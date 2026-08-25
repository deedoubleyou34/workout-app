// Spotify auth and playback control — spec Phase 5.
//
// Authorization Code with PKCE. A static site on GitHub Pages cannot hold a
// client secret, and PKCE is the flow designed for exactly that. There is no
// server anywhere in this: the phone talks to Spotify directly.
//
// Two things about tokens that the spec calls out and that WILL bite:
//   - An access token lasts one hour. Sessions run up to two. A token expires
//     mid-session EVERY session, so refresh is proactive on a timer, not
//     reactive on a 401. The 401 path is kept as a backstop, not the plan.
//   - Spotify rotates refresh tokens. A refresh response that carries a new
//     refresh_token replaces the stored one, or the next refresh fails.
//
// Never called from here: audio-features, audio-analysis, recommendations,
// related-artists, featured-playlists, category playlists, 30-second previews.
// All of them 403 for any app registered after 2024-11-27, and ours was
// (spec §1.2). Player endpoints are unaffected.

import { idbGet, idbPut } from './db.js';

export const CLIENT_ID = 'cf46be5104434a87948db209215d61f7';
// The three player scopes have been here since Phase 5. The three read scopes
// are new (2026-08-25) and exist only so the in-app picker can list what Dom
// already has. They are read-only: nothing here ever modifies a playlist or
// his library.
//
// Adding them means every token issued before this build is under-scoped, so
// browsing prompts for a reconnect. hasScope() below is how that is detected
// WITHOUT provoking a 403 — it reads the scope string Spotify returned with
// the token, so it works offline.
export const SCOPE_LIST = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-library-read',
];
export const SCOPES = SCOPE_LIST.join(' ');

export const LIBRARY_SCOPES = ['playlist-read-private', 'user-library-read'];

const AUTH_KEY = 'spotify-auth';       // IndexedDB: tokens, kept out of the .sqlite export
const PKCE_KEY = 'spotify-pkce';       // localStorage: survives the redirect out and back
const API = 'https://api.spotify.com/v1';
const ACCOUNTS = 'https://accounts.spotify.com';

// Refresh this long before the token actually dies. Ten minutes covers a
// backgrounded app that wakes up late.
const REFRESH_MARGIN_MS = 10 * 60 * 1000;

// ---------- errors ----------

export class SpotifyError extends Error {
  constructor(kind, message, extra = {}) {
    super(message);
    this.kind = kind;
    Object.assign(this, extra);
  }
}

// Status -> something worth showing a human. Pure, so it is testable.
export function describeError(status, reason = '') {
  if (status === 401) return ['expired', 'Spotify login expired. Connect again.'];
  if (status === 403 && /premium/i.test(reason)) return ['premium', 'Playback control needs Spotify Premium.'];
  // The one 403 that decides the whole ducking strategy (spec Phase 6 step 1):
  // this device will not let anyone set its volume remotely.
  if (status === 403 && /VOLUME_CONTROL_DISALLOW/i.test(reason)) {
    return ['volume_disallowed', 'This device will not let Spotify set its volume remotely.'];
  }
  if (status === 403) return ['forbidden', 'Spotify refused that: ' + (reason || 'not allowed on this device') + '.'];
  if (status === 404 || /NO_ACTIVE_DEVICE/i.test(reason)) {
    return ['no_device', 'No active device. Start something playing in Spotify, then come back.'];
  }
  if (status === 429) return ['rate_limited', 'Spotify is rate-limiting. Waiting a moment.'];
  if (status >= 500) return ['spotify_down', 'Spotify is having a problem. Try again shortly.'];
  return ['error', 'Spotify request failed (' + status + ').'];
}

// 429 responses carry Retry-After in SECONDS.
export function retryAfterMs(headers) {
  const raw = headers && typeof headers.get === 'function' ? headers.get('Retry-After') : null;
  const secs = Number(raw);
  return Number.isFinite(secs) && secs > 0 ? secs * 1000 : 1000;
}

// ---------- PKCE ----------

function randomString(len = 64) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[b % 62]).join('');
}

function base64url(buffer) {
  let s = '';
  for (const b of new Uint8Array(buffer)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function challengeFor(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(digest);
}

// Must match the registered redirect URI EXACTLY, including the trailing
// slash — Spotify compares strings, not URLs.
export function redirectUri() {
  return location.origin + location.pathname.replace(/index\.html$/, '');
}

// ---------- stored tokens ----------

let auth = null;          // { access_token, refresh_token, expires_at, scope }
let refreshTimer = null;
let inflightRefresh = null;

export async function loadAuth() {
  if (auth === null) auth = (await idbGet(AUTH_KEY)) || false;
  return auth || null;
}

async function saveAuth(next) {
  auth = next;
  await idbPut(AUTH_KEY, next);
  scheduleRefresh();
}

export function isConnected() {
  return !!(auth && auth.refresh_token);
}

// Does the stored token actually carry this permission? Reading the granted
// scope string beats calling the endpoint and catching the 403: it is instant,
// works offline, and lets the UI explain itself before Dom taps anything.
export function hasScope(scope) {
  if (!auth || !auth.scope) return false;
  return String(auth.scope).split(/\s+/).includes(scope);
}

export function missingLibraryScopes() {
  return LIBRARY_SCOPES.filter((s) => !hasScope(s));
}

export async function disconnect() {
  auth = false;
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = null;
  await idbPut(AUTH_KEY, null);
}

// Pure: is this token close enough to death to replace now?
export function needsRefresh(expiresAt, now = Date.now(), margin = REFRESH_MARGIN_MS) {
  if (!expiresAt) return true;
  return expiresAt - now <= margin;
}

function scheduleRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = null;
  if (!isConnected()) return;
  // fire at the margin, and never further out than 50 minutes: a timer that
  // long is unreliable on iOS anyway, which is what the visibility hook is for
  const delay = Math.max(Math.min(auth.expires_at - Date.now() - REFRESH_MARGIN_MS, 50 * 60 * 1000), 5000);
  refreshTimer = setTimeout(() => { refresh().catch(() => {}); }, delay);
}

async function tokenRequest(body) {
  const res = await fetch(ACCOUNTS + '/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new SpotifyError('auth_failed',
      'Spotify login failed: ' + (data.error_description || data.error || res.status));
  }
  return data;
}

// grant -> stored auth. Spotify may or may not return a new refresh_token;
// when it does, the old one stops working, so keep whichever is newest.
async function storeGrant(data, previous = auth) {
  await saveAuth({
    access_token: data.access_token,
    refresh_token: data.refresh_token || (previous && previous.refresh_token) || null,
    expires_at: Date.now() + (data.expires_in || 3600) * 1000,
    scope: data.scope || SCOPES,
  });
  return auth;
}

export async function refresh(force = false) {
  await loadAuth();
  if (!isConnected()) return null;
  if (!force && !needsRefresh(auth.expires_at)) return auth.access_token;
  if (inflightRefresh) return inflightRefresh;       // never two at once
  inflightRefresh = (async () => {
    try {
      const data = await tokenRequest({
        grant_type: 'refresh_token',
        refresh_token: auth.refresh_token,
        client_id: CLIENT_ID,
      });
      await storeGrant(data);
      return auth.access_token;
    } finally {
      inflightRefresh = null;
    }
  })();
  return inflightRefresh;
}

// The token to use right now, refreshed first if it is close to expiry.
export async function ensureToken() {
  await loadAuth();
  if (!isConnected()) return null;
  if (needsRefresh(auth.expires_at)) return refresh();
  return auth.access_token;
}

// ---------- login ----------

export async function beginLogin() {
  const verifier = randomString(64);
  const state = randomString(16);
  localStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state }));
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri(),
    code_challenge_method: 'S256',
    code_challenge: await challengeFor(verifier),
    state,
    scope: SCOPES,
  });
  // A same-window navigation keeps this inside the installed PWA. window.open
  // would hand the whole flow to a stray Safari tab and the redirect would
  // never come back to the app.
  location.assign(ACCOUNTS + '/authorize?' + params.toString());
}

// Pure: what did Spotify send back on the redirect?
export function callbackParams(search) {
  const p = new URLSearchParams(search || '');
  const code = p.get('code');
  const error = p.get('error');
  if (!code && !error) return null;
  return { code, error, state: p.get('state') };
}

// Called once on load when the URL carries ?code=. Returns a status string for
// the UI: 'connected' | 'denied' | 'stale' | null (nothing to do).
export async function handleRedirect() {
  const params = callbackParams(location.search);
  if (!params) return null;
  const clean = () => history.replaceState({}, '', redirectUri() + location.hash);
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(PKCE_KEY) || 'null');
  } catch { /* corrupt, treated as missing */ }
  localStorage.removeItem(PKCE_KEY);
  clean();

  if (params.error) return 'denied';
  // state mismatch: this redirect is not the one this app started
  if (!saved || !saved.verifier || saved.state !== params.state) return 'stale';

  const data = await tokenRequest({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: redirectUri(),
    client_id: CLIENT_ID,
    code_verifier: saved.verifier,
  });
  await storeGrant(data, null);
  return 'connected';
}

// Refresh on resume: a phone that slept through the timer wakes up with a
// token that is already dead.
export function watchForeground() {
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    // a cold launch straight into the runner may not have read the tokens yet
    await loadAuth();
    if (!isConnected()) return;
    if (needsRefresh(auth.expires_at)) refresh().catch(() => {});
    else scheduleRefresh();
  });
}

// ---------- the API ----------

async function request(path, { method = 'GET', body = null, query = null, retry = true } = {}) {
  const token = await ensureToken();
  if (!token) throw new SpotifyError('not_connected', 'Not connected to Spotify.');
  const url = API + path + (query ? '?' + new URLSearchParams(query) : '');

  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: 'Bearer ' + token,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    // no network: say so instead of hanging or throwing something cryptic
    throw new SpotifyError('offline', 'No connection — Spotify controls need the network.');
  }

  if (res.status === 401 && retry) {
    await refresh(true);
    return request(path, { method, body, query, retry: false });
  }
  if (res.status === 204 || res.status === 202) return null;   // nothing playing / accepted
  if (res.status === 429) {
    throw new SpotifyError('rate_limited', 'Spotify is rate-limiting. Try again in a moment.',
      { retryAfterMs: retryAfterMs(res.headers) });
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const reason = (data.error && (data.error.reason || data.error.message)) || '';
    const [kind, message] = describeError(res.status, reason);
    // `reason` is Spotify's own machine-readable string. The ducking probe
    // branches on it, so it must survive the throw.
    throw new SpotifyError(kind, message, { status: res.status, reason });
  }
  if (res.status === 200) return res.json().catch(() => null);
  return null;
}

// ---------- waking a device back up ----------
//
// Dom, 2026-08-25: after a force-quit he reopened the app and "it doesn't allow
// me to start spotify where it left off unless I start playing music on a
// device that has spotify."
//
// That is Spotify's own behaviour, not a bug here: it drops the ACTIVE device
// after a spell of inactivity, and every /me/player command then 404s with
// NO_ACTIVE_DEVICE. There is no endpoint that says "resume on whatever was
// last playing" — but PUT /me/player (transfer) will hand playback to a device
// that is merely awake, which is what the phone's Spotify app is.
//
// So the last device this app saw playing is remembered, and wake() puts
// playback back on it: that one, if it is still listed; otherwise whatever is.
const LAST_DEVICE_KEY = 'spotify-last-device';
let lastDevice = null;

export function rememberDevice(device) {
  if (!device || !device.id) return;
  if (lastDevice && lastDevice.id === device.id) return;
  lastDevice = { id: device.id, name: device.name || 'your last device' };
  idbPut(LAST_DEVICE_KEY, lastDevice).catch(() => {});
}

export async function lastKnownDevice() {
  if (lastDevice) return lastDevice;
  lastDevice = (await idbGet(LAST_DEVICE_KEY)) || null;
  return lastDevice;
}

// Returns the device playback landed on, or null if there was nothing to wake.
// Throws only what the transfer itself threw.
export async function wake() {
  const list = await player.devices();
  if (!list.length) return null;
  const remembered = await lastKnownDevice();
  const target = (remembered && list.find((d) => d.id === remembered.id))
    || list.find((d) => d.is_active) || list[0];
  if (!target) return null;
  await player.transfer(target.id);
  rememberDevice(target);
  return target;
}

// Run a playback command, and if Spotify says there is no active device, wake
// one and try exactly once more. One retry, never a loop: if the second
// attempt fails there is nothing awake to talk to and the caller's error line
// is the honest answer.
export async function withDevice(fn) {
  try {
    return await fn();
  } catch (err) {
    if (!err || err.kind !== 'no_device') throw err;
    const woken = await wake();
    if (!woken) throw err;
    return fn();
  }
}

export const player = {
  state: () => request('/me/player').then((st) => {
    if (st && st.device) rememberDevice(st.device);
    return st;
  }),
  devices: () => request('/me/player/devices').then((d) => (d && d.devices) || []),
  // With no contextUri this sends NO body, which resumes whatever was playing.
  // Passing a body with a context_uri would restart a playlist from track one,
  // which is right for a phase change and very wrong after a voice cue.
  play: (deviceId, contextUri = null) => request('/me/player/play', {
    method: 'PUT',
    query: deviceId ? { device_id: deviceId } : null,
    body: contextUri ? { context_uri: contextUri } : null,
  }),
  shuffle: (state, deviceId) => request('/me/player/shuffle', {
    method: 'PUT',
    query: { state: state ? 'true' : 'false', ...(deviceId ? { device_id: deviceId } : {}) },
  }),
  pause: () => request('/me/player/pause', { method: 'PUT' }),
  next: () => request('/me/player/next', { method: 'POST' }),
  previous: () => request('/me/player/previous', { method: 'POST' }),
  transfer: (deviceId) => request('/me/player', { method: 'PUT', body: { device_ids: [deviceId], play: true } }),
  // 204 on success — "did not throw" is the only signal there is.
  volume: (percent, deviceId) => request('/me/player/volume', {
    method: 'PUT',
    query: { volume_percent: String(Math.round(percent)), ...(deviceId ? { device_id: deviceId } : {}) },
  }),
};

// ---------- library and search (read-only) ----------
//
// Every one of these is a current endpoint. None of the deprecated set is
// touched anywhere in this file: no audio-features, audio-analysis,
// recommendations, related-artists, featured-playlists, category playlists or
// 30-second previews. They 403 for any app registered after 2024-11-27, and
// ours was (spec §1.2).

// Spotify's own lists can contain nulls — playlist search is the usual
// offender — and a null in a render loop is a blank screen.
const clean = (items) => (items || []).filter(Boolean);

function asSource(item, type) {
  if (!item || !item.uri) return null;
  const by = type === 'album' && item.artists
    ? clean(item.artists).map((a) => a.name).join(', ')
    : (item.owner && item.owner.display_name) || '';
  return {
    uri: item.uri,
    type,
    name: item.name,
    by,
    tracks: (item.tracks && item.tracks.total) || item.total_tracks || null,
    image: (clean(item.images)[0] || {}).url || null,
  };
}

export const library = {
  // GET /me/playlists — needs playlist-read-private (and -collaborative for
  // playlists shared with him).
  async playlists({ limit = 50, offset = 0 } = {}) {
    const data = await request('/me/playlists', { query: { limit: String(limit), offset: String(offset) } });
    return {
      items: clean(data && data.items).map((i) => asSource(i, 'playlist')).filter(Boolean),
      next: !!(data && data.next),
      total: (data && data.total) || 0,
    };
  },
  // GET /me/albums — needs user-library-read. Saved albums arrive wrapped.
  async albums({ limit = 50, offset = 0 } = {}) {
    const data = await request('/me/albums', { query: { limit: String(limit), offset: String(offset) } });
    return {
      items: clean(data && data.items).map((i) => asSource(i && i.album, 'album')).filter(Boolean),
      next: !!(data && data.next),
      total: (data && data.total) || 0,
    };
  },
};

// GET /search — no extra scope. Whether it still answers for apps registered
// after the 2024 cutoff is the one thing we could not verify from the PC, so
// the picker treats a 403 here as "search is unavailable" and carries on with
// the library lists rather than breaking.
export async function search(q, { types = ['playlist', 'album'], limit = 12 } = {}) {
  const text = String(q || '').trim();
  if (!text) return { playlists: [], albums: [] };
  return parseSearchResults(await request('/search', {
    query: { q: text, type: types.join(','), limit: String(limit) },
  }));
}

// Split out so it can be tested without a network. Search responses are the
// one place Spotify reliably returns nulls inside items[], and a null reaching
// a render loop is a blank screen.
export function parseSearchResults(data) {
  return {
    playlists: clean(data && data.playlists && data.playlists.items)
      .map((i) => asSource(i, 'playlist')).filter(Boolean),
    albums: clean(data && data.albums && data.albums.items)
      .map((i) => asSource(i, 'album')).filter(Boolean),
  };
}

// "Track — Artist", or null when nothing is playing.
export function nowPlayingText(state) {
  const item = state && state.item;
  if (!item) return null;
  const artists = (item.artists || []).map((a) => a.name).join(', ');
  return artists ? item.name + ' — ' + artists : item.name;
}
