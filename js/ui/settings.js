// Settings — what plays when, the backup, and the switch that hands the app
// over from development to real training.

import { getDb, persist, exportSqliteBlob, resetTrainingData, backupStatus, markBackedUp } from '../db.js';
import {
  PHASES, PHASE_LABELS, CATEGORIES, categoryLabel, loadConfig, saveConfig,
  parseContext, sourceLabel, explainCategory, defaultShuffle, phaseForCategory,
} from '../playlists.js';
import { openPicker } from './picker.js';
import { today } from '../sessions.js';

// Survives the re-render after every change, so the section does not snap shut
// while Dom is working through it.
let overridesOpen = false;

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

  const cfg = loadConfig(db);

  // Every change writes immediately. A Save button you can forget is a way to
  // lose work, and there is nothing here worth batching.
  async function commit() {
    saveConfig(db, cfg);
    await persist();
    renderSettings(root);
  }

  // ---------- music ----------
  const card = el('section', 'blockcard');
  card.append(el('h3', 'cardlabel', 'Music'));
  card.append(el('p', 'muted',
    'Pick a playlist or a whole album for each part of a session. The runner switches '
    + 'when the session moves on. Anything left blank keeps whatever is already playing.'));

  // one row, used for both a phase and a category override
  function sourceRow({ label, source, sub, phase, onChoose, onClear, onShuffle }) {
    const row = el('div', 'phaserow');
    row.append(el('label', 'phaselabel', label));

    const current = el('p', 'sourceline' + (source ? '' : ' empty'),
      source ? sourceLabel(source) : (sub || 'nothing set'));
    row.append(current);

    const buttons = el('div', 'btnrow');
    const choose = el('button', 'btn btn-small', source ? 'Change…' : 'Choose…');
    choose.onclick = () => openPicker({ title: label, onPick: onChoose });
    buttons.append(choose);
    if (source) {
      const clear = el('button', 'btn btn-small', 'Clear');
      clear.onclick = onClear;
      buttons.append(clear);
    }
    row.append(buttons);

    if (source && onShuffle) {
      const wrap = el('label', 'shufflewrap');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = !!source.shuffle;
      box.onchange = () => onShuffle(box.checked);
      wrap.append(box, el('span', null,
        'shuffle' + (source.type === 'album' && !source.shuffle ? ' (off — album order)' : '')));
      row.append(wrap);
    }

    // The paste field stays: it needs no permissions, works offline, and is
    // the only way to reach something that is not in his library.
    const paste = document.createElement('input');
    paste.type = 'url';
    paste.inputMode = 'url';
    paste.placeholder = 'or paste a playlist / album link';
    paste.autocomplete = 'off';
    paste.setAttribute('autocorrect', 'off');
    paste.setAttribute('spellcheck', 'false');
    const pasteNote = el('p', 'musicnote', '');
    paste.addEventListener('change', () => {
      const value = paste.value.trim();
      if (!value) return;
      const parsed = parseContext(value);
      if (!parsed) {
        pasteNote.textContent = 'That is not a playlist or album link.';
        pasteNote.classList.add('bad');
        return;
      }
      onChoose({ uri: parsed.uri, type: parsed.type, name: null });
    });
    row.append(paste, pasteNote);
    return row;
  }

  for (const phase of PHASES) {
    card.append(sourceRow({
      label: PHASE_LABELS[phase],
      source: cfg.phases[phase],
      phase,
      onChoose: (picked) => {
        cfg.phases[phase] = { ...picked, shuffle: defaultShuffle(picked.type, phase) };
        commit();
      },
      onClear: () => { cfg.phases[phase] = null; commit(); },
      onShuffle: (on) => { cfg.phases[phase] = { ...cfg.phases[phase], shuffle: on }; commit(); },
    }));
  }

  // ---------- per-category overrides ----------
  const toggle = el('button', 'btn btn-small', (overridesOpen ? '▾' : '▸') + '  Per-category overrides');
  toggle.onclick = () => { overridesOpen = !overridesOpen; renderSettings(root); };
  card.append(toggle);

  if (overridesOpen) {
    const box = el('div', 'overrides');
    box.append(el('p', 'muted',
      'Every category follows its phase unless you set one here. This is where Superset C '
      + 'gets different music from Superset A.'));
    for (const key of CATEGORIES) {
      const explained = explainCategory(key, cfg);
      const phase = phaseForCategory(key);
      box.append(sourceRow({
        label: categoryLabel(key),
        source: explained.overridden ? cfg.categories[key] : null,
        sub: explained.text,
        phase,
        onChoose: (picked) => {
          cfg.categories[key] = { ...picked, shuffle: defaultShuffle(picked.type, phase) };
          commit();
        },
        onClear: () => { delete cfg.categories[key]; commit(); },
        onShuffle: (on) => { cfg.categories[key] = { ...cfg.categories[key], shuffle: on }; commit(); },
      }));
    }
    card.append(box);
  }

  card.append(el('p', 'musicnote',
    'Playback control needs Spotify Premium, and something must already be playing on a device '
    + 'for a switch to land. A switch that fails is ignored — the music you have keeps playing '
    + 'and the session carries on.'));
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
    + 'day templates and the music mapping all stay. This is the button for the '
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
