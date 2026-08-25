// Every named import must resolve to a real export.
// Usage: node tools/verify_imports.mjs   (from the repo root)
//
// Node's own loader already proves this for anything the test suite executes,
// but the UI modules (home, day, run, dashboard, music, main) are never
// imported by a test — a renamed export there is a blank screen on Dom's
// phone and nothing catches it before the deploy.
import { readFileSync, readdirSync, statSync } from 'fs';
import { dirname, resolve, relative } from 'path';

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = dir + '/' + name;
    if (statSync(p).isDirectory()) {
      if (!/vendor|audio|icons|\.git|__pycache__/.test(p)) walk(p);
    } else if (p.endsWith('.js') || p.endsWith('.mjs')) {
      files.push(p);
    }
  }
})('.');

const exportsOf = (src) => {
  const names = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z0-9_$]+)/g)) {
    names.add(m[1]);
  }
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const as = part.trim().split(/\s+as\s+/);
      const name = (as[1] || as[0] || '').trim();
      if (name) names.add(name);
    }
  }
  return names;
};

let broken = 0;
let checked = 0;
for (const file of files) {
  if (file.includes('/sw.js')) continue;
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*'(\.[^']+)'/g)) {
    const target = resolve(dirname(file), m[2]);
    let targetSrc;
    try {
      targetSrc = readFileSync(target, 'utf8');
    } catch {
      console.log('FAIL  missing module ' + m[2] + '  (imported by ' + file + ')');
      broken++;
      continue;
    }
    const available = exportsOf(targetSrc);
    for (const raw of m[1].split(',')) {
      const name = raw.trim().split(/\s+as\s+/)[0].trim();
      if (!name) continue;
      checked++;
      if (!available.has(name)) {
        console.log('FAIL  ' + relative('.', target) + ' does not export "' + name
          + '"  (imported by ' + file + ')');
        broken++;
      }
    }
  }
}

console.log(broken === 0
  ? 'ALL ' + checked + ' NAMED IMPORTS RESOLVE'
  : broken + ' BROKEN IMPORT(S)');
process.exit(broken === 0 ? 0 : 1);
