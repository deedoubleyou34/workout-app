// Spotify panel — spec Phase 5 step 4. Used twice: full on the home screen,
// compact on the runner's rest screens (the only moment in a session when
// fiddling with music is reasonable).
//
// Every failure mode the spec lists gets a visible line rather than a hang or
// a console message: expired token, no active device, 429, 403, and no network.

import * as spotify from '../spotify.js';
import * as ducking from '../ducking.js';
import { clearPickerCache } from './picker.js';

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

// The runner redraws its rest screen on every repaint, so only the newest
// compact panel PER PLACE is allowed to keep polling. Keyed, because the
// music sheet and the rest screen can be on screen at the same time and one
// must not silence the other.
const stopPrevious = new Map();

// container: where to draw. compact: the runner's one-line version.
// key: which compact slot this is ('rest', 'sheet', ...).
export function renderMusic(container, { compact = false, key = 'default' } = {}) {
  let timer = null;
  let disposed = false;

  const root = el('div', 'music' + (compact ? ' music-compact' : ''));
  container.append(root);
  if (compact) {
    const previous = stopPrevious.get(key);
    if (previous) previous();
    stopPrevious.set(key, () => stop());
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
          // Spotify drops the active device after a while idle — commonest
          // after a force-quit. withDevice hands playback back to the last
          // device we saw and retries once, so a control press works instead
          // of telling him to go open Spotify first.
          await spotify.withDevice(fn);
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
      // A second tap closes the list (Dom, 2026-08-25: it opened but never
      // dropped back down). `open` is tracked rather than inferred from
      // childNodes, because the "no devices" branch also leaves a child behind
      // and that state has to close on the next tap too.
      let devicesOpen = false;
      pick.onclick = async () => {
        devices.innerHTML = '';
        if (devicesOpen) {
          devicesOpen = false;
          pick.textContent = 'Devices…';
          pick.classList.remove('btn-primary');
          return;
        }
        devicesOpen = true;
        pick.textContent = 'Devices ▴';
        pick.classList.add('btn-primary');
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

      // ---- what Spotify will actually let this app do ----
      // Two things we cannot know from the PC: whether the stored token has
      // the read scopes, and whether Spotify still answers /search for an app
      // registered after its 2024 cutoff. Both are one tap to find out, and
      // both change what the picker can offer.
      const access = el('div', 'duckbox');
      const accessLine = el('p', 'musicnote', '');
      const missing = spotify.missingLibraryScopes();
      accessLine.textContent = missing.length
        ? 'Browsing your library needs a one-time reconnect (missing: ' + missing.join(', ') + ').'
        : 'Your library is readable — browsing works.';
      access.append(accessLine);
      if (missing.length) {
        const again = el('button', 'btn btn-small', 'Reconnect Spotify');
        again.onclick = () => spotify.beginLogin();
        access.append(again);
      }
      const searchLine = el('p', 'musicnote', '');
      const testSearch = el('button', 'btn btn-small', 'Test search');
      testSearch.onclick = async () => {
        testSearch.disabled = true;
        searchLine.textContent = 'Asking Spotify…';
        searchLine.classList.remove('bad');
        try {
          const found = await spotify.search('test');
          searchLine.textContent = 'Search works — ' + found.playlists.length + ' playlists, '
            + found.albums.length + ' albums came back.';
        } catch (err) {
          searchLine.textContent = 'Search unavailable: ' + (err.message || 'failed')
            + (err.status === 403 ? ' — the picker will list your own library instead.' : '');
          searchLine.classList.add('bad');
        } finally {
          testSearch.disabled = false;
        }
      };
      access.append(testSearch, searchLine);
      root.append(access);

      // ---- ducking: what cues will do to the music, spec Phase 6 step 5 ----
      const duckBox = el('div', 'duckbox');
      const duckLine = el('p', 'musicnote', 'Cues over music: not checked yet.');
      const duckBtn = el('button', 'btn btn-small', 'Check cues over music');
      duckBtn.onclick = async () => {
        duckBtn.disabled = true;
        duckLine.textContent = 'Checking this device…';
        try {
          showDuckPlan(await ducking.begin({ force: true }));
        } catch (err) {
          duckLine.textContent = err.message || 'Could not check.';
        } finally {
          duckBtn.disabled = false;
        }
      };
      duckBox.append(duckLine, duckBtn);
      root.append(duckBox);

      function showDuckPlan(plan) {
        duckBox.querySelector('.escape')?.remove();
        if (!plan) return;
        const where = plan.deviceName ? ' (' + plan.deviceName + ')' : '';
        if (plan.strategy === 'duck') {
          duckLine.textContent = 'Cues dip the music to ' + ducking.DUCK_LEVEL
            + '% and put it straight back' + where + '.';
          return;
        }
        duckLine.textContent = plan.note || (plan.strategy === 'pause'
          ? 'This device will not allow a remote volume change, so cues pause the music instead'
            + where + '.'
          : 'Cues will play over the music at full volume' + where + '.');
        // Only worth saying when the device actually refused something.
        if (plan.probed) {
          duckBox.append(el('p', 'musicnote escape',
            'Escape hatch: run Spotify on a Bluetooth speaker or the PC instead of the iPhone. '
            + 'That sidesteps the iOS audio-session conflict entirely, and volume control usually '
            + 'works on those devices. It is a better answer than any amount of code here.'));
        }
      }
      showDuckPlan(ducking.currentPlan());

      const out = el('button', 'btn btn-small', 'Disconnect');
      out.onclick = async () => {
        if (!confirm('Disconnect Spotify? You will need to log in again.')) return;
        await spotify.disconnect();
        clearPickerCache();      // his library is no longer ours to show
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
