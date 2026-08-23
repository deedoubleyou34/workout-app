// Seed: transcribes workout_plan.txt (steady-state prescription only) and
// PROJECT_SPEC.md Appendix A into the library tables.
//
// Rules (spec §1.1, §1.3, Phase 1):
// - RAMP-IN and RE-CHECK sections are coaching notes and are NOT seeded.
// - bias_side is per BLOCK, not per exercise. NULL = bilateral / no side cue.
// - Asymmetric prescriptions are separate left/right block_target rows.
// - Superset rest goes on the 'b' block (rest after the pair); 'a' blocks flow
//   straight into 'b' with 0 rest.
// - Rest values shortened on Dom's instruction 2026-08-23: 30->20, 60->45,
//   75->60, 90->60, 120->90, 150->120. The runner also inserts a MAIN REST at
//   the end of each category (warm-up, knee, superset A, ...) instead of
//   resting after that category's final round.
// - instruction / feel_cue come verbatim from Appendix A. Displayed, never spoken.

// [name, category, load_type, is_unilateral, is_timed, increment_value, increment_unit, instruction, feel_cue]
export const EXERCISES = [
  // ---- Mobility / stretches ----
  ['Couch stretch', 'mobility', 'bodyweight', 1, 1, null, null,
    'Rear knee against the wall/couch, shin vertical up it, front foot flat. Squeeze the rear glute and tuck the pelvis before easing torso upright.',
    'Stretch down the front of the rear hip and thigh — not pinching in the low back.'],
  ['Banded ankle dorsiflexion rocks', 'mobility', 'band', 1, 0, null, null,
    'Band around the front of the ankle pulling back, knee drives forward over the toes, heel stays planted.',
    'Stretch deep in the back of the ankle; no pinch at the front crease.'],
  ['Leg swings (front/back + lateral)', 'mobility', 'bodyweight', 1, 0, null, null,
    'Tall stance, hold support, swing the leg loose and controlled through a growing range.',
    'Free movement at the hip — momentum, not muscle effort.'],
  ['90/90 hip switches', 'mobility', 'bodyweight', 0, 0, null, null,
    'Both legs at 90°, one in front, one to the side. Rotate knees to the other side without hands, chest tall, ending in the held stretch.',
    'Stretch in the outer hip of the front leg and the inner thigh/front hip of the rear leg.'],
  ['Doorway pec stretch', 'mobility', 'bodyweight', 1, 1, null, null,
    'Forearm on the frame, elbow at shoulder height, step through and turn the chest away.',
    'Stretch across the chest and front of the shoulder — not tingling down the arm (back off if so).'],
  ['Standing calf stretch (knee straight)', 'mobility', 'bodyweight', 1, 1, null, null,
    'Rear leg straight, heel driven into the floor, lean into the wall.',
    'Stretch in the upper calf belly (gastroc).'],
  ['Standing calf stretch (knee bent, soleus)', 'mobility', 'bodyweight', 1, 1, null, null,
    'Same stance but rear knee bent, heel pinned down.',
    'Stretch low and deep near the Achilles (soleus), not the upper calf.'],
  ['Arm circles + cross-body swings', 'mobility', 'bodyweight', 0, 0, null, null,
    'Big slow circles both directions, then swing arms across the chest and open.',
    'Shoulders warming and loosening — no joint clunk or pinch.'],

  // ---- Corrective / activation ----
  ['Tibialis raise (back to wall)', 'tibialis', 'bodyweight', 0, 0, 2, 'rep',
    'Heels a foot from the wall, lean back into it, lift both forefeet as high as possible, lower slow.',
    'Burn along the front of the shin, not the ankle joint.'],
  ['Banded hip flexor march', 'corrective', 'band', 1, 0, 1, 'rep',
    'Band anchored behind (posterior-lateral pull), drive one knee to hip height against it, tall posture, no lean-back.',
    'Deep front-of-hip working on the marching leg; abs bracing to keep the pelvis still.'],
  ['Standing banded hip flexion', 'corrective', 'band', 1, 0, 1, 'rep',
    'Band on the ankle from behind, drive the knee up and slightly across to hip height, slow return.',
    'Hip flexor high on the front of the thigh into the hip crease — not the low back arching.'],
  ['Lateral band walks', 'corrective', 'band', 0, 0, null, null,
    'Band at knees or ankles, quarter squat, step wide and keep tension — never let the feet click together. Monster walks add the forward diagonal.',
    'Burn in the side of the hip/upper glute on BOTH legs, not the front of the thigh.'],
  ['Band-resisted monster walks', 'corrective', 'band', 0, 0, 1, 'rep',
    'Band at knees or ankles, quarter squat, step wide and keep tension — never let the feet click together. Monster walks add the forward diagonal.',
    'Burn in the side of the hip/upper glute on BOTH legs, not the front of the thigh.'],
  ['Banded clamshells', 'corrective', 'band', 1, 0, null, null,
    'Side-lying, knees bent, heels together, band above knees. Open the top knee without rolling the pelvis back.',
    'Side/back of the top hip (glute med) — if the front of the hip cramps, reset the pelvis.'],
  ['Side-lying hip abduction (band)', 'corrective', 'band', 1, 0, null, null,
    'Side-lying, top leg straight and slightly behind the body line, toes forward, lift against the band.',
    'Side of the top hip, just below the crest — not the TFL at the front.'],
  ['Fire hydrant', 'corrective', 'bodyweight', 1, 0, null, null,
    'On all fours, lift the bent knee out to the side, spine still, no torso lean.',
    'Outer hip/glute of the moving leg; abs holding the trunk from rotating.'],
  ['Standing banded hip abduction hold', 'corrective', 'band', 1, 1, 10, 'sec',
    "Band on the ankle, standing tall, drive the leg out to the side (or hold it there); the STANCE leg's hip stays level.",
    "Both hips — the moving side's outer glute, and just as much the stance-side glute med keeping the pelvis level."],
  ['Single-leg glute bridge', 'corrective', 'bodyweight', 1, 0, null, null,
    'One foot planted, other knee to chest, drive through the heel until hip is fully open, pelvis level.',
    'The working glute doing all of it; a cramping hamstring means bring the heel closer.'],
  ['Glute bridge iso hold', 'corrective', 'bodyweight', 0, 1, 10, 'sec',
    'Both feet planted, bridge to full extension, squeeze at the top, ribs down.',
    'Both glutes maximally squeezed, hamstrings quiet, nothing in the low back.'],
  ['Band pull-aparts', 'corrective', 'band', 0, 0, null, null,
    'Arms straight at shoulder height, pull the band to the chest by driving hands apart, shoulders down.',
    'Squeeze between the shoulder blades — not the neck shrugging.'],
  ['Band external rotation at 90° abduction', 'corrective', 'band', 1, 0, null, null,
    'Elbow at shoulder height bent 90°, rotate the forearm up and back against the band.',
    'Deep in the back of the shoulder (cuff), traps quiet.'],
  ['Wall slides with scapular protraction', 'corrective', 'bodyweight', 0, 0, null, null,
    'Forearms on the wall, slide up, at the top push the wall away so the shoulder blades wrap around the ribs.',
    'The push-away in the serratus, at the side of the ribcage below the armpit.'],
  ['Prone Y-T-W', 'corrective', 'bodyweight', 0, 0, null, null,
    'Face down, thumbs up, lift the arms in each letter shape, holding a beat at the top.',
    'Lower and mid traps between/below the shoulder blades — the neck should not do the lifting.'],
  ['Face pulls (external rotation emphasis)', 'corrective', 'band', 0, 0, 1, 'rep',
    'Pull to the face with a high elbow, finishing with knuckles rotated back toward the ears.',
    'Rear delts and mid-back squeezing; nothing in the low back or neck.'],
  ['DB scaption raise', 'corrective', 'dumbbell', 0, 0, 2.5, 'lb',
    'Raise light DBs at ~30° forward of the body line, thumbs slightly up, stop at shoulder height.',
    'Side/front of the shoulder working smoothly — no pinch at the top (lower the range if so).'],
  ['Prone trap raise', 'corrective', 'dumbbell', 0, 0, 2.5, 'lb',
    'Face down, arm hanging, raise a light DB into the "Y" with the shoulder blade leading the arm.',
    'Lower trap, below and inside the shoulder blade — a small muscle; light means light.'],
  ['Serratus punch (banded)', 'corrective', 'band', 1, 0, 1, 'rep',
    'Press to full arm extension, then punch an extra inch by pushing the shoulder blade forward.',
    'The extra inch coming from the side of the ribcage (serratus), not the elbow.'],
  ['Weighted hip flexor march', 'corrective', 'ankle_weight', 1, 0, 2.5, 'lb',
    'Band anchored behind (posterior-lateral pull), drive one knee to hip height against it, tall posture, no lean-back.',
    'Deep front-of-hip working on the marching leg; abs bracing to keep the pelvis still.'],
  ['Weighted hanging knee raise', 'corrective', 'ankle_weight', 0, 0, 2.5, 'lb',
    'Dead hang, curl the knees above hip height with a slight pelvic tuck at the top, lower under control.',
    'Lower abs and hip flexors together; no swinging.'],

  // ---- Core / pelvis ----
  ['Copenhagen plank', 'corrective', 'bodyweight', 1, 1, 10, 'sec',
    'Side plank with the top foot/knee on a bench, bottom leg free. Body in one line, hips lifted.',
    'Inside of the TOP thigh (adductor) holding you up — not the shoulder collapsing.'],
  ['Side plank hip dips (QL)', 'corrective', 'bodyweight', 1, 0, null, null,
    'Side plank on the elbow, lower the hip toward the floor and lift it back past level.',
    'The side of the trunk between ribs and hip (obliques/QL) on the DOWN side.'],
  ['Side plank with abduction', 'corrective', 'bodyweight', 1, 0, null, null,
    'Side plank, then raise the top leg and hold it.',
    "Two burns — the bottom-side trunk, and the TOP leg's outer hip (glute med) holding the lift."],
  ['Side plank hold', 'corrective', 'bodyweight', 1, 1, null, null,
    'Elbow under shoulder, body in one line (knees version fine), hips high.',
    'Bottom-side obliques and hip holding the line — no sag.'],
  ['Pallof press', 'corrective', 'band', 1, 0, 1, 'rep',
    'Band at chest height from the side, press hands straight out and hold the line; do not let the band turn you.',
    'Obliques and deep abs resisting rotation — arms are just handles.'],
  ['Pallof press iso hold', 'corrective', 'band', 1, 1, 10, 'sec',
    'Band at chest height from the side, press hands straight out and hold the line; do not let the band turn you.',
    'Obliques and deep abs resisting rotation — arms are just handles.'],
  ['Dead bug', 'corrective', 'bodyweight', 1, 0, null, null,
    'On the back, ribs pinned down, opposite arm and leg lower slowly without the low back arching off the floor.',
    'Deep lower abs holding the back flat; if the back arches, shorten the range.'],
  ['Ab roller (from knees)', 'corrective', 'bodyweight', 0, 0, null, null,
    'Roll out only as far as the hips stay tucked and the back stays flat; pull back with the abs.',
    'Abs stretching under tension on the way out — low back pain means you rolled past your range.'],
  ['Suitcase carry', 'strength', 'kettlebell', 1, 0, 5, 'lb',
    'One heavy weight at the side, walk tall; the free-side shoulder and hip stay level.',
    'The trunk on the side OPPOSITE the load fighting the lean.'],

  // ---- Strength ----
  ['Trap bar deadlift jump-shrug', 'power', 'trap_bar', 0, 0, null, null,
    'Set the back flat, push the floor away and finish with an aggressive shrug-jump; land soft and reset every rep.',
    'The whole hip-and-leg drive as one snap upward — quads, glutes, calves finishing together.'],
  ['Single-leg box step-up', 'strength', 'dumbbell', 1, 0, 5, 'lb',
    'Whole foot on the box, drive through that heel to full stand-up WITHOUT pushing off the floor leg.',
    'The top-leg quad and glute doing all the work.'],
  ['KB swings', 'strength', 'kettlebell', 0, 0, 5, 'lb',
    'Hinge, not squat: hike the bell back, snap the hips forward, arms loose.',
    'Glutes and hamstrings launching the bell; the low back should never take over.'],
  ['Single-leg RDL (KB)', 'strength', 'kettlebell', 1, 0, 5, 'lb',
    'Soft stance knee, hinge by pushing the hips straight back, flat back, square hips, stand up through the heel.',
    'Stretch-then-drive in the stance-leg hamstring and glute; wobble is the foot and hip stabilizers working.'],
  ['Single-leg RDL (DB)', 'strength', 'dumbbell', 1, 0, 5, 'lb',
    'Soft stance knee, hinge by pushing the hips straight back, flat back, square hips, stand up through the heel.',
    'Stretch-then-drive in the stance-leg hamstring and glute; wobble is the foot and hip stabilizers working.'],
  ['Barbell hip thrust', 'strength', 'barbell', 0, 0, 10, 'lb',
    'Upper back on the bench, chin tucked, drive through the heels to a flat-table top position and squeeze.',
    'Glutes doing everything at lockout — no low-back arch, no hamstring cramp.'],
  ['Banded leg curl (ankle wrap)', 'strength', 'band', 1, 0, 1, 'rep',
    'Lying or standing, curl the heel to the glute against the band, slow on the way back.',
    'Hamstring belly contracting hard, especially resisting the return.'],
  ['Half-kneeling single-arm band row', 'strength', 'band', 1, 0, 1, 'rep',
    'Half-kneeling, tall trunk, row to the ribs leading with the shoulder blade, no trunk twist.',
    'Lat and mid-back on the pulling side; abs keeping the trunk from rotating.'],
  ['Landmine press (single arm)', 'strength', 'landmine', 1, 0, 5, 'lb',
    'Half-kneeling or standing, press the bar up-and-forward, ribs down, reach at the top so the shoulder blade wraps forward.',
    'Shoulder and serratus (side of the ribcage) on the reach — no low-back lean.'],

  // ---- Knee / tendon ----
  ['ATG split squat (front foot on low board)', 'knee', 'board', 1, 0, 2, 'rep',
    'Long split stance, lower until the back knee is near the floor and the front knee travels well past the toes, heel down.',
    'Front-leg quad above the knee under deep stretch-load; a calf/Achilles stretch too. Joint pain = shorten range.'],
  ['Reverse Nordic', 'knee', 'bodyweight', 0, 0, 2, 'rep',
    'Tall kneeling, straight line ear-to-knee, lean back on a 4-count as far as controllable, pull back up.',
    'Quads lengthening under load down the whole front thigh; the low back must not arch.'],
  ['Nordic hamstring curl', 'tendon', 'bodyweight', 0, 0, 2, 'rep',
    'Ankles anchored, lower the whole body forward on a 4-count with hips extended; use the rope to assist as needed.',
    'Hamstrings screaming to control the descent — if the hips fold, it turns into a back exercise.'],
  ['Tibialis raise, loaded', 'tibialis', 'band', 0, 0, 2, 'rep',
    'Same as wall version with band/plate over the forefoot: lift the toes, lower slow.',
    'Front-of-shin burn, deeper than bodyweight.'],
  ['Wall sit iso hold', 'tendon', 'bodyweight', 0, 1, 10, 'sec',
    'Back flat on the wall, knees at 90°, weight through the heels.',
    'Steady quad burn above the knees — quiet, no shaking out.'],
  ['Standing calf raise iso hold (top)', 'tendon', 'bodyweight', 0, 1, 10, 'sec',
    'Rise to the very top of the tallest calf raise and hold, locked and still.',
    'Calves fully cramped-short at the top; balance work is part of it.'],
  ['Slow calf raises off low board', 'tendon', 'board', 0, 0, null, null,
    'Heel drops below board level, 2-count up to full height, 3-count down, no bounce.',
    'Full stretch at the bottom, full squeeze at the top, tension the whole way.'],
  ['Single-leg ankle pogo hops', 'power', 'bodyweight', 1, 0, null, null,
    'Stiff-ankle bouncing on the forefoot, knees nearly straight, quick ground contact, small height.',
    'The spring coming from the calf/Achilles rebounding — not from bending the knees.'],
  ['Ankle pogo hops', 'power', 'bodyweight', 0, 0, null, null,
    'Stiff-ankle bouncing on the forefoot, knees nearly straight, quick ground contact, small height.',
    'The spring coming from the calf/Achilles rebounding — not from bending the knees.'],

  // ---- Power / reactive ----
  ['Heavy sled push', 'power', 'sled', 0, 0, 10, 'lb',
    'Low arms-locked lean, drive one full stride at a time. Load heavy enough that it grinds — never turns into a run.',
    'Full-body triple extension — hip, knee, ankle of the drive leg finishing every stride.'],
  ['Heavy sled march', 'power', 'sled', 0, 0, 10, 'lb',
    'Same load, upright-er, long forceful marching strides with a full second of drive each.',
    'Glutes and calves loading through each full foot-to-toe push-off.'],
  ['Backward sled drag', 'knee', 'sled', 0, 0, 10, 'lb',
    'Facing the sled, small quick backward steps, toes-first, knees bent, constant tension.',
    "Continuous quad burn above the knees — that's the knee-tendon work, don't straighten the legs to escape it."],
  ['Broad jump hold-and-stick', 'power', 'bodyweight', 0, 0, null, null,
    'Sub-max jump forward, land soft in a quarter squat and freeze 2 seconds. No rebound.',
    'Glutes and quads absorbing silently — a loud or wobbly landing is the rep to fix.'],
  ['Depth march (low board)', 'power', 'board', 0, 0, null, null,
    "Step (don't jump) off the low board, land soft on one or both feet, stick and hold.",
    'The whole leg absorbing quietly — knee tracking over the toes, no inward collapse.'],
  ['Depth drop into stick landing', 'power', 'board', 0, 0, null, null,
    "Step (don't jump) off the low board, land soft on one or both feet, stick and hold.",
    'The whole leg absorbing quietly — knee tracking over the toes, no inward collapse.'],
  ['Band-resisted lateral bounds', 'power', 'band', 1, 0, null, null,
    'Band at the waist, controlled sideways bound, stick each landing on the outside leg before returning.',
    'Outer hip (glute med) of the landing leg catching and holding the pelvis level.'],
];

// Targets: [side, sets, reps, hold_seconds, distance_m]
const L = 'left', R = 'right', B = 'both';

export const DAYS = [
  {
    day_no: 1,
    name: 'Sprint mechanics + hip flexor strength + left ankle',
    blocks: [
      { code: 'warmup', ex: 'Couch stretch', bias: L, rest: 20, t: [[L, 1, null, 120, null], [R, 1, null, 60, null]] },
      { code: 'warmup', ex: 'Banded ankle dorsiflexion rocks', bias: L, rest: 20, t: [[L, 1, 15, null, null], [R, 1, 15, null, null]] },
      { code: 'warmup', ex: 'Tibialis raise (back to wall)', bias: null, rest: 20, t: [[B, 3, 20, null, null]] },
      { code: 'warmup', ex: 'Banded hip flexor march', bias: null, rest: 20, t: [[L, 1, 15, null, null], [R, 1, 15, null, null]] },
      { code: 'warmup', ex: 'Lateral band walks', bias: null, rest: 20, t: [[B, 2, 20, null, null]] },
      { code: 'warmup', ex: 'Single-leg ankle pogo hops', bias: null, rest: 20, t: [[L, 1, 15, null, null], [R, 1, 15, null, null]] },
      { code: 'warmup', ex: 'Leg swings (front/back + lateral)', bias: null, rest: 20, t: [[L, 1, 12, null, null], [R, 1, 12, null, null]] },
      { code: 'warmup', ex: 'Banded hip flexor march', bias: null, rest: 20, t: [[L, 1, 12, null, null], [R, 1, 12, null, null]] },
      { code: 'knee', ex: 'Backward sled drag', bias: null, rest: 45, t: [[B, 3, null, null, 30]] },
      { code: 'knee', ex: 'Tibialis raise, loaded', bias: null, rest: 45, t: [[B, 3, 20, null, null]] },
      { code: 'knee', ex: 'ATG split squat (front foot on low board)', bias: L, rest: 45, t: [[L, 4, 8, null, null], [R, 3, 8, null, null]] },
      { code: '1a', ex: 'Trap bar deadlift jump-shrug', group: '1', bias: null, rest: 0, t: [[B, 5, 4, null, null]] },
      { code: '1b', ex: 'Weighted hanging knee raise', group: '1', bias: null, rest: 90, t: [[B, 4, 10, null, null]] },
      { code: '2a', ex: 'Single-leg box step-up', group: '2', bias: L, rest: 0, t: [[L, 4, 8, null, null], [R, 3, 8, null, null]] },
      { code: '2b', ex: 'Standing banded hip flexion', group: '2', bias: L, rest: 60, t: [[L, 4, 12, null, null], [R, 3, 12, null, null]] },
      { code: '3a', ex: 'Copenhagen plank', group: '3', bias: L, rest: 0, t: [[L, 4, null, 60, null], [R, 3, null, 45, null]] },
      { code: '3b', ex: 'KB swings', group: '3', bias: null, rest: 60, t: [[B, 4, 15, null, null]] },
      { code: 'power', ex: 'Heavy sled push', bias: null, rest: 120, t: [[B, 6, null, null, 20]] },
      { code: 'finisher', ex: 'Single-leg ankle pogo hops', bias: L, rest: 20, t: [[L, 3, 15, null, null], [R, 2, 15, null, null]] },
      { code: 'finisher', ex: 'Wall sit iso hold', bias: null, rest: 20, t: [[B, 2, null, 90, null]] },
      { code: 'finisher', ex: 'Standing calf raise iso hold (top)', bias: null, rest: 20, t: [[B, 2, null, 45, null]] },
    ],
  },
  {
    day_no: 2,
    name: 'Shoulder abductors + scapular control + core anti-tilt',
    blocks: [
      { code: 'warmup', ex: 'Band pull-aparts', bias: null, rest: 20, t: [[B, 1, 20, null, null]] },
      { code: 'warmup', ex: 'Band external rotation at 90° abduction', bias: null, rest: 20, t: [[L, 1, 15, null, null], [R, 1, 15, null, null]] },
      { code: 'warmup', ex: 'Wall slides with scapular protraction', bias: null, rest: 20, t: [[B, 1, 12, null, null]] },
      { code: 'warmup', ex: 'Prone Y-T-W', bias: null, rest: 20, t: [[B, 1, 10, null, null]] },
      { code: 'warmup', ex: 'Doorway pec stretch', bias: null, rest: 20, t: [[L, 1, null, 90, null], [R, 1, null, 90, null]] },
      { code: 'warmup', ex: 'Side plank hip dips (QL)', bias: L, rest: 20, t: [[L, 3, 8, null, null], [R, 2, 8, null, null]] },
      { code: 'warmup', ex: 'Arm circles + cross-body swings', bias: null, rest: 20, t: [[B, 1, 12, null, null]] },
      { code: 'knee', ex: 'Reverse Nordic', bias: null, rest: 45, t: [[B, 3, 8, null, null]] },
      { code: 'knee', ex: 'Tibialis raise (back to wall)', bias: null, rest: 45, t: [[B, 3, 25, null, null]] },
      { code: 'knee', ex: 'Standing calf stretch (knee bent, soleus)', bias: L, rest: 45, t: [[L, 1, null, 90, null], [R, 1, null, 60, null]] },
      { code: '1a', ex: 'Half-kneeling single-arm band row', group: '1', bias: L, rest: 0, t: [[L, 4, 12, null, null], [R, 3, 12, null, null]] },
      { code: '1b', ex: 'Landmine press (single arm)', group: '1', bias: L, rest: 60, t: [[L, 4, 8, null, null], [R, 3, 8, null, null]] },
      { code: '2a', ex: 'Serratus punch (banded)', group: '2', bias: null, rest: 0, t: [[L, 4, 12, null, null], [R, 4, 12, null, null]] },
      { code: '2b', ex: 'Prone trap raise', group: '2', bias: null, rest: 60, t: [[B, 4, 12, null, null]] },
      { code: '3a', ex: 'DB scaption raise', group: '3', bias: null, rest: 0, t: [[B, 4, 12, null, null]] },
      { code: '3b', ex: 'Face pulls (external rotation emphasis)', group: '3', bias: null, rest: 60, t: [[B, 4, 15, null, null]] },
      { code: 'core', ex: 'Side plank with abduction', bias: R, rest: 45, t: [[R, 3, 10, null, null], [L, 2, 10, null, null]] },
      { code: 'core', ex: 'Pallof press', bias: null, rest: 45, t: [[L, 3, 12, null, null], [R, 3, 12, null, null]] },
      { code: 'core', ex: 'Pallof press iso hold', bias: null, rest: 45, t: [[L, 3, null, 60, null], [R, 3, null, 60, null]] },
      { code: 'core', ex: 'Ab roller (from knees)', bias: null, rest: 45, t: [[B, 3, 8, null, null]] },
    ],
  },
  {
    day_no: 3,
    name: 'Reactive prep (sub-max, no true plyo yet) + posterior chain',
    blocks: [
      { code: 'warmup', ex: 'Couch stretch', bias: L, rest: 20, t: [[L, 1, null, 120, null], [R, 1, null, 60, null]] },
      { code: 'warmup', ex: 'Pallof press', bias: null, rest: 20, t: [[L, 1, 12, null, null], [R, 1, 12, null, null]] },
      { code: 'warmup', ex: 'Banded hip flexor march', bias: null, rest: 20, t: [[L, 1, 12, null, null], [R, 1, 12, null, null]] },
      { code: 'warmup', ex: 'Tibialis raise (back to wall)', bias: null, rest: 20, t: [[B, 3, 20, null, null]] },
      { code: 'warmup', ex: 'Broad jump hold-and-stick', bias: null, rest: 20, t: [[B, 1, 6, null, null]] },
      { code: 'warmup', ex: 'Depth march (low board)', bias: null, rest: 20, t: [[B, 1, 6, null, null]] },
      { code: 'warmup', ex: 'Band-resisted lateral bounds', bias: null, rest: 20, t: [[L, 1, 10, null, null], [R, 1, 10, null, null]] },
      { code: 'warmup', ex: 'Ankle pogo hops', bias: null, rest: 20, t: [[B, 1, 20, null, null]] },
      { code: 'knee', ex: 'Backward sled drag', bias: null, rest: 60, t: [[B, 3, null, null, 30]] },
      { code: 'knee', ex: 'ATG split squat (front foot on low board)', bias: L, rest: 60, t: [[L, 3, 8, null, null], [R, 2, 8, null, null]] },
      { code: 'knee', ex: 'Nordic hamstring curl', bias: null, rest: 60, t: [[B, 4, 5, null, null]] },
      { code: '1a', ex: 'Trap bar deadlift jump-shrug', group: '1', bias: null, rest: 0, t: [[B, 5, 4, null, null]] },
      { code: '1b', ex: 'Single-leg RDL (KB)', group: '1', bias: L, rest: 90, t: [[L, 4, 10, null, null], [R, 3, 10, null, null]] },
      { code: '2a', ex: 'Depth drop into stick landing', group: '2', bias: null, rest: 0, t: [[B, 4, 4, null, null]] },
      { code: '2b', ex: 'Weighted hip flexor march', group: '2', bias: null, rest: 60, t: [[L, 4, 10, null, null], [R, 4, 10, null, null]] },
      { code: '3a', ex: 'Suitcase carry', group: '3', bias: L, rest: 0, t: [[L, 3, null, null, 30], [R, 3, null, null, 30]] },
      { code: '3b', ex: 'Heavy sled march', group: '3', bias: null, rest: 90, t: [[B, 6, null, null, 20]] },
      { code: 'finisher', ex: 'Pallof press iso hold', bias: null, rest: 20, t: [[L, 3, null, 60, null], [R, 3, null, 60, null]] },
      { code: 'finisher', ex: 'Standing banded hip abduction hold', bias: R, rest: 20, t: [[R, 3, null, 60, null], [L, 2, null, 45, null]] },
    ],
  },
  {
    day_no: 4,
    name: 'Hip abductors/extensors + pelvic correction + glute strength',
    blocks: [
      { code: 'warmup', ex: 'Couch stretch', bias: L, rest: 20, t: [[L, 1, null, 120, null], [R, 1, null, 60, null]] },
      { code: 'warmup', ex: 'Banded clamshells', bias: L, rest: 20, t: [[L, 2, 15, null, null], [R, 1, 15, null, null]] },
      { code: 'warmup', ex: 'Lateral band walks', bias: null, rest: 20, t: [[B, 2, 20, null, null]] },
      { code: 'warmup', ex: 'Fire hydrant', bias: null, rest: 20, t: [[L, 1, 12, null, null], [R, 1, 12, null, null]] },
      { code: 'warmup', ex: '90/90 hip switches', bias: null, rest: 20, t: [[B, 1, 10, null, null], [L, 1, null, 60, null], [R, 1, null, 60, null]] },
      { code: 'warmup', ex: 'Side-lying hip abduction (band)', bias: R, rest: 20, t: [[R, 2, 15, null, null], [L, 1, 15, null, null]] },
      { code: 'warmup', ex: 'Tibialis raise (back to wall)', bias: null, rest: 20, t: [[B, 3, 20, null, null]] },
      { code: 'knee', ex: 'Banded leg curl (ankle wrap)', bias: L, rest: 45, t: [[L, 4, 15, null, null], [R, 3, 15, null, null]] },
      { code: 'knee', ex: 'Reverse Nordic', bias: null, rest: 45, t: [[B, 3, 8, null, null]] },
      { code: 'knee', ex: 'ATG split squat (front foot on low board)', bias: L, rest: 45, t: [[L, 3, 8, null, null], [R, 2, 8, null, null]] },
      { code: '1a', ex: 'Single-leg RDL (DB)', group: '1', bias: L, rest: 0, t: [[L, 4, 8, null, null], [R, 3, 8, null, null]] },
      { code: '1b', ex: 'Copenhagen plank', group: '1', bias: L, rest: 60, t: [[L, 4, null, 60, null], [R, 3, null, 45, null]] },
      { code: '2a', ex: 'Standing banded hip flexion', group: '2', bias: L, rest: 0, t: [[L, 4, 12, null, null], [R, 3, 12, null, null]] },
      { code: '2b', ex: 'Barbell hip thrust', group: '2', bias: null, rest: 90, t: [[B, 5, 8, null, null]] },
      { code: '3a', ex: 'Single-leg glute bridge', group: '3', bias: R, rest: 0, t: [[R, 4, 12, null, null]] },
      { code: '3b', ex: 'Band-resisted monster walks', group: '3', bias: null, rest: 60, t: [[B, 4, 20, null, null]] },
      { code: 'finisher', ex: 'Standing banded hip abduction hold', bias: R, rest: 20, t: [[R, 3, null, 60, null], [L, 2, null, 45, null]] },
      { code: 'finisher', ex: 'Glute bridge iso hold', bias: null, rest: 20, t: [[B, 3, null, 60, null]] },
      { code: 'finisher', ex: 'Couch stretch', bias: L, rest: 20, t: [[L, 1, null, 120, null]] },
    ],
  },
  {
    day_no: 0,
    name: 'Nightly non-negotiable (~20 min)',
    blocks: [
      { code: 'calves', ex: 'Standing calf stretch (knee straight)', bias: L, rest: 0, t: [[L, 1, null, 90, null], [R, 1, null, 60, null]] },
      { code: 'calves', ex: 'Standing calf stretch (knee bent, soleus)', bias: L, rest: 0, t: [[L, 1, null, 90, null], [R, 1, null, 60, null]] },
      { code: 'calves', ex: 'Slow calf raises off low board', bias: null, rest: 0, t: [[B, 2, 15, null, null]] },
      { code: 'calves', ex: 'Tibialis raise (back to wall)', bias: null, rest: 0, t: [[B, 2, 20, null, null]] },
      { code: 'glutes', ex: 'Glute bridge iso hold', bias: null, rest: 0, t: [[B, 3, null, 45, null]] },
      { code: 'glutes', ex: 'Single-leg glute bridge', bias: R, rest: 0, t: [[R, 2, 8, null, null], [L, 2, 8, null, null]] },
      { code: 'glutes', ex: 'Banded clamshells', bias: L, rest: 0, t: [[L, 2, 15, null, null], [R, 1, 15, null, null]] },
      { code: 'core', ex: 'Dead bug', bias: null, rest: 0, t: [[L, 2, 8, null, null], [R, 2, 8, null, null]] },
      { code: 'core', ex: 'Side plank hold', bias: R, rest: 0, t: [[R, 2, null, 60, null], [L, 2, null, 45, null]] },
      { code: 'core', ex: '90/90 hip switches', bias: null, rest: 0, t: [[B, 1, 8, null, null], [L, 1, null, 45, null], [R, 1, null, 45, null]] },
      { code: 'close', ex: 'Couch stretch', bias: L, rest: 0, t: [[L, 1, null, 120, null], [R, 1, null, 60, null]] },
    ],
  },
];

export function seed(db) {
  const insEx = db.prepare(
    'INSERT INTO exercise (name, category, load_type, is_unilateral, is_timed, increment_value, increment_unit, instruction, feel_cue) VALUES (?,?,?,?,?,?,?,?,?)'
  );
  const exId = new Map();
  for (const e of EXERCISES) {
    insEx.run(e);
    exId.set(e[0], db.exec('SELECT last_insert_rowid()')[0].values[0][0]);
  }
  insEx.free();

  const insDay = db.prepare('INSERT INTO day_template (day_no, name) VALUES (?,?)');
  const insBlock = db.prepare(
    'INSERT INTO block (day_template_id, block_code, order_index, exercise_id, superset_group, rest_seconds_after, bias_side) VALUES (?,?,?,?,?,?,?)'
  );
  const insTarget = db.prepare(
    'INSERT INTO block_target (block_id, side, sets, reps, hold_seconds, distance_m) VALUES (?,?,?,?,?,?)'
  );

  for (const day of DAYS) {
    insDay.run([day.day_no, day.name]);
    const dayId = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
    day.blocks.forEach((b, i) => {
      const eid = exId.get(b.ex);
      if (!eid) throw new Error('seed: unknown exercise ' + b.ex);
      insBlock.run([dayId, b.code, i + 1, eid, b.group || null, b.rest, b.bias]);
      const blockId = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
      for (const [side, sets, reps, hold, dist] of b.t) {
        insTarget.run([blockId, side, sets, reps, hold, dist]);
      }
    });
  }
  insDay.free();
  insBlock.free();
  insTarget.free();
}
