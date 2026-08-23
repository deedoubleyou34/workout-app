import { query, exec, getDb, persist } from '../db.js';
import { computeFlags } from '../progression.js';
import { activeSession, lastCompleted, startSession, finishSession, startOver, today } from '../sessions.js';

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

const SECTION_LABELS = {
  warmup: 'Warm-up',
  1: 'Superset A',
  2: 'Superset B',
  3: 'Superset C',
  knee: 'Knee / tendon',
  power: 'Power',
  finisher: 'Finisher',
  core: 'Core / pelvis',
  calves: 'Calves / ankle',
  glutes: 'Glutes',
  close: 'Close',
};

const TAB_LABELS = {
  warmup: 'Warm-up',
  1: 'A',
  2: 'B',
  3: 'C',
  knee: 'Knee',
  power: 'Power',
  finisher: 'Finish',
  core: 'Core',
  calves: 'Calves',
  glutes: 'Glutes',
  close: 'Close',
};

function sectionKey(block) {
  return block.superset_group ? block.superset_group : block.block_code;
}

function targetText(t, isTimed) {
  const side = t.side === 'both' ? '' : t.side[0].toUpperCase() + ' ';
  if (t.distance_m) return side + t.sets + '×' + t.distance_m + 'm';
  if (isTimed || t.hold_seconds) return side + t.sets + '×' + (effHold(t) || '?') + 's';
  return side + t.sets + '×' + effReps(t);
}

// Accepted progression suggestions live in current_load and override the
// seeded target. The seed itself is never rewritten (§4.3).
const loadByPair = new Map();   // exercise_id|side -> current_load row
function loadFor(exerciseId, side) {
  return loadByPair.get(exerciseId + '|' + side) || {};
}
function effReps(t) {
  return t._load && t._load.reps != null ? t._load.reps : t.reps;
}
function effHold(t) {
  return t._load && t._load.hold_seconds != null ? t._load.hold_seconds : t.hold_seconds;
}
function progressed(t, isTimed) {
  if (!t._load) return false;
  return isTimed || t.hold_seconds
    ? (t._load.hold_seconds != null && t._load.hold_seconds !== t.hold_seconds)
    : (t._load.reps != null && t._load.reps !== t.reps);
}

// per-day view position (section + exercise index), survives re-renders after saves
const viewState = new Map();

export function renderDay(root, dayNo) {
  const day = query('SELECT * FROM day_template WHERE day_no = ?', [dayNo])[0];
  if (!day) {
    location.hash = '#/';
    return;
  }
  const isNightly = dayNo === 0;
  const blocks = query(
    'SELECT b.*, e.name ex_name, e.is_timed, e.load_type, e.instruction, e.feel_cue ' +
    'FROM block b JOIN exercise e ON e.id = b.exercise_id ' +
    'WHERE b.day_template_id = ? ORDER BY b.order_index', [day.id]
  );

  // group consecutive blocks into ordered sections
  const sections = [];
  for (const b of blocks) {
    const key = sectionKey(b);
    if (!sections.length || sections[sections.length - 1].key !== key) {
      sections.push({ key, blocks: [] });
    }
    sections[sections.length - 1].blocks.push(b);
  }

  let st = viewState.get(dayNo);
  if (!st || !sections.some((s) => s.key === st.section)) {
    st = { section: sections[0].key, idx: 0 };
  }
  let sec = sections.find((s) => s.key === st.section);
  if (st.idx >= sec.blocks.length) st.idx = sec.blocks.length - 1;
  viewState.set(dayNo, st);

  loadByPair.clear();
  for (const cl of query('SELECT * FROM current_load')) {
    loadByPair.set(cl.exercise_id + '|' + cl.side, cl);
  }

  let session = null;
  const setLogs = new Map();   // block_id|side|set_index -> row
  const nightLogs = new Map(); // drill|side -> row
  if (!isNightly) {
    // only a live session fills the grid — a finished day resets for next time
    session = activeSession(getDb(), dayNo);
    if (session) {
      for (const r of query('SELECT * FROM set_log WHERE session_id = ?', [session.id])) {
        setLogs.set(r.block_id + '|' + r.side + '|' + r.set_index, r);
      }
    }
  } else {
    for (const r of query('SELECT * FROM nightly_log WHERE date = ?', [today()])) {
      nightLogs.set(r.drill + '|' + (r.side || 'both'), r);
    }
  }

  async function getOrCreateSession() {
    if (session && session.status === 'in_progress') return session;
    session = startSession(getDb(), dayNo);
    await persist();
    return session;
  }

  function blockDone(b) {
    const targets = query('SELECT * FROM block_target WHERE block_id = ? ORDER BY id', [b.id]);
    if (isNightly) {
      return targets.every((t) => nightLogs.has(b.ex_name + '|' + t.side));
    }
    return targets.every((t) => {
      for (let i = 1; i <= t.sets; i++) {
        if (!setLogs.has(b.id + '|' + t.side + '|' + i)) return false;
      }
      return true;
    });
  }

  root.innerHTML = '';
  root.className = 'page';

  const header = el('header', 'top');
  const navRow = el('div', 'navrow');
  const back = el('a', 'back', '‹ Home');
  back.href = '#/';
  navRow.append(back);
  const refresh = el('button', 'iconbtn', '↻');
  refresh.title = 'Reload from the database and check for an app update';
  refresh.onclick = async () => {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) reg.update().catch(() => {});
    }
    renderDay(root, dayNo);
  };
  navRow.append(refresh);
  header.append(navRow);

  const titleRow = el('div', 'titlerow');
  titleRow.append(el('h1', null, isNightly ? 'Nightly' : 'Day ' + dayNo));
  if (!isNightly && session) {
    titleRow.append(el('span', 'chip chip-' + session.status, session.status.replace('_', ' ')));
  }
  header.append(titleRow);
  header.append(el('p', 'muted', day.name));

  if (!isNightly) {
    const done = lastCompleted(getDb(), dayNo);
    if (done && !session) {
      header.append(el('p', 'lastdone',
        'Last completed ' + (done.daysAgo === 0 ? 'today' : done.daysAgo === 1 ? 'yesterday'
          : done.daysAgo + ' days ago') + ' — ' + done.sets + ' sets, ' + done.hits
        + ' on target. Targets below include any progressions you accepted.'));
    }

    const controls = el('div', 'btnrow');
    const loggedCount = setLogs.size;

    const run = el('a', 'btn btn-primary btn-small', session && loggedCount ? '▶ Resume runner' : '▶ Run session');
    run.href = '#/run/' + dayNo;
    controls.append(run);

    if (!session) {
      const start = el('button', 'btn btn-small', 'Start session');
      start.onclick = async () => {
        await getOrCreateSession();
        renderDay(root, dayNo);
      };
      controls.append(start);
    } else if (session.status === 'in_progress') {
      const fin = el('button', 'btn btn-small', 'Finish session');
      fin.onclick = async () => {
        const hits = query('SELECT COUNT(*) c FROM set_log WHERE session_id=? AND hit_target=1',
          [session.id])[0].c;
        finishSession(getDb(), session.id);
        const flags = computeFlags(getDb(), session.id);
        await persist();
        alert('Day ' + dayNo + ' complete — ' + loggedCount + ' sets, ' + hits + ' on target.\n\n'
          + (flags.length
            ? flags.length + (flags.length === 1 ? ' suggestion is' : ' suggestions are') + ' waiting on the home screen.'
            : 'No suggestions yet — a jump needs two clean sessions in a row.'));
        renderDay(root, dayNo);
      };
      controls.append(fin);
    }

    if (session && loggedCount) {
      const over = el('button', 'btn btn-small btn-danger', 'Start over');
      over.onclick = async () => {
        if (!confirm('Start Day ' + dayNo + ' over? The ' + loggedCount
          + ' sets you logged stay in your history but will not count toward progression.')) return;
        startOver(getDb(), dayNo);
        await persist();
        renderDay(root, dayNo);
      };
      controls.append(over);
    }
    if (controls.childNodes.length) header.append(controls);
  }
  root.append(header);

  // ---------- section tabs ----------
  const tabs = el('div', 'tabs');
  for (const s of sections) {
    const done = s.blocks.every(blockDone);
    const tab = el('button',
      'tab' + (s.key === st.section ? ' active' : '') + (done ? ' done' : ''),
      TAB_LABELS[s.key] || s.key);
    tab.onclick = () => {
      st.section = s.key;
      st.idx = 0;
      renderDay(root, dayNo);
    };
    tabs.append(tab);
  }
  root.append(tabs);

  // ---------- pager within the section ----------
  function go(delta) {
    let si = sections.indexOf(sec);
    let i = st.idx + delta;
    while (i < 0 && si > 0) { si--; i = sections[si].blocks.length - 1; }
    while (i >= sections[si].blocks.length && si < sections.length - 1) { si++; i = 0; }
    if (i < 0 || i >= sections[si].blocks.length) return;
    st.section = sections[si].key;
    st.idx = i;
    renderDay(root, dayNo);
  }

  const pager = el('div', 'pager');
  const prev = el('button', 'btn pagerbtn', '‹');
  prev.disabled = sections.indexOf(sec) === 0 && st.idx === 0;
  prev.onclick = () => go(-1);
  const next = el('button', 'btn pagerbtn', '›');
  next.disabled = sections.indexOf(sec) === sections.length - 1 && st.idx === sec.blocks.length - 1;
  next.onclick = () => go(1);
  pager.append(prev,
    el('span', 'pagerlabel', (SECTION_LABELS[sec.key] || sec.key) + ' · ' + (st.idx + 1) + ' / ' + sec.blocks.length),
    next);
  root.append(pager);

  // ---------- single exercise: three separate cards ----------
  const b = sec.blocks[st.idx];
  const stack = el('div', 'cardstack');

  const targets = query('SELECT * FROM block_target WHERE block_id = ? ORDER BY id', [b.id]);
  for (const t of targets) t._load = loadFor(b.exercise_id, t.side);
  const ordered = b.bias_side
    ? [...targets].sort((a, c) => (a.side === b.bias_side ? -1 : c.side === b.bias_side ? 1 : 0))
    : targets;

  // 1 — the exercise
  const exCard = el('section', 'blockcard');
  const head = el('div', 'blockhead');
  head.append(el('span', 'blockcode', b.block_code));
  head.append(el('span', 'blockname', b.ex_name));
  if (b.bias_side) head.append(el('span', 'chip chip-bias', b.bias_side[0].toUpperCase() + ' first'));
  exCard.append(head);
  const meta = ordered.map((t) => targetText(t, b.is_timed)).join(' · ')
    + (b.rest_seconds_after ? ' · rest ' + b.rest_seconds_after + 's' : '');
  exCard.append(el('p', 'targets', meta));
  stack.append(exCard);

  // 2 — how-to + feel
  const howCard = el('section', 'blockcard howcard');
  howCard.append(el('h3', 'cardlabel', 'How'));
  howCard.append(el('p', 'instruction', b.instruction));
  howCard.append(el('p', 'feelcue', 'Feel: ' + b.feel_cue));
  stack.append(howCard);

  // 3 — set log, one aligned column per set number
  const logCard = el('section', 'blockcard logcard');
  logCard.append(el('h3', 'cardlabel', 'Set log'));
  const maxSets = isNightly ? 1 : Math.max(...ordered.map((t) => t.sets));
  const grid = el('div', 'setgrid');
  grid.style.gridTemplateColumns = 'auto repeat(' + maxSets + ', minmax(52px, 1fr))';
  if (!isNightly && maxSets > 1) {
    grid.append(el('span', 'gridhead', ''));
    for (let i = 1; i <= maxSets; i++) grid.append(el('span', 'gridhead', 'set ' + i));
  }
  for (const t of ordered) {
    const sideLabel = t.side === 'both' ? '—' : t.side[0].toUpperCase();
    grid.append(el('span', 'sidelabel', sideLabel + ' · ' + targetText(t, b.is_timed).replace(/^[LR] /, '')));
    if (isNightly) {
      const logged = nightLogs.get(b.ex_name + '|' + t.side);
      const btn = el('button', 'setbtn' + (logged ? ' hit' : ''),
        logged ? logged.value + (logged.unit === 'sec' ? 's' : '') + ' ✓' : 'log');
      btn.onclick = () => openSheet(b, t, 1, logged || null);
      grid.append(btn);
    } else {
      for (let i = 1; i <= maxSets; i++) {
        if (i > t.sets) {
          grid.append(el('span', 'setpad', ''));
          continue;
        }
        const logged = setLogs.get(b.id + '|' + t.side + '|' + i);
        let label = String(i);
        if (logged) {
          label = logged.hold_seconds_done != null
            ? logged.hold_seconds_done + 's'
            : (logged.weight_lb ? logged.weight_lb + '×' : '') + logged.reps_done;
        }
        const btn = el('button', 'setbtn' + (logged ? (logged.hit_target ? ' hit' : ' miss') : ''), label);
        btn.onclick = () => openSheet(b, t, i, logged || null);
        grid.append(btn);
      }
    }
  }
  logCard.append(grid);
  stack.append(logCard);

  // swipe left/right moves between exercises
  let touchX = null, touchY = null;
  stack.addEventListener('touchstart', (e) => {
    touchX = e.touches[0].clientX;
    touchY = e.touches[0].clientY;
  }, { passive: true });
  stack.addEventListener('touchend', (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    const dy = e.changedTouches[0].clientY - touchY;
    touchX = touchY = null;
    if (Math.abs(dx) > 60 && Math.abs(dy) < 50) go(dx < 0 ? 1 : -1);
  }, { passive: true });

  root.append(stack);
  window.scrollTo(0, 0);

  // ---------- bottom-sheet set entry ----------
  function openSheet(block, target, setIndex, existing) {
    document.querySelector('.sheet')?.remove();
    const sheet = el('div', 'sheet');
    const sideTxt = target.side === 'both' ? '' : ' — ' + target.side;
    sheet.append(el('h3', null, block.ex_name + sideTxt +
      (isNightly ? '' : ' · set ' + setIndex + '/' + target.sets)));

    const isDist = !!target.distance_m;
    // per-target, not per-exercise: 90/90 mixes reps and per-side holds
    const isTimed = !!block.is_timed || target.hold_seconds != null;
    const showWeight = !isNightly && !['bodyweight', 'board', 'band'].includes(block.load_type);
    const showBand = !isNightly && block.load_type === 'band';

    const fields = el('div', 'fields');
    let wIn, bandIn;

    // Approved load (an accepted suggestion) wins over whatever was last logged.
    const approved = loadFor(block.exercise_id, target.side);

    if (showWeight) {
      wIn = document.createElement('input');
      wIn.type = 'number'; wIn.inputMode = 'decimal'; wIn.step = '2.5'; wIn.min = '0';
      wIn.placeholder = 'weight lb';
      const prev2 = existing?.weight_lb ?? approved.weight_lb ?? query(
        'SELECT weight_lb FROM set_log WHERE exercise_id=? AND side=? AND weight_lb IS NOT NULL ORDER BY id DESC LIMIT 1',
        [block.exercise_id, target.side])[0]?.weight_lb;
      if (prev2 != null) wIn.value = prev2;
      fields.append(label('Weight (lb)', wIn));
    }
    if (showBand) {
      // bands are logged by their pound rating — always a number, never text
      bandIn = document.createElement('input');
      bandIn.type = 'number'; bandIn.inputMode = 'decimal'; bandIn.step = '5'; bandIn.min = '0';
      bandIn.placeholder = 'band lb';
      const prev2 = existing?.band_level ?? approved.band_level ?? query(
        'SELECT band_level FROM set_log WHERE exercise_id=? AND side=? AND band_level IS NOT NULL ORDER BY id DESC LIMIT 1',
        [block.exercise_id, target.side])[0]?.band_level;
      if (prev2 != null) bandIn.value = prev2;
      fields.append(label('Band', bandIn));
    }

    const mainIn = document.createElement('input');
    mainIn.type = 'number'; mainIn.inputMode = 'numeric'; mainIn.min = '0';
    const mainLabel = isDist ? 'Distance (m)' : isTimed ? 'Hold (seconds)' : 'Reps';
    const tgtHold = effHold(target);
    const tgtReps = effReps(target);
    if (isNightly) {
      mainIn.value = existing?.value ?? (tgtHold || tgtReps || '');
    } else if (existing) {
      mainIn.value = existing.hold_seconds_done != null ? existing.hold_seconds_done : existing.reps_done;
    } else {
      mainIn.value = isDist ? target.distance_m : isTimed ? tgtHold : tgtReps;
    }
    fields.append(label(mainLabel, mainIn));
    sheet.append(fields);

    const row = el('div', 'btnrow');
    const save = el('button', 'btn btn-primary', existing && !isNightly ? 'Log correction' : 'Save');
    const cancel = el('button', 'btn', 'Cancel');
    cancel.onclick = () => sheet.remove();
    save.onclick = async () => {
      const val = Number(mainIn.value);
      if (!Number.isFinite(val) || val < 0) return;
      if (isNightly) {
        await exec(
          'INSERT OR REPLACE INTO nightly_log (date, drill, side, value, unit) VALUES (?,?,?,?,?)',
          [today(), block.ex_name, target.side, val, isTimed ? 'sec' : 'rep']
        );
      } else {
        const s = await getOrCreateSession();
        const targetReps = isDist ? target.distance_m : tgtReps;
        const hit = isTimed
          ? (val >= (tgtHold || 0) ? 1 : 0)
          : (val >= (targetReps || 0) ? 1 : 0);
        // set_log is append-only: a re-log of the same set is a new row + note
        await exec(
          'INSERT INTO set_log (session_id, block_id, exercise_id, side, set_index, weight_lb, band_level, ' +
          'reps_done, hold_seconds_done, target_reps, target_hold_seconds, hit_target, notes, logged_at) ' +
          'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          [s.id, block.id, block.exercise_id, target.side, setIndex,
            wIn && wIn.value !== '' ? Number(wIn.value) : null,
            bandIn && bandIn.value !== '' ? bandIn.value : null,
            isTimed ? null : val,
            isTimed ? val : null,
            isTimed ? null : targetReps,
            isTimed ? tgtHold : null,
            hit,
            existing ? 'correction of earlier entry' : null,
            new Date().toISOString()]
        );
      }
      renderDay(root, dayNo);
    };
    row.append(save, cancel);
    sheet.append(row);
    root.append(sheet);
    mainIn.focus();
  }

  function label(text, input) {
    const wrap = el('label', 'field');
    wrap.append(el('span', null, text), input);
    return wrap;
  }
}
