import { query, getDb, persist } from '../db.js';
import { computeFlags } from '../progression.js';
import { currentSession, startSession, finishSession, logSet,
         saveRunnerState, loadRunnerState, clearRunnerState } from '../sessions.js';
import { buildSteps, stepTarget, remainingSeconds, resumeIndex, progressOf } from '../runner.js';
import * as audio from '../audio.js';
import { renderMusic } from './music.js';
import * as ducking from '../ducking.js';

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

const SIDE_WORD = { left: 'LEFT', right: 'RIGHT', both: '' };

// ---------- screen wake lock ----------
let wakeLock = null;
let wakeLockLost = false;

async function acquireWakeLock(onChange) {
  if (!('wakeLock' in navigator)) {
    wakeLockLost = true;
    onChange();
    return;
  }
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLockLost = false;
    wakeLock.addEventListener('release', () => {
      wakeLockLost = true;
      onChange();
    });
  } catch {
    wakeLockLost = true;
  }
  onChange();
}

function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}

export function renderRun(root, dayNo) {
  const db = getDb();
  const day = query('SELECT * FROM day_template WHERE day_no = ?', [dayNo])[0];
  if (!day || dayNo === 0) {
    location.hash = '#/';
    return;
  }

  let session = currentSession(db, dayNo);
  if (!session || session.status !== 'in_progress') {
    session = startSession(db, dayNo);
    persist();
  }

  // ---------- build the step list ----------
  const blocks = query(
    'SELECT b.*, e.name ex_name, e.is_timed, e.load_type, e.instruction, e.feel_cue ' +
    'FROM block b JOIN exercise e ON e.id = b.exercise_id ' +
    'WHERE b.day_template_id = ? ORDER BY b.order_index', [day.id]);
  for (const b of blocks) {
    b.targets = query('SELECT * FROM block_target WHERE block_id = ? ORDER BY id', [b.id]);
  }
  const steps = buildSteps(blocks);

  const loads = new Map();
  for (const cl of query('SELECT * FROM current_load')) loads.set(cl.exercise_id + '|' + cl.side, cl);
  const loadFor = (s) => loads.get(s.block.exercise_id + '|' + s.side) || {};

  const logged = new Set();
  for (const r of query('SELECT block_id, side, set_index FROM set_log WHERE session_id = ?', [session.id])) {
    logged.add(r.block_id + '|' + r.side + '|' + r.set_index);
  }
  const isLogged = (s) => logged.has(s.block.id + '|' + s.side + '|' + s.setIndex);

  const saved = loadRunnerState(db, session.id);
  let index = saved ? Math.min(saved.index, steps.length - 1) : 0;
  // a set already logged at the saved position means the app died after the
  // write but before the state save — resume at the first unlogged set
  if (steps[index] && steps[index].kind === 'set' && isLogged(steps[index])) {
    index = resumeIndex(steps, isLogged);
  }
  let restStartedAt = saved && saved.restStartedAt ? saved.restStartedAt : null;
  let ticker = null;
  let warnedAt = null;   // which rest already got its ten-second warning

  // A hold runs its own clock: { index, startedAt, accMs, running }. It is
  // pausable (Dom asked for a play/pause so a stretch can be set up first), so
  // one startedAt is not enough — elapsed is accumulated across pauses and
  // saved with the rest of the runner state, or a force-quit mid-hold would
  // come back at zero.
  let hold = saved && saved.hold ? saved.hold : null;

  function holdElapsedMs() {
    if (!hold) return 0;
    return hold.accMs + (hold.running ? Date.now() - hold.startedAt : 0);
  }

  function save() {
    saveRunnerState(db, { session_id: session.id, index, restStartedAt, hold });
    persist();
  }

  function go(next) {
    index = Math.max(0, Math.min(next, steps.length - 1));
    restStartedAt = steps[index] && steps[index].kind === 'rest' ? Date.now() : null;
    hold = null;
    save();
    draw();
    cueFor(steps[index]);
  }

  // ---------- voice cues ----------
  function cueFor(step) {
    if (!step || !audio.isUnlocked()) return;
    if (step.kind === 'set') {
      say(audio.announceSet({
        name: step.label, side: step.side, ...targetOf(step),
        setIndex: step.setIndex, totalSets: step.totalSets,
      }));
    } else if (step.kind === 'rest') {
      say(audio.announceRest(step.seconds, { main: step.main }));
    } else if (step.kind === 'summary') {
      say(audio.CUE_COMPLETE);
    }
  }

  // One way in for every cue: the music dips (or pauses) around it and comes
  // back. A silent session returns 0 ms from play() and never ducks at all.
  function say(ids) {
    ducking.speakOver(() => audio.play(ids)).catch(() => {});
  }

  // decode the clips this session will actually use, so the first cue is on time
  function preloadCues() {
    const ids = new Set(['s_go', 's_ten_seconds', 's_last_set', 's_session_complete']);
    for (const st of steps) {
      const cueStep = st.kind === 'set'
        ? { ...st, name: st.label, ...targetOf(st) }
        : st;
      for (const id of audio.cueIdsFor(cueStep)) ids.add(id);
    }
    audio.preload([...ids]);
  }

  // the shape js/cues.js speaks from
  function targetOf(step) {
    const tgt = stepTarget(step, loadFor(step));
    return { targetKind: tgt.kind, targetValue: tgt.value };
  }

  // ---------- start gate ----------
  // iOS keeps audio muted until a tap has produced sound, so the session starts
  // behind one deliberate tap: it unlocks the AudioContext, takes the wake lock,
  // and only then begins. Also the natural place to resume a killed session.
  let started = false;

  function drawGate() {
    root.innerHTML = '';
    root.className = 'page runpage';
    const resuming = logged.size > 0;
    const card = el('section', 'runcard gatecard');
    card.append(el('div', 'runside', resuming ? 'RESUME' : 'READY'));
    card.append(el('h1', 'runex', 'Day ' + dayNo));
    card.append(el('p', 'nextname', day.name));
    const { done, total } = progressOf(steps, index);
    card.append(el('p', 'runset', resuming
      ? done + ' of ' + total + ' sets already logged'
      : total + ' sets · ' + steps.filter((s) => s.kind === 'rest').length + ' rests'));
    root.append(card);

    const begin = el('button', 'btn btn-primary donebtn', resuming ? '▶  Resume' : '▶  Start');
    begin.onclick = async () => {
      started = true;
      await audio.unlock();
      preloadCues();
      await acquireWakeLock(() => {});
      // The capability probe is two API calls; it must not hold up the start,
      // and a session with no music simply never ducks.
      ducking.begin().catch(() => {});
      draw();
      cueFor(steps[index]);
    };
    root.append(begin);

    const silent = el('button', 'btn', 'Start without voice');
    silent.onclick = async () => {
      started = true;
      await acquireWakeLock(() => {});
      draw();
    };
    root.append(silent);

    const back = el('button', 'btn btn-small', '‹ back to the day');
    back.onclick = () => { location.hash = '#/day/' + dayNo; };
    root.append(back);
  }

  // ---------- drawing ----------
  function draw() {
    if (ticker) { clearInterval(ticker); ticker = null; }
    if (!started) return drawGate();
    root.innerHTML = '';
    root.className = 'page runpage';

    const step = steps[index];
    const { done, total } = progressOf(steps, index);

    const bar = el('div', 'runtop');
    const quit = el('button', 'iconbtn', '✕');
    quit.title = 'Leave the runner (session stays open)';
    quit.onclick = () => {
      audio.stop();
      ducking.end().catch(() => {});
      releaseWakeLock();
      location.hash = '#/day/' + dayNo;
    };
    bar.append(quit);
    bar.append(el('span', 'runprogress', 'Day ' + dayNo + ' · ' + done + '/' + total
      + ' sets · b' + (window.BUILD || '?')));
    const status = el('span', 'lockdot' + (wakeLockLost ? ' lost' : ''),
      (audio.isUnlocked() ? '🔊' : '🔇') + ' ' + (wakeLockLost ? 'screen may sleep' : 'screen held'));
    bar.append(status);
    // duck/restore cycles, so the Phase 6 gate is a number he reads rather
    // than an impression he reports
    const duck = ducking.stats();
    if (duck.ducks) {
      bar.append(el('span', 'duckdot' + (duck.failures ? ' lost' : ''),
        '♪ ' + duck.restores + '/' + duck.ducks + (duck.failures ? ' · ' + duck.failures + ' failed' : '')));
    }
    root.append(bar);

    const track = el('div', 'runtrack');
    const fill = el('div', 'runfill');
    fill.style.width = (total ? (done / total) * 100 : 0) + '%';
    track.append(fill);
    root.append(track);

    if (step.kind === 'summary') return drawSummary();
    if (step.kind === 'rest') return drawRest(step);
    return drawSet(step);
  }

  function drawSet(step) {
    const load = loadFor(step);
    const tgt = stepTarget(step, load);
    // Stretches and holds run their own countdown (Dom, 2026-08-24): the clock
    // starts on its own, pauses if the set-up takes longer, and logs the time
    // ACTUALLY held — never the prescribed number, or a paused hold would
    // report itself as a hit.
    const timed = tgt.kind === 'hold' && tgt.value > 0;
    const effort = tgt.kind === 'effort';
    const card = el('section', 'runcard');

    const side = SIDE_WORD[step.side];
    if (side) card.append(el('div', 'runside', side));
    card.append(el('h1', 'runex', step.label));
    card.append(el('p', 'runset', 'Set ' + step.setIndex + ' of ' + step.totalSets));
    card.append(el('p', 'runtarget',
      tgt.kind === 'hold' ? tgt.value + 's hold'
        : tgt.kind === 'distance' ? tgt.value + ' m'
        : effort ? 'one trip — log the weight'
        : tgt.value + ' reps'));

    let clock = null, playBtn = null, staleNote = null;
    // A hold restored from a force-quit whose target already elapsed while the
    // app was dead: nobody knows how long he actually held it, so the clock
    // stops and he confirms the number by hand.
    const stale = timed && hold && hold.index === index && hold.running
      && holdElapsedMs() >= tgt.value * 1000;
    let edited = false;
    if (timed) {
      clock = el('div', 'holdclock', '');
      card.append(clock);
      playBtn = el('button', 'btn holdbtn', '');
      card.append(playBtn);
      if (stale) {
        staleNote = el('p', 'musicnote bad',
          'The clock ran while the app was closed — check the seconds before logging.');
        card.append(staleNote);
      }
    }

    card.append(el('p', 'instruction', step.block.instruction));
    card.append(el('p', 'feelcue', 'Feel: ' + step.block.feel_cue));

    // prefilled inputs — the happy path is one press, editing is one tap away
    const showWeight = !['bodyweight', 'board', 'band'].includes(step.block.load_type);
    const showBand = step.block.load_type === 'band';
    const fields = el('div', 'fields');
    let wIn = null, bandIn = null;

    if (showWeight) {
      wIn = numberInput('2.5');
      const prev = load.weight_lb ?? query(
        'SELECT weight_lb FROM set_log WHERE exercise_id=? AND side=? AND weight_lb IS NOT NULL ORDER BY id DESC LIMIT 1',
        [step.block.exercise_id, step.side])[0]?.weight_lb;
      if (prev != null && Number.isFinite(Number(prev))) wIn.value = Number(prev);
      fields.append(labelled('Weight (lb)', wIn));
    }
    if (showBand) {
      // bands are logged by their pound rating — always a number, never text
      bandIn = numberInput('5');
      const prev = load.band_level ?? query(
        'SELECT band_level FROM set_log WHERE exercise_id=? AND side=? AND band_level IS NOT NULL ORDER BY id DESC LIMIT 1',
        [step.block.exercise_id, step.side])[0]?.band_level;
      // a legacy value like "green" is not a number: leave the field empty
      // rather than hand a number input something it will silently drop
      if (prev != null && Number.isFinite(Number(prev))) bandIn.value = Number(prev);
      fields.append(labelled('Band (lb)', bandIn));
    }
    let mainIn = null;
    if (!effort) {
      mainIn = numberInput('1');
      mainIn.inputMode = 'numeric';
      mainIn.value = tgt.value ?? '';
      mainIn.addEventListener('input', () => { edited = true; });
      fields.append(labelled(tgt.kind === 'hold' ? 'Hold (s)'
        : tgt.kind === 'distance' ? 'Distance (m)' : 'Reps', mainIn));
    }
    card.append(fields);
    root.append(card);

    const doneBtn = el('button', 'btn btn-primary donebtn', effort ? 'Logged' : 'Done');
    doneBtn.onclick = () => commit(timed ? Math.round(holdElapsedMs() / 1000) : null);
    root.append(doneBtn);

    const nav = el('div', 'runnav');
    const back = el('button', 'btn btn-small', '‹ back');
    back.disabled = index === 0;
    back.onclick = () => go(index - 1);
    const skip = el('button', 'btn btn-small', 'skip ›');
    skip.onclick = () => go(index + 1);
    nav.append(back, skip);
    root.append(nav);

    function commit(elapsed) {
      let val = null;
      if (timed) {
        // the clock is the source of truth — never the prescribed number —
        // unless he typed over it, or it ran on while the app was dead
        val = (stale || edited) ? Number(mainIn.value) : elapsed;
        if (!Number.isFinite(val) || val < 0) return;
      } else if (!effort) {
        val = Number(mainIn.value);
        if (!Number.isFinite(val) || val < 0) return;
      }
      const isHold = tgt.kind === 'hold';
      logSet(db, {
        session_id: session.id,
        block_id: step.block.id,
        exercise_id: step.block.exercise_id,
        side: step.side,
        set_index: step.setIndex,
        weight_lb: wIn && wIn.value !== '' ? Number(wIn.value) : null,
        band_level: bandIn && bandIn.value !== '' ? String(Number(bandIn.value)) : null,
        reps_done: isHold || effort ? null : val,
        hold_seconds_done: isHold ? val : null,
        target_reps: isHold || effort ? null : tgt.value,
        target_hold_seconds: isHold ? tgt.value : null,
        // a sled set carries no counted target: doing it IS the set
        hit_target: effort ? true : val >= (tgt.value ?? 0),
      });
      logged.add(step.block.id + '|' + step.side + '|' + step.setIndex);
      go(index + 1);
    }

    if (!timed) return;

    // ---- the hold clock ----
    if (!hold || hold.index !== index) {
      hold = { index, startedAt: Date.now(), accMs: 0, running: true };
      save();
    } else if (stale) {
      hold = { index, startedAt: Date.now(), accMs: tgt.value * 1000, running: false };
      save();
    }
    const paintHold = () => {
      // go() clears `hold` on the way to the next step; a tick that lands
      // after that must do nothing
      if (!hold) return;
      const left = Math.max(tgt.value - Math.floor(holdElapsedMs() / 1000), 0);
      clock.textContent = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
      clock.classList.toggle('running', hold.running);
      playBtn.textContent = hold.running ? '⏸  Pause' : '▶  Start';
      if (left === 0 && hold.running && !stale) {
        hold.running = false;
        hold.accMs = tgt.value * 1000;
        if (ticker) { clearInterval(ticker); ticker = null; }
        if (navigator.vibrate) navigator.vibrate(200);
        commit(tgt.value);   // the next step's own cue follows immediately
      }
    };
    playBtn.onclick = () => {
      if (hold.running) {
        hold.accMs = holdElapsedMs();
        hold.running = false;
      } else {
        hold.startedAt = Date.now();
        hold.running = true;
      }
      save();
      paintHold();
    };
    ticker = setInterval(paintHold, 250);
    paintHold();
  }

  function drawRest(step) {
    if (!restStartedAt) { restStartedAt = Date.now(); save(); }
    const card = el('section', 'runcard restcard' + (step.main ? ' mainrest' : ''));
    card.append(el('div', 'runside', step.main ? 'MAIN REST' : 'REST'));
    const clock = el('div', 'restclock', '');
    card.append(clock);
    card.append(el('p', 'muted', step.main ? step.after + ' complete' : 'after ' + step.after));
    if (step.main) card.append(el('p', 'restnext', 'Up next: ' + step.nextCategory));
    const next = steps[index + 1];
    if (next && next.kind === 'set') {
      card.append(el('p', 'restnext',
        'Next: ' + next.label + (SIDE_WORD[next.side] ? ' — ' + SIDE_WORD[next.side] : '')
        + ' · set ' + next.setIndex + ' of ' + next.totalSets));
    }
    root.append(card);

    const skip = el('button', 'btn btn-primary donebtn', 'Skip rest');
    skip.onclick = () => go(index + 1);
    root.append(skip);

    // Rest is the only sane moment to touch the music, so the controls appear
    // here and nowhere else in the runner.
    const musicBar = el('div', 'runmusic');
    root.append(musicBar);
    renderMusic(musicBar, { compact: true });

    // wall-clock delta, recomputed every tick — survives iOS throttling
    const paint = () => {
      const left = remainingSeconds(restStartedAt, step.seconds);
      clock.textContent = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
      clock.classList.toggle('done', left === 0);
      // keyed to this rest, so coming back to the app late does not replay it
      if (left <= 10 && left > 0 && warnedAt !== restStartedAt && step.seconds > 12) {
        warnedAt = restStartedAt;
        say(audio.CUE_TEN_SECONDS);
      }
      if (left === 0) {
        skip.textContent = 'Go ›';
        say(audio.CUE_GO);
        if (navigator.vibrate) navigator.vibrate(200);
        clearInterval(ticker);
        ticker = null;
      }
    };
    paint();
    ticker = setInterval(paint, 250);
  }

  function drawSummary() {
    const sets = query('SELECT COUNT(*) c FROM set_log WHERE session_id=?', [session.id])[0].c;
    const hits = query('SELECT COUNT(*) c FROM set_log WHERE session_id=? AND hit_target=1', [session.id])[0].c;
    const missed = query(
      'SELECT e.name, s.side, s.set_index, s.reps_done, s.hold_seconds_done, s.target_reps, s.target_hold_seconds ' +
      'FROM set_log s JOIN exercise e ON e.id=s.exercise_id WHERE s.session_id=? AND s.hit_target=0 ORDER BY s.id',
      [session.id]);

    const card = el('section', 'runcard');
    card.append(el('h1', 'runex', 'Day ' + dayNo + ' complete'));
    card.append(el('p', 'runtarget', sets + ' sets · ' + hits + ' on target'));
    if (missed.length) {
      const list = el('ul', 'missedlist');
      for (const m of missed) {
        const got = m.hold_seconds_done != null ? m.hold_seconds_done + 's' : m.reps_done;
        const want = m.target_hold_seconds != null ? m.target_hold_seconds + 's' : m.target_reps;
        list.append(el('li', null, m.name + (m.side === 'both' ? '' : ' — ' + m.side)
          + ', set ' + m.set_index + ': ' + got + ' of ' + want));
      }
      card.append(el('p', 'cardlabel', 'Missed'));
      card.append(list);
    }
    root.append(card);

    if (session.status === 'in_progress') {
      const fin = el('button', 'btn btn-primary donebtn', 'Finish session');
      fin.onclick = () => {
        finishSession(db, session.id);
        const flags = computeFlags(db, session.id);
        clearRunnerState(db);
        persist();
        ducking.end().catch(() => {});
        releaseWakeLock();
        alert(flags.length
          ? flags.length + (flags.length === 1 ? ' suggestion is' : ' suggestions are') + ' waiting on the home screen.'
          : 'No suggestions yet — a jump needs two clean sessions in a row.');
        location.hash = '#/';
      };
      root.append(fin);
    }
    const back = el('button', 'btn', 'Back to the day');
    back.onclick = () => {
      ducking.end().catch(() => {});
      releaseWakeLock();
      location.hash = '#/day/' + dayNo;
    };
    root.append(back);
  }

  // Every value the runner logs is a number. iOS shows a keypad for these and
  // there is no text field anywhere in set entry.
  function numberInput(stepAttr) {
    const i = document.createElement('input');
    i.type = 'number';
    i.inputMode = 'decimal';
    i.step = stepAttr;
    i.min = '0';
    i.autocomplete = 'off';
    i.setAttribute('autocorrect', 'off');
    i.setAttribute('spellcheck', 'false');
    return i;
  }

  function labelled(text, input) {
    const wrap = el('label', 'field');
    wrap.append(el('span', null, text), input);
    return wrap;
  }

  // wake lock: acquire now, re-acquire whenever the app comes back to the front
  acquireWakeLock(() => {
    const dot = document.querySelector('.lockdot');
    if (dot) {
      dot.className = 'lockdot' + (wakeLockLost ? ' lost' : '');
      dot.textContent = (audio.isUnlocked() ? '🔊' : '🔇') + ' '
        + (wakeLockLost ? 'screen may sleep' : 'screen held');
    }
  });
  const onVisible = () => {
    if (document.visibilityState !== 'visible') return;
    if (!location.hash.startsWith('#/run/')) return;
    acquireWakeLock(() => {});
    draw();   // recompute the timer from wall-clock, never from ticks
  };
  document.addEventListener('visibilitychange', onVisible);

  draw();
}
