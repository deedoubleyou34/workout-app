// sql.js init, IndexedDB persistence, forward-only migrations, export/import.
// The whole DB lives in memory and is exported to IndexedDB after every write
// transaction — the dataset is small; simplicity beats cleverness.

import { seed } from './seed.js';

const IDB_NAME = 'workout-app';
const IDB_STORE = 'kv';
const IDB_KEY = 'sqlite-db';

// Forward-only. Each entry: { version, sql }. Version 1 is schema.sql + seed.
const MIGRATIONS = [];

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
        db.run(m.sql);
        setSchemaVersion(m.version);
        v = m.version;
      }
    }
    await persist();
  } else {
    db = await createFresh();
    seed(db);
    setSchemaVersion(1);
    await persist();
  }
  return db;
}

export async function persist() {
  await idbPut(IDB_KEY, db.export());
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
