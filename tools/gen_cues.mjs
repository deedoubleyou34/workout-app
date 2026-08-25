// Enumerate every line the app can say, straight out of the seed.
// Usage: node tools/gen_cues.mjs   (from the repo root) -> audio/cues.json
//
// It walks all five days through the REAL runner (buildSteps), so the cue list
// is whatever the runner will actually reach — including the per-category main
// rests and the sled sets that carry no counted target. tools/gen_audio.py then
// renders exactly this file, which is why the voice can never say something the
// generator never saw.
import { createRequire } from 'module';
import { readFileSync, writeFileSync } from 'fs';
import { seed } from '../js/seed.js';
import { buildSteps, stepTarget } from '../js/runner.js';
import { setText, restText, cueId, atomicLibrary } from '../js/cues.js';

const require = createRequire(import.meta.url);
const initSqlJs = require('../vendor/sql-wasm.js');

const SQL = await initSqlJs({ locateFile: (f) => 'vendor/' + f });
const db = new SQL.Database();
db.run(readFileSync('js/schema.sql', 'utf8'));
seed(db);

const all = (sql, params = []) => {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
};

const clips = atomicLibrary();
let composites = 0;

for (const day of all('SELECT * FROM day_template ORDER BY day_no')) {
  const blocks = all(
    'SELECT b.*, e.name ex_name, e.is_timed, e.load_type FROM block b ' +
    'JOIN exercise e ON e.id = b.exercise_id WHERE b.day_template_id = ? ORDER BY b.order_index',
    [day.id]);
  for (const b of blocks) b.targets = all('SELECT * FROM block_target WHERE block_id = ? ORDER BY id', [b.id]);

  for (const step of buildSteps(blocks)) {
    let text = null;
    if (step.kind === 'set') {
      const t = stepTarget(step);
      text = setText({ name: step.label, side: step.side, targetKind: t.kind, targetValue: t.value });
    } else if (step.kind === 'rest') {
      text = restText(step.seconds,
        { main: step.main, nextCategory: step.nextCategory, category: step.category });
    }
    const id = cueId(text);
    if (id && !(id in clips)) { clips[id] = text; composites++; }
  }
}

const sorted = Object.fromEntries(Object.entries(clips).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync('audio/cues.json', JSON.stringify(sorted, null, 1) + '\n', 'utf8');
console.log(Object.keys(sorted).length + ' clips (' + composites + ' whole-sentence, '
  + (Object.keys(sorted).length - composites) + ' word-at-a-time) -> audio/cues.json');
