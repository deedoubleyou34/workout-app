// sql.js init, IndexedDB persistence, forward-only migrations, export/import.
// The whole DB lives in memory and is exported to IndexedDB after every write
// transaction — the dataset is small; simplicity beats cleverness.

import { seed } from './seed.js';

const IDB_NAME = 'workout-app';
const IDB_STORE = 'kv';
const IDB_KEY = 'sqlite-db';

// Forward-only. Each entry: { version, run(db) }. Version 1 is schema.sql + seed.
// Exported so tools/verify_migration.mjs can run them against historical seeds.
export const MIGRATIONS = [
  {
    // v2 (build 008): day blocks reordered — knee block moved before supersets,
    // unilateral before bilateral inside pairs. Exercise ids are unchanged
    // (EXERCISES array untouched); block ids AND block codes shift, so
    // set_log.block_id is remapped by (day_no, exercise_id, occurrence) —
    // NOT block_code, which the reorder renamed (e.g. Copenhagen 3b→3a).
    version: 2,
    run(db) {
      const readBlocks = () => {
        const rows = [];
        const stmt = db.prepare(
          'SELECT b.id, d.day_no, b.exercise_id FROM block b ' +
          'JOIN day_template d ON d.id = b.day_template_id ORDER BY b.id');
        while (stmt.step()) rows.push(stmt.getAsObject());
        stmt.free();
        return rows;
      };
      const keyed = (rows) => {
        const seen = new Map();
        const out = new Map();
        for (const r of rows) {
          const base = r.day_no + '|' + r.exercise_id;
          const n = (seen.get(base) || 0) + 1;
          seen.set(base, n);
          out.set(base + '|' + n, r.id);
        }
        return out;
      };
      const oldMap = keyed(readBlocks());
      db.run('DELETE FROM block_target; DELETE FROM block; DELETE FROM day_template; DELETE FROM exercise;');
      seed(db);
      const newMap = keyed(readBlocks());
      // negative temp ids first so remaps never collide with real ids
      const pairs = [];
      for (const [key, oldId] of oldMap) {
        const newId = newMap.get(key);
        if (newId !== undefined && newId !== oldId) pairs.push([oldId, newId]);
      }
      pairs.forEach(([oldId], i) => db.run('UPDATE set_log SET block_id=? WHERE block_id=?', [-(i + 1), oldId]));
      pairs.forEach(([, newId], i) => db.run('UPDATE set_log SET block_id=? WHERE block_id=?', [newId, -(i + 1)]));
    },
  },
  {
    // v3 (build 009, Phase 2): current_load gains `reps` — the approved working
    // rep target. Spec §3 has weight/band/hold but §4.2 progresses band and
    // knee/tibialis work by REPS (+1 to +3 then band step; +2 to +6 then vest),
    // which the original schema could not express.
    version: 3,
    run(db) {
      db.run('ALTER TABLE current_load ADD COLUMN reps INTEGER');
    },
  },
];
const SCHEMA_VERSION = 1 + MIGRATIONS.length;

let SQL = null;
let db = null;

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const d = await idbOpen();
  return new Promise((resolve, reject) => {
    const req = d.transaction(IDB_STORE).objectStore(IDB_STORE).get(key);
    req.onsuccess = () => { resolve(req.result); d.close(); };
    req.onerror = () => { reject(req.error); d.close(); };
  });
}

async function idbPut(key, value) {
  const d = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => { resolve(); d.close(); };
    tx.onerror = () => { reject(tx.error); d.close(); };
  });
}

function schemaVersion() {
  try {
    const res = db.exec("SELECT value FROM meta WHERE key='schema_version'");
    return res.length ? Number(res[0].values[0][0]) : 0;
  } catch {
    return 0;
  }
}

function setSchemaVersion(v) {
  db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)", [String(v)]);
}

async function createFresh() {
  const fresh = new SQL.Database();
  const ddl = await fetch('./js/schema.sql').then((r) => r.text());
  fresh.run(ddl);
  return fresh;
}

export async function initDb() {
  SQL = await window.initSqlJs({ locateFile: (f) => './vendor/' + f });
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }
  const stored = await idbGet(IDB_KEY);
  if (stored && stored.length) {
    db = new SQL.Database(new Uint8Array(stored));
    let v = schemaVersion();
    for (const m of MIGRATIONS) {
      if (m.version > v) {
        m.run(db);
        setSchemaVersion(m.version);
        v = m.version;
      }
    }
    await persist();
  } else {
    db = await createFresh();
    seed(db);
    setSchemaVersion(SCHEMA_VERSION);
    await persist();
  }
  return db;
}

export async function persist() {
  await idbPut(IDB_KEY, db.export());
}

// Raw handle for modules that run their own SQL (progression.js). Anything that
// writes through this must call persist() itself.
export function getDb() {
  return db;
}

export function query(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

// Write + persist in one call. Returns last inserted rowid.
export async function exec(sql, params = []) {
  db.run(sql, params);
  const id = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
  await persist();
  return id;
}

export function storageStatus() {
  if (navigator.storage && navigator.storage.persisted) {
    return navigator.storage.persisted();
  }
  return Promise.resolve(false);
}

// ---------- export / import (the backup story, spec Phase 1 step 6) ----------

export function exportSqliteBlob() {
  return new Blob([db.export()], { type: 'application/octet-stream' });
}

export function exportJsonBlob() {
  const tables = query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
  const out = {};
  for (const { name } of tables) {
    out[name] = query('SELECT * FROM ' + name);
  }
  return new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' });
}

const SQLITE_MAGIC = 'SQLite format 3';

export async function importBytes(bytes) {
  const head = new TextDecoder().decode(bytes.slice(0, 15));
  let next;
  if (head === SQLITE_MAGIC) {
    next = new SQL.Database(new Uint8Array(bytes));
    next.exec('SELECT count(*) FROM exercise'); // sanity: throws if not our DB
  } else {
    const data = JSON.parse(new TextDecoder().decode(bytes));
    if (!data.exercise || !data.day_template) throw new Error('not a workout-app JSON export');
    next = await createFresh();
    for (const [table, rows] of Object.entries(data)) {
      if (!rows.length) continue;
      const cols = Object.keys(rows[0]);
      const stmt = next.prepare(
        'INSERT INTO ' + table + ' (' + cols.join(',') + ') VALUES (' + cols.map(() => '?').join(',') + ')'
      );
      for (const row of rows) stmt.run(cols.map((c) => (row[c] === undefined ? null : row[c])));
      stmt.free();
    }
  }
  db.close();
  db = next;
  await persist();
}
