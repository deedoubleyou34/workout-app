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
export const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
].join(' ');

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
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
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
    throw new SpotifyError(kind, message, { status: res.status });
  }
  if (res.status === 200) return res.json().catch(() => null);
  return null;
}

export const player = {
  state: () => request('/me/player'),
  devices: () => request('/me/player/devices').then((d) => (d && d.devices) || []),
  play: (deviceId) => request('/me/player/play', { method: 'PUT', query: deviceId ? { device_id: deviceId } : null }),
  pause: () => request('/me/player/pause', { method: 'PUT' }),
  next: () => request('/me/player/next', { method: 'POST' }),
  previous: () => request('/me/player/previous', { method: 'POST' }),
  transfer: (deviceId) => request('/me/player', { method: 'PUT', body: { device_ids: [deviceId], play: true } }),
};

// "Track — Artist", or null when nothing is playing.
export function nowPlayingText(state) {
  const item = state && state.item;
  if (!item) return null;
  const artists = (item.artists || []).map((a) => a.name).join(', ');
  return artists ? item.name + ' — ' + artists : item.name;
}
