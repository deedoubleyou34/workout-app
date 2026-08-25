// Power level — the weekly goal tracker (Dom, 2026-08-25).
//
// It was already a number on the home screen. Two things were missing: no way
// to see what the number was made of, and nothing to aim at. So:
//
//   - powerParts() shows the arithmetic, line by line. The weights are not
//     changed here — the score Dom has been watching all week still reads the
//     same. This module only explains it and puts a target above it.
//   - TIERS turns it into DBZ transformations.
//
// A word about the thresholds, because they are a judgement call and Dom
// should be able to argue with them.
//
// The real spacing does not work. Canonically Super Saiyan is base x50 and
// Super Saiyan God is somewhere past x5000; scaled off a week of this program
// that puts SSJ out of reach of a perfect week and God out of reach of a
// perfect year. Dom asked for the gaps "scaled down to make goals attainable
// and reachable", so the numbers below are set against what his program
// actually scores, and it is the SHAPE that is kept from the source: every
// form costs more work than the one before it, and the jump to God is the
// biggest single step on the ladder.
//
// The measuring stick, straight out of the seed (js/seed.js, 2026-08-25):
//   one training day  ~ 19,000     (79 sets, 689 reps, 825 s of holds)
//   all four days     ~ 74,000     before any weight is entered
//   a night           ~ 50         (nights are a streak, not a score — see below)
// So: Super Saiyan is about one full training day. God is the whole program,
// four days, done. Blue and Ultra Instinct are above the program — they need
// the tonnage and the nights as well, which is the point of putting them there.

// The weights the score has always used. Kept here so the legend and the
// number can never disagree about them.
export const WEIGHTS = {
  sets: 100,
  reps: 10,
  holdSeconds: 5,
  tonnage: 0.1,      // weight x reps, /10
  nights: 50,
};

// counts: { sets, reps, holds, tonnage, nights } -> the legend, in the order
// it reads best: biggest contributor first is tempting but the order has to be
// stable, or the legend reshuffles itself every time a set is logged.
export function powerParts(counts = {}) {
  const c = {
    sets: counts.sets || 0,
    reps: counts.reps || 0,
    holds: counts.holds || 0,
    tonnage: counts.tonnage || 0,
    nights: counts.nights || 0,
  };
  return [
    { key: 'sets', label: 'sets logged', count: c.sets, each: WEIGHTS.sets, points: c.sets * WEIGHTS.sets },
    { key: 'reps', label: 'reps', count: c.reps, each: WEIGHTS.reps, points: c.reps * WEIGHTS.reps },
    { key: 'holds', label: 'seconds held', count: c.holds, each: WEIGHTS.holdSeconds, points: c.holds * WEIGHTS.holdSeconds },
    { key: 'tonnage', label: 'lb moved (weight × reps)', count: c.tonnage, each: WEIGHTS.tonnage, points: c.tonnage * WEIGHTS.tonnage },
    { key: 'nights', label: 'nights logged', count: c.nights, each: WEIGHTS.nights, points: c.nights * WEIGHTS.nights },
  ];
}

export function powerFrom(counts) {
  return Math.round(powerParts(counts).reduce((sum, p) => sum + p.points, 0));
}

// Every tier carries its own palette, because Dom asked for the screen to
// change with the form. `accent` drives buttons and links, `glow` the header's
// halo. They are applied as CSS custom properties — see applyTierTheme().
export const TIERS = [
  {
    key: 'base', name: 'Base', at: 0,
    accent: '#ff8c2e', glow: 'rgba(255, 140, 46, 0.42)',
    blurb: 'Orange gi, no aura. Everyone starts the week here.',
  },
  {
    key: 'kaioken', name: 'Kaio-ken', at: 5000,
    accent: '#ff4d3d', glow: 'rgba(255, 77, 61, 0.45)',
    blurb: 'A technique, not a transformation — one honest session lights it.',
  },
  {
    key: 'ssj', name: 'Super Saiyan', at: 18000,
    accent: '#ffd75e', glow: 'rgba(255, 215, 94, 0.45)',
    blurb: 'About one complete training day. The first form that costs something.',
  },
  {
    key: 'ssj2', name: 'Super Saiyan 2', at: 32000,
    accent: '#ffe14d', glow: 'rgba(120, 200, 255, 0.5)',
    blurb: 'Getting on for two days. Gold, with the blue arcs.',
  },
  {
    key: 'ssj3', name: 'Super Saiyan 3', at: 48000,
    accent: '#ffb703', glow: 'rgba(255, 183, 3, 0.5)',
    blurb: 'Three days. Enormous output, and it is meant to feel expensive.',
  },
  {
    key: 'ssg', name: 'Super Saiyan God', at: 68000,
    accent: '#ff5f8a', glow: 'rgba(255, 95, 138, 0.5)',
    blurb: 'The whole program: four training days, finished. This is the week the plan asks for.',
  },
  {
    key: 'ssb', name: 'Super Saiyan Blue', at: 88000,
    accent: '#3fd8ff', glow: 'rgba(63, 216, 255, 0.5)',
    blurb: 'Four days plus the weight on the bar and the nights in the book.',
  },
  {
    key: 'ui', name: 'Ultra Instinct', at: 115000,
    accent: '#e6ecff', glow: 'rgba(230, 236, 255, 0.55)',
    blurb: 'Above the program. Silver hair, and no week has to reach it.',
  },
];

// Which form this number is, what is next, and how far through the gap it is.
// Pure: the whole ladder is decided here and drawn somewhere else.
export function tierFor(power) {
  const p = Number.isFinite(power) ? Math.max(power, 0) : 0;
  let index = 0;
  for (let i = 0; i < TIERS.length; i++) if (p >= TIERS[i].at) index = i;
  const tier = TIERS[index];
  const next = TIERS[index + 1] || null;
  if (!next) {
    return { tier, next: null, index, toNext: 0, progressPct: 100 };
  }
  const span = next.at - tier.at;
  const into = p - tier.at;
  return {
    tier,
    next,
    index,
    toNext: Math.max(next.at - p, 0),
    progressPct: span > 0 ? Math.min(Math.max((into / span) * 100, 0), 100) : 100,
  };
}

// The one sentence under the bar. Written here rather than in the view so it
// can be asserted in a test, like the asymmetry verdicts.
export function tierGoalText(power) {
  const { tier, next, toNext } = tierFor(power);
  if (!next) return tier.name + ' — nothing above this. Take the week off, or do not.';
  return toNext.toLocaleString() + ' more to ' + next.name + '.';
}

// Paint the app in the current form's colours. Set on the document element so
// the runner and the dashboard match the home screen rather than snapping back
// to gold the moment he starts a session.
export function applyTierTheme(tier, root) {
  const node = root || (typeof document !== 'undefined' ? document.documentElement : null);
  if (!node || !node.style || !tier) return;
  node.style.setProperty('--accent', tier.accent);
  node.style.setProperty('--tier', tier.accent);
  node.style.setProperty('--tier-glow', tier.glow);
  node.dataset.tier = tier.key;
}
