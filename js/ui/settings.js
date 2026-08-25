// Settings — Phase 8's playlist mapping, and the switch that hands the app
// over from development to real training.

import { getDb, persist, exportSqliteBlob, resetTrainingData, backupStatus, markBackedUp } from '../db.js';
import { PHASES, PHASE_LABELS, loadConfig, saveConfig, parsePlaylist, playlistUrl } from '../playlists.js';
import { today } from '../sessions.js';

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function renderSettings(root) {
  const db = getDb();
  root.innerHTML = '';
  root.className = 'page';

  const header = el('header', 'top');
  const back = el('a', 'back', '‹ Home');
  back.href = '#/';
  header.append(back);
  header.append(el('h1', null, 'Settings'));
  root.append(header);

  // ---------- playlists (Phase 8) ----------
  const cfg = loadConfig(db);
  const card = el('section', 'blockcard');
  card.append(el('h3', 'cardlabel', 'Music by session phase'));
  card.append(el('p', 'muted',
    'Build four playlists in Spotify and paste a link for each. The runner switches '
    + 'to the right one at each phase boundary. Leave one blank and that phase keeps '
    + 'whatever was already playing.'));

  const inputs = {};
  const shuffles = {};
  for (const phase of PHASES) {
    const row = el('div', 'phaserow');
    row.append(el('label', 'phaselabel', PHASE_LABELS[phase]));

    const input = document.createElement('input');
    input.type = 'url';
    input.inputMode = 'url';
    input.placeholder = 'paste a Spotify playlist link';
    input.autocomplete = 'off';
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('spellcheck', 'false');
    if (cfg[phase].uri) input.value = playlistUrl(cfg[phase].uri) || cfg[phase].uri;
    inputs[phase] = input;
    row.append(input);

    const shuffleWrap = el('label', 'shufflewrap');
    const shuffle = document.createElement('input');
    shuffle.type = 'checkbox';
    shuffle.checked = !!cfg[phase].shuffle;
    shuffles[phase] = shuffle;
    shuffleWrap.append(shuffle, el('span', null, 'shuffle'));
    row.append(shuffleWrap);

    const status = el('p', 'musicnote', '');
    row.append(status);
    input.addEventListener('input', () => {
      if (!input.value.trim()) { status.textContent = ''; return; }
      const uri = parsePlaylist(input.value);
      status.textContent = uri ? '✓ ' + uri : 'That does not look like a playlist link.';
      status.classList.toggle('bad', !uri);
    });
    card.append(row);
  }

  const saveRow = el('div', 'btnrow');
  const saveBtn = el('button', 'btn btn-primary', 'Save playlists');
  const saveNote = el('p', 'musicnote', '');
  saveBtn.onclick = async () => {
    const next = {};
    for (const phase of PHASES) {
      next[phase] = { uri: inputs[phase].value, shuffle: shuffles[phase].checked };
    }
    const clean = saveConfig(db, next);
    await persist();
    const set = PHASES.filter((p) => clean[p].uri).length;
    saveNote.textContent = set
      ? 'Saved — ' + set + ' of 4 phases have a playlist.'
      : 'Saved. No playlists set, so the music never changes on its own.';
    saveNote.classList.remove('bad');
  };
  saveRow.append(saveBtn);
  card.append(saveRow, saveNote);
  card.append(el('p', 'musicnote',
    'Playback control needs Spotify Premium, and something must already be playing '
    + 'on a device for a switch to land. A switch that fails is ignored — the music '
    + 'you have keeps playing and the session carries on.'));
  root.append(card);

  // ---------- backup ----------
  const backup = el('section', 'blockcard');
  backup.append(el('h3', 'cardlabel', 'Backup'));
  const status = backupStatus();
  backup.append(el('p', 'muted', status.everExported
    ? status.completed + ' sessions logged · ' + status.since + ' since your last .sqlite backup'
    : status.completed + ' sessions logged · never backed up'));
  const backupBtn = el('button', 'btn', 'Export .sqlite and mark backed up');
  backupBtn.onclick = async () => {
    download(exportSqliteBlob(), 'workout-' + today() + '.sqlite');
    await markBackedUp();
    renderSettings(root);
  };
  backup.append(backupBtn);
  root.append(backup);

  // ---------- start fresh ----------
  const danger = el('section', 'blockcard dangercard');
  danger.append(el('h3', 'cardlabel', 'Start fresh'));
  danger.append(el('p', 'muted',
    'Deletes every session, set, nightly entry, accepted load and suggestion — '
    + 'everything logged while the app was being built. The exercise library, your '
    + 'day templates and the playlist mapping all stay. This is the button for the '
    + 'day real training starts.'));

  const forgetWrap = el('label', 'shufflewrap');
  const forget = document.createElement('input');
  forget.type = 'checkbox';
  forgetWrap.append(forget, el('span', null, 'also disconnect Spotify'));
  danger.append(forgetWrap);

  const result = el('p', 'musicnote', '');
  const wipe = el('button', 'btn btn-danger', 'Delete all training data');
  wipe.onclick = async () => {
    const counts = backupStatus();
    if (!confirm('Delete all training data?\n\n'
      + counts.completed + ' completed sessions will be erased and cannot be recovered.\n\n'
      + 'Export a .sqlite backup first if you want to keep any of it.')) return;
    if (!confirm('Last check — this really does delete everything you have logged. Continue?')) return;
    const { setsDeleted } = await resetTrainingData({ forgetSpotify: forget.checked });
    result.textContent = 'Done — ' + setsDeleted + ' logged sets erased. The app is as new.';
    result.classList.remove('bad');
    setTimeout(() => { location.hash = '#/'; }, 1200);
  };
  danger.append(wipe, result);
  root.append(danger);
}
