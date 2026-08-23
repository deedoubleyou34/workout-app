// Machine-checkable Phase 1 gate items, run against the real schema + seed.
// Usage: node tools/verify_seed.mjs   (from the repo root)
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { seed, EXERCISES, DAYS } from '../js/seed.js';
import { buildSteps } from '../js/runner.js';

const require = createRequire(import.meta.url);
const initSqlJs = require('../vendor/sql-wasm.js');

const SQL = await initSqlJs({ locateFile: (f) => 'vendor/' + f });
const db = new SQL.Database();
db.run(readFileSync('js/schema.sql', 'utf8'));
seed(db);

let failures = 0;
function check(name, ok, detail = '') {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  [' + detail + ']' : ''));
  if (!ok) failures++;
}
function one(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  stmt.step();
  const row = stmt.getAsObject();
  stmt.free();
  return row;
}
function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

// -- counts --
check('5 day templates (4 days + nightly)', one('SELECT COUNT(*) c FROM day_template').c === 5);
const exCount = one('SELECT COUNT(*) c FROM exercise').c;
check('exercise count matches seed source', exCount === EXERCISES.length, exCount + ' rows');
const blockCount = one('SELECT COUNT(*) c FROM block').c;
const expectedBlocks = DAYS.reduce((n, d) => n + d.blocks.length, 0);
check('block count matches seed source', blockCount === expectedBlocks, blockCount + ' rows');

// -- no orphan exercises, none missing --
const orphans = all('SELECT name FROM exercise WHERE id NOT IN (SELECT exercise_id FROM block)');
check('every exercise appears in at least one block', orphans.length === 0, orphans.map(o => o.name).join(', '));

// -- instruction / feel_cue non-empty everywhere --
const noInstr = one("SELECT COUNT(*) c FROM exercise WHERE instruction IS NULL OR instruction = '' OR feel_cue IS NULL OR feel_cue = ''").c;
check('every exercise has non-empty instruction + feel_cue', noInstr === 0);

// -- bias_side spot checks (spec Phase 1 gate) --
function biasOf(exName, dayNo) {
  const r = one(
    'SELECT b.bias_side bs FROM block b JOIN exercise e ON e.id=b.exercise_id ' +
    'JOIN day_template d ON d.id=b.day_template_id WHERE e.name=? AND d.day_no=?',
    [exName, dayNo]);
  return r.bs === undefined ? '(absent)' : r.bs;
}
check("side plank with abduction = right", biasOf('Side plank with abduction', 2) === 'right');
check("Copenhagen plank = left (Day 1)", biasOf('Copenhagen plank', 1) === 'left');
check("Copenhagen plank = left (Day 4)", biasOf('Copenhagen plank', 4) === 'left');
check("single-leg glute bridge (nightly) = right", biasOf('Single-leg glute bridge', 0) === 'right');
check("reverse Nordic = NULL", biasOf('Reverse Nordic', 2) === null);
check("pogo hops NULL in Day 1 warm-up", one(
  "SELECT b.bias_side bs FROM block b JOIN exercise e ON e.id=b.exercise_id JOIN day_template d ON d.id=b.day_template_id " +
  "WHERE e.name='Single-leg ankle pogo hops' AND d.day_no=1 AND b.block_code='warmup'").bs === null);
check("pogo hops left in Day 1 finisher", one(
  "SELECT b.bias_side bs FROM block b JOIN exercise e ON e.id=b.exercise_id JOIN day_template d ON d.id=b.day_template_id " +
  "WHERE e.name='Single-leg ankle pogo hops' AND d.day_no=1 AND b.block_code='finisher'").bs === 'left');

// -- asymmetric prescriptions are separate left/right rows --
const asym = one(
  "SELECT COUNT(*) c FROM block b WHERE " +
  "(SELECT COUNT(DISTINCT side) FROM block_target t WHERE t.block_id=b.id AND t.side IN ('left','right')) = 2").c;
check('asymmetric/unilateral targets stored as separate L/R rows', asym > 20, asym + ' blocks with both sides');

// -- exclusions --
const sprint = one("SELECT COUNT(*) c FROM exercise WHERE name LIKE '%sprint%'").c;
check('no exercise references sprinting', sprint === 0);
const rampin = one(
  "SELECT COUNT(*) c FROM exercise WHERE name LIKE '%no jump%' OR name LIKE '%step-down%' " +
  "OR name LIKE '%knee-to-wall%' OR name LIKE '%short-lever%'").c;
check('nothing from RAMP-IN / RE-CHECK sections in seed', rampin === 0);

// -- ordering (2026-08-22): knee block before supersets on every lifting day --
for (const dn of [1, 2, 3, 4]) {
  const r = one(
    "SELECT MIN(CASE WHEN b.block_code='knee' THEN b.order_index END) kmin, " +
    "MIN(CASE WHEN b.superset_group IS NOT NULL THEN b.order_index END) smin " +
    'FROM block b JOIN day_template d ON d.id=b.day_template_id WHERE d.day_no=?', [dn]);
  check('Day ' + dn + ': knee block precedes supersets', r.kmin != null && r.kmin < r.smin,
    'knee@' + r.kmin + ' vs superset@' + r.smin);
}

// -- session length, measured on the runner's ACTUAL step list --
// Work model: holds at face value, reps at 3 s, distance at 2 s/m, plus 8 s of
// transition per set. Rest comes from the steps themselves, so this tracks the
// real ordering including the per-category main rests.
{
  const dayMins = (dayNo) => {
    const d = one('SELECT * FROM day_template WHERE day_no=?', [dayNo]);
    const blocks = all(
      'SELECT b.*, e.name ex_name, e.is_timed FROM block b JOIN exercise e ON e.id=b.exercise_id ' +
      'WHERE b.day_template_id=? ORDER BY b.order_index', [d.id]);
    for (const b of blocks) b.targets = all('SELECT * FROM block_target WHERE block_id=? ORDER BY id', [b.id]);
    let secs = 0;
    for (const s of buildSteps(blocks)) {
      if (s.kind === 'rest') secs += s.seconds;
      else if (s.kind === 'set') {
        const t = s.target;
        secs += t.hold_seconds ? t.hold_seconds : t.distance_m ? t.distance_m * 2 : (t.reps || 0) * 3;
        secs += 8;
      }
    }
    return secs / 60;
  };
  for (const dn of [1, 2, 3, 4]) {
    const m = dayMins(dn);
    check('Day ' + dn + ' runs 80-115 min', m >= 80 && m <= 115, m.toFixed(0) + ' min');
  }
  const nightly = dayMins(0);
  check('Nightly runs 20-35 min', nightly >= 20 && nightly <= 35, nightly.toFixed(0) + ' min');
}

// -- legacy per-round estimate, kept as a floor check on rest seeding --
// Time model mirrors the runner semantics in the spec's "Main work" walkthrough:
// left+right of a unilateral drill run back-to-back inside one ROUND, supersets
// pair a+b inside a round, and rest_seconds_after fires once per round (it is 0
// on 'a' blocks; the pair's rest lives on the 'b' block). Work: holds at face
// value, reps at 3 s (2 s in warm-ups), distance at 2 s/m, 15 s setup per block.
const day1 = all(
  'SELECT b.id, b.block_code code, b.rest_seconds_after rest, e.is_timed FROM block b ' +
  'JOIN exercise e ON e.id=b.exercise_id JOIN day_template d ON d.id=b.day_template_id ' +
  'WHERE d.day_no=1 ORDER BY b.order_index');
let total = 0;
for (const b of day1) {
  const targets = all('SELECT * FROM block_target WHERE block_id=?', [b.id]);
  const repSec = b.code === 'warmup' ? 2 : 3;
  let rounds = 0, work = 0;
  for (const t of targets) {
    rounds = Math.max(rounds, t.sets);
    if (t.hold_seconds) work += t.sets * t.hold_seconds;
    else if (t.distance_m) work += t.sets * t.distance_m * 2;
    else work += t.sets * t.reps * repSec;
  }
  total += work + rounds * b.rest + 15;
}
const mins = total / 60;
check('Day 1 rest is actually seeded (not all zeros)', mins >= 70, mins.toFixed(1) + ' min');

// -- nightly holds stay in the 45-60s band except left-calf 90s + close couch 120 --
const longNight = all(
  "SELECT e.name, t.side, t.hold_seconds h FROM block_target t JOIN block b ON b.id=t.block_id " +
  "JOIN exercise e ON e.id=b.exercise_id JOIN day_template d ON d.id=b.day_template_id " +
  "WHERE d.day_no=0 AND t.hold_seconds > 60");
const allowed = longNight.every(r =>
  (r.name.startsWith('Standing calf stretch') && r.side === 'left' && r.h === 90) ||
  (r.name === 'Couch stretch' && r.side === 'left' && r.h === 120));
check('nightly holds: only left-calf 90s and closing couch 120s exceed 60s', allowed,
  longNight.map(r => r.name + ' ' + r.side + ' ' + r.h + 's').join('; '));

// -- audio: every seeded exercise must have a clip, or the runner goes quiet --
{
  let manifest = null;
  try {
    manifest = JSON.parse(readFileSync('audio/manifest.json', 'utf8'));
  } catch {
    check('audio/manifest.json exists (run tools/gen_audio.py)', false);
  }
  if (manifest) {
    const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').replace(/_+/g, '_');
    const names = all('SELECT name FROM exercise').map((r) => r.name);
    const missing = names.filter((n) => !manifest['ex_' + slug(n)]);
    check('every seeded exercise has a voice clip', missing.length === 0, missing.slice(0, 5).join('; '));

    const structural = ['side_left', 'side_right', 'u_reps', 'u_seconds', 'u_meters',
      's_rest', 's_main_rest', 's_go', 's_ten_seconds', 's_last_set', 's_session_complete'];
    const missingPhrases = structural.filter((c) => !manifest[c]);
    check('structural cue clips present', missingPhrases.length === 0, missingPhrases.join(', '));

    // every hold value the plan actually uses must have a natural spoken clip
    const holds = all('SELECT DISTINCT hold_seconds h FROM block_target WHERE hold_seconds IS NOT NULL')
      .map((r) => r.h);
    const missingHolds = holds.filter((h) => !manifest['sec_' + h] && !(h >= 1 && h <= 50 && manifest['n_' + h]));
    check('every prescribed hold length is speakable', missingHolds.length === 0, missingHolds.join(', '));
    check('120 s says "two minutes", not "one hundred twenty seconds"',
      manifest.sec_120 && /two minutes/i.test(manifest.sec_120.text),
      manifest.sec_120 && manifest.sec_120.text);

    const durations = Object.values(manifest).map((c) => c.ms);
    check('no zero-length clips', durations.every((d) => d > 0),
      String(durations.filter((d) => !d).length) + ' zero-length');
  }
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : '\n' + failures + ' CHECK(S) FAILED');
process.exit(failures === 0 ? 0 : 1);
