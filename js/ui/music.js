// Spotify panel — spec Phase 5 step 4. Used twice: full on the home screen,
// compact on the runner's rest screens (the only moment in a session when
// fiddling with music is reasonable).
//
// Every failure mode the spec lists gets a visible line rather than a hang or
// a console message: expired token, no active device, 429, 403, and no network.

import * as spotify from '../spotify.js';

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

// The runner redraws its rest screen on every repaint, so only the newest
// compact panel is allowed to keep polling.
let stopPreviousCompact = null;

// container: where to draw. compact: the runner's one-line version.
export function renderMusic(container, { compact = false } = {}) {
  let timer = null;
  let disposed = false;

  const root = el('div', 'music' + (compact ? ' music-compact' : ''));
  container.append(root);
  if (compact) {
    if (stopPreviousCompact) stopPreviousCompact();
    stopPreviousCompact = () => stop();
  }

  const stop = () => {
    disposed = true;
    if (timer) clearInterval(timer);
    timer = null;
  };
  // the caller redraws the whole screen; when this node leaves the document,
  // its polling has to stop with it
  const alive = () => !disposed && root.isConnected;

  async function draw() {
    await spotify.loadAuth();
    root.innerHTML = '';

    if (!spotify.isConnected()) {
      if (compact) return;                 // no login prompts mid-session
      root.append(el('h2', null, 'Music'));
      const btn = el('button', 'btn btn-primary', 'Connect Spotify');
      btn.onclick = () => spotify.beginLogin();
      root.append(btn);
      root.append(el('p', 'muted',
        'Playback control needs Spotify Premium — that is Spotify’s rule, not the app’s. '
        + 'The app only controls what is already playing; it never becomes a music player.'));
      // The commonest reason a first login fails is a redirect URI in the
      // Spotify dashboard that does not match this one character for
      // character. Print it rather than make him guess it.
      root.append(el('p', 'musicnote',
        'Redirect URI (must match the Spotify dashboard exactly): ' + spotify.redirectUri()));
      return;
    }

    if (!compact) root.append(el('h2', null, 'Music'));

    const track = el('p', 'nowplaying', 'checking…');
    const note = el('p', 'musicnote', '');
    const controls = el('div', 'musicrow');

    const button = (label, title, fn) => {
      const b = el('button', 'btn musicbtn', label);
      b.title = title;
      b.onclick = async () => {
        b.disabled = true;
        try {
          await fn();
          note.textContent = '';
          // Spotify's own state lags its commands by a moment
          setTimeout(() => { if (alive()) refresh(); }, 500);
        } catch (err) {
          showError(err);
        } finally {
          b.disabled = false;
        }
      };
      return b;
    };

    let playing = false;
    const prev = button('⏮', 'Previous track', () => spotify.player.previous());
    const toggle = button('⏯', 'Play / pause',
      () => (playing ? spotify.player.pause() : spotify.player.play()));
    const next = button('⏭', 'Next track', () => spotify.player.next());
    controls.append(prev, toggle, next);

    if (!compact) {
      const refreshBtn = button('↻', 'Re-read what Spotify is doing', async () => {});
      controls.append(refreshBtn);
    }

    root.append(track, controls, note);

    if (!compact) {
      const devices = el('div', 'musicdevices');
      root.append(devices);

      const pick = el('button', 'btn btn-small', 'Devices…');
      pick.onclick = async () => {
        devices.innerHTML = '';
        try {
          const list = await spotify.player.devices();
          if (!list.length) {
            devices.append(el('p', 'musicnote',
              'No devices. Open Spotify on the phone and start something playing, then come back.'));
            return;
          }
          for (const d of list) {
            const b = el('button', 'btn btn-small' + (d.is_active ? ' btn-primary' : ''),
              d.name + (d.is_active ? ' · active' : ''));
            b.onclick = async () => {
              try {
                await spotify.player.transfer(d.id);
                note.textContent = 'Moved playback to ' + d.name + '.';
                setTimeout(() => { if (alive()) refresh(); }, 700);
              } catch (err) { showError(err); }
            };
            devices.append(b);
          }
        } catch (err) { showError(err); }
      };

      const out = el('button', 'btn btn-small', 'Disconnect');
      out.onclick = async () => {
        if (!confirm('Disconnect Spotify? You will need to log in again.')) return;
        await spotify.disconnect();
        draw();
      };
      const row = el('div', 'btnrow');
      row.append(pick, out);
      root.append(row);
    }

    function showError(err) {
      // Mid-session, a dead network is not news: the app is built to work
      // without one. Say it once, quietly, and do not paint it as a failure.
      if (compact && err && (err.kind === 'offline' || err.kind === 'not_connected')) {
        track.textContent = 'Music offline';
        note.textContent = '';
        note.classList.remove('bad');
        return;
      }
      note.textContent = err && err.message ? err.message : 'Spotify request failed.';
      note.classList.toggle('bad', true);
      if (err && (err.kind === 'expired' || err.kind === 'auth_failed')) {
        const again = el('button', 'btn btn-small', 'Connect again');
        again.onclick = () => spotify.beginLogin();
        note.append(document.createTextNode(' '));
        note.append(again);
      }
    }

    async function refresh() {
      if (!alive()) return stop();
      try {
        const state = await spotify.player.state();
        const text = spotify.nowPlayingText(state);
        playing = !!(state && state.is_playing);
        track.textContent = text
          ? (playing ? '▶ ' : '⏸ ') + text
          : 'Nothing playing. Start a track in Spotify.';
        toggle.textContent = playing ? '⏸' : '▶';
        note.classList.remove('bad');
        if (!text) note.textContent = '';
      } catch (err) {
        track.textContent = 'Spotify';
        showError(err);
      }
    }

    await refresh();
    timer = setInterval(() => {
      if (!alive()) return stop();
      if (document.visibilityState === 'visible') refresh();
    }, compact ? 15000 : 10000);
  }

  draw();
  return stop;
}
