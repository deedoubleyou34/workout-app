// Ducking — spec Phase 6. Voice cues cut through music, and music always
// comes back.
//
// The spec calls this the riskiest phase and it is right, for two reasons that
// have nothing to do with our code:
//   - PUT /me/player/volume returns 403 VOLUME_CONTROL_DISALLOW on many
//     Connect devices, and the Spotify iOS app is a frequent offender.
//   - On iOS, a web page that plays audio can seize the audio session and
//     pause Spotify by itself.
// So: probe the device before trusting either, and after every cue re-assert
// what playback was SUPPOSED to be doing rather than assuming the cue left it
// alone. If it still fights back, the answer is the escape hatch (run Spotify
// on a Bluetooth speaker or the PC), not more code — see js/ui/music.js.

import * as spotify from './spotify.js';
import { idbGet, idbPut } from './db.js';

export const DUCK_LEVEL = 25;        // percent, per spec
export const MIN_CYCLE_MS = 1500;    // never duck+restore faster than this
export const TAIL_MS = 400;          // let the cue finish before music returns

const CACHE_KEY = 'duck-strategies'; // { [deviceId]: { strategy, at } }
const STRANDED_KEY = 'duck-stranded';

// ---------- pure decisions (tested without a network) ----------

// probe result -> strategy. `ok` means the volume PUT went through.
export function pickStrategy(result) {
  if (!result) return 'none';
  if (result.ok) return 'duck';                                    // strategy A
  const reason = result.reason || '';
  if (result.kind === 'volume_disallowed' || /VOLUME_CONTROL_DISALLOW/i.test(reason)) {
    return 'pause';                                                // strategy B
  }
  return 'none';                                                   // strategy C
}

// Cue bookkeeping. The case this exists for is the end of a rest: CUE_GO fires
// off the 250 ms ticker, then commit -> go() -> the next step's cue lands
// ~50 ms later. Two cues, one window — that must be ONE duck and ONE restore.
export function planCycle(state, now, cueMs, min = MIN_CYCLE_MS, tail = TAIL_MS) {
  const until = now + cueMs + tail;
  if (state && state.ducked) {
    return { ...state, action: 'extend', releaseAt: Math.max(state.releaseAt, until) };
  }
  return { ducked: true, action: 'duck', duckedAt: now, releaseAt: Math.max(until, now + min) };
}

export function canRelease(state, now, min = MIN_CYCLE_MS) {
  if (!state || !state.ducked) return false;
  return now >= state.releaseAt && now - state.duckedAt >= min;
}

// ---------- session state ----------

let sessionPlan = null;   // { strategy, deviceId, priorVolume, wasPlaying, note }
let cycle = { ducked: false, duckedAt: 0, releaseAt: 0 };
let releaseTimer = null;
let failures = 0;

export function currentPlan() {
  return sessionPlan;
}

async function cachedStrategies() {
  return (await idbGet(CACHE_KEY)) || {};
}

export async function strategyFor(deviceId) {
  if (!deviceId) return null;
  const all = await cachedStrategies();
  return all[deviceId] ? all[deviceId].strategy : null;
}

async function rememberStrategy(deviceId, strategy) {
  if (!deviceId) return;
  const all = await cachedStrategies();
  all[deviceId] = { strategy, at: new Date().toISOString() };
  await idbPut(CACHE_KEY, all);
}

// ---------- the probe (spec Phase 6 step 1) ----------

// Writes the CURRENT volume back at the device: a no-op if it works, and the
// only way to find out whether it is allowed to work.
async function probeDevice(deviceId, volume) {
  try {
    await spotify.player.volume(volume, deviceId);
    return { ok: true };
  } catch (err) {
    return { ok: false, kind: err.kind, reason: err.reason || err.message };
  }
}

// Work out what this session can do. Called once, behind the runner's Start
// tap — the same gesture that unlocks audio.
export async function begin({ force = false } = {}) {
  reset();
  await spotify.loadAuth();
  if (!spotify.isConnected()) {
    sessionPlan = { strategy: 'none', note: 'Spotify is not connected.' };
    return sessionPlan;
  }

  let state = null;
  try {
    state = await spotify.player.state();
  } catch (err) {
    sessionPlan = { strategy: 'none', note: err.message };
    return sessionPlan;
  }

  if (!state || !state.is_playing) {
    sessionPlan = { strategy: 'none', note: 'Nothing is playing, so there is nothing to duck.' };
    return sessionPlan;
  }

  const device = state.device || {};
  const volume = device.volume_percent;
  // A device that will not report its volume cannot have it restored, and
  // guessing a level to put it back to is worse than not ducking. Pausing
  // still works on those, so they get strategy B rather than a gamble.
  if (volume == null) {
    sessionPlan = {
      strategy: 'pause', deviceId: device.id, deviceName: device.name, probed: true,
      priorVolume: null, wasPlaying: true,
      note: device.name + ' does not report its volume, so cues pause the music instead of dipping it.',
    };
    await rememberStrategy(device.id, 'pause');
    return sessionPlan;
  }

  let strategy = force ? null : await strategyFor(device.id);
  if (!strategy) {
    strategy = pickStrategy(await probeDevice(device.id, volume));
    await rememberStrategy(device.id, strategy);
  }

  sessionPlan = {
    strategy,
    deviceId: device.id,
    deviceName: device.name,
    probed: true,
    priorVolume: volume,
    wasPlaying: true,
    note: null,
  };
  return sessionPlan;
}

function reset() {
  if (releaseTimer) clearTimeout(releaseTimer);
  releaseTimer = null;
  cycle = { ducked: false, duckedAt: 0, releaseAt: 0 };
  failures = 0;
}

// ---------- duck / restore ----------

async function applyDuck() {
  const plan = sessionPlan;
  // Persist BEFORE the change. If iOS kills the app mid-cue, this record is
  // the only thing that knows the music was left at 25%.
  await idbPut(STRANDED_KEY, {
    ducked: true, strategy: plan.strategy, deviceId: plan.deviceId,
    priorVolume: plan.priorVolume, at: Date.now(),
  });
  if (plan.strategy === 'duck') await spotify.player.volume(DUCK_LEVEL, plan.deviceId);
  else if (plan.strategy === 'pause') await spotify.player.pause();
}

async function applyRestore() {
  const plan = sessionPlan;
  if (!plan) return;
  if (plan.strategy === 'duck' && plan.priorVolume != null) {
    await spotify.player.volume(plan.priorVolume, plan.deviceId);
  }
  // Spec step 3: re-assert the INTENDED state unconditionally. On iOS the cue
  // may have paused Spotify on its own, and "it was playing before" is the
  // only thing that makes resuming correct rather than presumptuous — if Dom
  // paused it himself, it stays paused.
  let after = null;
  try {
    after = await spotify.player.state();
  } catch { /* best effort; the volume is already back */ }
  if (after && plan.wasPlaying && !after.is_playing) {
    await spotify.player.play(plan.deviceId);
  }
  await idbPut(STRANDED_KEY, null);
}

function scheduleRelease() {
  if (releaseTimer) clearTimeout(releaseTimer);
  const wait = Math.max(cycle.releaseAt - Date.now(), 0);
  releaseTimer = setTimeout(async () => {
    releaseTimer = null;
    if (!canRelease(cycle, Date.now())) return scheduleRelease();   // a later cue extended it
    cycle = { ducked: false, duckedAt: 0, releaseAt: 0 };
    try {
      await applyRestore();
    } catch {
      failures++;
    }
  }, wait);
}

// Play a cue with the music out of its way. `playFn` returns the cue length in
// ms — 0 means nothing was played (silent session), and silence never ducks.
export async function speakOver(playFn) {
  const ms = await playFn();
  if (!ms) return ms;
  const plan = sessionPlan;
  if (!plan || plan.strategy === 'none') return ms;

  const next = planCycle(cycle, Date.now(), ms);
  const wasDucked = cycle.ducked;
  cycle = next;
  if (!wasDucked) {
    try {
      await applyDuck();
    } catch {
      failures++;
      // Two failures and we stop fighting the device for the rest of the
      // session. A cue that has to lose is better than music stuck at 25%.
      if (failures >= 2) {
        sessionPlan = { ...plan, strategy: 'none', note: 'Ducking kept failing, so it is off for this session.' };
        cycle = { ducked: false, duckedAt: 0, releaseAt: 0 };
        await idbPut(STRANDED_KEY, null);
        return ms;
      }
    }
  }
  scheduleRelease();
  return ms;
}

// Leaving the runner — finished, quit, or abandoned. Volume comes back either
// way (spec Phase 6 exit gate).
export async function end() {
  if (releaseTimer) clearTimeout(releaseTimer);
  releaseTimer = null;
  const wasDucked = cycle.ducked;
  cycle = { ducked: false, duckedAt: 0, releaseAt: 0 };
  if (wasDucked) {
    try { await applyRestore(); } catch { /* the stranded record survives for next launch */ }
  }
  sessionPlan = null;
}

// On launch: if the app died mid-cue, the music is still turned down and
// nothing in memory knows it. Put it back.
export async function recoverIfStranded() {
  let stranded = null;
  try {
    stranded = await idbGet(STRANDED_KEY);
  } catch { return false; }
  if (!stranded || !stranded.ducked) return false;
  await idbPut(STRANDED_KEY, null);
  try {
    await spotify.loadAuth();
    if (!spotify.isConnected()) return false;
    if (stranded.strategy === 'duck' && stranded.priorVolume != null) {
      await spotify.player.volume(stranded.priorVolume, stranded.deviceId);
      return true;
    }
  } catch { /* offline or the device is gone; nothing more to do */ }
  return false;
}
