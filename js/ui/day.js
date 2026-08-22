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
  power: 'Power / force production',
  finisher: 'Finisher',
  core: 'Core / pelvis',
  calves: 'Calves / ankle / tibialis',
  glutes: 'Glutes',
  close: 'Close every night with',
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

  let session = null;
  let setLogs = new Map();   // block_id|side|set_index -> row
  let nightLogs = new Map(); // drill|side -> row
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

  root.innerHTML = '';
  root.className = 'page';

  const header = el('header', 'top');
  const back = el('a', 'back', '‹ Home');
  back.href = '#/';
  header.append(back);
  header.append(el('h1', null, isNightly ? 'Nightly' : 'Day ' + dayNo));
  header.append(el('p', 'muted', day.name));
  if (!isNightly && session) {
    const chip = el('span', 'chip chip-' + session.status, session.status.replace('_', ' '));
    header.append(chip);
    if (session.status === 'in_progress') {
      const fin = el('button', 'btn btn-small', 'Finish session');
      fin.onclick = async () => {
        await exec("UPDATE session SET status='complete', ended_at=? WHERE id=?",
          [new Date().toISOString(), session.id]);
        renderDay(root, dayNo);
      };
      header.append(fin);
    }
  }
  root.append(header);

  let lastSection = null;
  for (const b of blocks) {
    const key = sectionKey(b);
    if (key !== lastSection) {
      root.append(el('h2', 'section', SECTION_LABELS[key] || key));
      lastSection = key;
    }
    const card = el('section', 'blockcard');
    const head = el('div', 'blockhead');
    head.append(el('span', 'blockcode', b.block_code));
    head.append(el('span', 'blockname', b.ex_name));
    if (b.bias_side) head.append(el('span', 'chip chip-bias', b.bias_side[0].toUpperCase() + ' first'));
    card.append(head);

    const targets = query('SELECT * FROM block_target WHERE block_id = ? ORDER BY id', [b.id]);
    // biased side's targets render (and get done) first
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
    root.append(card);
  }

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
    let wIn, bandIn, mainIn;

    if (showWeight) {
      wIn = document.createElement('input');
      wIn.type = 'number'; wIn.inputMode = 'decimal'; wIn.step = '2.5'; wIn.min = '0';
      wIn.placeholder = 'weight lb';
      const prev = existing?.weight_lb ?? query(
        'SELECT weight_lb FROM set_log WHERE exercise_id=? AND side=? AND weight_lb IS NOT NULL ORDER BY id DESC LIMIT 1',
        [block.exercise_id, target.side])[0]?.weight_lb;
      if (prev != null) wIn.value = prev;
      fields.append(label('Weight (lb)', wIn));
    }
    if (showBand) {
      bandIn = document.createElement('input');
      bandIn.type = 'text'; bandIn.placeholder = 'band (color/lb)';
      const prev = existing?.band_level ?? query(
        'SELECT band_level FROM set_log WHERE exercise_id=? AND side=? AND band_level IS NOT NULL ORDER BY id DESC LIMIT 1',
        [block.exercise_id, target.side])[0]?.band_level;
      if (prev != null) bandIn.value = prev;
      fields.append(label('Band', bandIn));
    }

    mainIn = document.createElement('input');
    mainIn.type = 'number'; mainIn.inputMode = 'numeric'; mainIn.min = '0';
    const mainLabel = isDist ? 'Distance (m)' : isTimed ? 'Hold (seconds)' : 'Reps';
    if (isNightly) {
      mainIn.value = existing?.value ?? (target.hold_seconds || target.reps || '');
    } else if (existing) {
      mainIn.value = isTimed ? existing.hold_seconds_done : existing.reps_done;
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
