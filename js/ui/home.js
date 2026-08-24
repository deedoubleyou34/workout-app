import { query, storageStatus, exportSqliteBlob, exportJsonBlob, exportCsvBlob, importBytes, getDb, persist } from '../db.js';
import { pendingFlags, acceptFlag, acceptAll, declineFlag, snoozeFlag, isSessionHit } from '../progression.js';
import { daySummaries, nextDayUp, lastSessionReport, nightlyStreak, today, weekStart } from '../sessions.js';
import { renderMusic } from './music.js';

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

const UNIT_LABEL = { lb: 'lb', sec: 's', rep: ' reps', band_step: '', vest: '' };

// "L  45 → 50 lb" — the whole suggestion at a glance.
function moveText(f) {
  const to = f.suggested_value;
  const u = UNIT_LABEL[f.suggested_unit] ?? '';
  if (f.suggested_unit === 'band_step') return 'next band up, reset to ' + to + ' reps';
  if (f.suggested_unit === 'vest') return 'add vest, reset to ' + to + ' reps';
  if (to == null) return f.flag === 'hold' ? 'hold here' : 'review';
  return '→ ' + to + u;
}

export function renderHome(root) {
  const db = getDb();
  root.innerHTML = '';
  root.className = 'page';

  // ---------- title + power level ----------
  const header = el('header', 'top');
  header.append(el('h1', null, 'Hyperbolic Time Chamber'));
  // Power level is a WEEKLY cycle (Dom, 2026-08-24): it counts the four
  // training days and every nightly session logged since Monday, and starts
  // again next week. The all-time figure is kept alongside it so a reset reads
  // as a new week, not as lost work.
  const from = weekStart();
  const powerOf = (since) => {
    const v = query(
      'SELECT COUNT(*) sets, COALESCE(SUM(l.reps_done),0) reps, ' +
      'COALESCE(SUM(l.hold_seconds_done),0) holds, COALESCE(SUM(l.weight_lb*l.reps_done),0) tonnage ' +
      'FROM set_log l JOIN session s ON s.id = l.session_id' +
      (since ? " WHERE s.date >= ?" : ''), since ? [since] : [])[0];
    const nights = query('SELECT COUNT(DISTINCT date) c FROM nightly_log'
      + (since ? ' WHERE date >= ?' : ''), since ? [since] : [])[0].c;
    return Math.round(v.sets * 100 + v.reps * 10 + v.holds * 5 + v.tonnage / 10 + nights * 50);
  };
  const power = powerOf(from);
  const allTime = powerOf(null);
  const setCount = query('SELECT COUNT(*) c FROM set_log')[0].c;
  header.append(el('p', 'powerline',
    '⚡ Power level: ' + power.toLocaleString() + (power > 9000 ? " — IT'S OVER 9,000!" : '')));
  const daysThisWeek = query(
    "SELECT COUNT(DISTINCT day_no) c FROM session WHERE status = 'complete' AND day_no > 0 AND date >= ?",
    [from])[0].c;
  const nightsThisWeek = query('SELECT COUNT(DISTINCT date) c FROM nightly_log WHERE date >= ?', [from])[0].c;
  header.append(el('p', 'weekline',
    'this week · ' + daysThisWeek + ' of 4 training days · ' + nightsThisWeek
    + (nightsThisWeek === 1 ? ' night' : ' nights') + ' · resets Monday'
    + (allTime > power ? ' · all-time ' + allTime.toLocaleString() : '')));
  root.append(header);

  // ---------- next up ----------
  const next = nextDayUp(db);
  const nextSec = el('section', 'nextsec');
  nextSec.append(el('h2', null, 'Next up'));
  const nextCard = el('div', 'nextcard');
  nextCard.append(el('div', 'nextday', 'Day ' + next.day_no));
  nextCard.append(el('div', 'nextname', next.name));
  nextCard.append(el('p', 'muted',
    next.daysAgo == null ? 'not trained yet'
      : next.daysAgo === 0 ? 'last trained today'
      : next.daysAgo === 1 ? 'last trained yesterday'
      : 'last trained ' + next.daysAgo + ' days ago'));
  const startBtn = el('a', 'btn btn-primary nextstart', '▶  Run Day ' + next.day_no);
  startBtn.href = '#/run/' + next.day_no;
  nextCard.append(startBtn);
  const manual = el('a', 'nextmanual', 'or log it by hand');
  manual.href = '#/day/' + next.day_no;
  nextCard.append(manual);
  nextSec.append(nextCard);
  root.append(nextSec);

  // ---------- suggestions, grouped per exercise ----------
  const flags = pendingFlags(db);
  if (flags.length) {
    const byExercise = new Map();
    for (const f of flags) {
      if (!byExercise.has(f.ex_name)) byExercise.set(f.ex_name, []);
      byExercise.get(f.ex_name).push(f);
    }

    const sec = el('section', 'flagsec');
    const head = el('div', 'flagsechead');
    head.append(el('h2', null,
      flags.length === 1 ? '1 suggestion' : flags.length + ' suggestions'));
    const applicable = flags.filter((f) => f.suggested_unit);
    if (applicable.length > 1) {
      const all = el('button', 'btn btn-small btn-primary', 'Accept all');
      all.onclick = async () => {
        if (!confirm('Apply all ' + applicable.length + ' suggestions?')) return;
        acceptAll(db, applicable.map((f) => f.id));
        await persist();
        renderHome(root);
      };
      head.append(all);
    }
    sec.append(head);

    for (const [name, group] of byExercise) {
      const card = el('div', 'flagcard flag-' + group[0].flag);
      card.append(el('div', 'flagname', name));
      for (const f of group) {
        const line = el('div', 'flagline');
        const label = el('span', 'flagside', f.side === 'both' ? '—' : f.side[0].toUpperCase());
        const kind = el('span', 'flagkind flagkind-' + f.flag, f.flag.replace('_', ' '));
        line.append(label, kind, el('span', 'flagmove', moveText(f)));
        if (f.status === 'snoozed') line.append(el('span', 'chip', 'snoozed'));

        const btns = el('span', 'flagbtns');
        const decide = (fn, text, cls) => {
          const b = el('button', 'iconbtn' + (cls ? ' ' + cls : ''), text);
          b.onclick = async () => {
            fn(db, f.id);
            await persist();
            renderHome(root);
          };
          return b;
        };
        if (f.suggested_unit) btns.append(decide(acceptFlag, '✓', 'ok'));
        btns.append(decide(declineFlag, '✕', 'no'));
        if (f.status !== 'snoozed') btns.append(decide(snoozeFlag, 'z'));
        line.append(btns);
        card.append(line);

        const why = el('p', 'flagreason', f.reason);
        card.append(why);
      }
      sec.append(card);
    }
    root.append(sec);
  } else {
    // No flags is a real answer, not an error — say why (§4.1 needs two clean
    // sessions in a row before anything is suggested).
    const report = lastSessionReport(db, isSessionHit);
    if (report) {
      const note = el('section', 'notesec');
      const when = report.session.date === today() ? 'today' : 'on ' + report.session.date;
      if (report.missedPairs === 0 && report.cleanPairs > 0) {
        note.append(el('p', 'notetext',
          'Day ' + report.session.day_no + ' ' + when + ' was clean — ' + report.sets + ' sets, '
          + report.cleanPairs + ' exercises on target. '
          + (report.priorClean
            ? 'Suggestions are waiting above.'
            : "That's 1 of 2. Run it clean once more and the app will suggest a jump.")));
      } else if (report.cleanPairs > 0) {
        note.append(el('p', 'notetext',
          'Day ' + report.session.day_no + ' ' + when + ': ' + report.cleanPairs + ' on target, '
          + report.missedPairs + ' short. No changes suggested — one short session is noise.'));
      }
      if (note.childNodes.length) root.append(note);
    }
  }

  // ---------- day list ----------
  const list = el('nav', 'daylist');
  list.append(el('h2', 'listhead', 'All days'));
  for (const d of daySummaries(db)) {
    const a = el('a', 'daycard');
    a.href = '#/day/' + d.day_no;
    const title = d.day_no === 0 ? 'Nightly' : 'Day ' + d.day_no;
    const row = el('div', 'daycard-row');
    row.append(el('div', 'daycard-title', title));
    if (d.openStatus === 'in_progress') row.append(el('span', 'chip chip-in_progress', 'in progress'));
    else if (d.daysAgo === 0) row.append(el('span', 'chip chip-complete', 'done today'));
    else if (d.day_no === next.day_no) row.append(el('span', 'chip chip-bias', 'next up'));
    a.append(row);
    a.append(el('div', 'daycard-sub', d.name));
    a.append(el('div', 'daycard-meta',
      d.daysAgo == null ? 'never' : d.daysAgo === 0 ? 'today'
        : d.daysAgo === 1 ? 'yesterday' : d.daysAgo + ' days ago'));
    list.append(a);
  }
  root.append(list);

  // ---------- music ----------
  const music = el('section', 'musicsec');
  root.append(music);
  renderMusic(music);

  // ---------- data ----------
  const data = el('section', 'datasec');
  data.append(el('h2', null, 'Data'));
  const row = el('div', 'btnrow');

  const expSql = el('button', 'btn', 'Export .sqlite');
  expSql.onclick = () => download(exportSqliteBlob(), 'workout-' + today() + '.sqlite');
  const expJson = el('button', 'btn', 'Export .json');
  expJson.onclick = () => download(exportJsonBlob(), 'workout-' + today() + '.json');
  const expCsv = el('button', 'btn', 'Export .csv');
  expCsv.onclick = () => download(exportCsvBlob(), 'workout-sets-' + today() + '.csv');

  const imp = el('button', 'btn btn-danger', 'Import…');
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = '.sqlite,.json,application/json,application/octet-stream';
  file.hidden = true;
  imp.onclick = () => file.click();
  file.onchange = async () => {
    if (!file.files.length) return;
    if (!confirm('Import replaces ALL current app data with the file contents. Continue?')) {
      file.value = '';
      return;
    }
    try {
      await importBytes(new Uint8Array(await file.files[0].arrayBuffer()));
      alert('Import complete.');
      renderHome(root);
    } catch (err) {
      alert('Import failed: ' + err.message);
    }
    file.value = '';
  };

  row.append(expSql, expCsv, expJson, imp, file);
  data.append(row);
  const testLink = el('a', 'testlink', 'Run progression tests →');
  testLink.href = 'tests/test.html';
  data.append(testLink);
  root.append(data);

  // ---------- footer ----------
  const streak = nightlyStreak(db);
  const foot = el('footer', 'foot');
  if (streak) foot.append(el('p', 'streakline', '🌙 Nightly streak: ' + streak + (streak === 1 ? ' night' : ' nights')));
  foot.append(el('p', 'muted',
    query('SELECT COUNT(*) c FROM exercise')[0].c + ' exercises · ' + setCount + ' sets logged'));
  const storageLine = el('p', 'muted', 'storage: checking…');
  foot.append(storageLine);
  storageStatus().then((p) => {
    storageLine.textContent = 'storage: ' + (p ? 'persistent' : 'best-effort') + ' · build ' + (window.BUILD || '?');
  });
  root.append(foot);
}
