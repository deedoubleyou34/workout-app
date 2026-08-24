// Session lifecycle, in one place so the home and day screens agree.
//
// A session belongs to (day_no, date). Opening a day on a new date starts a
// clean slate automatically — that is the "reset". Redoing a day you already
// logged abandons the old session rather than deleting anything: set_log stays
// append-only, and computeFlags only ever reads status='complete', so abandoned
// work never reaches the progression engine.

const LIFTING_DAYS = [1, 2, 3, 4];

function rows(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const out = [];
  while (stmt.step()) out.push(stmt.getAsObject());
  stmt.free();
  return out;
}

export function today() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Monday of the week a date falls in. The power level is a weekly cycle
// (Dom, 2026-08-24), so everything that feeds it is filtered from here.
export function weekStart(iso = today()) {
  const d = new Date(iso + 'T00:00:00');
  const back = (d.getDay() + 6) % 7;          // Sunday(0) -> 6 days back
  d.setDate(d.getDate() - back);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
    + '-' + String(d.getDate()).padStart(2, '0');
}

export function daysBetween(isoA, isoB) {
  const a = new Date(isoA + 'T00:00:00');
  const b = new Date(isoB + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}

// The session in play for a day today: newest one that was not abandoned.
export function currentSession(db, dayNo) {
  return rows(db,
    "SELECT * FROM session WHERE day_no = ? AND date = ? AND status <> 'abandoned' " +
    'ORDER BY id DESC LIMIT 1', [dayNo, today()])[0] || null;
}

// Only a session still being worked. Once a day is finished it becomes history:
// reopening that day gives a clean slate carrying any accepted progressions,
// rather than showing yesterday's (or this morning's) filled-in sets.
export function activeSession(db, dayNo) {
  return rows(db,
    "SELECT * FROM session WHERE day_no = ? AND date = ? AND status = 'in_progress' " +
    'ORDER BY id DESC LIMIT 1', [dayNo, today()])[0] || null;
}

export function lastCompleted(db, dayNo) {
  const s = rows(db,
    "SELECT * FROM session WHERE day_no = ? AND status = 'complete' ORDER BY date DESC, id DESC LIMIT 1",
    [dayNo])[0];
  if (!s) return null;
  const counts = rows(db,
    'SELECT COUNT(*) sets, COALESCE(SUM(hit_target),0) hits FROM set_log WHERE session_id = ?', [s.id])[0];
  return { ...s, sets: counts.sets, hits: counts.hits, daysAgo: daysBetween(s.date, today()) };
}

export function startSession(db, dayNo) {
  db.run("INSERT INTO session (date, day_no, status, started_at) VALUES (?, ?, 'in_progress', ?)",
    [today(), dayNo, new Date().toISOString()]);
  return rows(db, 'SELECT * FROM session WHERE id = last_insert_rowid()')[0];
}

export function finishSession(db, sessionId) {
  db.run("UPDATE session SET status='complete', ended_at=? WHERE id=?",
    [new Date().toISOString(), sessionId]);
}

export function abandonSession(db, sessionId) {
  db.run("UPDATE session SET status='abandoned', ended_at=? WHERE id=?",
    [new Date().toISOString(), sessionId]);
}

// Redo a day: park what is there, open a fresh session. Nothing is deleted.
export function startOver(db, dayNo) {
  const cur = currentSession(db, dayNo);
  if (cur) abandonSession(db, cur.id);
  return startSession(db, dayNo);
}

export function sessionSets(db, sessionId) {
  return rows(db, 'SELECT * FROM set_log WHERE session_id = ?', [sessionId]);
}

// The one place a set gets written. set_log is append-only: a re-log of the
// same set is a new row carrying a note, never an UPDATE.
export function logSet(db, s) {
  db.run(
    'INSERT INTO set_log (session_id, block_id, exercise_id, side, set_index, weight_lb, band_level, ' +
    'reps_done, hold_seconds_done, target_reps, target_hold_seconds, hit_target, rpe, notes, logged_at) ' +
    'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [s.session_id, s.block_id, s.exercise_id, s.side, s.set_index,
      s.weight_lb ?? null, s.band_level ?? null,
      s.reps_done ?? null, s.hold_seconds_done ?? null,
      s.target_reps ?? null, s.target_hold_seconds ?? null,
      s.hit_target ? 1 : 0, s.rpe ?? null, s.notes ?? null,
      new Date().toISOString()]);
}

// ---------- runner position (Phase 3) ----------
// Persisted after every step so a killed app resumes at the exact set.

export function saveRunnerState(db, state) {
  db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('runner_state', ?)", [JSON.stringify(state)]);
}

export function loadRunnerState(db, sessionId) {
  const r = rows(db, "SELECT value FROM meta WHERE key = 'runner_state'")[0];
  if (!r) return null;
  try {
    const state = JSON.parse(r.value);
    return state.session_id === sessionId ? state : null;
  } catch {
    return null;
  }
}

export function clearRunnerState(db) {
  db.run("DELETE FROM meta WHERE key = 'runner_state'");
}

// What each day looks like on the home list.
export function daySummaries(db) {
  const days = rows(db,
    'SELECT * FROM day_template ORDER BY CASE day_no WHEN 0 THEN 99 ELSE day_no END');
  return days.map((d) => {
    const last = rows(db,
      "SELECT date FROM session WHERE day_no = ? AND status = 'complete' ORDER BY date DESC LIMIT 1",
      [d.day_no])[0];
    const open = currentSession(db, d.day_no);
    return {
      ...d,
      lastDate: last ? last.date : null,
      daysAgo: last ? daysBetween(last.date, today()) : null,
      openStatus: open ? open.status : null,
    };
  });
}

// Which lifting day is up next: the one after the last completed, cycling
// 1 -> 2 -> 3 -> 4 -> 1. Nightly (day_no 0) is every night and never "next".
export function nextDayUp(db) {
  const last = rows(db,
    "SELECT day_no, date FROM session WHERE status = 'complete' AND day_no <> 0 " +
    'ORDER BY date DESC, id DESC LIMIT 1')[0];
  const dayNo = last ? (LIFTING_DAYS[LIFTING_DAYS.indexOf(last.day_no) + 1] || LIFTING_DAYS[0]) : 1;
  const name = rows(db, 'SELECT name FROM day_template WHERE day_no = ?', [dayNo])[0];
  const lastOwn = rows(db,
    "SELECT date FROM session WHERE day_no = ? AND status = 'complete' ORDER BY date DESC LIMIT 1",
    [dayNo])[0];
  return {
    day_no: dayNo,
    name: name ? name.name : '',
    lastTrained: lastOwn ? lastOwn.date : null,
    daysAgo: lastOwn ? daysBetween(lastOwn.date, today()) : null,
    restedSinceLast: last ? daysBetween(last.date, today()) : null,
  };
}

// How many consecutive clean sessions a pair is sitting on, and what the last
// completed session did — so the home screen can say "that's 1 of 2" instead of
// showing nothing at all when a clean session earns no flag yet.
export function lastSessionReport(db, isSessionHit) {
  const s = rows(db,
    "SELECT * FROM session WHERE status = 'complete' AND day_no <> 0 ORDER BY date DESC, id DESC LIMIT 1")[0];
  if (!s) return null;

  const pairs = rows(db,
    'SELECT DISTINCT s.exercise_id, s.side FROM set_log s WHERE s.session_id = ? AND ' +
    "s.block_id IN (SELECT b.id FROM block b JOIN exercise e ON e.id = b.exercise_id " +
    "WHERE b.block_code <> 'warmup' AND e.category <> 'mobility')", [s.id]);

  let clean = 0, missed = 0;
  for (const p of pairs) {
    const sets = rows(db,
      'SELECT * FROM set_log WHERE session_id = ? AND exercise_id = ? AND side = ?',
      [s.id, p.exercise_id, p.side]);
    if (isSessionHit(sets, {})) clean++; else missed++;
  }

  const dayName = rows(db, 'SELECT name FROM day_template WHERE day_no = ?', [s.day_no])[0];
  return {
    session: s,
    dayName: dayName ? dayName.name : '',
    sets: rows(db, 'SELECT COUNT(*) c FROM set_log WHERE session_id = ?', [s.id])[0].c,
    cleanPairs: clean,
    missedPairs: missed,
    // a pair needs two clean sessions in a row; this is how far along the last one got
    priorClean: priorSessionWasClean(db, s, isSessionHit),
  };
}

function priorSessionWasClean(db, s, isSessionHit) {
  const prev = rows(db,
    "SELECT * FROM session WHERE status = 'complete' AND day_no = ? AND id < ? ORDER BY id DESC LIMIT 1",
    [s.day_no, s.id])[0];
  if (!prev) return false;
  const pairs = rows(db,
    'SELECT DISTINCT exercise_id, side FROM set_log WHERE session_id = ?', [prev.id]);
  if (!pairs.length) return false;
  return pairs.every((p) => isSessionHit(
    rows(db, 'SELECT * FROM set_log WHERE session_id = ? AND exercise_id = ? AND side = ?',
      [prev.id, p.exercise_id, p.side]), {}));
}

// Consecutive nights ending today (or yesterday) with any nightly drill logged.
export function nightlyStreak(db) {
  const dates = rows(db, 'SELECT DISTINCT date FROM nightly_log ORDER BY date DESC').map((r) => r.date);
  if (!dates.length) return 0;
  const gap = daysBetween(dates[0], today());
  if (gap > 1) return 0;           // streak already broken
  let streak = 1;
  for (let i = 1; i < dates.length; i++) {
    if (daysBetween(dates[i], dates[i - 1]) === 1) streak++;
    else break;
  }
  return streak;
}
