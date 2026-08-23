// Voice cues — spec Phase 4.
//
// Pre-rendered edge-tts clips, not Safari's speechSynthesis: getVoices() comes
// back empty, voice selection is ignored, and speech dies when the page
// backgrounds. speechSynthesis stays only as a last resort for a string with
// no clip.
//
// A cue is an ordered queue of clip ids — ['s_next_up','ex_couch_stretch',
// 'side_left','sec_120'] — decoded once, cached as AudioBuffers, and scheduled
// back to back on one AudioContext that stays open for the whole session.

let ctx = null;
let manifest = null;
let unlocked = false;
const buffers = new Map();      // clip id -> AudioBuffer
const pending = new Map();      // clip id -> Promise<AudioBuffer>
let scheduled = [];             // live AudioBufferSourceNodes

const GAP = 0.06;               // seconds between clips; keeps cues from slurring

export function isUnlocked() {
  return unlocked && ctx && ctx.state === 'running';
}

export async function loadManifest() {
  if (manifest) return manifest;
  try {
    manifest = await fetch('./audio/manifest.json').then((r) => r.json());
  } catch {
    manifest = {};
  }
  return manifest;
}

// Must be called from inside a user gesture (the session-start tap). iOS keeps
// audio muted until a real tap has produced sound.
export async function unlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
  const silent = ctx.createBuffer(1, 1, 22050);
  const src = ctx.createBufferSource();
  src.buffer = silent;
  src.connect(ctx.destination);
  src.start(0);
  unlocked = ctx.state === 'running';
  await loadManifest();
  return unlocked;
}

async function bufferFor(id) {
  if (buffers.has(id)) return buffers.get(id);
  if (pending.has(id)) return pending.get(id);
  const entry = manifest && manifest[id];
  if (!entry || !ctx) return null;
  const p = fetch('./audio/' + entry.file)
    .then((r) => r.arrayBuffer())
    .then((buf) => new Promise((res, rej) => ctx.decodeAudioData(buf, res, rej)))
    .then((decoded) => {
      buffers.set(id, decoded);
      pending.delete(id);
      return decoded;
    })
    .catch(() => {
      pending.delete(id);
      return null;
    });
  pending.set(id, p);
  return p;
}

// Fetch and decode ahead of time so the first cue of a session is not late.
export async function preload(ids) {
  if (!ctx || !manifest) return;
  await Promise.all([...new Set(ids)].map((id) => bufferFor(id)));
}

export function stop() {
  for (const src of scheduled) {
    try { src.stop(); } catch { /* already finished */ }
  }
  scheduled = [];
}

// Play a queue of clip ids in order. Durations come from the decoded buffers,
// not the manifest — decoded length is exact, and the manifest's millisecond
// figures are only advisory.
export async function play(ids, { interrupt = true } = {}) {
  if (!isUnlocked()) return false;
  if (interrupt) stop();
  const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
  const decoded = [];
  for (const id of list) {
    const buf = await bufferFor(id);
    if (buf) decoded.push(buf);
  }
  if (!decoded.length) return false;

  let at = ctx.currentTime + 0.04;
  for (const buf of decoded) {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(at);
    scheduled.push(src);
    at += buf.duration + GAP;
  }
  return true;
}

// Last resort for a string with no clip (spec Phase 4).
export function speak(text) {
  if (!('speechSynthesis' in window)) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    window.speechSynthesis.speak(u);
  } catch { /* nothing more to try */ }
}

// ---------- cue composition ----------

function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').replace(/_+/g, '_');
}

export function exerciseClip(name) {
  return 'ex_' + slug(name);
}

const SIDE_CLIP = { left: 'side_left', right: 'side_right', both: null };
const SPOKEN_SECONDS = new Set([45, 60, 75, 90, 105, 120]);

// A number the library actually has a clip for.
function numberClips(n) {
  if (!Number.isFinite(n)) return [];
  if (n >= 1 && n <= 50 && Number.isInteger(n)) return ['n_' + n];
  return [];
}

// "Couch stretch. Left side. Two minutes."
export function announceSet({ name, side, targetKind, targetValue, setIndex, totalSets }) {
  const q = [exerciseClip(name)];
  const sideClip = SIDE_CLIP[side];
  if (sideClip) q.push(sideClip);

  if (targetKind === 'hold') {
    if (SPOKEN_SECONDS.has(targetValue)) q.push('sec_' + targetValue);
    else q.push(...numberClips(targetValue), 'u_seconds');
  } else if (targetKind === 'distance') {
    q.push(...numberClips(targetValue), 'u_meters');
  } else {
    q.push(...numberClips(targetValue), 'u_reps');
  }

  if (setIndex && totalSets && setIndex === totalSets && totalSets > 1) q.push('s_last_set');
  return q;
}

export function announceRest(seconds, { main = false } = {}) {
  const q = [main ? 's_main_rest' : 's_rest'];
  if (SPOKEN_SECONDS.has(seconds)) q.push('sec_' + seconds);
  else q.push(...numberClips(seconds), 'u_seconds');
  return q;
}

export const CUE_TEN_SECONDS = ['s_ten_seconds'];
export const CUE_GO = ['s_go'];
export const CUE_COMPLETE = ['s_session_complete'];
