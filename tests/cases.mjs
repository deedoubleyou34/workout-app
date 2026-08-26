// Phase 2 progression test cases (spec Phase 2 step 3).
// One source of truth, run two ways:
//   - tests/test.html   in Safari on the iPhone (this is the gate)
//   - tools/run_tests.mjs  in Node on the PC, so a broken rule never ships
//
// ctx: { check(name, ok, detail), eq(name, got, want), initSqlJs, loadSchema() }

import { ruleFor, isSessionHit, trailingStreak, evaluate,
         computeFlags, acceptFlag, acceptAll, declineFlag, snoozeFlag, pendingFlags } from '../js/progression.js';
import { seed } from '../js/seed.js';
import { nextDayUp, startOver, currentSession, finishSession, startSession, logSet,
         saveRunnerState, resumableSession, runnerSession } from '../js/sessions.js';
import { buildSteps, remainingSeconds, resumeIndex, progressOf, stepTarget, isTimedStep,
         MAIN_REST_FLOOR } from '../js/runner.js';
import { setText, restText, restIsSilent, cueId, spokenSeconds, hasSecondsClip } from '../js/cues.js';
import { needsRefresh, callbackParams, retryAfterMs, describeError,
         nowPlayingText, appLink, isFreshWake, WAKE_TTL_MS } from '../js/spotify.js';
import { pickStrategy, planCycle, canRelease, worthDucking, MIN_CYCLE_MS, MIN_CUE_MS } from '../js/ducking.js';
import { capacityOf, bestCapacity, gapPct, weeklySeries,
         verdictFor } from '../js/asymmetry.js';
import { niceBounds } from '../js/charts.js';
import { powerParts, powerFrom, tierFor, tierGoalText, applyTierTheme,
         TIERS, WEIGHTS } from '../js/power.js';
import { bodyPartFor, groupByBodyPart, defaultBodyPart, BODY_PARTS } from '../js/bodyparts.js';
import { EXERCISES } from '../js/seed.js';
import { parseContext, contextUrl, phaseForCategory, emptyConfig, loadConfig, saveConfig,
         sourceFor, isConfigured, defaultShuffle, sourceLabel, explainCategory,
         PHASES, CATEGORIES } from '../js/playlists.js';
import { parseSearchResults } from '../js/spotify.js';

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

  // 26. warm-up drills rest 15 s between each (Dom, 2026-08-25 — 5 s was too
  //     tight to get set up), but the break before the first working block is
  //     still a real one
  {
    const steps = buildSteps([
      blk({ id: 1, code: 'warmup', name: 'Leg swings', rest: 15,
        targets: [{ side: 'both', sets: 2, reps: 12 }] }),
      blk({ id: 2, code: 'knee', name: 'ATG split squat', rest: 45,
        targets: [{ side: 'both', sets: 2, reps: 8 }] }),
    ]);
    const rests = steps.filter((s) => s.kind === 'rest');
    // 15 s inside the warm-up, then the 45 s main rest at the boundary, then
    // the knee block's own 45 s between its rounds
    eq('a fifteen-second gap between warm-up drills, 45 s before the work',
      rests.map((r) => [r.seconds, !!r.main]), [[15, false], [45, true], [45, false]]);
    eq('only the warm-up carries a main-rest floor', MAIN_REST_FLOOR, { warmup: 45 });
    eq('every warm-up rest still carries its category, which is what silences it',
      rests.filter((r) => !r.main).map((r) => r.category), ['warmup', 'knee']);
  }

  // 26b. the seed actually carries 15 s, not just the synthetic block above —
  //      this is the value a migration has to reach on Dom's phone
  {
    const SQL = await ctx.initSqlJs();
    const db = new SQL.Database();
    db.run(await ctx.loadSchema());
    seed(db);
    const warmupRests = db.exec(
      "SELECT DISTINCT rest_seconds_after FROM block WHERE block_code = 'warmup' ORDER BY 1");
    eq('every seeded warm-up block rests 15 s', warmupRests[0].values.map((v) => v[0]), [15]);
    db.close();
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
    check('a five-second gap is not announced at all', restText(5) === null);
    // Dom, 2026-08-25: 15 s warm-up gaps, silent, with only "go" at the end.
    // The old rule was `seconds < 10`, so at 15 s these would have STARTED
    // talking — the category is what keeps them quiet.
    check('a fifteen-second warm-up gap says nothing',
      restText(15, { category: 'warmup' }) === null);
    eq('the same fifteen seconds anywhere else is still announced',
      restText(15, { category: 'knee' }), '15 seconds rest.');
    check('the main rest at the end of the warm-up still speaks',
      restIsSilent(45, { main: true, category: 'warmup' }) === false);
    check('and a warm-up gap of any length is silent',
      restIsSilent(30, { category: 'warmup' }) && restIsSilent(15, { category: 'warmup' }));
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

  // 36b. a cue too short to be worth stopping the music for (Dom, 2026-08-25:
  //      "the music pauses a bit longer before saying go ... which is a bit
  //      choppy"). "go" renders at ~580 ms; a real announcement is 1.8 s+.
  {
    check('"go" alone never touches the music', !worthDucking(580));
    check('a whole-sentence set cue still does', worthDucking(2736));
    check('the boundary is inclusive', worthDucking(MIN_CUE_MS));
    check('a silent session does not duck either', !worthDucking(0));
    check('a cue length that is not a number is never ducked for',
      !worthDucking(undefined) && !worthDucking(NaN));
  }

  // 37. capacity: §4.4 says MAX(weight_lb * reps_done), which is NULL for the
  //     bodyweight unilateral work — Copenhagen planks, glute bridges,
  //     clamshells — i.e. most of the asymmetry work in the program.
  {
    eq('a loaded set is weight times reps',
      capacityOf({ weight_lb: 40, reps_done: 8 }), { value: 320, kind: 'load' });
    eq('a timed set is the seconds held',
      capacityOf({ hold_seconds_done: 45 }), { value: 45, kind: 'hold' });
    eq('a bodyweight set counts its reps rather than counting nothing',
      capacityOf({ weight_lb: null, reps_done: 12 }), { value: 12, kind: 'reps' });
    check('a sled effort set has no capacity to compare',
      capacityOf({ weight_lb: 180, reps_done: null }) === null);
    eq('the best set of the week wins',
      bestCapacity([{ reps_done: 10 }, { reps_done: 14 }, { reps_done: 12 }]),
      { value: 14, kind: 'reps' });
    eq('a stray set of another kind does not contaminate the number',
      bestCapacity([{ reps_done: 10 }, { reps_done: 14 }, { hold_seconds_done: 900 }]),
      { value: 14, kind: 'reps' });
    // 90/90 hip switches carry a rep target AND per-side holds on one block:
    // an even split must resolve the same way every week, not by row order
    eq('an even split of kinds resolves the same way every time',
      bestCapacity([{ reps_done: 10 }, { hold_seconds_done: 60 }]), { value: 60, kind: 'hold' });
    eq('and the same regardless of which arrived first',
      bestCapacity([{ hold_seconds_done: 60 }, { reps_done: 10 }]), { value: 60, kind: 'hold' });
  }

  // 38. gap_pct per §4.4, including the case worth having: the biased side
  //     overtaking, which must read as words and not as a minus sign
  {
    eq('gap is measured against the strong side', Math.round(gapPct(400, 320)), 20);
    check('a stronger biased side gives a negative gap', gapPct(400, 440) < 0);
    check('no capacity on one side is not a zero gap', gapPct(400, null) === null);
    check('a zero strong side does not divide by zero', gapPct(0, 0) === null);
  }

  // 39. HAND-COMPUTED, exercise one — Single-leg RDL (DB), loaded, bias LEFT.
  //     Week of 2026-06-01: left 40x8 = 320, right 50x8 = 400 -> (400-320)/400 = 20%
  //     Week of 2026-06-29: left 50x8 = 400, right 55x8 = 440 -> (440-400)/440 = 9.09% -> 9%
  //     Four weeks apart, moved 11 points toward zero -> Closing.
  {
    const rows = [
      // explicit nulls: this is the row shape sql.js getAsObject() produces
      { date: '2026-06-01', side: 'left', weight_lb: 40, reps_done: 8, hold_seconds_done: null },
      { date: '2026-06-01', side: 'right', weight_lb: 50, reps_done: 8, hold_seconds_done: null },
      { date: '2026-06-04', side: 'left', weight_lb: 40, reps_done: 7 },
      { date: '2026-06-04', side: 'right', weight_lb: 50, reps_done: 7 },
      { date: '2026-06-29', side: 'left', weight_lb: 50, reps_done: 8 },
      { date: '2026-06-29', side: 'right', weight_lb: 55, reps_done: 8 },
      { date: '2026-07-02', side: 'both', weight_lb: 90, reps_done: 8 },   // must be ignored
    ];
    const series = weeklySeries(rows, 'left');
    eq('two weeks of data, both sides present', series.length, 2);
    eq('week one capacities match the hand computation',
      [series[0].left, series[0].right, Math.round(series[0].gapPct)], [320, 400, 20]);
    eq('week two capacities match the hand computation',
      [series[1].left, series[1].right, Math.round(series[1].gapPct)], [400, 440, 9]);
    eq('the verdict reads the way a coach would say it',
      verdictFor({ series, biasSide: 'left', sessions: 4 }).text,
      'Left was 20% behind 4 weeks ago. Now 9% behind. Closing.');
  }

  // 40. HAND-COMPUTED, exercise two — Copenhagen plank, TIMED and bodyweight,
  //     bias LEFT. This is the path §4.4's formula would have returned NULL for.
  //     Week of 2026-06-01: left 30 s, right 45 s -> (45-30)/45 = 33.3% -> 33%
  //     Week of 2026-06-22: left 40 s, right 45 s -> (45-40)/45 = 11.1% -> 11%
  {
    const rows = [
      // explicit nulls: this is the row shape sql.js getAsObject() produces
      { date: '2026-06-01', side: 'left', weight_lb: null, reps_done: null, hold_seconds_done: 30 },
      { date: '2026-06-01', side: 'right', weight_lb: null, reps_done: null, hold_seconds_done: 45 },
      { date: '2026-06-03', side: 'left', hold_seconds_done: 28 },
      { date: '2026-06-03', side: 'right', hold_seconds_done: 45 },
      { date: '2026-06-22', side: 'left', hold_seconds_done: 40 },
      { date: '2026-06-22', side: 'right', hold_seconds_done: 45 },
      { date: '2026-06-24', side: 'left', hold_seconds_done: 38 },
    ];
    const series = weeklySeries(rows, 'left');
    eq('holds are compared as seconds, not silently dropped',
      [series[0].kind, series[0].left, series[0].right], ['hold', 30, 45]);
    eq('both weeks compute to the hand-checked gap',
      [Math.round(series[0].gapPct), Math.round(series[1].gapPct)], [33, 11]);
    eq('the timed verdict is the same shape as the loaded one',
      verdictFor({ series, biasSide: 'left', sessions: 4 }).text,
      'Left was 33% behind 3 weeks ago. Now 11% behind. Closing.');
  }

  // 41. the verdict the app exists to produce: six weeks of bias that did
  //     nothing. §4.4 says say so in plain words rather than drawing a line.
  {
    const series = [
      { week: '2026-06-01', gapPct: 20, left: 10, right: 12.5 },
      { week: '2026-07-13', gapPct: 19, left: 10.5, right: 13 },
    ];
    const v = verdictFor({ series, biasSide: 'right', sessions: 8 });
    eq('a flat gap after six weeks is called out, not charted quietly', v.state, 'stuck');
    check('and it says what to do about it', /change it/.test(v.text), v.text);

    const widening = verdictFor({
      series: [{ week: '2026-06-01', gapPct: 12 }, { week: '2026-06-22', gapPct: 20 }],
      biasSide: 'left', sessions: 6,
    });
    eq('a widening gap is named', widening.state, 'widening');

    const flipped = verdictFor({
      series: [{ week: '2026-06-01', gapPct: 12 }, { week: '2026-06-22', gapPct: -4 }],
      biasSide: 'left', sessions: 6,
    });
    eq('a biased side that overtook reads as words, not a minus sign', flipped.state, 'ahead');
    check('and says by how much', /ahead by 4%/.test(flipped.text), flipped.text);

    const thin = verdictFor({ series: [{ week: '2026-06-01', gapPct: 20 }], biasSide: 'left', sessions: 2 });
    eq('under four sessions there is no verdict at all', thin.state, 'thin');
    check('and it says how far off it is', /2 of 4 sessions/.test(thin.text), thin.text);
  }

  // 42. chart axes round to numbers a human reads
  {
    eq('bounds cover the data', niceBounds([3, 47]).max >= 47, true);
    check('a flat series still has a drawable range', niceBounds([5, 5]).max > niceBounds([5, 5]).min);
    eq('an empty series does not produce NaN bounds', niceBounds([]), { min: 0, max: 1 });
  }

  // 43. links: whatever Spotify's share sheet produces has to work, because
  //     that is the only way Dom will ever type one. Albums included now
  //     (Dom, 2026-08-25) — the API always accepted them, our parser did not.
  {
    const pl = '37i9dQZF1DXcBWIGoYBM5M';
    const al = '1ATL5GLyefJaxhQzSPVrLX';
    eq('a playlist share link parses',
      parseContext('https://open.spotify.com/playlist/' + pl + '?si=abc123'),
      { uri: 'spotify:playlist:' + pl, type: 'playlist' });
    eq('an ALBUM share link parses, and knows it is an album',
      parseContext('https://open.spotify.com/album/' + al + '?si=abc123'),
      { uri: 'spotify:album:' + al, type: 'album' });
    eq('a localised link parses too',
      parseContext('https://open.spotify.com/intl-de/album/' + al),
      { uri: 'spotify:album:' + al, type: 'album' });
    eq('a raw URI passes through',
      parseContext('spotify:album:' + al), { uri: 'spotify:album:' + al, type: 'album' });
    eq('an artist link is accepted if pasted',
      parseContext('spotify:artist:' + al), { uri: 'spotify:artist:' + al, type: 'artist' });
    eq('a bare id is still assumed to be a playlist',
      parseContext(pl), { uri: 'spotify:playlist:' + pl, type: 'playlist' });
    eq('whitespace from a paste is ignored',
      parseContext('  spotify:playlist:' + pl + '  '), { uri: 'spotify:playlist:' + pl, type: 'playlist' });
    check('a single track is not a context you can hand to play',
      parseContext('https://open.spotify.com/track/' + al) === null);
    check('an empty field is nothing', parseContext('') === null);
    check('nonsense is nothing', parseContext('my gym mix') === null);
    eq('and a stored URI turns back into a link a human can open',
      contextUrl('spotify:album:' + al), 'https://open.spotify.com/album/' + al);
    eq('a source reads as a name and a kind',
      sourceLabel({ uri: 'spotify:album:' + al, type: 'album', name: 'Blackout' }), 'Blackout — album');
  }

  // 44. every runner category maps to one of the four musical phases —
  //     an unmapped category would mean silence where music was expected
  {
    eq('the warm-up has its own phase', phaseForCategory('warmup'), 'warmup');
    eq('knee work is main work as far as music goes', phaseForCategory('knee'), 'main');
    eq('every superset is main work', [phaseForCategory('superset 1'), phaseForCategory('superset 3')],
      ['main', 'main']);
    eq('power is its own phase', phaseForCategory('power'), 'power');
    eq('the finisher, core, calves, glutes and close all ride the finisher playlist',
      ['finisher', 'core', 'calves', 'glutes', 'close'].map(phaseForCategory),
      ['finisher', 'finisher', 'finisher', 'finisher', 'finisher']);
    check('a category with no step has no phase', phaseForCategory(null) === null);
    eq('every category the runner can produce is offered in settings',
      CATEGORIES.length, 11);
    eq('a playlist shuffles by default, an album does not — an album is ordered',
      [defaultShuffle('playlist', 'main'), defaultShuffle('album', 'main')], [true, false]);
    eq('power never shuffles, whatever it is (spec Phase 8 step 4)',
      [defaultShuffle('playlist', 'power'), defaultShuffle('album', 'power')], [false, false]);
  }

  // 45. the mapping survives a save/load round trip, and a setup made by the
  //     PREVIOUS build still loads — saveConfig writes a shape loadConfig must
  //     still be able to read from before it existed
  {
    const SQL = await ctx.initSqlJs();
    const db = new SQL.Database();
    db.run(await ctx.loadSchema());
    seed(db);
    check('nothing configured to begin with', !isConfigured(loadConfig(db)));

    const cfg = emptyConfig();
    cfg.phases.warmup = { uri: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=x', name: 'Warm' };
    cfg.phases.main = { uri: 'spotify:playlist:37i9dQZF1DX0XUsuxWHRQd', name: 'Gym Heavy' };
    cfg.phases.power = { uri: 'spotify:album:1ATL5GLyefJaxhQzSPVrLX', name: 'Blackout', type: 'album' };
    cfg.phases.finisher = { uri: 'not a link' };
    cfg.categories['superset 3'] = { uri: 'spotify:album:4LH4d3cOWNNsVw41Gqt2kv', name: 'C only' };
    saveConfig(db, cfg);

    const back = loadConfig(db);
    eq('links are stored canonicalised, not as pasted',
      back.phases.warmup.uri, 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M');
    eq('the name is stored, so settings can show it with no network',
      back.phases.main.name, 'Gym Heavy');
    eq('an album keeps its kind and defaults to unshuffled',
      [back.phases.power.type, back.phases.power.shuffle], ['album', false]);
    check('an unparseable entry is stored as nothing, not as junk', back.phases.finisher === null);
    check('and the app knows it has music to switch to', isConfigured(back));

    // resolution: an override wins, everything else inherits its phase
    eq('a category with an override plays the override',
      sourceFor('superset 3', back).uri, 'spotify:album:4LH4d3cOWNNsVw41Gqt2kv');
    eq('a category with no override follows its phase',
      sourceFor('superset 1', back).uri, 'spotify:playlist:37i9dQZF1DX0XUsuxWHRQd');
    eq('knee work is main work', sourceFor('knee', back).uri, 'spotify:playlist:37i9dQZF1DX0XUsuxWHRQd');
    eq('power has its own', sourceFor('power', back).uri, 'spotify:album:1ATL5GLyefJaxhQzSPVrLX');
    check('a phase with nothing set resolves to nothing, and the music is left alone',
      sourceFor('finisher', back) === null);
    check('and the settings screen can say why',
      /follows Main work/.test(explainCategory('superset 1', back).text),
      explainCategory('superset 1', back).text);

    // clearing an override drops it rather than storing a blank
    delete back.categories['superset 3'];
    saveConfig(db, back);
    eq('a cleared override goes back to inheriting',
      sourceFor('superset 3', loadConfig(db)).uri, 'spotify:playlist:37i9dQZF1DX0XUsuxWHRQd');
    db.close();
  }

  // 45b. a configuration written by build 020 still works after this update.
  //      Dom set his playlists up before per-category existed; nothing he did
  //      should need doing again.
  {
    const SQL = await ctx.initSqlJs();
    const db = new SQL.Database();
    db.run(await ctx.loadSchema());
    seed(db);
    // exactly the shape build 020 wrote: flat, four keys, playlists only
    db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('playlists', ?)", [JSON.stringify({
      warmup: { uri: 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M', shuffle: true },
      main: { uri: 'spotify:playlist:37i9dQZF1DX0XUsuxWHRQd', shuffle: true },
      power: { uri: null, shuffle: false },
      finisher: { uri: 'spotify:playlist:37i9dQZF1DX4eRPd9frC1m', shuffle: true },
    })]);
    const cfg = loadConfig(db);
    eq('an old flat config loads into the phases', cfg.phases.warmup.uri,
      'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M');
    eq('its shuffle settings survive', cfg.phases.main.shuffle, true);
    eq('and it starts with no category overrides', Object.keys(cfg.categories).length, 0);
    eq('so every category resolves exactly as it did before',
      sourceFor('superset 2', cfg).uri, 'spotify:playlist:37i9dQZF1DX0XUsuxWHRQd');
    // and once re-saved it comes back in the new shape, unchanged in meaning
    saveConfig(db, cfg);
    eq('re-saving does not change what plays',
      sourceFor('superset 2', loadConfig(db)).uri, 'spotify:playlist:37i9dQZF1DX0XUsuxWHRQd');
    db.close();
  }

  // 45c. Spotify puts nulls inside search results. A null reaching a render
  //      loop is a blank screen, so they are filtered before the UI sees them.
  {
    const parsed = parseSearchResults({
      playlists: { items: [null, { uri: 'spotify:playlist:a', name: 'Real', owner: { display_name: 'Dom' } }, null] },
      albums: { items: [{ uri: 'spotify:album:b', name: 'Blackout', artists: [{ name: 'Scorpions' }, null] }] },
    });
    eq('nulls are dropped from search results', parsed.playlists.length, 1);
    eq('the survivor keeps its name', parsed.playlists[0].name, 'Real');
    eq('an album shows who it is by, nulls and all', parsed.albums[0].by, 'Scorpions');
    eq('an empty response is empty, not a crash',
      parseSearchResults({}), { playlists: [], albums: [] });
  }

  // 46. starting fresh: everything logged goes, everything describing the
  //     program stays — and schema_version above all, or the next launch
  //     re-runs every migration against an already-current schema
  {
    const SQL = await ctx.initSqlJs();
    const db = new SQL.Database();
    db.run(await ctx.loadSchema());
    seed(db);
    db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '6')");
    db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('runner_state', '{\"index\":4}')");
    const musicCfg = emptyConfig();
    musicCfg.phases.main = { uri: 'spotify:playlist:37i9dQZF1DX0XUsuxWHRQd', shuffle: true };
    saveConfig(db, musicCfg);
    db.run("INSERT INTO session (date, day_no, status) VALUES ('2026-08-01', 4, 'complete')");
    const sid = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
    const blockRow = db.exec('SELECT id, exercise_id FROM block LIMIT 1')[0].values[0];
    db.run('INSERT INTO set_log (session_id, block_id, exercise_id, side, set_index, reps_done, hit_target, logged_at) '
      + "VALUES (?,?,?,'left',1,8,1,'2026-08-01T10:00:00Z')", [sid, blockRow[0], blockRow[1]]);
    db.run("INSERT INTO nightly_log (date, drill, side, value, unit) VALUES ('2026-08-01','Couch stretch','left',90,'sec')");

    // These statements MUST mirror resetTrainingData() in js/db.js. They are
    // repeated rather than called because the real function also clears
    // IndexedDB keys, which do not exist in Node — so a change there needs a
    // change here, and this comment is the only thing that says so.
    for (const t of ['set_log', 'progression_flag', 'current_load', 'nightly_log', 'session']) {
      db.run('DELETE FROM ' + t);
    }
    db.run("DELETE FROM meta WHERE key IN ('runner_state', 'sessions_at_last_export')");

    const count = (t) => db.exec('SELECT COUNT(*) FROM ' + t)[0].values[0][0];
    eq('everything logged is gone',
      [count('set_log'), count('session'), count('nightly_log')], [0, 0, 0]);
    eq('the exercise library is untouched', count('exercise') > 0, true);
    eq('so are the day templates and blocks', [count('day_template'), count('block') > 0], [5, true]);
    eq('the schema version survives — dropping it would break the next launch',
      db.exec("SELECT value FROM meta WHERE key='schema_version'")[0].values[0][0], '6');
    eq('the music mapping is configuration, not data, and survives',
      loadConfig(db).phases.main.uri, 'spotify:playlist:37i9dQZF1DX0XUsuxWHRQd');
    check('the runner position does not survive',
      db.exec("SELECT value FROM meta WHERE key='runner_state'").length === 0);
    db.close();
  }

  // 24b. the power level as a goal tracker (Dom, 2026-08-25)
  {
    // The legend has to add up to the number, or it is explaining a different
    // score from the one on screen.
    const counts = { sets: 79, reps: 689, holds: 825, tonnage: 12000, nights: 3 };
    const parts = powerParts(counts);
    eq('the legend adds up to the power level',
      Math.round(parts.reduce((n, p) => n + p.points, 0)), powerFrom(counts));
    eq('the legend has a line per contributor, in a fixed order',
      parts.map((p) => p.key), ['sets', 'reps', 'holds', 'tonnage', 'nights']);
    eq('the weights are the ones the score has always used',
      [WEIGHTS.sets, WEIGHTS.reps, WEIGHTS.holdSeconds, WEIGHTS.nights], [100, 10, 5, 50]);
    eq('an empty week is zero, not NaN', powerFrom({}), 0);
    eq('and its legend still draws every row', powerParts({}).length, 5);

    // The ladder: thresholds must climb, and every step must cost more than the
    // one before it — that is the shape kept from the source material.
    check('the forms are in ascending order',
      TIERS.every((t, i) => i === 0 || t.at > TIERS[i - 1].at),
      TIERS.map((t) => t.at).join(', '));
    const gaps = TIERS.slice(1).map((t, i) => t.at - TIERS[i].at);
    check('each form costs more work than the last',
      gaps.every((g, i) => i === 0 || g >= gaps[i - 1]), gaps.join(', '));
    check('every form carries a colour for the screen to take',
      TIERS.every((t) => /^#[0-9a-f]{6}$/i.test(t.accent)));
    // Two forms sharing a colour means reaching one of them looks like nothing
    // happened, which defeats the point of a goal tracker.
    eq('no two forms share a colour',
      new Set(TIERS.map((t) => t.accent.toLowerCase())).size, TIERS.length);
    check('every form carries its own glow to match',
      TIERS.every((t) => /^rgba\(/.test(t.glow)));
    // The premise Dom chose: gold means Super Saiyan. Base must not already
    // BE gold, or the transformation is invisible.
    check('Base is not the same colour as Super Saiyan',
      TIERS[0].accent.toLowerCase() !== TIERS.find((t) => t.key === 'ssj').accent.toLowerCase(),
      TIERS[0].accent + ' vs ' + TIERS.find((t) => t.key === 'ssj').accent);
    eq('Super Saiyan is the gold the app has always used',
      TIERS.find((t) => t.key === 'ssj').accent.toLowerCase(), '#ffd75e');

    // Anchored to what Dom's program actually scores (js/seed.js): one training
    // day is ~19,000 and all four are ~74,000. If the seed's volume ever
    // changes enough to break these, the ladder needs re-tuning with it.
    eq('a brand-new week is Base', tierFor(0).tier.key, 'base');
    eq('one complete training day is Super Saiyan', tierFor(19000).tier.key, 'ssj');
    eq('the whole four-day program is Super Saiyan God', tierFor(74000).tier.key, 'ssg');
    eq('nothing sits above Ultra Instinct', tierFor(9_000_000).next, null);
    check('and the top form does not divide by a zero span',
      tierFor(9_000_000).progressPct === 100);

    eq('the goal line says what the next form costs',
      tierGoalText(0), '5,000 more to Kaio-ken.');
    check('progress through a gap is a percentage of that gap, not of the total',
      Math.round(tierFor(11500).progressPct) === 50, String(tierFor(11500).progressPct));
    eq('a negative or missing score never falls off the bottom',
      [tierFor(-5).tier.key, tierFor(undefined).tier.key], ['base', 'base']);
  }

  // 24b2. applyTierTheme writes exactly the properties the stylesheet reads.
  //       The first version of this wrote --accent, which no rule read, so the
  //       whole-app theming shipped looking like it worked.
  {
    const written = {};
    const fake = {
      style: { setProperty(name, value) { written[name] = value; } },
      dataset: {},
    };
    applyTierTheme(TIERS.find((t) => t.key === 'ssg'), fake);
    eq('the form colour is published as --tier', written['--tier'], '#ff5f8a');
    check('and its halo as --tier-glow', !!written['--tier-glow']);
    check('nothing writes a property no rule reads', !('--accent' in written));
    eq('the form is stamped on the element for CSS to hook', fake.dataset.tier, 'ssg');
    // Must not throw on a node that cannot be styled — the boot path runs
    // before anything has rendered.
    applyTierTheme(TIERS[0], null);
    applyTierTheme(null, fake);
    check('a missing tier or node is survivable, not a crash', true);
  }

  // 24c. resume only a session with work actually in it (Dom, 2026-08-25:
  //      "not a session that was only viewed"). The runner opens a session on
  //      entry, so in_progress alone is not the test.
  {
    const SQL = await ctx.initSqlJs();
    const db = new SQL.Database();
    db.run(await ctx.loadSchema());
    seed(db);

    check('nothing to resume on a fresh database', resumableSession(db) === null);

    const viewed = startSession(db, 1);
    check('a day that was only opened is not offered as resumable',
      resumableSession(db) === null, JSON.stringify(resumableSession(db)));

    // The runner parked at step 0 is still "only opened" — that is where it
    // starts, so it says nothing about whether any work happened.
    saveRunnerState(db, { session_id: viewed.id, index: 0, restStartedAt: null, hold: null });
    check('and neither is one parked at the very first step',
      resumableSession(db) === null);

    saveRunnerState(db, { session_id: viewed.id, index: 7, restStartedAt: null, hold: null });
    const parked = resumableSession(db);
    eq('a runner parked past the first step is live work', parked && parked.day_no, 1);

    // A logged set is the other way in, and it does not need runner state.
    const block = db.exec("SELECT b.id, b.exercise_id FROM block b JOIN day_template d " +
      'ON d.id = b.day_template_id WHERE d.day_no = 2 LIMIT 1')[0].values[0];
    const worked = startSession(db, 2);
    db.run("DELETE FROM meta WHERE key = 'runner_state'");
    logSet(db, { session_id: worked.id, block_id: block[0], exercise_id: block[1],
      side: 'left', set_index: 1, reps_done: 10, target_reps: 10, hit_target: 1 });
    const live = resumableSession(db);
    eq('a session with a logged set is resumable with no runner state at all',
      [live && live.day_no, live && live.sets], [2, 1]);
    check('and it carries the day name for the card', !!(live && live.name));

    finishSession(db, worked.id);
    check('a finished session is never offered as resumable',
      (resumableSession(db) || {}).day_no !== 2);
    db.close();
  }

  // 24e. the card and the runner must agree, or Resume is a lie.
  //
  // This is the bug the card shipped with: resumableSession is deliberately
  // not scoped to today, and the runner's old currentSession() was. A session
  // started at 11pm and force-quit was offered on the home screen, and tapping
  // Resume opened a BRAND-NEW empty session for today — the night's work
  // stranded, the old session in_progress forever.
  {
    const SQL = await ctx.initSqlJs();
    const db = new SQL.Database();
    db.run(await ctx.loadSchema());
    seed(db);

    const yesterday = (() => {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
        + '-' + String(d.getDate()).padStart(2, '0');
    })();

    const block = db.exec('SELECT b.id, b.exercise_id FROM block b JOIN day_template d '
      + 'ON d.id = b.day_template_id WHERE d.day_no = 3 LIMIT 1')[0].values[0];
    db.run("INSERT INTO session (date, day_no, status, started_at) VALUES (?, 3, 'in_progress', ?)",
      [yesterday, yesterday + 'T23:10:00Z']);
    const lastNight = db.exec('SELECT id FROM session ORDER BY id DESC LIMIT 1')[0].values[0][0];
    logSet(db, { session_id: lastNight, block_id: block[0], exercise_id: block[1],
      side: 'left', set_index: 1, reps_done: 8, target_reps: 8, hit_target: 1 });

    const offered = resumableSession(db);
    eq('the card offers last night\u2019s force-quit session', offered && offered.id, lastNight);

    const opened = runnerSession(db, 3);
    eq('and the runner opens THAT session, not a new one for today',
      opened.session.id, lastNight);
    check('the runner knows it is resuming', opened.resumed === true);
    eq('nothing extra was created', db.exec('SELECT COUNT(*) FROM session')[0].values[0][0], 1);

    // Same day, opened and backed out of: still the same session, not a second.
    const fresh = runnerSession(db, 4);
    const again = runnerSession(db, 4);
    eq('re-entering a day opened a minute ago reuses its session',
      again.session.id, fresh.session.id);
    check('and an empty one is not called a resume', again.resumed === false);

    // A stale EMPTY session cannot be resumed and nothing points at it, so it
    // must be closed rather than left in_progress behind the new one.
    db.run("UPDATE session SET date = ? WHERE id = ?", [yesterday, fresh.session.id]);
    const replacement = runnerSession(db, 4);
    check('a stale empty session is not adopted', replacement.session.id !== fresh.session.id);
    eq('it is parked rather than left open forever',
      db.exec('SELECT status FROM session WHERE id = ?', [fresh.session.id])[0].values[0][0],
      'abandoned');
    check('and it stops being offered on the home screen',
      (resumableSession(db) || {}).id !== fresh.session.id);

    // Finishing through the runner closes the card down for good.
    finishSession(db, lastNight);
    check('once finished, last night is no longer offered',
      (resumableSession(db) || {}).id !== lastNight);
    db.close();
  }

  // 24d. the dashboard's body-part drawers (Dom, 2026-08-25)
  {
    // Every seeded exercise must land somewhere deliberate. 'other' is a real
    // drawer rather than a crash, but nothing in the program should need it —
    // an exercise falling through means the map was not updated with the seed.
    const homeless = EXERCISES.map(([name]) => name).filter((n) => bodyPartFor(n) === 'other');
    eq('every seeded exercise has a body part', homeless, []);

    // The seed's own `category` says what an exercise is FOR, not what it
    // moves. These two are both 'corrective' and belong in different drawers —
    // which is the whole reason this map exists rather than reusing it.
    eq('Copenhagen plank is adductor work, not core', bodyPartFor('Copenhagen plank'), 'hips');
    eq('Pallof press is core', bodyPartFor('Pallof press'), 'core');
    eq('an unknown name lands in a visible drawer, not nowhere',
      bodyPartFor('Something Dom invented'), 'other');

    // Grouping keeps BODY_PARTS order and never offers an empty drawer.
    const groups = groupByBodyPart([
      { name: 'Prone Y-T-W' },
      { name: 'Single-leg RDL (DB)' },
      { name: 'Banded clamshells' },
      { name: 'ATG split squat (front foot on low board)' },
    ]);
    eq('groups come back in body order, not in the order they arrived',
      groups.map((g) => g.key), ['legs', 'hips', 'shoulders']);
    eq('and each carries its own exercises',
      groups.map((g) => g.items.length), [2, 1, 1]);
    check('an empty body part is never offered',
      groups.every((g) => g.items.length > 0));
    eq('nothing to group is an empty list, not a crash', groupByBodyPart([]), []);
    eq('and neither is nothing at all', groupByBodyPart(null), []);

    // The drawer that opens is the one holding the loudest verdict, because
    // unilateralTrends() already sorts widening and stuck gaps to the front.
    const ordered = [{ name: 'Banded clamshells' }, { name: 'Single-leg RDL (DB)' }];
    eq('the drawer that opens is the one with the worst gap in it',
      defaultBodyPart(groups, ordered), 'hips');
    eq('with nothing to rank it opens the first drawer',
      defaultBodyPart(groups, []), 'legs');
    // A trend whose exercise is not in these groups must not open a drawer
    // that is not on screen.
    eq('an exercise outside the groups does not select a missing drawer',
      defaultBodyPart(groups, [{ name: 'Doorway pec stretch' }]), 'legs');
    check('no groups means no selection at all', defaultBodyPart([], ordered) === null);

    check('every body part has a human label',
      BODY_PARTS.every((p) => p.label && p.label !== p.key));
  }

  // 24f. opening Spotify by hand when it is not running (Dom, 2026-08-25).
  //      A force-quit Spotify is not in GET /me/player/devices at all, so no
  //      API call can reach it — the only lever is a spotify: URL from a tap.
  {
    eq('a mapped playlist sends him straight to it',
      appLink('spotify:playlist:37i9dQZF1DXcBWIGoYBM5M'), 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M');
    eq('an album works the same way',
      appLink('spotify:album:1An0Kk9bJcCLkYuG0AS9Cx'), 'spotify:album:1An0Kk9bJcCLkYuG0AS9Cx');
    eq('nothing mapped still opens the app', appLink(null), 'spotify:');
    eq('and so does something that is not a Spotify uri at all',
      [appLink('https://example.com'), appLink(''), appLink(undefined)],
      ['spotify:', 'spotify:', 'spotify:']);
    check('a url that only looks like one is not passed through',
      appLink('spotify:playlist:../../evil') === 'spotify:');

    // A stale intent must never fire — he could be mid-set tomorrow when the
    // app next comes to the front.
    const now = 1_000_000_000;
    check('an intent armed a moment ago is acted on',
      isFreshWake({ at: now - 5000 }, now));
    check('one armed longer ago than the window is not',
      !isFreshWake({ at: now - WAKE_TTL_MS - 1 }, now));
    check('the boundary itself is stale, not fresh',
      !isFreshWake({ at: now - WAKE_TTL_MS }, now));
    check('nothing armed is not an intent', !isFreshWake(null, now));
    check('and neither is a malformed one',
      !isFreshWake({}, now) && !isFreshWake({ at: 'soon' }, now) && !isFreshWake('yes', now));
    check('a clock that jumped backwards does not make one fresh forever',
      !isFreshWake({ at: now + 60_000 }, now));
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
