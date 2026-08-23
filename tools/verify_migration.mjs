// Verifies the v2 block-reorder migration against the REAL v1 seed pulled from
// git history: seeds an old-layout DB, logs sets against old block ids, runs
// the migration, and checks every set_log row still points at the same
// (day, exercise, block_code) it was logged under.
// Usage: node tools/verify_migration.mjs
import { createRequire } from 'module';
import { readFileSync, writeFileSync, mkdtempSync } from 'fs';
import { execSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { MIGRATIONS } from '../js/db.js';

const V1_COMMIT = '1ad1296'; // "Phase 1: sql.js DB + full seed..." — the seed Dom's phone has
const require = createRequire(import.meta.url);
const initSqlJs = require('../vendor/sql-wasm.js');

const oldSeedSrc = execSync('git show ' + V1_COMMIT + ':js/seed.js', { encoding: 'utf8' });
const tmp = mkdtempSync(join(tmpdir(), 'seedv1-'));
writeFileSync(join(tmp, 'seed_v1.mjs'), oldSeedSrc);
const { seed: seedV1 } = await import(pathToFileURL(join(tmp, 'seed_v1.mjs')).href);

const SQL = await initSqlJs({ locateFile: (f) => 'vendor/' + f });
const db = new SQL.Database();
db.run(readFileSync('js/schema.sql', 'utf8'));
seedV1(db);
db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '1')");

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

// log one set against EVERY old block (worst case), remembering identity as
// (day, exercise name, within-day occurrence) — block codes are ALLOWED to
// change across the reorder; day/exercise/occurrence are not.
db.run("INSERT INTO session (id, date, day_no, status) VALUES (1, '2026-08-22', 1, 'complete')");
const oldBlocks = all(
  'SELECT b.id, d.day_no, b.exercise_id, e.name FROM block b ' +
  'JOIN day_template d ON d.id=b.day_template_id JOIN exercise e ON e.id=b.exercise_id ORDER BY b.id');
const occSeen = new Map();
for (const ob of oldBlocks) {
  const base = ob.day_no + '|' + ob.name;
  const n = (occSeen.get(base) || 0) + 1;
  occSeen.set(base, n);
  db.run(
    "INSERT INTO set_log (session_id, block_id, exercise_id, side, set_index, reps_done, hit_target, notes, logged_at) " +
    "VALUES (1, ?, ?, 'both', 1, 5, 1, ?, 'now')",
    [ob.id, ob.exercise_id, base + '|' + n]);
}

for (const m of MIGRATIONS) m.run(db);

const newBlocks = all(
  'SELECT b.id, d.day_no, e.name FROM block b ' +
  'JOIN day_template d ON d.id=b.day_template_id JOIN exercise e ON e.id=b.exercise_id ORDER BY b.id');
const occSeen2 = new Map();
const newIdent = new Map();
for (const nb of newBlocks) {
  const base = nb.day_no + '|' + nb.name;
  const n = (occSeen2.get(base) || 0) + 1;
  occSeen2.set(base, n);
  newIdent.set(nb.id, base + '|' + n);
}
const rows = all('SELECT s.notes expect, s.block_id FROM set_log s');
let bad = 0;
for (const r of rows) {
  const got = newIdent.get(r.block_id) || '(dangling)';
  if (got !== r.expect) {
    bad++;
    console.log('MISMATCH  expected ' + r.expect + '  got ' + got);
  }
}
const dangling = all(
  'SELECT COUNT(*) c FROM set_log WHERE block_id NOT IN (SELECT id FROM block)')[0].c;
console.log(rows.length + ' logged sets checked, ' + bad + ' mismatched, ' + dangling + ' dangling block refs');
if (bad || dangling || rows.length !== oldBlocks.length) {
  console.log('MIGRATION VERIFICATION FAILED');
  process.exit(1);
}
console.log('MIGRATION VERIFIED: every set still points at its original (day, exercise, occurrence)');
