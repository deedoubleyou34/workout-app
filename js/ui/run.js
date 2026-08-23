import { query, getDb, persist } from '../db.js';
import { computeFlags } from '../progression.js';
import { currentSession, startSession, finishSession, logSet,
         saveRunnerState, loadRunnerState, clearRunnerState } from '../sessions.js';
import { buildSteps, stepTarget, remainingSeconds, resumeIndex, progressOf } from '../runner.js';

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

  function save() {
    saveRunnerState(db, { session_id: session.id, index, restStartedAt });
    persist();
  }

  function go(next) {
    index = Math.max(0, Math.min(next, steps.length - 1));
    restStartedAt = steps[index] && steps[index].kind === 'rest' ? Date.now() : null;
    save();
    draw();
  }

  // ---------- drawing ----------
  function draw() {
    if (ticker) { clearInterval(ticker); ticker = null; }
    root.innerHTML = '';
    root.className = 'page runpage';

    const step = steps[index];
    const { done, total } = progressOf(steps, index);

    const bar = el('div', 'runtop');
    const quit = el('button', 'iconbtn', '✕');
    quit.title = 'Leave the runner (session stays open)';
    quit.onclick = () => {
      releaseWakeLock();
      location.hash = '#/day/' + dayNo;
    };
    bar.append(quit);
    bar.append(el('span', 'runprogress', 'Day ' + dayNo + ' · ' + done + '/' + total + ' sets'));
    const lockDot = el('span', 'lockdot' + (wakeLockLost ? ' lost' : ''),
      wakeLockLost ? 'screen may sleep' : 'screen held');
    bar.append(lockDot);
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
    const card = el('section', 'runcard');

    const side = SIDE_WORD[step.side];
    if (side) card.append(el('div', 'runside', side));
    card.append(el('h1', 'runex', step.label));
    card.append(el('p', 'runset', 'Set ' + step.setIndex + ' of ' + step.totalSets));
    card.append(el('p', 'runtarget', tgt.value + (tgt.kind === 'hold' ? 's hold'
      : tgt.kind === 'distance' ? ' m' : ' reps')));

    card.append(el('p', 'instruction', step.block.instruction));
    card.append(el('p', 'feelcue', 'Feel: ' + step.block.feel_cue));

    // prefilled inputs — the happy path is one press, editing is one tap away
    const showWeight = !['bodyweight', 'board', 'band'].includes(step.block.load_type);
    const showBand = step.block.load_type === 'band';
    const fields = el('div', 'fields');
    let wIn = null, bandIn = null;

    if (showWeight) {
      wIn = document.createElement('input');
      wIn.type = 'number'; wIn.inputMode = 'decimal'; wIn.step = '2.5'; wIn.min = '0';
      const prev = load.weight_lb ?? query(
        'SELECT weight_lb FROM set_log WHERE exercise_id=? AND side=? AND weight_lb IS NOT NULL ORDER BY id DESC LIMIT 1',
        [step.block.exercise_id, step.side])[0]?.weight_lb;
      if (prev != null) wIn.value = prev;
      fields.append(labelled('Weight (lb)', wIn));
    }
    if (showBand) {
      bandIn = document.createElement('input');
      bandIn.type = 'text';
      const prev = load.band_level ?? query(
        'SELECT band_level FROM set_log WHERE exercise_id=? AND side=? AND band_level IS NOT NULL ORDER BY id DESC LIMIT 1',
        [step.block.exercise_id, step.side])[0]?.band_level;
      if (prev != null) bandIn.value = prev;
      fields.append(labelled('Band', bandIn));
    }
    const mainIn = document.createElement('input');
    mainIn.type = 'number'; mainIn.inputMode = 'numeric'; mainIn.min = '0';
    mainIn.value = tgt.value ?? '';
    fields.append(labelled(tgt.kind === 'hold' ? 'Hold (s)' : tgt.kind === 'distance' ? 'Distance (m)' : 'Reps', mainIn));
    card.append(fields);
    root.append(card);

    const done = el('button', 'btn btn-primary donebtn', 'Done');
    done.onclick = () => {
      const val = Number(mainIn.value);
      if (!Number.isFinite(val) || val < 0) return;
      const isHold = tgt.kind === 'hold';
      logSet(db, {
        session_id: session.id,
        block_id: step.block.id,
        exercise_id: step.block.exercise_id,
        side: step.side,
        set_index: step.setIndex,
        weight_lb: wIn && wIn.value !== '' ? Number(wIn.value) : null,
        band_level: bandIn && bandIn.value !== '' ? bandIn.value : null,
        reps_done: isHold ? null : val,
        hold_seconds_done: isHold ? val : null,
        target_reps: isHold ? null : tgt.value,
        target_hold_seconds: isHold ? tgt.value : null,
        hit_target: val >= (tgt.value ?? 0),
      });
      logged.add(step.block.id + '|' + step.side + '|' + step.setIndex);
      go(index + 1);
    };
    root.append(done);

    const nav = el('div', 'runnav');
    const back = el('button', 'btn btn-small', '‹ back');
    back.disabled = index === 0;
    back.onclick = () => go(index - 1);
    const skip = el('button', 'btn btn-small', 'skip ›');
    skip.onclick = () => go(index + 1);
    nav.append(back, skip);
    root.append(nav);
  }

  function drawRest(step) {
    if (!restStartedAt) { restStartedAt = Date.now(); save(); }
    const card = el('section', 'runcard restcard');
    card.append(el('div', 'runside', 'REST'));
    const clock = el('div', 'restclock', '');
    card.append(clock);
    card.append(el('p', 'muted', 'after ' + step.after));
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

    // wall-clock delta, recomputed every tick — survives iOS throttling
    const paint = () => {
      const left = remainingSeconds(restStartedAt, step.seconds);
      clock.textContent = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
      clock.classList.toggle('done', left === 0);
      if (left === 0) {
        skip.textContent = 'Go ›';
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
        releaseWakeLock();
        alert(flags.length
          ? flags.length + (flags.length === 1 ? ' suggestion is' : ' suggestions are') + ' waiting on the home screen.'
          : 'No suggestions yet — a jump needs two clean sessions in a row.');
        location.hash = '#/';
      };
      root.append(fin);
    }
    const back = el('button', 'btn', 'Back to the day');
    back.onclick = () => { releaseWakeLock(); location.hash = '#/day/' + dayNo; };
    root.append(back);
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
      dot.textContent = wakeLockLost ? 'screen may sleep' : 'screen held';
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
