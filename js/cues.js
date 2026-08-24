// What the app SAYS — one place, shared by the runner and the clip generator.
//
// Dom, 2026-08-24: "The voice is very choppy and says things in increments
// instead of like a flowing sentence. For example: '15' pause 'reps' when it
// should be '15 reps'."
//
// So a cue is now ONE clip holding one whole sentence. This module derives
// both the sentence and its clip id; tools/gen_cues.mjs walks every step of
// every day through the same functions and writes audio/cues.json, which
// tools/gen_audio.py renders. Runtime and build time can therefore never
// disagree about what a cue says.
//
// The word-at-a-time clips (n_15, u_reps, side_left, ...) are still rendered
// and still used: an accepted progression can move a target to a value the
// seed never had ("14 reps"), and a composite for it does not exist. In that
// case the runner falls back to the piecewise queue rather than going silent.

import { EXERCISES } from './seed.js';

export function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').replace(/_+/g, '_');
}

// A composite clip is named after what it says.
export function cueId(text) {
  return text ? 'c_' + slug(text) : null;
}

// Initialisms a TTS voice mangles if left alone.
function say(text) {
  return text
    .replace(/90\/90/g, 'ninety ninety')
    .replace(/Y-T-W/g, 'Y T W')
    .replace(/ATG/g, 'A T G')
    .replace(/\bKB\b/g, 'kettlebell')
    .replace(/\bDB\b/g, 'dumbbell')
    .replace(/\bRDL\b/g, 'R D L')
    .replace(/\bQL\b/g, 'Q L')
    .replace(/\+/g, 'and')
    .replace(/°/g, ' degree')
    .replace(/\//g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+,/g, ',')
    .replace(/^[\s,]+|[\s,]+$/g, '');
}

// The parenthetical equipment note is dropped — unless dropping it would make
// two exercises sound identical ("Standing calf stretch (knee straight)" vs
// "(knee bent, soleus)"), in which case it is spoken as a trailing clause.
const SPOKEN_NAME = (() => {
  const names = EXERCISES.map((e) => e[0]);
  const short = new Map(names.map((n) => [n, say(n.replace(/\s*\([^)]*\)/g, ''))]));
  const counts = new Map();
  for (const s of short.values()) counts.set(s, (counts.get(s) || 0) + 1);
  const out = new Map();
  for (const n of names) {
    out.set(n, counts.get(short.get(n)) > 1 ? say(n.replace(/\(/g, ', ').replace(/\)/g, '')) : short.get(n));
  }
  return out;
})();

export function spokenName(name) {
  return SPOKEN_NAME.get(name) || say(name.replace(/\s*\([^)]*\)/g, ''));
}

// Holds run 45-120 s. "one hundred twenty seconds" is the wrong cue.
export function spokenSeconds(n) {
  if (n === 60) return 'one minute';
  if (n === 90) return 'a minute thirty';
  if (n === 120) return 'two minutes';
  if (n % 60 === 0) return n / 60 + ' minutes';
  if (n > 60 && n % 60 === 30) return Math.floor(n / 60) + ' minutes thirty';
  return n + ' seconds';
}

// Values the clip library carries a natural spoken duration for. Anything on a
// five-second boundary up to three minutes — accepted progressions move holds
// in 5 and 10 s steps, and a hold with no clip is a silent set.
export function hasSecondsClip(n) {
  return Number.isInteger(n) && n >= 5 && n <= 180 && n % 5 === 0;
}

const SIDE_PHRASE = { left: 'Left side', right: 'Right side', both: null };

const sentence = (parts) => parts.filter(Boolean)
  .map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('. ') + '.';

function targetPhrase(kind, value) {
  if (kind === 'hold') return hasSecondsClip(value) ? spokenSeconds(value) : null;
  if (kind === 'distance') return value + ' meters';
  if (kind === 'effort') return null;          // sled: sets and weight, no count
  return value == null ? null : value + ' reps';
}

// "Copenhagen plank. Left side. One minute."
export function setText({ name, side, targetKind, targetValue }) {
  return sentence([spokenName(name), SIDE_PHRASE[side], targetPhrase(targetKind, targetValue)]);
}

// Short rests lead with the number — it is the only thing worth hearing.
// A five-second gap between warm-up drills is not worth announcing at all.
export function restText(seconds, { main = false, nextCategory = null } = {}) {
  if (main) {
    const next = nextCategory ? nextCategory.replace(/\s*\/\s*/g, ' and ') : null;
    return sentence(['Main rest', spokenSeconds(seconds), next ? 'next up, ' + next : null]);
  }
  if (seconds < 10) return null;
  // A short rest is a number, not a phrase: "90 seconds rest", not "a minute
  // thirty rest". Whole minutes still read as minutes.
  const said = seconds % 60 === 0 ? spokenSeconds(seconds) : seconds + ' seconds';
  return sentence([said + ' rest']);
}

// Word-at-a-time clips: the fallback path, and the pieces every session needs.
export const STRUCTURAL = {
  side_left: 'left side',
  side_right: 'right side',
  side_both: 'both sides',
  u_reps: 'reps',
  u_seconds: 'seconds',
  u_meters: 'meters',
  s_rest: 'rest',
  s_main_rest: 'main rest',
  s_next_up: 'next up',
  s_ten_seconds: 'ten seconds',
  s_go: 'go',
  s_last_set: 'last set',
  s_session_complete: 'session complete',
};

// The whole word-at-a-time library, in clip-id order-independent form.
export function atomicLibrary() {
  const clips = { ...STRUCTURAL };
  for (const [name] of EXERCISES) clips['ex_' + slug(name)] = spokenName(name);
  for (let n = 1; n <= 50; n++) clips['n_' + n] = String(n);
  for (let n = 5; n <= 180; n += 5) clips['sec_' + n] = spokenSeconds(n);
  return clips;
}
