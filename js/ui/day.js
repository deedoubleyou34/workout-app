import { query, exec } from '../db.js';

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function today() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
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
  if (isTimed || t.hold_seconds) return side + t.sets + '×' + (t.hold_seconds || '?') + 's';
  return side + t.sets + '×' + t.reps;
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

  let session = null;
  const setLogs = new Map();   // block_id|side|set_index -> row
  const nightLogs = new Map(); // drill|side -> row
  if (!isNightly) {
    session = query(
      'SELECT * FROM session WHERE day_no = ? AND date = ? ORDER BY id DESC LIMIT 1',
      [dayNo, today()]
    )[0] || null;
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
    const id = await exec(
      "INSERT INTO session (date, day_no, status, started_at) VALUES (?, ?, 'in_progress', ?)",
      [today(), dayNo, new Date().toISOString()]
    );
    session = { id, date: today(), day_no: dayNo, status: 'in_progress' };
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
  const back = el('a', 'back', '‹ Home');
  back.href = '#/';
  header.append(back);
  const titleRow = el('div', 'titlerow');
  titleRow.append(el('h1', null, isNightly ? 'Nightly' : 'Day ' + dayNo));
  if (!isNightly && session) {
    titleRow.append(el('span', 'chip chip-' + session.status, session.status.replace('_', ' ')));
    if (session.status === 'in_progress') {
      const fin = el('button', 'btn btn-small', 'Finish session');
      fin.onclick = async () => {
        await exec("UPDATE session SET status='complete', ended_at=? WHERE id=?",
          [new Date().toISOString(), session.id]);
        renderDay(root, dayNo);
      };
      titleRow.append(fin);
    }
  }
  header.append(titleRow);
  header.append(el('p', 'muted', day.name));
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

  // ---------- single exercise card ----------
  const b = sec.blocks[st.idx];
  const card = el('section', 'blockcard blockcard-solo');
  const head = el('div', 'blockhead');
  head.append(el('span', 'blockcode', b.block_code));
  head.append(el('span', 'blockname', b.ex_name));
  if (b.bias_side) head.append(el('span', 'chip chip-bias', b.bias_side[0].toUpperCase() + ' first'));
  card.append(head);

  const targets = query('SELECT * FROM block_target WHERE block_id = ? ORDER BY id', [b.id]);
  const ordered = b.bias_side
    ? [...targets].sort((a, c) => (a.side === b.bias_side ? -1 : c.side === b.bias_side ? 1 : 0))
    : targets;

  const meta = ordered.map((t) => targetText(t, b.is_timed)).join(' · ')
    + (b.rest_seconds_after ? ' · rest ' + b.rest_seconds_after + 's' : '');
  card.append(el('p', 'targets', meta));
  card.append(el('p', 'instruction', b.instruction));
  card.append(el('p', 'feelcue', 'Feel: ' + b.feel_cue));

  for (const t of ordered) {
    const row = el('div', 'setrow');
    row.append(el('span', 'sidelabel', t.side === 'both' ? '—' : t.side[0].toUpperCase()));
    if (isNightly) {
      const logged = nightLogs.get(b.ex_name + '|' + t.side);
      const btn = el('button', 'setbtn' + (logged ? ' hit' : ''),
        logged ? logged.value + (logged.unit === 'sec' ? 's' : '') + ' ✓' : 'log');
      btn.onclick = () => openSheet(b, t, 1, logged || null);
      row.append(btn);
    } else {
      for (let i = 1; i <= t.sets; i++) {
        const logged = setLogs.get(b.id + '|' + t.side + '|' + i);
        let label = String(i);
        if (logged) {
          label = logged.hold_seconds_done != null
            ? logged.hold_seconds_done + 's'
            : (logged.weight_lb ? logged.weight_lb + '×' : '') + logged.reps_done;
        }
        const btn = el('button', 'setbtn' + (logged ? (logged.hit_target ? ' hit' : ' miss') : ''), label);
        btn.onclick = () => openSheet(b, t, i, logged || null);
        row.append(btn);
      }
    }
    card.append(row);
  }

  // swipe left/right moves between exercises
  let touchX = null, touchY = null;
  card.addEventListener('touchstart', (e) => {
    touchX = e.touches[0].clientX;
    touchY = e.touches[0].clientY;
  }, { passive: true });
  card.addEventListener('touchend', (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    const dy = e.changedTouches[0].clientY - touchY;
    touchX = touchY = null;
    if (Math.abs(dx) > 60 && Math.abs(dy) < 50) go(dx < 0 ? 1 : -1);
  }, { passive: true });

  root.append(card);
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

    if (showWeight) {
      wIn = document.createElement('input');
      wIn.type = 'number'; wIn.inputMode = 'decimal'; wIn.step = '2.5'; wIn.min = '0';
      wIn.placeholder = 'weight lb';
      const prev2 = existing?.weight_lb ?? query(
        'SELECT weight_lb FROM set_log WHERE exercise_id=? AND side=? AND weight_lb IS NOT NULL ORDER BY id DESC LIMIT 1',
        [block.exercise_id, target.side])[0]?.weight_lb;
      if (prev2 != null) wIn.value = prev2;
      fields.append(label('Weight (lb)', wIn));
    }
    if (showBand) {
      bandIn = document.createElement('input');
      bandIn.type = 'text'; bandIn.placeholder = 'band (color/lb)';
      const prev2 = existing?.band_level ?? query(
        'SELECT band_level FROM set_log WHERE exercise_id=? AND side=? AND band_level IS NOT NULL ORDER BY id DESC LIMIT 1',
        [block.exercise_id, target.side])[0]?.band_level;
      if (prev2 != null) bandIn.value = prev2;
      fields.append(label('Band', bandIn));
    }

    const mainIn = document.createElement('input');
    mainIn.type = 'number'; mainIn.inputMode = 'numeric'; mainIn.min = '0';
    const mainLabel = isDist ? 'Distance (m)' : isTimed ? 'Hold (seconds)' : 'Reps';
    if (isNightly) {
      mainIn.value = existing?.value ?? (target.hold_seconds || target.reps || '');
    } else if (existing) {
      mainIn.value = existing.hold_seconds_done != null ? existing.hold_seconds_done : existing.reps_done;
    } else {
      mainIn.value = isDist ? target.distance_m : isTimed ? target.hold_seconds : target.reps;
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
        const targetReps = isDist ? target.distance_m : target.reps;
        const hit = isTimed
          ? (val >= (target.hold_seconds || 0) ? 1 : 0)
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
            isTimed ? target.hold_seconds : null,
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
