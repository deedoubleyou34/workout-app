// Voice cues — spec Phase 4.
//
// Pre-rendered edge-tts clips, not Safari's speechSynthesis: getVoices() comes
// back empty, voice selection is ignored, and speech dies when the page
// backgrounds. speechSynthesis stays only as a last resort for a string with
// no clip.
//
// A cue is normally ONE clip holding a whole sentence — "Couch stretch. Left
// side. Two minutes." — because word-at-a-time playback sounded chopped up
// (Dom, 2026-08-24). js/cues.js derives the sentence and its id; the clip is
// rendered at build time. When a cue has no composite — an accepted
// progression can move a target to a value the seed never had — the queue
// falls back to the word-at-a-time clips rather than going silent.
//
// Either way a cue is an ordered queue of clip ids, decoded once, cached as
// AudioBuffers and scheduled back to back on one AudioContext that stays open
// for the whole session.

import { cueId, setText, restText, restIsSilent, hasSecondsClip, slug } from './cues.js';

let ctx = null;
let manifest = null;
let unlocked = false;
const buffers = new Map();      // clip id -> AudioBuffer
const pending = new Map();      // clip id -> Promise<AudioBuffer>
let scheduled = [];             // live AudioBufferSourceNodes

const GAP = 0.03;               // seconds between clips in a fallback queue

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
//
// Returns the length of the cue in MILLISECONDS, or 0 if nothing was played.
// Ducking needs to know how long to hold the music down, and "0" is how it
// knows a silent session must not duck at all.
export async function play(ids, { interrupt = true } = {}) {
  if (!isUnlocked()) return 0;
  if (interrupt) stop();
  const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
  const decoded = [];
  for (const id of list) {
    const buf = await bufferFor(id);
    if (buf) decoded.push(buf);
  }
  if (!decoded.length) return 0;

  const start = ctx.currentTime + 0.04;
  let at = start;
  for (const buf of decoded) {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(at);
    scheduled.push(src);
    at += buf.duration + GAP;
  }
  return Math.round((at - ctx.currentTime) * 1000);
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

export function exerciseClip(name) {
  return 'ex_' + slug(name);
}

export function hasClip(id) {
  return !!(id && manifest && manifest[id]);
}

const SIDE_CLIP = { left: 'side_left', right: 'side_right', both: null };

// A number the word-at-a-time library actually has a clip for.
function numberClips(n) {
  if (!Number.isFinite(n) || !Number.isInteger(n)) return [];
  if (n >= 1 && n <= 50) return ['n_' + n];
  return [];
}

// Word-at-a-time, used only when the sentence has no clip of its own.
function piecewiseSet({ name, side, targetKind, targetValue }) {
  const q = [exerciseClip(name)];
  const sideClip = SIDE_CLIP[side];
  if (sideClip) q.push(sideClip);
  if (targetKind === 'effort' || targetValue == null) return q;
  if (targetKind === 'hold') {
    if (hasSecondsClip(targetValue)) q.push('sec_' + targetValue);
    else q.push(...numberClips(targetValue), 'u_seconds');
  } else if (targetKind === 'distance') {
    q.push(...numberClips(targetValue), 'u_meters');
  } else {
    q.push(...numberClips(targetValue), 'u_reps');
  }
  return q;
}

// "Copenhagen plank. Left side. One minute."  — one clip when we have it.
export function announceSet(step) {
  const id = cueId(setText(step));
  const q = hasClip(id) ? [id] : piecewiseSet(step);
  if (step.setIndex && step.totalSets && step.setIndex === step.totalSets && step.totalSets > 1) {
    q.push('s_last_set');
  }
  return q;
}

export function announceRest(seconds, opts = {}) {
  const text = restText(seconds, opts);
  if (!text) return [];                       // a warm-up gap says nothing
  const id = cueId(text);
  if (hasClip(id)) return [id];
  const q = [opts.main ? 's_main_rest' : 's_rest'];
  if (hasSecondsClip(seconds)) q.push('sec_' + seconds);
  else q.push(...numberClips(seconds), 'u_seconds');
  return q;
}

// Every clip id a session could ask for, so preload covers the fallback too.
export function cueIdsFor(step) {
  if (step.kind === 'set') return [...new Set([...announceSet(step), ...piecewiseSet(step)])];
  if (step.kind === 'rest') {
    const opts = { main: step.main, nextCategory: step.nextCategory, category: step.category };
    // A silent rest asks for no clips at all — preloading the fallback pieces
    // for one would be decoding audio the session can never reach.
    if (restIsSilent(step.seconds, opts)) return [];
    const id = cueId(restText(step.seconds, opts));
    return [id, 's_rest', 's_main_rest', 'sec_' + step.seconds].filter(Boolean);
  }
  return [];
}

export const CUE_TEN_SECONDS = ['s_ten_seconds'];
export const CUE_GO = ['s_go'];
export const CUE_COMPLETE = ['s_session_complete'];
