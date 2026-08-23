// Progression rule engine — spec §4.
//
// The decision logic is pure functions over plain rows (testable without a DB);
// the SQL layer at the bottom only gathers rows and writes progression_flag.
// Nothing here ever writes current_load. Only an explicit Accept does (§4.3).

// ---------- rules (§4.2) ----------

export const NO_PROGRESSION = { mode: 'none' };
export const REVIEW = { mode: 'review' };

const HOLD_CAP_SECONDS = 120;   // past this, add load instead of more time
const BAND_REP_BONUS_CAP = 3;   // +3 reps, then next band step
const KNEE_REP_BONUS_CAP = 6;   // +6 reps, then weighted vest / elevate

// What kind of progression does this exercise support, and by how much?
// ex: { category, load_type, is_timed, increment_value, increment_unit }
export function ruleFor(ex) {
  // Sled first: category is 'power' for the pushes/marches but §4.2 gives sled
  // its own row (+10 lb, distance fixed).
  if (ex.load_type === 'sled') {
    return { mode: 'weight', increment: ex.increment_value ?? 10, unit: 'lb' };
  }
  // Plyometric / power is quality-gated, not load-gated.
  if (ex.category === 'power') return REVIEW;
  // Stretches: duration is prescribed by tightness, not earned.
  if (ex.category === 'mobility') return NO_PROGRESSION;
  if (ex.increment_value == null || ex.increment_unit == null) return NO_PROGRESSION;

  switch (ex.increment_unit) {
    case 'sec':
      return { mode: 'hold', increment: ex.increment_value, unit: 'sec', cap: HOLD_CAP_SECONDS };
    case 'lb':
      return { mode: 'weight', increment: ex.increment_value, unit: 'lb' };
    case 'rep':
      return ex.load_type === 'band'
        ? { mode: 'band', increment: ex.increment_value, unit: 'rep', bonusCap: BAND_REP_BONUS_CAP }
        : { mode: 'reps', increment: ex.increment_value, unit: 'rep', bonusCap: KNEE_REP_BONUS_CAP };
    default:
      return NO_PROGRESSION;
  }
}

// ---------- session hits (§4.1) ----------

// A session hit for (exercise, side): every working set logged for that pair in
// that session met or exceeded its target, at a load >= current_load at the time.
export function isSessionHit(sets, currentLoad = {}) {
  if (!sets || !sets.length) return false;
  return sets.every((s) => {
    const met = s.target_hold_seconds != null
      ? (s.hold_seconds_done ?? 0) >= s.target_hold_seconds
      : (s.reps_done ?? 0) >= (s.target_reps ?? 0);
    if (!met) return false;
    if (currentLoad.weight_lb != null && s.weight_lb != null && s.weight_lb < currentLoad.weight_lb) return false;
    return true;
  });
}

// Trailing streak over sessions ordered oldest -> newest.
// Returns { hits, misses }: consecutive run at the newest end.
export function trailingStreak(hits) {
  let h = 0, m = 0;
  for (let i = hits.length - 1; i >= 0; i--) {
    if (hits[i]) { if (m) break; h++; } else { if (h) break; m++; }
  }
  return { hits: h, misses: m };
}

// ---------- the decision (§4.1 + §4.2) ----------

// args:
//   ex          exercise row (see ruleFor)
//   side        'left' | 'right' | 'both'
//   hits        booleans, oldest -> newest, one per session containing this pair
//   currentLoad { weight_lb, band_level, hold_seconds, reps } or {}
//   baseTarget  { reps, hold_seconds } from block_target
// returns a flag object or null.
export function evaluate({ ex, side, hits, currentLoad = {}, baseTarget = {} }) {
  const rule = ruleFor(ex);
  if (rule.mode === 'none') return null;

  const { hits: hitRun, misses } = trailingStreak(hits);

  if (misses >= 3) {
    return decrease(ex, side, rule, currentLoad, baseTarget, misses);
  }
  if (misses === 2) {
    return {
      flag: 'hold', side, exercise_id: ex.id, suggested_value: null, suggested_unit: null,
      reason: ex.name + ' — ' + sideWord(side) + 'missed sets two sessions running. Hold here until you clear it clean.',
    };
  }
  if (misses === 1) return null;          // one bad day is noise
  if (hitRun < 2) return null;

  if (rule.mode === 'review') {
    return {
      flag: 'review', side, exercise_id: ex.id, suggested_value: null, suggested_unit: null,
      reason: ex.name + ' — ' + sideWord(side) + 'two clean sessions. Power work progresses on quality, not load: '
        + 'add height, speed or load only if the landings look right.',
    };
  }
  return increase(ex, side, rule, currentLoad, baseTarget);
}

function sideWord(side) {
  return side === 'both' ? '' : side.toUpperCase() + ' — ';
}

function increase(ex, side, rule, currentLoad, baseTarget) {
  const base = { side, exercise_id: ex.id, flag: 'increase' };

  if (rule.mode === 'weight') {
    const from = currentLoad.weight_lb;
    const to = (from ?? 0) + rule.increment;
    return {
      ...base, suggested_value: to, suggested_unit: 'lb',
      reason: ex.name + ' — ' + sideWord(side) + 'hit every set two sessions running'
        + (from != null ? ' at ' + fmt(from) + ' lb' : '') + '. Try ' + fmt(to) + ' lb.',
    };
  }

  if (rule.mode === 'hold') {
    const from = currentLoad.hold_seconds ?? baseTarget.hold_seconds ?? 0;
    if (from >= rule.cap) {
      return {
        ...base, flag: 'add_load', suggested_value: null, suggested_unit: 'vest',
        reason: ex.name + ' — ' + sideWord(side) + 'holding ' + from + 's clean, which is the ceiling for time. '
          + 'Add load (weighted vest) and drop back to ' + (baseTarget.hold_seconds ?? 45) + 's rather than holding longer.',
      };
    }
    const to = Math.min(from + rule.increment, rule.cap);
    return {
      ...base, suggested_value: to, suggested_unit: 'sec',
      reason: ex.name + ' — ' + sideWord(side) + 'held ' + from + 's clean two sessions running. Try ' + to + 's.',
    };
  }

  const baseReps = baseTarget.reps ?? 0;
  const from = currentLoad.reps ?? baseReps;
  const bonus = from - baseReps;

  if (rule.mode === 'band') {
    if (bonus >= rule.bonusCap) {
      return {
        ...base, flag: 'add_load', suggested_value: baseReps, suggested_unit: 'band_step',
        reason: ex.name + ' — ' + sideWord(side) + 'at ' + from + ' reps, ' + rule.bonusCap
          + ' above the written target. Move up to the next band and reset to ' + baseReps + ' reps.',
      };
    }
    const to = from + rule.increment;
    return {
      ...base, suggested_value: to, suggested_unit: 'rep',
      reason: ex.name + ' — ' + sideWord(side) + 'clean two sessions running at ' + from
        + ' reps. Try ' + to + ' on the same band (reps first, band step at +' + rule.bonusCap + ').',
    };
  }

  // rule.mode === 'reps' — knee / tibialis bodyweight
  if (bonus >= rule.bonusCap) {
    return {
      ...base, flag: 'add_load', suggested_value: baseReps, suggested_unit: 'vest',
      reason: ex.name + ' — ' + sideWord(side) + 'at ' + from + ' reps, ' + rule.bonusCap
        + ' above the written target. Add a weighted vest (or elevate the board) and reset to ' + baseReps + ' reps.',
    };
  }
  const to = from + rule.increment;
  return {
    ...base, suggested_value: to, suggested_unit: 'rep',
    reason: ex.name + ' — ' + sideWord(side) + 'clean two sessions running at ' + from + ' reps. Try ' + to + '.',
  };
}

function decrease(ex, side, rule, currentLoad, baseTarget, misses) {
  const base = {
    side, exercise_id: ex.id, flag: 'reduce',
    reasonTail: ' Three sessions short in a row — back off one step and rebuild.',
  };
  const why = ex.name + ' — ' + sideWord(side) + 'missed sets ' + misses + ' sessions running.';

  if (rule.mode === 'review') {
    return { side, exercise_id: ex.id, flag: 'review', suggested_value: null, suggested_unit: null,
      reason: why + ' Power work is quality-gated: cut the height or load and rebuild the landing.' };
  }
  if (rule.mode === 'weight') {
    const from = currentLoad.weight_lb;
    const to = Math.max((from ?? rule.increment) - rule.increment, 0);
    return { ...base, suggested_value: to, suggested_unit: 'lb',
      reason: why + ' Drop to ' + fmt(to) + ' lb and build back.' };
  }
  if (rule.mode === 'hold') {
    const from = currentLoad.hold_seconds ?? baseTarget.hold_seconds ?? 0;
    const to = Math.max(from - rule.increment, 15);
    return { ...base, suggested_value: to, suggested_unit: 'sec',
      reason: why + ' Drop to ' + to + 's and build back.' };
  }
  const baseReps = baseTarget.reps ?? 0;
  const from = currentLoad.reps ?? baseReps;
  const to = Math.max(from - rule.increment, 1);
  return { ...base, suggested_value: to, suggested_unit: 'rep',
    reason: why + ' Drop to ' + to + ' reps and build back.' };
}

function fmt(n) {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

// ---------- SQL layer ----------

// Progression ignores warm-up blocks and mobility work entirely (§4.1).
const PROGRESSABLE = `
  s.block_id IN (
    SELECT b.id FROM block b JOIN exercise e2 ON e2.id = b.exercise_id
    WHERE b.block_code <> 'warmup' AND e2.category <> 'mobility'
  )`;

function rows(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const out = [];
  while (stmt.step()) out.push(stmt.getAsObject());
  stmt.free();
  return out;
}

// The approved working target for a pair, falling back to the seeded target.
export function effectiveTarget(db, exerciseId, side, baseTarget) {
  const cl = rows(db,
    'SELECT * FROM current_load WHERE exercise_id = ? AND side = ?', [exerciseId, side])[0] || {};
  return {
    reps: cl.reps ?? baseTarget.reps ?? null,
    hold_seconds: cl.hold_seconds ?? baseTarget.hold_seconds ?? null,
    weight_lb: cl.weight_lb ?? null,
    band_level: cl.band_level ?? null,
  };
}

// Evaluate every (exercise, side) touched by a completed session and write
// pending flags. Returns the flags written.
export function computeFlags(db, sessionId) {
  const pairs = rows(db,
    'SELECT DISTINCT s.exercise_id, s.side FROM set_log s WHERE s.session_id = ? AND ' + PROGRESSABLE,
    [sessionId]);
  const written = [];

  for (const p of pairs) {
    const ex = rows(db, 'SELECT * FROM exercise WHERE id = ?', [p.exercise_id])[0];
    if (!ex) continue;
    const currentLoad = rows(db,
      'SELECT * FROM current_load WHERE exercise_id = ? AND side = ?', [p.exercise_id, p.side])[0] || {};
    // No approved load yet (nothing has been Accepted for this pair). Build the
    // suggestion on what was actually lifted, not on zero — otherwise a first
    // suggestion reads "hit every set... try 5 lb". Read-only: current_load is
    // still written by Accept alone (§4.3).
    if (currentLoad.weight_lb == null) {
      const lifted = rows(db,
        'SELECT MAX(weight_lb) w FROM set_log WHERE exercise_id = ? AND side = ? AND session_id = ?',
        [p.exercise_id, p.side, sessionId])[0];
      if (lifted && lifted.w != null) currentLoad.weight_lb = lifted.w;
    }
    const baseTarget = rows(db,
      'SELECT t.reps, t.hold_seconds FROM block_target t JOIN block b ON b.id = t.block_id ' +
      "WHERE b.exercise_id = ? AND t.side = ? AND b.block_code <> 'warmup' ORDER BY b.order_index LIMIT 1",
      [p.exercise_id, p.side])[0] || {};

    // sessions containing this pair, oldest -> newest
    const sessions = rows(db,
      'SELECT DISTINCT s.session_id, ss.date FROM set_log s JOIN session ss ON ss.id = s.session_id ' +
      "WHERE s.exercise_id = ? AND s.side = ? AND ss.status = 'complete' AND " + PROGRESSABLE +
      ' ORDER BY ss.date, s.session_id',
      [p.exercise_id, p.side]);

    const hits = sessions.map((s) => {
      // only the newest row per (block, set_index) counts — set_log is append-only
      const sets = rows(db,
        'SELECT * FROM set_log s WHERE s.session_id = ? AND s.exercise_id = ? AND s.side = ? AND ' + PROGRESSABLE +
        ' AND s.id IN (SELECT MAX(id) FROM set_log WHERE session_id = s.session_id AND exercise_id = s.exercise_id ' +
        '  AND side = s.side GROUP BY block_id, set_index)',
        [s.session_id, p.exercise_id, p.side]);
      return isSessionHit(sets, currentLoad);
    });

    const flag = evaluate({ ex, side: p.side, hits, currentLoad, baseTarget });
    if (!flag) continue;
    if (isSuppressed(db, flag, sessions)) continue;
    if (hasPending(db, flag)) continue;

    db.run(
      'INSERT INTO progression_flag (created_session_id, exercise_id, side, flag, suggested_value, ' +
      "suggested_unit, reason, status) VALUES (?,?,?,?,?,?,?,'pending')",
      [sessionId, flag.exercise_id, flag.side, flag.flag,
        flag.suggested_value, flag.suggested_unit, flag.reason]);
    written.push(flag);
  }
  return written;
}

function hasPending(db, flag) {
  return rows(db,
    "SELECT 1 FROM progression_flag WHERE exercise_id=? AND side=? AND flag=? AND status='pending' LIMIT 1",
    [flag.exercise_id, flag.side, flag.flag]).length > 0;
}

// A declined flag does not come back the next session. It can return once the
// evidence is fresh — i.e. the streak that triggers it starts after the decline.
function isSuppressed(db, flag, sessions) {
  const declined = rows(db,
    "SELECT MAX(created_session_id) sid FROM progression_flag " +
    "WHERE exercise_id=? AND side=? AND flag=? AND status='declined'",
    [flag.exercise_id, flag.side, flag.flag])[0];
  if (!declined || declined.sid == null) return false;
  const streakStart = sessions.length >= 2 ? sessions[sessions.length - 2].session_id : null;
  return streakStart == null || streakStart <= declined.sid;
}

// ---------- decisions (§4.3) ----------

// A snoozed flag is still live — it is shown and can be decided (§4.3).
const DECIDABLE = ['pending', 'snoozed'];

export function acceptFlag(db, flagId) {
  const f = rows(db, 'SELECT * FROM progression_flag WHERE id = ?', [flagId])[0];
  if (!f || !DECIDABLE.includes(f.status)) return;
  const now = new Date().toISOString();
  const cl = rows(db, 'SELECT * FROM current_load WHERE exercise_id=? AND side=?',
    [f.exercise_id, f.side])[0] || {};
  const next = {
    weight_lb: cl.weight_lb ?? null,
    band_level: cl.band_level ?? null,
    hold_seconds: cl.hold_seconds ?? null,
    reps: cl.reps ?? null,
  };

  switch (f.suggested_unit) {
    case 'lb': next.weight_lb = f.suggested_value; break;
    case 'sec': next.hold_seconds = f.suggested_value; break;
    case 'rep': next.reps = f.suggested_value; break;
    case 'band_step':
      next.reps = f.suggested_value;   // reset reps; the band itself gets logged as used
      next.band_level = null;
      break;
    case 'vest':
      next.reps = f.suggested_value ?? next.reps;
      break;
    default: break;                    // review / hold carry no value
  }

  db.run(
    'INSERT OR REPLACE INTO current_load (exercise_id, side, weight_lb, band_level, hold_seconds, reps, updated_at) ' +
    'VALUES (?,?,?,?,?,?,?)',
    [f.exercise_id, f.side, next.weight_lb, next.band_level, next.hold_seconds, next.reps, now]);
  db.run("UPDATE progression_flag SET status='accepted', decided_at=? WHERE id=?", [now, flagId]);
}

// Apply several at once (the home screen's "Accept all").
export function acceptAll(db, flagIds) {
  for (const id of flagIds) acceptFlag(db, id);
}

export function declineFlag(db, flagId) {
  db.run("UPDATE progression_flag SET status='declined', decided_at=? WHERE id=? AND status IN ('pending','snoozed')",
    [new Date().toISOString(), flagId]);
}

// Snooze: decided, but not suppressed — it comes back next session.
export function snoozeFlag(db, flagId) {
  db.run("UPDATE progression_flag SET status='snoozed', decided_at=? WHERE id=? AND status='pending'",
    [new Date().toISOString(), flagId]);
}

export function pendingFlags(db) {
  return rows(db,
    'SELECT f.*, e.name ex_name FROM progression_flag f JOIN exercise e ON e.id = f.exercise_id ' +
    "WHERE f.status IN ('pending','snoozed') ORDER BY f.id");
}
