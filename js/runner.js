// Session state machine — spec Phase 3.
//
// buildSteps() is pure: blocks + targets in, an ordered step list out. That
// makes the ordering rules (bias side first, supersets alternating, asymmetric
// set counts, where rest falls) testable without a DOM or a clock.
//
// Timers live in the UI and are always computed from Date.now() deltas —
// never by counting setInterval ticks, which iOS throttles and which drift
// silently over a two-hour session.

// Sides for one round of a block, biased side first, skipping any side whose
// set count is already exhausted (4 left / 3 right means no 4th right set).
function sidesForRound(block, targets, round) {
  const live = targets.filter((t) => round <= t.sets);
  if (!block.bias_side) return live;
  return [...live].sort((a, b) =>
    (a.side === block.bias_side ? -1 : 0) - (b.side === block.bias_side ? -1 : 0));
}

// blocks: [{ id, block_code, superset_group, rest_seconds_after, bias_side,
//            exercise_id, ex_name, is_timed, load_type, instruction, feel_cue,
//            targets: [{ side, sets, reps, hold_seconds, distance_m }] }]
// in order_index order.
// A category is a run of consecutive blocks sharing a section: a superset
// group, or a block_code like 'warmup' / 'knee' / 'power' / 'finisher'.
export function categoryKey(b) {
  return b.superset_group ? 'superset ' + b.superset_group : b.block_code;
}

export const CATEGORY_LABELS = {
  warmup: 'Warm-up',
  'superset 1': 'Superset A',
  'superset 2': 'Superset B',
  'superset 3': 'Superset C',
  knee: 'Knee / tendon',
  power: 'Power',
  finisher: 'Finisher',
  core: 'Core / pelvis',
  calves: 'Calves / ankle',
  glutes: 'Glutes',
  close: 'Close',
};

export function categoryLabel(key) {
  return CATEGORY_LABELS[key] || key;
}

// Warm-up drills rest 15 s between each (Dom, 2026-08-25 — 5 s was too tight to
// get set up), and those gaps are SILENT: see restIsSilent() in js/cues.js. The
// break before the first working block is a real one — otherwise the warm-up
// runs straight into the knee work. Only the warm-up gets a floor; every other
// category's main rest is exactly what its blocks prescribe.
export const MAIN_REST_FLOOR = { warmup: 45 };

// Rounds for one superset group / solo block: sets alternate a -> b -> rest.
function roundsOf(groupBlocks) {
  return Math.max(...groupBlocks.map((b) => Math.max(...b.targets.map((t) => t.sets))));
}

export function buildSteps(blocks) {
  // 1. split into categories
  const categories = [];
  for (const b of blocks) {
    const key = categoryKey(b);
    const last = categories[categories.length - 1];
    if (last && last.key === key) last.blocks.push(b);
    else categories.push({ key, blocks: [b] });
  }

  const steps = [];

  categories.forEach((cat, ci) => {
    const isLastCategory = ci === categories.length - 1;
    const inner = [];

    // within a category: a superset alternates its blocks each round; anything
    // else runs one block at a time, all of its rounds, then the next block.
    const groups = cat.blocks[0].superset_group
      ? [cat.blocks]
      : cat.blocks.map((b) => [b]);

    for (const g of groups) {
      const rounds = roundsOf(g);
      for (let round = 1; round <= rounds; round++) {
        let any = false;
        for (const b of g) {
          for (const t of sidesForRound(b, b.targets, round)) {
            any = true;
            inner.push({
              kind: 'set',
              block: b,
              target: t,
              side: t.side,
              setIndex: round,
              totalSets: t.sets,
              label: b.ex_name,
              category: cat.key,
            });
          }
        }
        if (!any) continue;
        // Rest belongs to the block that carries it — in a superset that is the
        // trailing block, so the pair runs back to back and rest follows the round.
        const rest = Math.max(...g.map((b) => b.rest_seconds_after || 0));
        if (rest > 0) {
          inner.push({ kind: 'rest', seconds: rest, after: g[g.length - 1].ex_name, category: cat.key });
        }
      }
    }

    // The category's own trailing rest becomes the MAIN REST between categories
    // (Dom, 2026-08-23) — one longer break at each category change instead of a
    // short one after the category's final round.
    while (inner.length && inner[inner.length - 1].kind === 'rest') inner.pop();
    steps.push(...inner);

    if (!isLastCategory && inner.length) {
      const mainRest = Math.max(
        ...cat.blocks.map((b) => b.rest_seconds_after || 0), MAIN_REST_FLOOR[cat.key] || 0);
      if (mainRest > 0) {
        steps.push({
          kind: 'rest',
          main: true,
          seconds: mainRest,
          category: cat.key,
          after: categoryLabel(cat.key),
          nextCategory: categoryLabel(categories[ci + 1].key),
        });
      }
    }
  });

  steps.push({ kind: 'summary' });
  return steps;
}

// A step's prescribed work, after any accepted progression (current_load).
// 'effort' = a set with no countable target: sled pushes and drags, where the
// prescription is sets + weight and the distance depends on where you are
// (Dom, 2026-08-24). It is logged as done, never as a rep count of zero.
export function stepTarget(step, load = {}) {
  const t = step.target;
  if (t.distance_m) return { kind: 'distance', value: t.distance_m, unit: 'm' };
  const timed = step.block.is_timed || t.hold_seconds != null;
  if (timed) return { kind: 'hold', value: load.hold_seconds ?? t.hold_seconds, unit: 's' };
  const reps = load.reps ?? t.reps;
  if (reps == null) return { kind: 'effort', value: null, unit: '' };
  return { kind: 'reps', value: reps, unit: 'reps' };
}

// Timed work auto-starts a countdown in the runner; everything else waits for
// the Done press. Derived from stepTarget so the two can never disagree —
// 90/90 hip switches carry both a rep target and per-side holds on one block.
export function isTimedStep(step, load = {}) {
  return step.kind === 'set' && stepTarget(step, load).kind === 'hold';
}

// Elapsed/remaining from wall-clock deltas. startedAt is epoch ms.
export function remainingSeconds(startedAt, totalSeconds, now = Date.now()) {
  const elapsed = Math.floor((now - startedAt) / 1000);
  return Math.max(totalSeconds - elapsed, 0);
}

// Where to resume: the first step whose set is not already logged. Rest steps
// are skipped on resume — a rest that elapsed while the app was dead is over.
export function resumeIndex(steps, isLogged) {
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s.kind !== 'set') continue;
    if (!isLogged(s)) return i;
  }
  return steps.length - 1;   // everything logged -> summary
}

export function progressOf(steps, index) {
  const sets = steps.filter((s) => s.kind === 'set');
  const done = steps.slice(0, index).filter((s) => s.kind === 'set').length;
  return { done, total: sets.length };
}
