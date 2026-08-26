// Execute every screen in Node against a real seeded database.
// Usage: node tools/verify_screens.mjs   (from the repo root)
//
// Until this existed, the UI modules had never RUN anywhere: `node --check`
// proves syntax and verify_imports.mjs proves the names exist, but neither
// catches `step.taget`, a wrong argument order, or a null read. Those are
// blank screens on Dom's phone, mid-session, during weeks he cannot redo.
//
// The DOM stub is strict on purpose (see tools/domstub.mjs): an unimplemented
// property read is an error, not a silent undefined.
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { installDom, clearAllTimers, liveTimerCount } from './domstub.mjs';

const require = createRequire(import.meta.url);
const initSqlJs = require('../vendor/sql-wasm.js');

const { idb } = installDom({ root: process.cwd() });
// A live token, so the picker's connected path can actually run. spotify.js
// caches auth on first read, so this has to be in place before the imports.
idb.set('spotify-auth', {
  access_token: 'test-token',
  refresh_token: 'test-refresh',
  expires_at: Date.now() + 60 * 60 * 1000,
  scope: 'user-read-playback-state user-modify-playback-state user-read-currently-playing '
    + 'playlist-read-private playlist-read-collaborative user-library-read',
});
globalThis.window.initSqlJs = () => initSqlJs({ locateFile: (f) => 'vendor/' + f });

// modules must be imported AFTER the globals exist
const { initDb, getDb, query, persist, exportSqliteBlob, exportJsonBlob,
        exportCsvBlob, importBytes } = await import('../js/db.js');
const { renderHome } = await import('../js/ui/home.js');
const { renderDay } = await import('../js/ui/day.js');
const { renderRun } = await import('../js/ui/run.js');
const { renderDashboard } = await import('../js/ui/dashboard.js');
const { renderSettings } = await import('../js/ui/settings.js');
const { openPicker, clearPickerCache } = await import('../js/ui/picker.js');
const spotify = await import('../js/spotify.js');
const { buildSteps, stepTarget } = await import('../js/runner.js');
const { saveRunnerState } = await import('../js/sessions.js');

let failures = 0;
function check(name, ok, detail = '') {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  [' + detail + ']' : ''));
  if (!ok) failures++;
}

// Click handlers in the app are async (audio unlock, wake lock, persist), so
// the harness has to let the microtask queue drain before looking at what the
// click produced. Without this it reads the screen the click was leaving.
const tick = async (n = 3) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};

function screen() {
  const root = globalThis.document.createElement('main');
  globalThis.document.body.append(root);
  return root;
}

function contains(root, text) {
  return root.textContent.includes(text);
}

async function render(name, fn) {
  const root = screen();
  try {
    await fn(root);
    return root;
  } catch (err) {
    check(name + ' renders', false, err.message);
    console.log(String(err.stack).split('\n').slice(1, 4).join('\n'));
    return null;
  }
}

await initDb();
const db = getDb();

// ---------------------------------------------------------------- empty app
{
  const home = await render('home (empty)', (root) => renderHome(root));
  if (home) {
    check('home renders on a brand-new database', true);
    check('home shows the power level', contains(home, 'Power level'), home.textContent.slice(0, 60));
    check('home names the next day up', /Day [1-4]/.test(home.textContent));
    check('home offers a run link', !!home.querySelector('.nextstart'));
    check('a fresh database does NOT nag for a backup', !home.querySelector('.backupcard'));

      // ---- the CSS guard that would have caught the resume overlap ----
    // An <a> is display:inline, where vertical padding, border and min-height
    // do not affect line height — so a .btn anchor paints over its neighbours.
    {
      const css = readFileSync('css/app.css', 'utf8');
      const at = css.indexOf('\na.btn');
      const body = at < 0 ? null : css.slice(at, css.indexOf('}', at) + 1);
      check('a.btn declares a display, so an anchor-as-button cannot overlap',
        !!body && /display:\s*(inline-block|block|flex)/.test(body),
        body ? body.replace(/\s+/g, ' ').slice(0, 70) : 'no a.btn rule at all');
    }

  // ---- build 025: the home screen Dom asked for ----
    // The slim music bar is PERMANENT. Nothing about being logged out of
    // Spotify, or having no data, is allowed to remove it.
    check('the slim music bar is there on a brand-new database',
      !!home.querySelector('.slimbar'));
    // It reads its state from IndexedDB and then asks Spotify, so its first
    // text is a placeholder until that resolves — the same one frame Dom would
    // see on the phone. The harness carries a token but has no network, so the
    // state it settles into here is the offline one.
    await tick(4);
    const slimText = home.querySelector('.slimbar').textContent;
    check('the slim bar settles on a quiet, readable line rather than an error',
      /Music offline|not connected|Nothing playing|—/.test(slimText)
      && !/undefined|\[object|Error/.test(slimText), slimText);
    check('a dead network is not painted as a failure there',
      !home.querySelector('.slimbar').classList.contains('bad'), slimText);
    check('the full Music card is still at the bottom, below the slim bar',
      home.children.indexOf(home.querySelector('.musicsec'))
      > home.children.indexOf(home.querySelector('.slimsec')));
    // Dom, 2026-08-25: "add music bar to the top of the screen".
    check('the slim bar is the FIRST thing on the page',
      home.children.indexOf(home.querySelector('.slimsec')) === 0,
      'index ' + home.children.indexOf(home.querySelector('.slimsec')));
    check('and it sits above the app title',
      home.children.indexOf(home.querySelector('.slimsec'))
      < home.children.indexOf(home.querySelector('.top')));

    // Nothing has been trained, so there is nothing to resume.
    check('no resume card on a database with no live session',
      !home.querySelector('.resumecard'));

    // All days is a drop-down, closed, and Next up now sits BELOW it.
    const drawer = home.querySelector('.daylist');
    check('the day list is a drop-down tab bar', !!drawer && !!drawer.querySelector('.drawertab'));
    check('and it starts closed', drawer && !drawer.classList.contains('open'));
    check('the day cards are all in the drawer, not loose on the page',
      home.querySelectorAll('.daylist .drawerbody .daycard').length === 5,
      home.querySelectorAll('.daylist .drawerbody .daycard').length + ' cards');
    check('Next up has dropped below the day drawer',
      home.children.indexOf(home.querySelector('.nextsec'))
      > home.children.indexOf(drawer));
    if (drawer) {
      drawer.querySelector('.drawertab').click();
      check('tapping the tab bar opens it', drawer.classList.contains('open'));
      drawer.querySelector('.drawertab').click();
      check('and tapping again closes it', !drawer.classList.contains('open'));
    }

    // Data collapses the same way (Dom, 2026-08-25: "Collapse data section
    // into a tab as well to save on screen space").
    const dataDrawer = home.querySelector('.datasec');
    check('Data is a drawer too', !!dataDrawer && !!dataDrawer.querySelector('.drawertab'));
    check('and it starts closed', dataDrawer && !dataDrawer.classList.contains('open'));
    if (dataDrawer) {
      check('every export and all three links are inside it',
        dataDrawer.querySelectorAll('.drawerbody .btn').length >= 4
        && dataDrawer.querySelectorAll('.drawerbody .testlink').length === 3,
        dataDrawer.querySelectorAll('.drawerbody .btn').length + ' buttons, '
          + dataDrawer.querySelectorAll('.drawerbody .testlink').length + ' links');
      // Dom went looking for a way to wipe everything and could not find it
      // behind a link that only said "Settings".
      check('and the full wipe is named outright, not hidden behind "Settings"',
        !!dataDrawer.querySelector('.freshlink')
        && dataDrawer.querySelector('.freshlink').textContent.includes('delete all training data'),
        dataDrawer.querySelector('.freshlink')
          ? dataDrawer.querySelector('.freshlink').textContent : 'missing');
      dataDrawer.querySelector('.drawertab').click();
      check('tapping Data opens it', dataDrawer.classList.contains('open'));
      dataDrawer.querySelector('.drawertab').click();
      check('and tapping again closes it', !dataDrawer.classList.contains('open'));
    }
    // The build number must NOT be inside a drawer — it is the first thing to
    // check when a deploy lands, and it lives in the footer for that reason.
    check('the footer stays outside the Data drawer',
      !!home.querySelector('.foot')
      && home.children.indexOf(home.querySelector('.foot'))
        > home.children.indexOf(dataDrawer));

    // The power level is a goal tracker now: a form, a bar, and a legend.
    check('home names the current form', contains(home, 'Base'));
    check('home says what the next form costs', contains(home, 'more to Kaio-ken'));
    check('the progress bar toward it is drawn', !!home.querySelector('.tierfill'));
    check('the legend lists every contributor',
      home.querySelectorAll('.legendrows .legendrow').length === 6,
      home.querySelectorAll('.legendrows .legendrow').length + ' rows');
    check('the legend names the nightly contribution too', contains(home, 'nights logged'));
    check('the form repaints the app rather than only itself',
      globalThis.document.documentElement.dataset.tier === 'base',
      String(globalThis.document.documentElement.dataset.tier));
  }

  // ------------------------------------------- the Music card's Advanced tab
  //
  // Dom, 2026-08-25: "Tab the cue over music section as cue included devices
  // and disconnect for Spotify and test search." The card keeps the track and
  // the transport row; everything set up once goes behind one tab.
  {
    const { renderMusic } = await import('../js/ui/music.js');
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(typeof input === 'string' ? input : input.url);
      if (!url.startsWith('http')) return realFetch(input);
      return { ok: true, status: 200, headers: { get: () => null },
        json: async () => ({ is_playing: false, device: { id: 'd1', name: 'iPhone' }, item: null }) };
    };
    const root = screen();
    renderMusic(root);
    await tick(6);

    const drawer = root.querySelector('.musicadvanced');
    check('the Music card has an Advanced tab', !!drawer && !!drawer.querySelector('.drawertab'));
    check('and it starts closed', drawer && !drawer.classList.contains('open'));
    if (drawer) {
      const inside = drawer.textContent;
      check('Devices, Disconnect, Test search and the cue check are all inside it',
        ['Devices', 'Disconnect', 'Test search', 'Check cues over music']
          .every((t) => inside.includes(t)),
        inside.slice(0, 110));
      // The controls he uses mid-set must NOT be behind a tap.
      check('the transport controls stay outside the tab',
        !!root.querySelector('.musicrow')
        && !drawer.querySelector('.musicrow'));
      drawer.querySelector('.drawertab').click();
      check('tapping Advanced opens it', drawer.classList.contains('open'));
      drawer.querySelector('.drawertab').click();
      check('and tapping again closes it', !drawer.classList.contains('open'));
    }
    // It called an empty function and showed no sign it had done anything,
    // sitting in the transport row where Dom read it as a reset.
    check('the refresh button is gone from the transport row',
      !root.textContent.includes('↻'), root.querySelector('.musicrow').textContent);
    globalThis.fetch = realFetch;
    clearAllTimers();
  }

  // -------------------------------------------- Open Spotify when it is dead
  //
  // A force-quit Spotify is not in GET /me/player/devices at all, so no API
  // call can reach it. The only lever is a spotify: URL from a real tap.
  {
    const { renderMusic } = await import('../js/ui/music.js');
    const spotify = await import('../js/spotify.js');
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(typeof input === 'string' ? input : input.url);
      if (!url.startsWith('http')) return realFetch(input);
      if (url.includes('/me/player/devices')) {
        return { ok: true, status: 200, headers: { get: () => null },
          json: async () => ({ devices: [] }) };          // Spotify is not running
      }
      return { ok: false, status: 404, headers: { get: () => null },
        json: async () => ({ error: { status: 404, reason: 'NO_ACTIVE_DEVICE' } }) };
    };

    await spotify.clearWake();
    const root = screen();
    renderMusic(root, { contextUri: 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M' });
    await tick(6);
    const toggle = root.querySelectorAll('.musicbtn')[1];
    if (toggle) { toggle.click(); await tick(8); }

    const open = root.querySelector('.openspotify');
    check('a dead Spotify offers a way to start it, not a dead end', !!open,
      root.querySelector('.musicnote').textContent);
    if (open) {
      check('the link goes to the playlist this block is mapped to',
        open.href === 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M', String(open.href));
      check('and the message says what is actually wrong',
        root.textContent.includes('Spotify is not running'));
      open.click();
      await tick(4);
      const armed = await spotify.pendingWake();
      check('tapping it arms the resume so coming back finishes the job',
        !!armed && spotify.isFreshWake(armed), JSON.stringify(armed));
      await spotify.clearWake();
    }
    globalThis.fetch = realFetch;
    clearAllTimers();
  }

  // ---------------------------------------------- the revolving track name
  //
  // Dom, 2026-08-25: "the audio bar doesnt move in a rotating." When he said
  // that, this code had never executed ANYWHERE: the only paths the harness
  // reached passed marquee:false and short-circuited before the measurement,
  // and the DOM stub had no clientWidth to measure with — so the throw that
  // would have exposed it never happened either. These checks exist so that
  // cannot recur.
  {
    const { renderNowPlayingBar } = await import('../js/ui/music.js');
    const realFetch = globalThis.fetch;

    // A live player response, so setText runs with marquee: true.
    const playing = (title, artist) => ({
      is_playing: true,
      device: { id: 'dev1', name: 'iPhone', volume_percent: 60 },
      item: { name: title, artists: [{ name: artist }] },
    });

    const withTrack = async (title, artist, widths) => {
      globalThis.fetch = async (input) => {
        const url = String(typeof input === 'string' ? input : input.url);
        if (!url.startsWith('http')) return realFetch(input);
        return { ok: true, status: 200, headers: { get: () => null },
          json: async () => playing(title, artist) };
      };
      const root = screen();
      const stop = renderNowPlayingBar(root);
      await tick(6);
      const bar = root.querySelector('.slimbar');
      const win = root.querySelector('.slimwin');
      const text = root.querySelector('.slimtext');
      // Stand in for layout: the window is 300px, the text is whatever the
      // caller says. A browser measures this; Node cannot, so the harness does.
      win.clientWidth = widths.win;
      text.scrollWidth = widths.text;
      // re-run the measurement now that there is something to measure
      globalThis.dispatchWindow('resize');
      await tick(2);
      return { root, bar, stop };
    };

    // Long title in a narrow bar -> it revolves.
    {
      const { root, bar, stop } = await withTrack(
        'A Very Long Song Title That Will Not Fit', 'Some Band With A Long Name',
        { win: 300, text: 900 });
      check('a track too long for the bar revolves',
        bar.classList.contains('rolling'), bar.className);
      check('and the loop carries a duplicate copy so it wraps seamlessly',
        root.querySelectorAll('.slimtext')[1].textContent
          === root.querySelectorAll('.slimtext')[0].textContent,
        JSON.stringify(root.querySelectorAll('.slimtext').map((n) => n.textContent)));
      check('the scroll duration scales with the text rather than being fixed',
        root.querySelector('.slimtrack').style.getPropertyValue('--roll') === '22.5s',
        root.querySelector('.slimtrack').style.getPropertyValue('--roll'));
      check('the track name and artist are both on the bar',
        contains(root, 'A Very Long Song Title') && contains(root, 'Some Band'),
        root.querySelector('.slimtext').textContent);
      stop();
    }

    // Short title that fits -> it sits still. A short name crawling sideways
    // for no reason is worse than one that does not move.
    {
      const { bar, stop } = await withTrack('Go', 'Chemical Brothers',
        { win: 300, text: 120 });
      check('a track that fits does NOT revolve',
        !bar.classList.contains('rolling'), bar.className);
      stop();
    }

    // The failure that started this: measurement unavailable. A zero width
    // must read as "cannot tell yet", never as "it fits" — the fallback is to
    // scroll on character count, because degrading to silence IS the bug.
    {
      const { bar, stop } = await withTrack(
        'Another Extremely Long Track Name Indeed', 'And A Long Artist Too',
        { win: 0, text: 0 });
      check('a failed measurement falls back to scrolling, not to silence',
        bar.classList.contains('rolling'), bar.className);
      stop();
    }
    {
      const { bar, stop } = await withTrack('Short', 'Band', { win: 0, text: 0 });
      check('but a short name still does not scroll when measurement fails',
        !bar.classList.contains('rolling'), bar.className);
      stop();
    }

    globalThis.fetch = realFetch;
  }

  const day = await render('day 1', (root) => renderDay(root, 1));
  if (day) {
    // Day 1 opens on the couch stretch: one left set, one right set. An exact
    // count catches a bug that collapses several sets into one; "more than
    // none" would not.
    const buttons = day.querySelectorAll('.setbtn').length;
    check('day 1 renders one button per prescribed set', buttons === 2, buttons + ' buttons');
    check('day 1 shows the build number', contains(day, 'build'), '');
    check('day 1 shows section tabs', day.querySelectorAll('.tab').length > 0);
  }

  const nightly = await render('nightly (day 0)', (root) => renderDay(root, 0));
  if (nightly) check('the nightly screen renders', contains(nightly, 'Nightly'));

  const dash = await render('dashboard (empty)', (root) => renderDashboard(root));
  if (dash) {
    check('an empty dashboard says so rather than drawing nothing',
      contains(dash, 'Nothing to chart yet'));
    check('and still offers the nightly log', contains(dash, 'Log tonight'));
  }

  const settings = await render('settings', (root) => renderSettings(root));
  if (settings) {
    check('settings renders a music row per phase',
      settings.querySelectorAll('.phaserow').length === 4,
      settings.querySelectorAll('.phaserow').length + ' rows');
    check('settings offers the start-fresh button', contains(settings, 'Delete all training data'));
    check('settings offers a backup', contains(settings, 'Export .sqlite'));

    // the per-category overrides open to one row per runner category
    const toggle = settings.querySelectorAll('.btn-small')
      .find((b) => b.textContent.includes('Per-category overrides'));
    check('settings offers per-category overrides', !!toggle);
    if (toggle) {
      toggle.click();
      await tick();
      const reopened = globalThis.document.body.querySelectorAll('.phaserow').length;
      check('opening overrides shows all eleven categories plus the four phases',
        reopened === 15, reopened + ' rows');
      check('an un-overridden category explains what it follows',
        globalThis.document.body.textContent.includes('follows Main work'));
      toggle.click();
    }
  }

  // The picker's connected path: the library lists, the debounced search and
  // the 403 fallback are all new code that only ever runs against Spotify, so
  // this is the only place they execute at all.
  {
    const realFetch = globalThis.fetch;
    let searchStatus = 200;
    let searchCalls = 0;
    const api = (url) => {
      if (url.includes('/me/playlists')) {
        return { items: [null, { uri: 'spotify:playlist:p1', name: 'Gym Heavy', owner: { display_name: 'Dom' }, tracks: { total: 42 } }] };
      }
      if (url.includes('/me/albums')) {
        return { items: [{ album: { uri: 'spotify:album:a1', name: 'Blackout', artists: [{ name: 'Scorpions' }], total_tracks: 9 } }] };
      }
      if (url.includes('/search')) {
        searchCalls++;
        return { playlists: { items: [null, { uri: 'spotify:playlist:s1', name: 'Found Mix' }] }, albums: { items: [] } };
      }
      return {};
    };
    globalThis.fetch = async (input) => {
      const url = String(typeof input === 'string' ? input : input.url);
      if (!url.startsWith('http')) return realFetch(input);
      if (url.includes('/search') && searchStatus !== 200) {
        return {
          ok: false, status: searchStatus, headers: { get: () => null },
          json: async () => ({ error: { status: searchStatus, message: 'Forbidden' } }),
        };
      }
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => api(url) };
    };

    try {
      clearPickerCache();
      let picked = null;
      const sheet = openPicker({ title: 'Warm-up', onPick: (p) => { picked = p; } });
      await tick(6);
      check('the picker lists his own playlists and albums',
        sheet.textContent.includes('Gym Heavy') && sheet.textContent.includes('Blackout'),
        sheet.textContent.slice(0, 90));
      check('a null in Spotify\'s own list does not become a blank row',
        sheet.querySelectorAll('.pickeritem').length === 2,
        sheet.querySelectorAll('.pickeritem').length + ' rows');
      check('an album is labelled as one', sheet.textContent.includes('Scorpions'));

      // picking hands back a source and closes
      sheet.querySelectorAll('.pickeritem')[0].click();
      await tick();
      check('picking returns a playable source',
        picked && picked.uri === 'spotify:playlist:p1' && picked.type === 'playlist',
        JSON.stringify(picked));
      check('and the sheet closes behind it', !globalThis.document.querySelector('.picker'));

      // search: debounced, so it needs a real wait
      const s2 = openPicker({ title: 'Power', onPick: () => {} });
      await tick(6);
      const box = s2.querySelector('.pickersearch').children[0];
      box.value = 'sledge';
      box.dispatch('input');
      await new Promise((r) => setTimeout(r, 500));
      await tick(6);
      check('typing runs one debounced search, not one per keystroke', searchCalls === 1,
        searchCalls + ' calls');
      check('search results render', s2.textContent.includes('Found Mix'), s2.textContent.slice(0, 90));

      // and if Spotify refuses to let this app search at all
      searchStatus = 403;
      const box2 = s2.querySelector('.pickersearch').children[0];
      box2.value = 'anything';
      box2.dispatch('input');
      await new Promise((r) => setTimeout(r, 500));
      await tick(6);
      check('a 403 on search hides the box rather than looking broken',
        !s2.querySelector('.pickersearch'));
      check('and it falls back to the library with an explanation',
        s2.textContent.includes('will not let this app search'), s2.textContent.slice(0, 120));
      s2.remove();
    } catch (err) {
      check('the picker works when connected', false, err.message);
      console.log(String(err.stack).split('\n').slice(1, 4).join('\n'));
    }
    globalThis.fetch = realFetch;
  }

  // ...and with no account at all it must say so rather than reach for the API
  {
    await spotify.disconnect();
    clearPickerCache();
    let reachedApi = false;
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      if (String(input).startsWith('http')) { reachedApi = true; throw new Error('no network in the harness'); }
      return realFetch(input);
    };
    try {
      const sheet = openPicker({ title: 'Warm-up', onPick: () => {} });
      await tick();
      check('the picker opens', !!sheet);
      check('with no Spotify token it explains itself instead of hanging',
        sheet.textContent.includes('Not connected'), sheet.textContent.slice(0, 80));
      check('and it never calls the API when there is nothing to call it with', !reachedApi);
      sheet.remove();
    } catch (err) {
      check('the picker opens', false, err.message);
      console.log(String(err.stack).split('\n').slice(1, 4).join('\n'));
    }
    globalThis.fetch = realFetch;
  }

}

// ---------------------------------------------------------------- the runner
{
  const root = screen();
  try {
    renderRun(root, 4);
  } catch (err) {
    check('the runner gate renders', false, err.message);
    console.log(String(err.stack).split('\n').slice(1, 4).join('\n'));
  }
  const gate = root.querySelector('.gatecard');
  check('the runner opens behind a start gate', !!gate);
  check('the gate counts the session', /\d+ sets/.test(root.textContent), root.textContent.slice(0, 80));

  // "Start without voice": no AudioContext to stub, and the ducking path is
  // exercised separately below
  const silent = root.children.find((c) => c.textContent === 'Start without voice');
  check('the gate offers a silent start', !!silent);
  if (silent) {
    silent.click();
    await tick();
    check('the gate gives way to the session', !root.querySelector('.gatecard'));
    check('the first step is a set, not a rest', !!root.querySelector('.runcard'));
    check('the runner shows the build number', /b\w+/.test(root.textContent));

    // music is reachable from a set screen, not just from a rest
    const musicBtn = root.querySelector('.musicbtn-top');
    check('a music button sits on every runner screen', !!musicBtn);
    if (musicBtn) {
      const doneBefore = root.querySelector('.donebtn').textContent;
      musicBtn.click();
      await tick();
      const sheet = root.querySelector('.musicsheet');
      check('it opens a music sheet', !!sheet);
      check('and the Done button underneath is untouched',
        root.querySelector('.donebtn').textContent === doneBefore);
      if (sheet) sheet.remove();
    }
  }

  // walk forward through ~20 steps, pressing whatever the primary button is
  let logged = 0;
  let sawRest = false;
  let sawRing = false;
  for (let i = 0; i < 20; i++) {
    const before = query('SELECT COUNT(*) c FROM set_log')[0].c;
    const primary = root.querySelector('.donebtn');
    if (!primary) break;
    if (root.querySelector('.restcard')) {
      sawRest = true;
      if (root.querySelector('.ring')) sawRing = true;
    }
    // A hold whose clock has not run yet refuses to log. That is the point —
    // step past it the way Dom would, with skip.
    const stepper = primary.disabled
      ? root.querySelectorAll('.btn-small').find((b) => b.textContent.startsWith('skip'))
      : primary;
    if (!stepper) break;
    try {
      stepper.click();
      await tick();
    } catch (err) {
      check('step ' + i + ' advances', false, err.message);
      console.log(String(err.stack).split('\n').slice(1, 4).join('\n'));
      break;
    }
    if (query('SELECT COUNT(*) c FROM set_log')[0].c > before) logged++;
  }
  check('walking the runner logs sets', logged > 0, logged + ' sets logged');
  check('the walk passed through a rest step', sawRest);
  check('rests draw a countdown ring', sawRing);

  const rows = query(
    'SELECT s.side, s.reps_done, s.hold_seconds_done, s.hit_target FROM set_log s ORDER BY s.id LIMIT 1');
  check('a logged set records a side and a result', rows.length === 1 && !!rows[0].side,
    JSON.stringify(rows[0]));
  const zeroHolds = query('SELECT COUNT(*) c FROM set_log WHERE hold_seconds_done = 0')[0].c;
  check('no zero-second hold was logged — a premature Done cannot fake a miss',
    zeroHolds === 0, zeroHolds + ' zero-second holds');
  clearAllTimers();
}

// ---------------------------------------------------------------- hold + sled
// Both are new code paths, and neither has ever executed. Day 1 has the sled
// under 'power'; holds are everywhere.
{
  const day1 = query('SELECT * FROM day_template WHERE day_no = 1')[0];
  const blocks = query(
    'SELECT b.*, e.name ex_name, e.is_timed, e.load_type, e.instruction, e.feel_cue ' +
    'FROM block b JOIN exercise e ON e.id = b.exercise_id WHERE b.day_template_id = ? ORDER BY b.order_index',
    [day1.id]);
  for (const b of blocks) b.targets = query('SELECT * FROM block_target WHERE block_id = ? ORDER BY id', [b.id]);
  const steps = buildSteps(blocks);

  const holdAt = steps.findIndex((s) => s.kind === 'set' && stepTarget(s).kind === 'hold');
  const effortAt = steps.findIndex((s) => s.kind === 'set' && stepTarget(s).kind === 'effort');
  check('day 1 has a hold step to exercise', holdAt >= 0);
  check('day 1 has a sled (effort) step to exercise', effortAt >= 0);

  const openAt = async (index, label, extra = {}) => {
    const session = query("SELECT * FROM session WHERE day_no = 1 AND status = 'in_progress' ORDER BY id DESC LIMIT 1")[0]
      || null;
    if (!session) return null;
    saveRunnerState(db, { session_id: session.id, index, restStartedAt: null, ...extra });
    await persist();
    const root = screen();
    try {
      const cleanup = renderRun(root, 1);
      const silent = root.children.find((c) => c.textContent === 'Start without voice');
      if (silent) { silent.click(); await tick(); }
      root.cleanup = cleanup;      // what route() would hold on to
      return root;
    } catch (err) {
      check(label, false, err.message);
      console.log(String(err.stack).split('\n').slice(1, 4).join('\n'));
      return null;
    }
  };

  // open the day so a session exists
  const seedRoot = screen();
  renderRun(seedRoot, 1);
  const silentStart = seedRoot.children.find((c) => c.textContent === 'Start without voice');
  if (silentStart) { silentStart.click(); await tick(); }
  clearAllTimers();

  if (holdAt >= 0) {
    const root = await openAt(holdAt, 'a hold step renders');
    if (root) {
      check('a hold step draws its own clock', !!root.querySelector('.holdclock'));
      check('a hold step draws a ring', !!root.querySelector('.dial-hold'));
      const play = root.querySelector('.holdbtn');
      check('a hold step offers pause/start', !!play);
      if (play) {
        const first = play.textContent;
        play.click();
        check('the hold clock pauses and resumes', play.textContent !== first,
          first + ' -> ' + play.textContent);
      }
      clearAllTimers();
    }

    // The ORDINARY force-quit case: part-way through a hold, not past it. It
    // shares the branch with the stale one, so it needs its own check.
    const partway = await openAt(holdAt, 'a hold resumed part-way through renders',
      { hold: { index: holdAt, startedAt: Date.now() - 30 * 1000, accMs: 0, running: true } });
    if (partway) {
      check('a hold resumed part-way through keeps counting rather than warning',
        !partway.textContent.includes('ran while the app was closed'),
        partway.textContent.slice(0, 100));
      const btn = partway.querySelector('.holdbtn');
      check('and it comes back running, not paused',
        !!btn && btn.textContent.includes('Pause'), btn && btn.textContent);
      const done = partway.querySelector('.donebtn');
      check('and Done is live, because there are seconds worth logging',
        !!done && !done.disabled && /\d+s held/.test(done.textContent), done && done.textContent);
      clearAllTimers();
    }

    // the stale-resume branch: a hold whose target elapsed while the app was dead
    const stale = await openAt(holdAt, 'a hold resumed after the app died renders',
      { hold: { index: holdAt, startedAt: Date.now() - 10 * 60 * 1000, accMs: 0, running: true } });
    if (stale) {
      check('a hold that ran on while the app was closed warns instead of logging itself',
        stale.textContent.includes('ran while the app was closed'),
        stale.textContent.slice(0, 120));
      clearAllTimers();
    }
  }

  // ---- leaving the runner must actually stop it ----
  //
  // Dom, 2026-08-25: "I've closed backed out of the day but the session is
  // still running... while on dashboard." Only the X used to clean up, so any
  // other exit left the 250 ms ticker alive. `root` is the shared #app element,
  // so a hold reaching zero called commit() -> logged a set he never did ->
  // redrew the runner over whatever screen he was on.
  //
  // This is the check that would have caught it: count the timers.
  if (holdAt >= 0) {
    clearAllTimers();
    const before = query('SELECT COUNT(*) c FROM set_log')[0].c;

    // A hold, one second from its target: the tick that fires next is the one
    // that used to log a set.
    const target = stepTarget(steps[holdAt]).value;
    const root = await openAt(holdAt, 'a hold opens for the teardown check', {
      hold: { index: holdAt, startedAt: Date.now() - (target - 1) * 1000, accMs: 0, running: true },
    });
    if (root) {
      check('the runner is running a timer while it is on screen',
        liveTimerCount() > 0, liveTimerCount() + ' live');
      check('and it hands back a cleanup for route() to run',
        typeof root.cleanup === 'function', typeof root.cleanup);

      // What route() does on the way to another screen.
      if (typeof root.cleanup === 'function') root.cleanup();

      check('leaving the runner leaves NO timer behind',
        liveTimerCount() === 0, liveTimerCount() + ' still live');

      // Even if a stray closure did fire, it must not reach the database.
      const other = screen();
      other.append(globalThis.document.createElement('p'));
      const marker = other.children.length;
      // A REAL wait, not microtask ticks: the ticker runs on a 250 ms interval
      // and would never fire inside setImmediate drains, so tick() alone would
      // pass this check whether or not the timer was still alive.
      await new Promise((r) => setTimeout(r, 450));
      check('no set is logged by a runner that has been left',
        query('SELECT COUNT(*) c FROM set_log')[0].c === before,
        before + ' -> ' + query('SELECT COUNT(*) c FROM set_log')[0].c);
      check('and it does not repaint itself over the screen you moved to',
        other.children.length === marker, other.children.length + ' vs ' + marker);

      // Idempotent: route() may run it again, and a second call must be quiet.
      let threw = null;
      try { root.cleanup(); } catch (err) { threw = err.message; }
      check('running the cleanup twice is harmless', threw === null, String(threw));
    }
    clearAllTimers();
  }

  if (effortAt >= 0) {
    const root = await openAt(effortAt, 'a sled step renders');
    if (root) {
      check('a sled step asks for weight, not reps',
        root.textContent.includes('one trip') && !root.textContent.includes(' reps'),
        root.textContent.slice(0, 140));
      const before = query('SELECT COUNT(*) c FROM set_log')[0].c;
      const done = root.querySelector('.donebtn');
      if (done) { done.click(); await tick(); }
      const after = query('SELECT * FROM set_log ORDER BY id DESC LIMIT 1')[0];
      check('a sled set logs as done with no rep count',
        query('SELECT COUNT(*) c FROM set_log')[0].c === before + 1
        && after.reps_done === null && after.hit_target === 1,
        JSON.stringify(after && { reps: after.reps_done, hit: after.hit_target }));
      clearAllTimers();
    }
  }
}

// ---------------------------------------------------------------- with history
{
  const home = await render('home (with a session logged)', (root) => renderHome(root));
  if (home) {
    check('home still renders once there is history', contains(home, 'Power level'));
    // Sets were logged into an in-progress session above, which is exactly the
    // "logged active live session" Dom wants the resume card for.
    check('a session with work in it offers a resume card',
      !!home.querySelector('.resumecard'), home.textContent.slice(0, 80));
    check('and the resume card links straight into the runner',
      (home.querySelector('.resumebtn') || {}).href
        && home.querySelector('.resumebtn').href.startsWith('#/run/'),
      String((home.querySelector('.resumebtn') || {}).href));
    // Order at the top, since 028: sticky music bar, then the title/power
    // header, then the resume card. The bar is pinned above everything (Dom,
    // 2026-08-25); the resume card still comes before the day list.
    check('the resume card sits below the sticky bar but above the day list',
      home.children.indexOf(home.querySelector('.resumecard'))
        > home.children.indexOf(home.querySelector('.slimsec'))
      && home.children.indexOf(home.querySelector('.resumecard'))
        < home.children.indexOf(home.querySelector('.daylist')));
    check('the slim bar is still there alongside it',
      !!home.querySelector('.slimbar'));
    // Dom, 2026-08-25: "Resume day 1 section should be smaller button below the
    // day 1 info. Right now they are currently overlapping each other."
    check('the resume button sits below the day line, in its own row',
      !!home.querySelector('.resumeactions .resumebtn'));
    check('and the way out of the session is right next to it',
      !!home.querySelector('.resumeactions .resumeover'),
      home.querySelector('.resumecard').textContent);
    // He went looking for this and could not find it.
    {
      const over = home.querySelector('.resumeover');
      const sessions = query("SELECT COUNT(*) c FROM session WHERE status = 'abandoned'")[0].c;
      globalThis.__confirm = false;           // he says no
      over.click();
      await tick(3);
      check('Start over asks first, and no means no',
        query("SELECT COUNT(*) c FROM session WHERE status = 'abandoned'")[0].c === sessions,
        'abandoned ' + sessions + ' -> '
          + query("SELECT COUNT(*) c FROM session WHERE status = 'abandoned'")[0].c);
      globalThis.__confirm = true;
    }
    check('logged work moves the legend off zero',
      !home.querySelector('.legendrows .legendrow').classList.contains('legendzero'),
      home.querySelector('.legendrows .legendrow').textContent);
  }

  // The dashboard's real shape needs COMPLETE sessions with both sides logged
  // across more than one week, which nothing above produces. Build that here
  // rather than assert on an empty screen and call it covered.
  {
    const slRdl = query("SELECT id FROM exercise WHERE name = 'Single-leg RDL (DB)'")[0].id;
    const copen = query("SELECT id FROM exercise WHERE name = 'Copenhagen plank'")[0].id;
    const scap = query("SELECT id FROM exercise WHERE name = 'DB scaption raise'")[0].id;
    const blockFor = (exId) => query('SELECT id FROM block WHERE exercise_id = ? LIMIT 1', [exId])[0].id;

    // two weeks apart, so weeklySeries has something to trend
    const weeks = ['2026-08-03', '2026-08-10'];
    for (const [w, date] of weeks.entries()) {
      getDb().run("INSERT INTO session (date, day_no, status, started_at) "
        + "VALUES (?, 4, 'complete', ?)", [date, date + 'T18:00:00Z']);
      const sid = query('SELECT id FROM session ORDER BY id DESC LIMIT 1')[0].id;
      const put = (exId, side, reps, weight, hold) => getDb().run(
        'INSERT INTO set_log (session_id, block_id, exercise_id, side, set_index, weight_lb, '
        + 'reps_done, hold_seconds_done, hit_target, logged_at) VALUES (?,?,?,?,1,?,?,?,1,?)',
        [sid, blockFor(exId), exId, side, weight, reps, hold, date + 'T18:10:00Z']);
      // a loaded pair, a timed pair, and a shoulder pair — three different
      // body parts, which is the whole point of the drawer
      put(slRdl, 'left', 8, 40 + w * 10, null);
      put(slRdl, 'right', 8, 50 + w * 5, null);
      put(copen, 'left', null, null, 30 + w * 10);
      put(copen, 'right', null, null, 45, null);
      put(scap, 'left', 12, 10 + w * 2, null);
      put(scap, 'right', 12, 15, null);
    }
  }

  const dash = await render('dashboard (with a session logged)', (root) => renderDashboard(root));
  if (dash) {
    check('the dashboard renders with real rows behind it', dash.textContent.length > 50);
    check('and it drew actual trend cards', dash.querySelectorAll('.trendcard').length > 0,
      dash.querySelectorAll('.trendcard').length + ' cards');

    // ---- build 026: one body part at a time, picked from a drop-down ----
    const select = dash.querySelector('.partselect');
    check('the dashboard offers a body-part drop-down', !!select);
    if (select) {
      const options = select.querySelectorAll('option').map((o) => o.textContent);
      check('the drop-down lists more than one body part',
        options.length > 1, options.join(' | '));
      check('it names them in plain English rather than by key',
        options.some((o) => /Legs|Hips|Shoulders/.test(o)), options.join(' | '));
      check('it never offers a body part with nothing in it',
        options.every((o) => !/\(0\)/.test(o)), options.join(' | '));

      // Only one drawer is on screen, and its cards live on the sideways rail.
      const rail = dash.querySelector('.partrail');
      check('the visible cards are all on the sideways rail',
        rail && dash.querySelectorAll('.trendcard').length
          === rail.querySelectorAll('.trendcard').length,
        dash.querySelectorAll('.trendcard').length + ' on screen, '
          + (rail ? rail.querySelectorAll('.trendcard').length : 0) + ' on the rail');

      // Switching drawers must actually change what is drawn.
      const firstNames = rail.querySelectorAll('.trendname').map((n) => n.textContent).join(',');
      const other = select.querySelectorAll('option')
        .find((o) => o.value !== select.value);
      if (other) {
        select.value = other.value;
        select.dispatch('change');
        const nextNames = rail.querySelectorAll('.trendname').map((n) => n.textContent).join(',');
        check('picking another body part swaps the cards out',
          nextNames !== firstNames && nextNames.length > 0,
          firstNames + '  ->  ' + nextNames);
      }
      check('the volume and nightly sections survive a body-part switch',
        contains(dash, 'Weekly sets by side') && contains(dash, 'Nightly non-negotiables'));
    }
  }

  const day = await render('day 1 (with a session in progress)', (root) => renderDay(root, 1));
  if (day) check('a day with logged sets renders', day.querySelectorAll('.setbtn').length > 0);
}

// ------------------------------------------------------- the theme reaches everything
//
// "the home screen adn layout should match based on the colors of each power
// level form automatically" (Dom, 2026-08-25). The first attempt at this set a
// --accent custom property that NO css rule read, and only ran on the home
// route — so a cold open on #/run/1 after a force-quit had no theme at all.
{
  const css = readFileSync('css/app.css', 'utf8');

  const dead = (css.match(/var\(--accent\)/g) || []).length;
  check('no rule reads a custom property nothing sets',
    dead === 0, dead + ' var(--accent) uses');

  // Identity surfaces follow the form...
  const tiered = (css.match(/var\(--tier[,)]/g) || []).length;
  check('the form colour actually drives rules rather than only existing',
    tiered > 20, tiered + ' rules use var(--tier…)');

  // ...but the ones that carry MEANING do not. gold = on target / done /
  // increase, and the dashboard's left-vs-right must stay legible at every
  // form: at Super Saiyan Blue the tier is #3fd8ff against ki blue #57c7ff.
  // Read the whole declaration block, not just the selector line — most of
  // these are multi-line rules and matching one line would assert on nothing.
  const ruleBody = (selector) => {
    const at = css.indexOf('\n' + selector);
    if (at < 0) return null;
    const open = css.indexOf('{', at);
    const close = css.indexOf('}', open);
    return open < 0 || close < 0 ? null : css.slice(at, close + 1);
  };
  for (const rule of ['.setbtn.hit', '.chip-complete', '.tab.done', '.restclock.done']) {
    const body = ruleBody(rule);
    check(rule + ' keeps its fixed colour — success must not change weekly',
      !!body && body.includes('var(--gold)') && !body.includes('var(--tier'),
      body ? body.replace(/\s+/g, ' ').slice(0, 70) : 'rule not found');
  }
  const dash = readFileSync('js/ui/dashboard.js', 'utf8');
  check('left vs right on the dashboard stay gold-and-blue at every form',
    /const WEAK = '#ffd75e'/.test(dash) && /const STRONG = '#57c7ff'/.test(dash));

  // The theme is applied at boot, so a route that is not home is themed too.
  delete globalThis.document.documentElement.dataset.tier;
  globalThis.location.hash = '#/progress';
  const dash2 = screen();
  renderDashboard(dash2);
  check('a non-home route still renders (the boot theme path)', dash2.textContent.length > 20);
  const main = readFileSync('js/main.js', 'utf8');
  check('main.js applies the theme before the first route, not only on home',
    /applyBootTheme\(\);\s*\n\s*window\.addEventListener\('hashchange'/.test(main));
  globalThis.location.hash = '';
}

// ---------------------------------------------------------------- export / import
// The Phase 1 gate item deferred since August: "export .sqlite, open it,
// import it back". Whether VS Code can READ the file is still Dom's to check,
// but whether the round trip loses anything is answerable here.
{
  const before = {
    sets: query('SELECT COUNT(*) c FROM set_log')[0].c,
    sessions: query('SELECT COUNT(*) c FROM session')[0].c,
    exercises: query('SELECT COUNT(*) c FROM exercise')[0].c,
  };
  check('there is something to round-trip', before.sets > 0, before.sets + ' sets');

  const sqliteBytes = new Uint8Array(await exportSqliteBlob().arrayBuffer());
  check('the .sqlite export is a real SQLite file',
    new TextDecoder().decode(sqliteBytes.slice(0, 15)) === 'SQLite format 3');

  const jsonBytes = new Uint8Array(await exportJsonBlob().arrayBuffer());

  try {
    await importBytes(jsonBytes);
    const after = {
      sets: query('SELECT COUNT(*) c FROM set_log')[0].c,
      sessions: query('SELECT COUNT(*) c FROM session')[0].c,
      exercises: query('SELECT COUNT(*) c FROM exercise')[0].c,
    };
    check('a .json round trip loses nothing', JSON.stringify(after) === JSON.stringify(before),
      JSON.stringify(after) + ' vs ' + JSON.stringify(before));
  } catch (err) {
    check('a .json round trip loses nothing', false, err.message);
  }

  try {
    await importBytes(sqliteBytes);
    const after = {
      sets: query('SELECT COUNT(*) c FROM set_log')[0].c,
      sessions: query('SELECT COUNT(*) c FROM session')[0].c,
      exercises: query('SELECT COUNT(*) c FROM exercise')[0].c,
    };
    check('a .sqlite round trip loses nothing', JSON.stringify(after) === JSON.stringify(before),
      JSON.stringify(after) + ' vs ' + JSON.stringify(before));
    const sample = query('SELECT side, reps_done, hold_seconds_done FROM set_log ORDER BY id LIMIT 1')[0];
    check('and the sets come back with their values intact', !!sample && !!sample.side,
      JSON.stringify(sample));
  } catch (err) {
    check('a .sqlite round trip loses nothing', false, err.message);
  }

  // CSV is the look-at-it format, so what matters is that it parses cleanly
  const csv = await exportCsvBlob().text();
  const lines = csv.trim().split(/\r?\n/);
  check('the CSV header names the columns Dom will query',
    lines[0].startsWith('date,day_no,session_status,block_code,exercise,side'), lines[0].slice(0, 60));
  check('one CSV row per logged set', lines.length === before.sets + 1,
    (lines.length - 1) + ' rows for ' + before.sets + ' sets');
  const commasBalanced = lines.slice(1).every((l) => (l.match(/,/g) || []).length >= 15);
  check('every CSV row carries every column', commasBalanced);
  // `notes` is the one free-text column, so it is the one that can break the
  // format. Append a row carrying a comma (set_log stays append-only, even
  // here) and check the export quotes it rather than inventing a column.
  // getDb() rather than the handle captured at boot: importBytes swaps the
  // database out from under everything, which is the whole point of it.
  getDb().run("INSERT INTO set_log (session_id, block_id, exercise_id, side, set_index, reps_done, "
    + 'target_reps, hit_target, notes, logged_at) '
    + "SELECT session_id, block_id, exercise_id, side, 99, reps_done, target_reps, hit_target, "
    + "'held short, tweaked the setup', logged_at FROM set_log ORDER BY id LIMIT 1");
  const csv2 = await exportCsvBlob().text();
  const row = csv2.trim().split(/\r?\n/).find((l) => l.includes('held short'));
  check('a value with a comma is quoted, not spilled into the next column',
    !!row && row.includes('"held short, tweaked the setup"'), row && row.slice(-70));
  check('and the row still has the same number of columns as the header',
    !!row && row.replace(/"[^"]*"/g, 'X').split(',').length
      === csv2.trim().split(/\r?\n/)[0].split(',').length,
    row && String(row.replace(/"[^"]*"/g, 'X').split(',').length));
}

// ---------------------------------------------------------------- second boot
// The stored branch of initDb() with migrations, which is what the phone runs
// on every update.
{
  try {
    await initDb();
    check('a second launch reads the stored database and migrates cleanly', true);
    check('the logged sets survived the reload',
      query('SELECT COUNT(*) c FROM set_log')[0].c > 0);
  } catch (err) {
    check('a second launch reads the stored database and migrates cleanly', false, err.message);
  }
}

clearAllTimers();
console.log(failures === 0 ? '\nALL SCREENS RENDER' : '\n' + failures + ' SCREEN CHECK(S) FAILED');
process.exit(failures === 0 ? 0 : 1);
