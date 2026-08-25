// Choose a playlist or an album, without leaving the app.
//
// Dom, 2026-08-25: "I don't want to be limited to the songs/playlist but the
// freedom to adjust the music directly in the app."
//
// One component, two call sites: the settings screen (assigning music to a
// phase or a category) and the runner's music sheet (changing what is playing
// mid-session). Both hand it an onPick and get back { uri, type, name }.
//
// It degrades in three directions, because all three happen in a gym:
//   - not connected to Spotify      -> says so, offers the connect button
//   - connected but under-scoped    -> browsing prompts a one-time reconnect,
//                                      search still works
//   - offline, or search unavailable-> the half that works stays usable

import * as spotify from '../spotify.js';

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

// Lists are fetched once per app launch: they change rarely and a gym
// connection is worth spending sparingly.
const cache = { playlists: null, albums: null };
let searchAvailable = null;      // null = untested, false = this app cannot search

export function clearPickerCache() {
  cache.playlists = null;
  cache.albums = null;
}

export function openPicker({ title = 'Choose music', onPick, onClose } = {}) {
  document.querySelector('.picker')?.remove();
  const sheet = el('div', 'sheet picker');

  const head = el('div', 'pickerhead');
  head.append(el('h3', null, title));
  const close = el('button', 'iconbtn', '✕');
  close.title = 'Close';
  close.onclick = () => { sheet.remove(); if (onClose) onClose(); };
  head.append(close);
  sheet.append(head);

  const note = el('p', 'musicnote', '');
  const results = el('div', 'pickerlist');

  // ---------- not connected ----------
  if (!spotify.isConnected()) {
    note.textContent = 'Not connected to Spotify.';
    const connect = el('button', 'btn btn-primary', 'Connect Spotify');
    connect.onclick = () => spotify.beginLogin();
    sheet.append(note, connect);
    document.body.append(sheet);
    return sheet;
  }

  // ---------- search ----------
  const searchWrap = el('div', 'pickersearch');
  const box = document.createElement('input');
  box.type = 'search';
  box.placeholder = 'Search playlists and albums…';
  box.autocomplete = 'off';
  box.setAttribute('autocorrect', 'off');
  box.setAttribute('spellcheck', 'false');
  searchWrap.append(box);
  sheet.append(searchWrap, note, results);

  const row = (source) => {
    const item = el('button', 'pickeritem');
    const badge = el('span', 'pickertype', source.type === 'album' ? '▣' : '♪');
    const body = el('span', 'pickerbody');
    body.append(el('span', 'pickername', source.name || source.uri));
    const meta = [source.by, source.tracks ? source.tracks + ' tracks' : null]
      .filter(Boolean).join(' · ');
    if (meta) body.append(el('span', 'pickermeta', meta));
    item.append(badge, body);
    item.onclick = () => {
      sheet.remove();
      if (onPick) onPick({ uri: source.uri, type: source.type, name: source.name });
    };
    return item;
  };

  const show = (groups) => {
    results.innerHTML = '';
    let any = false;
    for (const [heading, items] of groups) {
      if (!items || !items.length) continue;
      any = true;
      results.append(el('h4', 'pickergroup', heading));
      for (const source of items) results.append(row(source));
    }
    if (!any) results.append(el('p', 'musicnote', 'Nothing to show.'));
  };

  const fail = (err) => {
    note.textContent = err && err.message ? err.message : 'Spotify request failed.';
    note.classList.add('bad');
  };

  // ---------- the library ----------
  async function loadLibrary() {
    const missing = spotify.missingLibraryScopes();
    if (missing.length) {
      // Detected from the stored token, so this is instant and works offline —
      // no 403 needed to find out.
      results.innerHTML = '';
      results.append(el('p', 'musicnote',
        'Your Spotify login predates in-app browsing, so it cannot read your library yet. '
        + 'Reconnecting takes one tap and asks for read-only access to your playlists and saved albums.'));
      const again = el('button', 'btn btn-primary', 'Reconnect Spotify');
      again.onclick = () => spotify.beginLogin();
      results.append(again);
      if (searchAvailable !== false) {
        results.append(el('p', 'musicnote', 'Search below still works without reconnecting.'));
      }
      return;
    }
    results.innerHTML = '';
    results.append(el('p', 'musicnote', 'Loading your library…'));
    try {
      if (!cache.playlists) cache.playlists = (await spotify.library.playlists()).items;
      if (!cache.albums) cache.albums = (await spotify.library.albums()).items;
      note.textContent = '';
      note.classList.remove('bad');
      show([['My playlists', cache.playlists], ['My albums', cache.albums]]);
    } catch (err) {
      results.innerHTML = '';
      fail(err);
      if (err && err.kind === 'expired') {
        const again = el('button', 'btn btn-small', 'Connect again');
        again.onclick = () => spotify.beginLogin();
        results.append(again);
      }
    }
  }

  // ---------- searching ----------
  let timer = null;
  let seq = 0;
  box.addEventListener('input', () => {
    if (timer) clearTimeout(timer);
    const q = box.value.trim();
    if (!q) { loadLibrary(); return; }
    // debounced: one request per pause, not one per keystroke
    timer = setTimeout(async () => {
      const mine = ++seq;
      results.innerHTML = '';
      results.append(el('p', 'musicnote', 'Searching…'));
      try {
        const found = await spotify.search(q);
        if (mine !== seq) return;                 // a later keystroke won
        searchAvailable = true;
        note.textContent = '';
        note.classList.remove('bad');
        show([['Playlists', found.playlists], ['Albums', found.albums]]);
      } catch (err) {
        if (mine !== seq) return;
        results.innerHTML = '';
        // Spotify closed several endpoints to apps registered after
        // 2024-11-27. If search is one of them for this app, say so once and
        // fall back to the library rather than looking broken.
        if (err && (err.kind === 'forbidden' || err.status === 403)) {
          searchAvailable = false;
          searchWrap.remove();
          results.append(el('p', 'musicnote',
            'Spotify will not let this app search. Your own playlists and albums are listed instead — '
            + 'anything else can still be added by pasting its link in Settings.'));
          loadLibrary();
          return;
        }
        fail(err);
      }
    }, 350);
  });

  const refresh = el('button', 'btn btn-small', '↻ reload library');
  refresh.onclick = () => { clearPickerCache(); box.value = ''; loadLibrary(); };
  sheet.append(refresh);

  document.body.append(sheet);
  loadLibrary();
  return sheet;
}
