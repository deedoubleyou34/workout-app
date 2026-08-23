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
export function buildSteps(blocks) {
  const steps = [];

  // consecutive blocks sharing a superset_group run as one alternating group
  const groups = [];
  for (const b of blocks) {
    const last = groups[groups.length - 1];
    if (last && b.superset_group && last.key === b.superset_group) last.blocks.push(b);
    else groups.push({ key: b.superset_group || Symbol('solo'), blocks: [b] });
  }

  groups.forEach((g, gi) => {
    const rounds = Math.max(...g.blocks.map((b) => Math.max(...b.targets.map((t) => t.sets))));
    const isLastGroup = gi === groups.length - 1;

    for (let round = 1; round <= rounds; round++) {
      let anyThisRound = false;
      for (const b of g.blocks) {
        for (const t of sidesForRound(b, b.targets, round)) {
          anyThisRound = true;
          steps.push({
            kind: 'set',
            block: b,
            target: t,
            side: t.side,
            setIndex: round,
            totalSets: t.sets,
            label: b.ex_name,
          });
        }
      }
      if (!anyThisRound) continue;

      // Rest belongs to the block that carries it — in a superset that is the
      // trailing block, so the pair runs back to back and rest follows the round.
      const rest = Math.max(...g.blocks.map((b) => b.rest_seconds_after || 0));
      const lastRound = round === rounds;
      if (rest > 0 && !(lastRound && isLastGroup)) {
        steps.push({ kind: 'rest', seconds: rest, after: g.blocks[g.blocks.length - 1].ex_name });
      }
    }
  });

  steps.push({ kind: 'summary' });
  return steps;
}

// A step's prescribed work, after any accepted progression (current_load).
export function stepTarget(step, load = {}) {
  const t = step.target;
  if (t.distance_m) return { kind: 'distance', value: t.distance_m, unit: 'm' };
  const timed = step.block.is_timed || t.hold_seconds != null;
  if (timed) return { kind: 'hold', value: load.hold_seconds ?? t.hold_seconds, unit: 's' };
  return { kind: 'reps', value: load.reps ?? t.reps, unit: 'reps' };
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
