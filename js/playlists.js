// Phase-based playlist switching — spec Phase 8.
//
// Rescoped per spec §1.2: there is no tempo API to build against any more, so
// Dom hand-builds four playlists and the app switches between them at session
// phase boundaries. Less magic, more reliable, and it cannot 403.
//
// Everything here is pure except the two config accessors, which read and
// write one JSON row in `meta` — so the mapping rides along in the .sqlite
// export with the rest of his setup.

export const PHASES = ['warmup', 'main', 'power', 'finisher'];

export const PHASE_LABELS = {
  warmup: 'Warm-up',
  main: 'Main work',
  power: 'Power',
  finisher: 'Finisher & close',
};

// The runner's categories are finer-grained than the four musical phases:
// knee work and every superset are all "main work" as far as music goes.
const CATEGORY_PHASE = {
  warmup: 'warmup',
  knee: 'main',
  power: 'power',
  finisher: 'finisher',
  core: 'finisher',
  calves: 'finisher',
  glutes: 'finisher',
  close: 'finisher',
};

export function phaseForCategory(key) {
  if (!key) return null;
  if (key.startsWith('superset')) return 'main';
  return CATEGORY_PHASE[key] || 'main';
}

// Accepts whatever Spotify's share sheet produces — a link, a URI, or the bare
// id — and returns the canonical URI, or null if it is not a playlist.
export function parsePlaylist(input) {
  const text = String(input || '').trim();
  if (!text) return null;
  let m = text.match(/^spotify:playlist:([A-Za-z0-9]+)$/);
  if (m) return 'spotify:playlist:' + m[1];
  m = text.match(/open\.spotify\.com\/(?:intl-[a-z]+\/)?playlist\/([A-Za-z0-9]+)/);
  if (m) return 'spotify:playlist:' + m[1];
  if (/^[A-Za-z0-9]{20,26}$/.test(text)) return 'spotify:playlist:' + text;
  return null;
}

export function playlistUrl(uri) {
  const m = String(uri || '').match(/^spotify:playlist:([A-Za-z0-9]+)$/);
  return m ? 'https://open.spotify.com/playlist/' + m[1] : null;
}

const EMPTY = () => Object.fromEntries(PHASES.map((p) => [p, { uri: null, shuffle: p === 'main' }]));

// Spec Phase 8 step 4: shuffle on for main work, off for power — power work is
// prescribed and short, and a shuffled playlist there is a different session
// every time.
export function defaultConfig() {
  const cfg = EMPTY();
  cfg.main.shuffle = true;
  cfg.warmup.shuffle = true;
  cfg.finisher.shuffle = true;
  cfg.power.shuffle = false;
  return cfg;
}

export function loadConfig(db) {
  const cfg = defaultConfig();
  try {
    const res = db.exec("SELECT value FROM meta WHERE key = 'playlists'");
    if (!res.length) return cfg;
    const saved = JSON.parse(res[0].values[0][0]);
    for (const p of PHASES) {
      if (saved[p]) {
        cfg[p] = { uri: parsePlaylist(saved[p].uri), shuffle: !!saved[p].shuffle };
      }
    }
  } catch { /* nothing saved, or unreadable — the defaults are fine */ }
  return cfg;
}

export function saveConfig(db, cfg) {
  const clean = {};
  for (const p of PHASES) {
    const entry = (cfg && cfg[p]) || {};
    clean[p] = { uri: parsePlaylist(entry.uri), shuffle: !!entry.shuffle };
  }
  db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('playlists', ?)", [JSON.stringify(clean)]);
  return clean;
}

export function isConfigured(cfg) {
  return PHASES.some((p) => cfg && cfg[p] && cfg[p].uri);
}
