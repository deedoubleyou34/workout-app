// Asymmetry — spec §4.4 and Phase 7. The one question the app exists to
// answer: is the gap closing?
//
// Everything above the SQL line is pure, because the verdict strings are the
// deliverable ("Left was 22% behind, now 9% behind. Closing.") and a string
// that is confidently wrong is worse than no string at all.

import { weekStart, daysBetween } from './sessions.js';

// A single logged set, reduced to one comparable number.
//
// §4.4 writes capacity as MAX(weight_lb * reps_done), or MAX(hold_seconds_done)
// when timed. Taken literally that returns NOTHING for Copenhagen planks,
// single-leg glute bridges, clamshells, fire hydrants — the bodyweight
// unilateral work, which is most of the asymmetry work in the program. For
// those, the reps ARE the capacity.
export function capacityOf(row) {
  if (!row) return null;
  if (row.hold_seconds_done != null) return { value: row.hold_seconds_done, kind: 'hold' };
  if (row.reps_done == null) return null;                       // a sled 'effort' set counts nothing
  if (row.weight_lb != null && row.weight_lb > 0) {
    return { value: row.weight_lb * row.reps_done, kind: 'load' };
  }
  return { value: row.reps_done, kind: 'reps' };
}

// Ties are broken by this order rather than by however the rows arrived.
// 90/90 hip switches carry one rep target and two per-side holds on the same
// block; without a fixed rule the label under the chart could read "reps" one
// week and "s held" the next purely on row order.
const KIND_RANK = { hold: 0, load: 1, reps: 2 };

// Best set of the group. Sets of different kinds are not comparable, so the
// kind with the most sets wins and the others are ignored rather than mixed.
export function bestCapacity(rows) {
  const byKind = new Map();
  for (const r of rows || []) {
    const c = capacityOf(r);
    if (!c) continue;
    if (!byKind.has(c.kind)) byKind.set(c.kind, []);
    byKind.get(c.kind).push(c.value);
  }
  if (!byKind.size) return null;
  let best = null;
  for (const [kind, values] of byKind) {
    const better = !best || values.length > best.count
      || (values.length === best.count && KIND_RANK[kind] < KIND_RANK[best.kind]);
    if (better) best = { kind, count: values.length, value: Math.max(...values) };
  }
  return { value: best.value, kind: best.kind };
}

// §4.4: weak = the exercise's bias_side, strong = the other one. A negative
// result means the biased side has passed it, which is the outcome we want and
// must be said in words rather than printed as a minus sign.
export function gapPct(strongValue, weakValue) {
  if (strongValue == null || weakValue == null) return null;
  if (!(strongValue > 0)) return null;
  return ((strongValue - weakValue) / strongValue) * 100;
}

const OTHER = { left: 'right', right: 'left' };

// rows: [{ date, side, weight_lb, reps_done, hold_seconds_done }]
// -> one entry per week that has BOTH sides, oldest first.
export function weeklySeries(rows, biasSide) {
  const weeks = new Map();
  for (const r of rows || []) {
    if (r.side !== 'left' && r.side !== 'right') continue;      // 'both' is not asymmetry data
    const w = weekStart(r.date);
    if (!weeks.has(w)) weeks.set(w, { week: w, left: [], right: [], dates: new Set() });
    weeks.get(w)[r.side].push(r);
    weeks.get(w).dates.add(r.date);
  }
  const out = [];
  for (const w of [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week))) {
    const left = bestCapacity(w.left);
    const right = bestCapacity(w.right);
    const strongSide = OTHER[biasSide] || 'right';
    const weak = biasSide === 'left' ? left : right;
    const strong = strongSide === 'left' ? left : right;
    // comparing a hold against a rep count would be arithmetic, not meaning
    const comparable = weak && strong && weak.kind === strong.kind;
    out.push({
      week: w.week,
      sessions: w.dates.size,
      left: left ? left.value : null,
      right: right ? right.value : null,
      kind: (left || right || {}).kind || null,
      gapPct: comparable ? gapPct(strong.value, weak.value) : null,
    });
  }
  return out;
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const CLOSING_THRESHOLD = 3;      // percentage points; less than this is noise
const LEVEL_THRESHOLD = 5;        // at or under this, the gap is closed
const MIN_SESSIONS = 4;           // spec Phase 7 exit gate
const STUCK_WEEKS = 6;            // §4.4: flat or widening after 6 weeks is the signal

// The sentence under the chart. This is the reason the app exists, so it says
// what happened and what it means, and admits when it does not know yet.
export function verdictFor({ series, biasSide, sessions }) {
  const weak = cap(biasSide || 'left');
  const usable = (series || []).filter((s) => s.gapPct != null);

  if (!sessions || sessions < MIN_SESSIONS) {
    return {
      state: 'thin',
      text: 'Not enough logged yet — ' + (sessions || 0) + ' of ' + MIN_SESSIONS
        + ' sessions. No verdict until there is something to compare.',
    };
  }
  if (!usable.length) {
    return { state: 'thin', text: 'Both sides have not been logged in the same week yet.' };
  }

  const last = usable[usable.length - 1];
  const now = Math.round(last.gapPct);

  if (now < 0) {
    return { state: 'ahead', text: weak + ' is now ahead by ' + Math.abs(now) + '%. The gap has flipped.' };
  }
  if (now <= LEVEL_THRESHOLD) {
    return { state: 'level', text: weak + ' is within ' + now + '% — level. Hold the bias where it is.' };
  }
  if (usable.length < 2) {
    return {
      state: 'thin',
      text: weak + ' is ' + now + '% behind. One week of data, so there is no trend yet.',
    };
  }

  const first = usable[0];
  const then = Math.round(first.gapPct);
  // Calendar weeks between the two ends, not the number of weeks that happen
  // to carry data — "4 weeks ago" has to mean four weeks ago even if two of
  // them were missed.
  const spanWeeks = Math.max(1, Math.round(daysBetween(first.week, last.week) / 7));
  const weekWord = spanWeeks === 1 ? 'week' : 'weeks';
  const moved = then - now;
  const history = weak + ' was ' + then + '% behind ' + spanWeeks + ' ' + weekWord
    + ' ago. Now ' + now + '% behind. ';

  if (moved >= CLOSING_THRESHOLD) return { state: 'closing', text: history + 'Closing.' };
  if (moved <= -CLOSING_THRESHOLD) {
    return {
      state: 'widening',
      text: history + 'Widening — the bias is not keeping up. Worth changing something.',
    };
  }
  if (spanWeeks >= STUCK_WEEKS) {
    return {
      state: 'stuck',
      text: weak + ' has sat around ' + now + '% behind for ' + spanWeeks + ' ' + weekWord
        + '. The program is not moving this one — change it.',
    };
  }
  return {
    state: 'flat',
    text: history + 'Holding steady. Too early to call at ' + spanWeeks + ' ' + weekWord + '.',
  };
}

// ---------- SQL layer ----------

function rows(db, sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const out = [];
  while (stmt.step()) out.push(stmt.getAsObject());
  stmt.free();
  return out;
}

// One entry per unilateral exercise, aggregated across EVERY day it appears
// in. Per-block would be wrong: Day 4 prescribes the single-leg glute bridge
// on the right only by design, and its left data comes from the nightly block.
export function unilateralTrends(db) {
  const exercises = rows(db,
    'SELECT e.id, e.name, e.is_timed, ' +
    '(SELECT b.bias_side FROM block b WHERE b.exercise_id = e.id AND b.bias_side IS NOT NULL LIMIT 1) bias ' +
    'FROM exercise e WHERE e.is_unilateral = 1 ORDER BY e.name');

  const out = [];
  for (const ex of exercises) {
    const sets = rows(db,
      'SELECT s.date, l.side, l.weight_lb, l.reps_done, l.hold_seconds_done ' +
      'FROM set_log l JOIN session s ON s.id = l.session_id ' +
      "WHERE l.exercise_id = ? AND l.side IN ('left','right') AND s.status = 'complete' " +
      'ORDER BY s.date', [ex.id]);
    if (!sets.length) continue;
    const sessions = new Set(sets.map((r) => r.date)).size;
    const series = weeklySeries(sets, ex.bias || 'left');
    out.push({
      exercise_id: ex.id,
      name: ex.name,
      biasSide: ex.bias || null,
      sessions,
      series,
      verdict: verdictFor({ series, biasSide: ex.bias || 'left', sessions }),
    });
  }
  // loudest first: a widening or stuck gap is the thing worth reading
  const rank = { widening: 0, stuck: 1, flat: 2, closing: 3, level: 4, ahead: 5, thin: 6 };
  return out.sort((a, b) => (rank[a.verdict.state] ?? 9) - (rank[b.verdict.state] ?? 9));
}

// Spec Phase 7 step 6: is the left bias actually happening, or only intended?
export function weeklyVolumeBySide(db) {
  const sets = rows(db,
    'SELECT s.date, l.side, COALESCE(l.reps_done, 0) reps FROM set_log l ' +
    "JOIN session s ON s.id = l.session_id WHERE l.side IN ('left','right') " +
    "AND s.status = 'complete'");
  const weeks = new Map();
  for (const r of sets) {
    const w = weekStart(r.date);
    if (!weeks.has(w)) weeks.set(w, { week: w, left: 0, right: 0, leftReps: 0, rightReps: 0 });
    const bucket = weeks.get(w);
    bucket[r.side] += 1;
    bucket[r.side + 'Reps'] += r.reps;
  }
  return [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week));
}

// The nightly non-negotiable that has a number worth trending: how long the
// couch stretch takes to get uncomfortable, per side.
export function couchStretchTrend(db) {
  const logs = rows(db,
    "SELECT date, side, value FROM nightly_log WHERE drill LIKE 'Couch stretch%' " +
    "AND side IN ('left','right') ORDER BY date");
  const days = new Map();
  for (const r of logs) {
    if (!days.has(r.date)) days.set(r.date, { date: r.date, left: null, right: null });
    days.get(r.date)[r.side] = r.value;
  }
  return [...days.values()];
}
