// Node runner for tests/cases.mjs — same cases the Safari page runs.
// The iPhone run is the actual Phase 2 gate; this catches breakage before deploy.
// Usage: node tools/run_tests.mjs   (from the repo root)
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { run } from '../tests/cases.mjs';

const require = createRequire(import.meta.url);
const initSqlJs = require('../vendor/sql-wasm.js');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (!ok && detail ? '  [' + detail + ']' : ''));
  if (ok) pass++; else fail++;
};
const eq = (name, got, want) =>
  check(name, JSON.stringify(got) === JSON.stringify(want),
    'got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want));

await run({
  check, eq,
  initSqlJs: () => initSqlJs({ locateFile: (f) => 'vendor/' + f }),
  loadSchema: async () => readFileSync('js/schema.sql', 'utf8'),
});

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' TESTS PASSED' : fail + ' FAILED / ' + (pass + fail)));
process.exit(fail === 0 ? 0 : 1);
