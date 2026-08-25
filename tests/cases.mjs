// Phase 2 progression test cases (spec Phase 2 step 3).
// One source of truth, run two ways:
//   - tests/test.html   in Safari on the iPhone (this is the gate)
//   - tools/run_tests.mjs  in Node on the PC, so a broken rule never ships
//
// ctx: { check(name, ok, detail), eq(name, got, want), initSqlJs, loadSchema() }

import { ruleFor, isSessionHit, trailingStreak, evaluate,
         computeFlags, acceptFlag, acceptAll, declineFlag, snoozeFlag, pendingFlags } from '../js/progression.js';
import { seed } from '../js/seed.js';
import { nextDayUp, startOver, currentSession, finishSession } from '../js/sessions.js';
import { buildSteps, remainingSeconds, resumeIndex, progressOf, stepTarget, isTimedStep,
         MAIN_REST_FLOOR } from '../js/runner.js';
import { setText, restText, cueId, spokenSeconds, hasSecondsClip } from '../js/cues.js';
import { needsRefresh, callbackParams, retryAfterMs, describeError,
         nowPlayingText } from '../js/spotify.js';
import { pickStrategy, planCycle, canRelease, MIN_CYCLE_MS } from '../js/ducking.js';

const EX = {
  slRdl:      { id: 1, name: 'Single-leg RDL (DB)', category: 'strength',   load_type: 'dumbbell',   is_timed: 0, increment_value: 5,  increment_unit: 'lb' },
  copenhagen: { id: 2, name: 'Copenhagen plank',    category: 'corrective', load_type: 'bodyweight', is_timed: 1, increment_value: 10, increment_unit: 'sec' },
  couch:      { id: 3, name: 'Couch stretch',       category: 'mobility',   load_type: 'bodyweight', is_timed: 1, increment_value: null, increment_unit: null },
  revNordic:  { id: 4, name: 'Reverse Nordic',      category: 'knee',       load_type: 'bodyweight', is_timed: 0, increment_value: 2,  increment_unit: 'rep' },
  sledPush:   { id: 5, name: 'Heavy sled push',     category: 'power',      load_type: 'sled',       is_timed: 0, increment_value: 10, increment_unit: 'lb' },
  jumpShrug:  { id: 6, name: 'Trap bar deadlift jump-shrug', category: 'power', load_type: 'trap_bar', is_timed: 0, increment_value: null, increment_unit: null },
  bandRow:    { id: 7, name: 'Half-kneeling single-arm band row', category: 'strength', load_type: 'band', is_timed: 0, increment_value: 1, increment_unit: 'rep' },
  hipThrust:  { id: 8, name: 'Barbell hip thrust',  category: 'strength',   load_type: 'barbell',    is_timed: 0, increment_value: 10, increment_unit: 'lb' },
};
const CLEAN = [true, true];

export async function run(ctx) {
  const { check, eq } = ctx;

  // 1. two clean sessions on SL RDL left -> increase +5 lb, left only
  {
    const f = evaluate({ ex: EX.slRdl, side: 'left', hits: CLEAN,
      currentLoad: { weight_lb: 45 }, baseTarget: { reps: 8 } });
    eq('SL RDL left, 2 clean -> increase 50 lb',
      [f.flag, f.suggested_value, f.suggested_unit, f.side], ['increase', 50, 'lb', 'left']);
    check('reason reads in plain English', /two sessions running/.test(f.reason) && /50 lb/.test(f.reason), f.reason);
  }

  // 2. sides are independent
  {
    const right = evaluate({ ex: EX.slRdl, side: 'right', hits: [true, false],
      currentLoad: { weight_lb: 35 }, baseTarget: { reps: 8 } });
    check('right side untouched when it did not earn it', right === null, JSON.stringify(right));
    const left = evaluate({ ex: EX.slRdl, side: 'left', hits: CLEAN,
      currentLoad: { weight_lb: 45 }, baseTarget: { reps: 8 } });
    eq('left still flags independently', [left.flag, left.side], ['increase', 'left']);
  }

  // 3. one missed set -> no flag
  eq('one missed session -> no flag',
    evaluate({ ex: EX.slRdl, side: 'left', hits: [true, true, false],
      currentLoad: { weight_lb: 45 }, baseTarget: { reps: 8 } }), null);

  // 4. two consecutive missed -> hold; three -> reduce
  {
    const two = evaluate({ ex: EX.slRdl, side: 'left', hits: [true, false, false],
      currentLoad: { weight_lb: 45 }, baseTarget: { reps: 8 } });
    eq('two consecutive misses -> hold', [two.flag, two.suggested_value], ['hold', null]);
    const three = evaluate({ ex: EX.slRdl, side: 'left', hits: [true, false, false, false],
      currentLoad: { weight_lb: 45 }, baseTarget: { reps: 8 } });
    eq('three consecutive misses -> reduce one increment',
      [three.flag, three.suggested_value, three.suggested_unit], ['reduce', 40, 'lb']);
  }

  // 5. band exercise progresses reps before band step
  {
    const first = evaluate({ ex: EX.bandRow, side: 'left', hits: CLEAN,
      currentLoad: {}, baseTarget: { reps: 12 } });
    eq('band row at target -> +1 rep, same band',
      [first.flag, first.suggested_value, first.suggested_unit], ['increase', 13, 'rep']);
    const capped = evaluate({ ex: EX.bandRow, side: 'left', hits: CLEAN,
      currentLoad: { reps: 15 }, baseTarget: { reps: 12 } });
    eq('band row at +3 reps -> next band step, reps reset',
      [capped.flag, capped.suggested_value, capped.suggested_unit], ['add_load', 12, 'band_step']);
  }

  // 6. Copenhagen (timed) -> +10 sec, not lb
  {
    const f = evaluate({ ex: EX.copenhagen, side: 'left', hits: CLEAN,
      currentLoad: { hold_seconds: 60 }, baseTarget: { hold_seconds: 60 } });
    eq('Copenhagen -> +10 sec', [f.flag, f.suggested_value, f.suggested_unit], ['increase', 70, 'sec']);
  }

  // 7. a hold already at 120 s -> no time increase, add load instead
  {
    const f = evaluate({ ex: EX.copenhagen, side: 'left', hits: CLEAN,
      currentLoad: { hold_seconds: 120 }, baseTarget: { hold_seconds: 60 } });
    eq('120 s hold -> add load, not more time', [f.flag, f.suggested_unit], ['add_load', 'vest']);
    check('120 s reason explains the ceiling', /ceiling for time/.test(f.reason), f.reason);
  }

  // 8. couch stretch never flags, even after ten clean sessions
  eq('couch stretch never flagged (10 clean sessions)',
    evaluate({ ex: EX.couch, side: 'left', hits: Array(10).fill(true),
      currentLoad: { hold_seconds: 120 }, baseTarget: { hold_seconds: 120 } }), null);

  // 9. reverse Nordic -> +2 reps; after +6 -> weighted vest
  {
    const f = evaluate({ ex: EX.revNordic, side: 'both', hits: CLEAN, currentLoad: {}, baseTarget: { reps: 8 } });
    eq('reverse Nordic -> +2 reps', [f.flag, f.suggested_value, f.suggested_unit], ['increase', 10, 'rep']);
    const capped = evaluate({ ex: EX.revNordic, side: 'both', hits: CLEAN,
      currentLoad: { reps: 14 }, baseTarget: { reps: 8 } });
    eq('reverse Nordic at +6 -> weighted vest, reps reset',
      [capped.flag, capped.suggested_value, capped.suggested_unit], ['add_load', 8, 'vest']);
  }

  // 10. heavy sled push -> +10 lb, distance unchanged
  {
    const f = evaluate({ ex: EX.sledPush, side: 'both', hits: CLEAN,
      currentLoad: { weight_lb: 90 }, baseTarget: {} });
    eq('sled push -> +10 lb', [f.flag, f.suggested_value, f.suggested_unit], ['increase', 100, 'lb']);
    check('sled suggestion says nothing about distance', !/\d+\s*m\b/.test(f.reason), f.reason);
  }

  // 11. trap bar jump shrug (power) -> review only
  {
    const f = evaluate({ ex: EX.jumpShrug, side: 'both', hits: CLEAN,
      currentLoad: { weight_lb: 185 }, baseTarget: { reps: 4 } });
    eq('jump shrug -> review, no suggested value',
      [f.flag, f.suggested_value, f.suggested_unit], ['review', null, null]);
    check('review reason mentions quality', /quality/.test(f.reason), f.reason);
  }

  // rule mapping sanity
  eq('rule: hip thrust is +10 lb', ruleFor(EX.hipThrust).increment, 10);
  eq('rule: mobility is no-progression', ruleFor(EX.couch).mode, 'none');
  eq('rule: sled beats the power category', ruleFor(EX.sledPush).mode, 'weight');

  // session-hit + streak helpers
  check('session hit: all sets met target',
    isSessionHit([{ reps_done: 8, target_reps: 8, weight_lb: 45 }], { weight_lb: 45 }) === true);
  check('session hit: a short set fails the session',
    isSessionHit([{ reps_done: 8, target_reps: 8 }, { reps_done: 6, target_reps: 8 }], {}) === false);
  check('session hit: hitting reps at a LIGHTER load is not a hit',
    isSessionHit([{ reps_done: 8, target_reps: 8, weight_lb: 40 }], { weight_lb: 45 }) === false);
  eq('trailing streak counts the newest run', trailingStreak([false, true, true]), { hits: 2, misses: 0 });

  // ---------- DB-backed ----------
  const SQL = await ctx.initSqlJs();
  const schema = await ctx.loadSchema();
  const freshDb = () => {
    const db = new SQL.Database();
    db.run(schema);
    seed(db);
    return db;
  };
  const scalar = (db, sql, params) => {
    const s = db.prepare(sql);
    s.bind(params);
    s.step();
    const row = s.getAsObject();
    s.free();
    return row[Object.keys(row)[0]];
  };
  const idOf = (db, name) => scalar(db, 'SELECT id FROM exercise WHERE name = ?', [name]);
  const mainBlock = (db, exId) =>
    scalar(db, "SELECT id FROM block WHERE exercise_id = ? AND block_code <> 'warmup' LIMIT 1", [exId]);
  const warmBlock = (db, exId) =>
    scalar(db, "SELECT id FROM block WHERE exercise_id = ? AND block_code = 'warmup' LIMIT 1", [exId]);

  function logSession(db, sessionId, date, entries) {
    db.run("INSERT INTO session (id, date, day_no, status) VALUES (?,?,4,'complete')", [sessionId, date]);
    for (const e of entries) {
      db.run('INSERT INTO set_log (session_id, block_id, exercise_id, side, set_index, weight_lb, reps_done, ' +
        'hold_seconds_done, target_reps, target_hold_seconds, hit_target, logged_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        [sessionId, e.block_id, e.exercise_id, e.side, e.set_index, e.weight_lb ?? null, e.reps_done ?? null,
         e.hold ?? null, e.target_reps ?? null, e.target_hold ?? null, e.hit ?? 1, date]);
    }
  }

  // 12. warm-up couch stretch is never flagged (SQL-level exclusion)
  {
    const db = freshDb();
    const couchId = idOf(db, 'Couch stretch');
    const wb = warmBlock(db, couchId);
    for (let i = 1; i <= 3; i++) {
      logSession(db, i, '2026-08-0' + i,
        [{ block_id: wb, exercise_id: couchId, side: 'left', set_index: 1, hold: 120, target_hold: 120 }]);
      computeFlags(db, i);
    }
    eq('warm-up couch stretch never flagged', pendingFlags(db).length, 0);
    db.close();
  }

  // 13. end-to-end: two clean sessions -> pending flag -> Accept writes current_load
  {
    const db = freshDb();
    const exId = idOf(db, 'Single-leg RDL (DB)');
    const blockId = mainBlock(db, exId);
    db.run("INSERT INTO current_load (exercise_id, side, weight_lb, updated_at) VALUES (?,'left',45,'2026-08-01')", [exId]);
    for (let i = 1; i <= 2; i++) {
      logSession(db, i, '2026-08-0' + i, [
        { block_id: blockId, exercise_id: exId, side: 'left',  set_index: 1, weight_lb: 45, reps_done: 8, target_reps: 8 },
        { block_id: blockId, exercise_id: exId, side: 'right', set_index: 1, weight_lb: 35, reps_done: 6, target_reps: 8, hit: 0 },
      ]);
    }
    computeFlags(db, 2);
    const flags = pendingFlags(db);
    // Left earned an increase; right missed both sessions, which earns a hold
    // (§4.1) — a note, not a load change. The two sides never share a decision.
    const left = flags.find((f) => f.side === 'left');
    const right = flags.find((f) => f.side === 'right');
    eq('end-to-end: left flags increase, right flags hold, independently',
      [flags.length, left && left.flag, right && right.flag, right && right.suggested_value],
      [2, 'increase', 'hold', null]);

    acceptFlag(db, left.id);
    eq('Accept writes current_load (45 -> 50)',
      scalar(db, "SELECT weight_lb FROM current_load WHERE exercise_id=? AND side='left'", [exId]), 50);
    eq('accepted flag is no longer pending',
      pendingFlags(db).filter((f) => f.id === left.id).length, 0);
    eq('right side current_load never created',
      scalar(db, "SELECT COUNT(*) c FROM current_load WHERE exercise_id=? AND side='right'", [exId]), 0);
    db.close();
  }

  // 14. Decline leaves current_load alone and does not re-raise next session
  {
    const db = freshDb();
    const exId = idOf(db, 'Single-leg RDL (DB)');
    const blockId = mainBlock(db, exId);
    db.run("INSERT INTO current_load (exercise_id, side, weight_lb, updated_at) VALUES (?,'left',45,'2026-08-01')", [exId]);
    const clean = (i) => {
      logSession(db, i, '2026-08-0' + i,
        [{ block_id: blockId, exercise_id: exId, side: 'left', set_index: 1, weight_lb: 45, reps_done: 8, target_reps: 8 }]);
      computeFlags(db, i);
    };
    clean(1); clean(2);
    const f = pendingFlags(db)[0];
    declineFlag(db, f.id);
    eq('Decline leaves current_load untouched',
      scalar(db, "SELECT weight_lb FROM current_load WHERE exercise_id=? AND side='left'", [exId]), 45);
    clean(3);
    eq('Declined flag does not re-raise the next session', pendingFlags(db).length, 0);
    clean(4);
    eq('Declined flag can return after two fresh clean sessions', pendingFlags(db).length, 1);
    db.close();
  }

  // 15. first-ever suggestion builds on the weight actually lifted, not zero.
  // Regression: with no current_load row this used to read "try 5 lb".
  {
    const db = freshDb();
    const exId = idOf(db, 'Single-leg RDL (DB)');
    const blockId = mainBlock(db, exId);
    for (let i = 1; i <= 2; i++) {
      logSession(db, i, '2026-08-0' + i,
        [{ block_id: blockId, exercise_id: exId, side: 'left', set_index: 1, weight_lb: 45, reps_done: 8, target_reps: 8 }]);
      computeFlags(db, i);
    }
    const f = pendingFlags(db)[0];
    eq('first suggestion builds on the logged weight (45 -> 50), not on zero',
      [f && f.suggested_value, f && f.suggested_unit], [50, 'lb']);
    db.close();
  }

  // 16. Accept works on a snoozed flag. Regression: acceptFlag ignored anything
  // that was not status='pending', so Accept on a snoozed card did nothing.
  {
    const db = freshDb();
    const exId = idOf(db, 'Single-leg RDL (DB)');
    const blockId = mainBlock(db, exId);
    for (let i = 1; i <= 2; i++) {
      logSession(db, i, '2026-08-0' + i,
        [{ block_id: blockId, exercise_id: exId, side: 'left', set_index: 1, weight_lb: 45, reps_done: 8, target_reps: 8 }]);
      computeFlags(db, i);
    }
    const f = pendingFlags(db)[0];
    snoozeFlag(db, f.id);
    eq('snoozed flag is still shown', pendingFlags(db).length, 1);
    acceptFlag(db, f.id);
    eq('Accept applies a snoozed flag',
      scalar(db, "SELECT weight_lb FROM current_load WHERE exercise_id=? AND side='left'", [exId]), 50);
    db.close();
  }

  // 17. Accept all applies every applicable suggestion at once
  {
    const db = freshDb();
    const exId = idOf(db, 'Single-leg RDL (DB)');
    const blockId = mainBlock(db, exId);
    for (let i = 1; i <= 2; i++) {
      logSession(db, i, '2026-08-0' + i, [
        { block_id: blockId, exercise_id: exId, side: 'left',  set_index: 1, weight_lb: 45, reps_done: 8, target_reps: 8 },
        { block_id: blockId, exercise_id: exId, side: 'right', set_index: 1, weight_lb: 35, reps_done: 8, target_reps: 8 },
      ]);
      computeFlags(db, i);
    }
    const ids = pendingFlags(db).filter((f) => f.suggested_unit).map((f) => f.id);
    acceptAll(db, ids);
    eq('Accept all moves both sides on their own ladders',
      [scalar(db, "SELECT weight_lb FROM current_load WHERE exercise_id=? AND side='left'", [exId]),
       scalar(db, "SELECT weight_lb FROM current_load WHERE exercise_id=? AND side='right'", [exId])],
      [50, 40]);
    db.close();
  }

  // 18. an abandoned session never reaches the engine
  {
    const db = freshDb();
    const exId = idOf(db, 'Single-leg RDL (DB)');
    const blockId = mainBlock(db, exId);
    const set = (sid) => ({ block_id: blockId, exercise_id: exId, side: 'left', set_index: 1,
      weight_lb: 45, reps_done: 8, target_reps: 8, sid });
    logSession(db, 1, '2026-08-01', [set(1)]);
    computeFlags(db, 1);
    // second clean session, but started over instead of finished
    db.run("INSERT INTO session (id, date, day_no, status) VALUES (2, ?, 4, 'in_progress')", [todayStr()]);
    db.run('INSERT INTO set_log (session_id, block_id, exercise_id, side, set_index, weight_lb, reps_done, ' +
      'target_reps, hit_target, logged_at) VALUES (2,?,?,?,1,45,8,8,1,?)',
      [blockId, exId, 'left', todayStr()]);
    startOver(db, 4);
    eq('starting over abandons the old session',
      scalar(db, 'SELECT status FROM session WHERE id = 2'), 'abandoned');
    eq('a fresh empty session is open', currentSession(db, 4).status, 'in_progress');
    const fresh = currentSession(db, 4);
    finishSession(db, fresh.id);
    computeFlags(db, fresh.id);
    eq('abandoned work earns no suggestion', pendingFlags(db).length, 0);
    db.close();
  }

  // 19. next day up cycles 1 -> 2 -> 3 -> 4 -> 1 and ignores nightly
  {
    const db = freshDb();
    eq('with no history, Day 1 is up first', nextDayUp(db).day_no, 1);
    db.run("INSERT INTO session (date, day_no, status) VALUES ('2026-08-01', 1, 'complete')");
    eq('after Day 1 -> Day 2', nextDayUp(db).day_no, 2);
    db.run("INSERT INTO session (date, day_no, status) VALUES ('2026-08-04', 4, 'complete')");
    eq('after Day 4 -> wraps to Day 1', nextDayUp(db).day_no, 1);
    db.run("INSERT INTO session (date, day_no, status) VALUES ('2026-08-05', 0, 'complete')");
    eq('nightly does not change what is next', nextDayUp(db).day_no, 1);
    db.run("INSERT INTO session (date, day_no, status) VALUES ('2026-08-06', 2, 'abandoned')");
    eq('an abandoned day does not advance the cycle', nextDayUp(db).day_no, 1);
    db.close();
  }

  // ---------- Phase 3: runner step ordering ----------

  const blk = (o) => ({
    id: o.id, block_code: o.code, superset_group: o.group || null,
    rest_seconds_after: o.rest || 0, bias_side: o.bias || null,
    exercise_id: o.id, ex_name: o.name, is_timed: o.timed ? 1 : 0,
    load_type: 'dumbbell', instruction: 'x', feel_cue: 'y',
    targets: o.targets,
  });
  const sig = (s) => s.kind === 'set'
    ? s.label + ':' + s.side[0].toUpperCase() + s.setIndex
    : s.kind === 'rest' ? 'rest' + s.seconds : 'summary';

  // 20. biased side goes first, every round
  {
    const steps = buildSteps([blk({ id: 1, code: '1a', name: 'SL RDL', bias: 'left', rest: 90,
      targets: [{ side: 'right', sets: 2, reps: 8 }, { side: 'left', sets: 2, reps: 8 }] })]);
    eq('bias side is presented first in every round',
      steps.map(sig), ['SL RDL:L1', 'SL RDL:R1', 'rest90', 'SL RDL:L2', 'SL RDL:R2', 'summary']);
  }

  // 21. asymmetric set counts: no 4th right set (spec "What done looks like")
  {
    const steps = buildSteps([blk({ id: 1, code: '2a', name: 'Step-up', bias: 'left', rest: 60,
      targets: [{ side: 'left', sets: 3, reps: 8 }, { side: 'right', sets: 2, reps: 8 }] })]);
    eq('the extra biased set runs alone, no phantom right set',
      steps.map(sig),
      ['Step-up:L1', 'Step-up:R1', 'rest60', 'Step-up:L2', 'Step-up:R2', 'rest60', 'Step-up:L3', 'summary']);
  }

  // 22. supersets alternate a -> b -> rest, for the larger set count
  {
    const steps = buildSteps([
      blk({ id: 1, code: '1a', group: '1', name: 'Thrust', rest: 0, targets: [{ side: 'both', sets: 3, reps: 8 }] }),
      blk({ id: 2, code: '1b', group: '1', name: 'Flexion', rest: 90, targets: [{ side: 'both', sets: 2, reps: 12 }] }),
    ]);
    eq('superset alternates and rest follows the pair',
      steps.map(sig),
      ['Thrust:B1', 'Flexion:B1', 'rest90', 'Thrust:B2', 'Flexion:B2', 'rest90', 'Thrust:B3', 'summary']);
  }

  // 23. no trailing rest at the very end of the session
  {
    const steps = buildSteps([blk({ id: 1, code: 'finisher', name: 'Wall sit', rest: 20, timed: true,
      targets: [{ side: 'both', sets: 2, hold_seconds: 90 }] })]);
    eq('session does not end on a rest step',
      steps.map(sig), ['Wall sit:B1', 'rest20', 'Wall sit:B2', 'summary']);
  }

  // 23b. one MAIN REST at each category change, not a rest after the category's
  // last round followed by another (Dom, 2026-08-23)
  {
    const steps = buildSteps([
      blk({ id: 1, code: 'knee', name: 'Nordic', rest: 60, targets: [{ side: 'both', sets: 2, reps: 5 }] }),
      blk({ id: 2, code: '1a', group: '1', name: 'Thrust', rest: 0, targets: [{ side: 'both', sets: 2, reps: 8 }] }),
      blk({ id: 3, code: '1b', group: '1', name: 'Flexion', rest: 90, targets: [{ side: 'both', sets: 2, reps: 12 }] }),
    ]);
    eq('main rest lands at the category boundary, no double rest',
      steps.map(sig),
      ['Nordic:B1', 'rest60', 'Nordic:B2', 'rest60', 'Thrust:B1', 'Flexion:B1', 'rest90', 'Thrust:B2', 'Flexion:B2', 'summary']);
    const main = steps.filter((s) => s.kind === 'rest' && s.main);
    eq('the boundary rest is flagged as the main rest and names what is next',
      [main.length, main[0].nextCategory], [1, 'Superset A']);
  }

  // 24. resume lands on the first unlogged set, and rest is not replayed
  {
    const steps = buildSteps([blk({ id: 1, code: '1a', name: 'SL RDL', bias: 'left', rest: 90,
      targets: [{ side: 'left', sets: 2, reps: 8 }, { side: 'right', sets: 2, reps: 8 }] })]);
    const done = new Set(['SL RDL:L1', 'SL RDL:R1']);
    const i = resumeIndex(steps, (s) => done.has(sig(s)));
    eq('resumes at the first unlogged set, skipping the elapsed rest', sig(steps[i]), 'SL RDL:L2');
    eq('progress counts logged sets only', progressOf(steps, i), { done: 2, total: 4 });
  }

  // 26. warm-up drills rest 5 s between each, but the break before the first
  //     working block is a real one (Dom, 2026-08-24)
  {
    const steps = buildSteps([
      blk({ id: 1, code: 'warmup', name: 'Leg swings', rest: 5,
        targets: [{ side: 'both', sets: 2, reps: 12 }] }),
      blk({ id: 2, code: 'knee', name: 'ATG split squat', rest: 45,
        targets: [{ side: 'both', sets: 2, reps: 8 }] }),
    ]);
    const rests = steps.filter((s) => s.kind === 'rest');
    // 5 s inside the warm-up, then the 45 s main rest at the boundary, then
    // the knee block's own 45 s between its rounds
    eq('a five-second gap between warm-up drills, 45 s before the work',
      rests.map((r) => [r.seconds, !!r.main]), [[5, false], [45, true], [45, false]]);
    eq('only the warm-up carries a main-rest floor', MAIN_REST_FLOOR, { warmup: 45 });
  }

  // 27. sled work: sets and weight, no counted target (Dom, 2026-08-24)
  {
    const steps = buildSteps([blk({ id: 1, code: 'power', name: 'Heavy sled push', rest: 120,
      targets: [{ side: 'both', sets: 2, reps: null, hold_seconds: null, distance_m: null }] })]);
    const t = stepTarget(steps[0]);
    eq('a sled set has no counted target', [t.kind, t.value], ['effort', null]);
    check('an effort set is never mistaken for a timed one', !isTimedStep(steps[0]));
  }

  // 28. a hold auto-times itself; a rep set does not — and the two can share a
  //     block (90/90 hip switches carry both)
  {
    const steps = buildSteps([blk({ id: 1, code: 'warmup', name: '90/90 hip switches', rest: 5,
      targets: [{ side: 'both', sets: 1, reps: 10 }, { side: 'left', sets: 1, hold_seconds: 60 }] })]);
    const reps = steps.find((s) => s.kind === 'set' && s.target.reps != null);
    const hold = steps.find((s) => s.kind === 'set' && s.target.hold_seconds != null);
    check('the rep target on a mixed block does not start a clock', !isTimedStep(reps));
    check('the hold target on the same block does', isTimedStep(hold));
    eq('an accepted rep progression moves the target, not the seed',
      stepTarget(reps, { reps: 14 }).value, 14);
  }

  // 29. cues are whole sentences, and the ones a progression can reach still
  //     resolve to something sayable
  {
    eq('a set cue is one flowing sentence',
      setText({ name: 'Copenhagen plank', side: 'left', targetKind: 'hold', targetValue: 60 }),
      'Copenhagen plank. Left side. One minute.');
    eq('reps are spoken with their unit attached, not as two clips',
      setText({ name: 'Reverse Nordic', side: 'both', targetKind: 'reps', targetValue: 15 }),
      'Reverse Nordic. 15 reps.');
    eq('a sled set announces the exercise and nothing it cannot count',
      setText({ name: 'Heavy sled push', side: 'both', targetKind: 'effort', targetValue: null }),
      'Heavy sled push.');
    check('a five-second warm-up gap is not announced at all', restText(5) === null);
    eq('the main rest names what is coming next',
      restText(90, { main: true, nextCategory: 'Superset A' }),
      'Main rest. A minute thirty. Next up, Superset A.');
    eq('long holds are spoken as minutes', [spokenSeconds(120), spokenSeconds(90), spokenSeconds(45)],
      ['two minutes', 'a minute thirty', '45 seconds']);
    check('a clip id is derived from what the clip says',
      cueId('Reverse Nordic. 15 reps.') === 'c_reverse_nordic_15_reps');
    check('an accepted hold progression (60 -> 70 s) is still speakable', hasSecondsClip(70));
    check('an off-grid value is not claimed to be speakable', !hasSecondsClip(63));
  }

  // 30. Spotify: the token arithmetic and the failure vocabulary (Phase 5).
  //     A token lasts an hour and a session runs two, so "does this need
  //     replacing yet" is the question the whole flow turns on.
  {
    const now = 1_000_000_000;
    const min = 60 * 1000;
    check('a token with 30 minutes left is left alone', !needsRefresh(now + 30 * min, now));
    check('a token with 5 minutes left is replaced before it dies', needsRefresh(now + 5 * min, now));
    check('a token already dead needs replacing', needsRefresh(now - min, now));
    check('no expiry recorded means refresh', needsRefresh(null, now));
  }

  // 31. the OAuth redirect is parsed without touching the network
  {
    eq('a successful callback yields code and state',
      callbackParams('?code=abc123&state=xyz'), { code: 'abc123', error: null, state: 'xyz' });
    eq('a refused callback yields the error',
      callbackParams('?error=access_denied&state=xyz'),
      { code: null, error: 'access_denied', state: 'xyz' });
    check('an ordinary launch is not mistaken for a callback', callbackParams('') === null);
    check('a cache-buster query is not mistaken for a callback', callbackParams('?cb=12345') === null);
  }

  // 32. every failure the spec names gets a readable line, not a hang
  {
    eq('401 reads as an expired login', describeError(401)[0], 'expired');
    eq('403 PREMIUM_REQUIRED says so plainly', describeError(403, 'PREMIUM_REQUIRED')[0], 'premium');
    eq('404 / NO_ACTIVE_DEVICE tells him to start Spotify first',
      describeError(404, 'NO_ACTIVE_DEVICE')[0], 'no_device');
    eq('429 is named as rate limiting', describeError(429)[0], 'rate_limited');
    check('the no-device message says what to do',
      /start something playing in spotify/i.test(describeError(404, 'NO_ACTIVE_DEVICE')[1]),
      describeError(404, 'NO_ACTIVE_DEVICE')[1]);
    const headers = { get: (k) => (k === 'Retry-After' ? '3' : null) };
    eq('Retry-After is respected, in seconds', retryAfterMs(headers), 3000);
    eq('a missing Retry-After still backs off', retryAfterMs({ get: () => null }), 1000);
  }

  // 33. now-playing text
  {
    eq('track and artists read as one line',
      nowPlayingText({ item: { name: 'Sabotage', artists: [{ name: 'Beastie Boys' }] } }),
      'Sabotage — Beastie Boys');
    check('nothing playing is null, not a crash', nowPlayingText(null) === null);
    check('a state with no item is null', nowPlayingText({ is_playing: false }) === null);
  }

  // 34. ducking: the probe picks a strategy from what the device refused
  //     (spec Phase 6 step 1). The whole phase turns on telling
  //     VOLUME_CONTROL_DISALLOW apart from every other 403.
  {
    eq('a device that accepts a volume write gets strategy A (duck)',
      pickStrategy({ ok: true }), 'duck');
    eq('VOLUME_CONTROL_DISALLOW gets strategy B (pause), not silence',
      pickStrategy({ ok: false, kind: 'volume_disallowed', reason: 'VOLUME_CONTROL_DISALLOW' }), 'pause');
    eq('the reason string alone is enough to reach strategy B',
      pickStrategy({ ok: false, kind: 'forbidden', reason: 'Player command failed: VOLUME_CONTROL_DISALLOW' }),
      'pause');
    eq('any other 403 falls to strategy C (cue over the music)',
      pickStrategy({ ok: false, kind: 'forbidden', reason: 'Restriction violated' }), 'none');
    eq('no Premium means no control at all', pickStrategy({ ok: false, kind: 'premium' }), 'none');
    eq('a missing probe result is never treated as permission', pickStrategy(null), 'none');
  }

  // 35. two cues inside one debounce window are ONE duck and ONE restore.
  //     This is the real case: CUE_GO fires off the rest ticker, then commit
  //     -> go() -> the next step's cue lands ~50 ms behind it.
  {
    const t = 1_000_000;
    const first = planCycle({ ducked: false }, t, 800);
    const second = planCycle(first, t + 50, 600);
    eq('the first cue ducks', first.action, 'duck');
    eq('the second extends the duck instead of cycling the music',
      second.action, 'extend');
    eq('one duck, so one restore', [first.duckedAt, second.duckedAt], [t, t]);
    check('the music does not come back mid-cue', !canRelease(second, t + 1000));
    check('it does come back once the window is served', canRelease(second, t + 1600));
    eq('a short cue still holds the floor for the full debounce',
      planCycle({ ducked: false }, t, 100).releaseAt, t + MIN_CYCLE_MS);
  }

  // 36. a longer cue than the debounce keeps the music down until it ends
  {
    const t = 2_000_000;
    const long = planCycle({ ducked: false }, t, 4000);
    check('a four-second cue is not cut off at 1.5 s', long.releaseAt >= t + 4000);
    check('nothing releases a cycle that was never ducked', !canRelease({ ducked: false }, t + 99999));
  }

  // 25. rest countdown is wall-clock, so a throttled/backgrounded app catches up
  {
    const started = 1000000;
    eq('timer reads from Date.now() deltas, not tick counts',
      [remainingSeconds(started, 90, started + 10000),
       remainingSeconds(started, 90, started + 89999),
       remainingSeconds(started, 90, started + 300000)],
      [80, 1, 0]);
  }
}

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
