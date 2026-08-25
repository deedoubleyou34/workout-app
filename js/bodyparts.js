// Which part of the body an exercise belongs to.
//
// Dom, 2026-08-25: "categorize each measured excercise by body category
// (legs, arms, chest, shoulder). The categories should be readable portrait
// from a drop down menu if clicked otherwise show only 1 body category and
// make it scroll sideways."
//
// This is presentational only, so it is a constant map keyed by exercise name
// rather than a column and a migration — nothing here decides what gets
// trained, progressed or logged, and a mis-filed exercise is a card in the
// wrong drawer, not bad data.
//
// The seed already has a `category` column, but it says what an exercise is
// FOR (corrective, tendon, power) rather than what it moves. Copenhagen plank
// and Pallof press are both 'corrective' and belong in different drawers.

export const BODY_PARTS = [
  { key: 'legs', label: 'Legs' },
  { key: 'hips', label: 'Hips & glutes' },
  { key: 'ankles', label: 'Ankles & calves' },
  { key: 'core', label: 'Core' },
  { key: 'shoulders', label: 'Shoulders' },
  { key: 'back', label: 'Back & arms' },
  { key: 'chest', label: 'Chest' },
  { key: 'other', label: 'Everything else' },
];

export const BODY_PART_LABELS = Object.fromEntries(BODY_PARTS.map((p) => [p.key, p.label]));

// Exercise name -> body part. Every seeded exercise is here; anything that is
// not falls through to 'other', which is a visible drawer rather than a silent
// disappearance.
const MAP = {
  // ---- legs: knee, quad, hamstring, and the jumping and dragging ----
  'ATG split squat (front foot on low board)': 'legs',
  'Reverse Nordic': 'legs',
  'Nordic hamstring curl': 'legs',
  'Single-leg box step-up': 'legs',
  'Single-leg RDL (KB)': 'legs',
  'Single-leg RDL (DB)': 'legs',
  'Banded leg curl (ankle wrap)': 'legs',
  'Wall sit iso hold': 'legs',
  'Leg swings (front/back + lateral)': 'legs',
  'Couch stretch': 'legs',
  'Depth drop into stick landing': 'legs',
  'Depth march (low board)': 'legs',
  'Broad jump hold-and-stick': 'legs',
  'Band-resisted lateral bounds': 'legs',
  'Trap bar deadlift jump-shrug': 'legs',
  'KB swings': 'legs',
  'Heavy sled push': 'legs',
  'Heavy sled march': 'legs',
  'Backward sled drag': 'legs',

  // ---- hips and glutes: the bulk of the asymmetry work ----
  'Banded hip flexor march': 'hips',
  'Weighted hip flexor march': 'hips',
  'Standing banded hip flexion': 'hips',
  'Lateral band walks': 'hips',
  'Band-resisted monster walks': 'hips',
  'Banded clamshells': 'hips',
  'Side-lying hip abduction (band)': 'hips',
  'Fire hydrant': 'hips',
  'Standing banded hip abduction hold': 'hips',
  'Single-leg glute bridge': 'hips',
  'Glute bridge iso hold': 'hips',
  'Barbell hip thrust': 'hips',
  '90/90 hip switches': 'hips',
  // adductor work, and the reason half this program exists
  'Copenhagen plank': 'hips',

  // ---- ankles and calves ----
  'Banded ankle dorsiflexion rocks': 'ankles',
  'Tibialis raise (back to wall)': 'ankles',
  'Tibialis raise, loaded': 'ankles',
  'Standing calf stretch (knee straight)': 'ankles',
  'Standing calf stretch (knee bent, soleus)': 'ankles',
  'Standing calf raise iso hold (top)': 'ankles',
  'Slow calf raises off low board': 'ankles',
  'Single-leg ankle pogo hops': 'ankles',
  'Ankle pogo hops': 'ankles',

  // ---- core, including the anti-rotation and anti-lateral-flexion work ----
  'Side plank hip dips (QL)': 'core',
  'Side plank with abduction': 'core',
  'Side plank hold': 'core',
  'Pallof press': 'core',
  'Pallof press iso hold': 'core',
  'Dead bug': 'core',
  'Ab roller (from knees)': 'core',
  'Weighted hanging knee raise': 'core',
  'Suitcase carry': 'core',

  // ---- shoulders ----
  'Band pull-aparts': 'shoulders',
  'Band external rotation at 90° abduction': 'shoulders',
  'Wall slides with scapular protraction': 'shoulders',
  'Prone Y-T-W': 'shoulders',
  'Face pulls (external rotation emphasis)': 'shoulders',
  'DB scaption raise': 'shoulders',
  'Prone trap raise': 'shoulders',
  'Serratus punch (banded)': 'shoulders',
  'Arm circles + cross-body swings': 'shoulders',
  'Landmine press (single arm)': 'shoulders',

  // ---- back and arms ----
  'Half-kneeling single-arm band row': 'back',

  // ---- chest ----
  'Doorway pec stretch': 'chest',
};

export function bodyPartFor(name) {
  return MAP[name] || 'other';
}

// items: anything with a `name`. Returns only the parts that HAVE something,
// in BODY_PARTS order, so the drop-down never offers an empty drawer.
export function groupByBodyPart(items) {
  const buckets = new Map();
  for (const item of items || []) {
    const key = bodyPartFor(item.name);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(item);
  }
  return BODY_PARTS
    .filter((p) => buckets.has(p.key))
    .map((p) => ({ key: p.key, label: p.label, items: buckets.get(p.key) }));
}

// Which drawer to open on arrival: the one holding the loudest verdict.
// unilateralTrends() already sorts widening and stuck gaps to the front, so
// the first group in that order is the one worth reading first.
export function defaultBodyPart(groups, ordered) {
  if (!groups || !groups.length) return null;
  const first = (ordered || [])[0];
  if (first) {
    const key = bodyPartFor(first.name);
    if (groups.some((g) => g.key === key)) return key;
  }
  return groups[0].key;
}
