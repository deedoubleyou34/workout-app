// What plays, and when — spec Phase 8, extended on Dom's direction 2026-08-25.
//
// Phase 8 mapped four session phases to four Spotify PLAYLISTS, entered by
// pasting a link. Dom wanted three things beyond that: albums as well as
// playlists, a choice per workout CATEGORY rather than per phase, and to pick
// them inside the app instead of pasting links.
//
// So the model is now: four phases carry the defaults, and any of the eleven
// categories can override its phase. A category with nothing set inherits —
// that is what keeps this to four decisions instead of eleven.
//
// Everything here is pure except loadConfig/saveConfig, which read and write
// one JSON row in `meta`, so the whole mapping still rides along in the
// .sqlite export with the rest of his setup.

import { CATEGORY_LABELS, categoryLabel } from './runner.js';

export const PHASES = ['warmup', 'main', 'power', 'finisher'];

export const PHASE_LABELS = {
  warmup: 'Warm-up',
  main: 'Main work',
  power: 'Power',
  finisher: 'Finisher & close',
};

// The runner's categories, in the order a session meets them. Lifting days
// first, then the nightly-only ones.
export const CATEGORIES = [
  'warmup', 'knee', 'superset 1', 'superset 2', 'superset 3', 'power', 'finisher',
  'core', 'calves', 'glutes', 'close',
];

export { categoryLabel };

// Categories are finer-grained than the four musical phases: knee work and
// every superset are all "main work" unless a category says otherwise.
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

// ---------- what can be played ----------

// PUT /me/player/play takes any context_uri, so an album has always been
// playable — only this parser refused it. Artist URIs are accepted if pasted;
// they are not offered in the picker.
const PLAYABLE = ['playlist', 'album', 'artist'];

export function parseContext(input) {
  const text = String(input || '').trim();
  if (!text) return null;
  let m = text.match(/^spotify:(playlist|album|artist):([A-Za-z0-9]+)$/);
  if (m) return { uri: 'spotify:' + m[1] + ':' + m[2], type: m[1] };
  m = text.match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(playlist|album|artist)\/([A-Za-z0-9]+)/);
  if (m) return { uri: 'spotify:' + m[1] + ':' + m[2], type: m[1] };
  // A bare id carries no type. Playlist is the older behaviour and the more
  // likely paste, so it stays the assumption.
  if (/^[A-Za-z0-9]{20,26}$/.test(text)) return { uri: 'spotify:playlist:' + text, type: 'playlist' };
  return null;
}

export function contextUrl(uri) {
  const m = String(uri || '').match(/^spotify:(playlist|album|artist):([A-Za-z0-9]+)$/);
  return m ? 'https://open.spotify.com/' + m[1] + '/' + m[2] : null;
}

export function contextType(uri) {
  const m = String(uri || '').match(/^spotify:(playlist|album|artist):/);
  return m ? m[1] : null;
}

// "Gym Heavy — playlist", or the bare URI when we never learned a name.
export function sourceLabel(source) {
  if (!source || !source.uri) return null;
  const type = source.type || contextType(source.uri) || 'playlist';
  return source.name ? source.name + ' — ' + type : source.uri;
}

// An album is an ordered thing and shuffling it defeats the point. Power stays
// unshuffled whatever it is: that work is prescribed and short, and a shuffled
// playlist there is a different session every time (spec Phase 8 step 4).
export function defaultShuffle(type, phase) {
  if (phase === 'power') return false;
  return type !== 'album';
}

export function makeSource({ uri, type, name, shuffle }, phase) {
  const parsed = parseContext(uri);
  if (!parsed) return null;
  return {
    uri: parsed.uri,
    type: type || parsed.type,
    name: name || null,
    shuffle: shuffle === undefined ? defaultShuffle(parsed.type, phase) : !!shuffle,
  };
}

// ---------- stored configuration ----------

export function emptyConfig() {
  return {
    version: 2,
    phases: Object.fromEntries(PHASES.map((p) => [p, null])),
    categories: {},
  };
}

export function loadConfig(db) {
  const cfg = emptyConfig();
  let saved = null;
  try {
    const res = db.exec("SELECT value FROM meta WHERE key = 'playlists'");
    if (!res.length) return cfg;
    saved = JSON.parse(res[0].values[0][0]);
  } catch {
    return cfg;                       // nothing saved, or unreadable
  }
  if (!saved || typeof saved !== 'object') return cfg;

  if (saved.version === 2) {
    for (const p of PHASES) {
      cfg.phases[p] = saved.phases && saved.phases[p] ? makeSource(saved.phases[p], p) : null;
    }
    for (const [key, entry] of Object.entries(saved.categories || {})) {
      const source = entry && makeSource(entry, phaseForCategory(key));
      if (source) cfg.categories[key] = source;
    }
    return cfg;
  }

  // v1 (build 020): a flat { warmup: { uri, shuffle }, main: {...}, ... }.
  // It maps straight onto the phases and leaves the overrides empty, so a
  // setup made before this build keeps working with nothing to do.
  for (const p of PHASES) {
    cfg.phases[p] = saved[p] ? makeSource(saved[p], p) : null;
  }
  return cfg;
}

export function saveConfig(db, cfg) {
  const clean = emptyConfig();
  for (const p of PHASES) {
    clean.phases[p] = cfg && cfg.phases && cfg.phases[p] ? makeSource(cfg.phases[p], p) : null;
  }
  for (const [key, entry] of Object.entries((cfg && cfg.categories) || {})) {
    const source = entry && makeSource(entry, phaseForCategory(key));
    if (source) clean.categories[key] = source;      // a cleared override is simply absent
  }
  db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('playlists', ?)", [JSON.stringify(clean)]);
  return clean;
}

// The single resolution point: what should be playing during this category?
// An override wins; otherwise the category inherits its phase; otherwise
// nothing, which means "leave whatever is playing alone".
export function sourceFor(categoryKey, cfg) {
  if (!cfg || !categoryKey) return null;
  const own = cfg.categories && cfg.categories[categoryKey];
  if (own && own.uri) return own;
  const phase = phaseForCategory(categoryKey);
  const inherited = phase && cfg.phases && cfg.phases[phase];
  return inherited && inherited.uri ? inherited : null;
}

// What a category will do, in words, for the settings screen.
export function explainCategory(categoryKey, cfg) {
  const own = cfg && cfg.categories && cfg.categories[categoryKey];
  if (own && own.uri) return { overridden: true, text: sourceLabel(own) };
  const phase = phaseForCategory(categoryKey);
  const inherited = cfg && cfg.phases && cfg.phases[phase];
  if (inherited && inherited.uri) {
    return { overridden: false, text: 'follows ' + PHASE_LABELS[phase] + ' — ' + sourceLabel(inherited) };
  }
  return { overridden: false, text: 'follows ' + PHASE_LABELS[phase] + ' — nothing set' };
}

export function isConfigured(cfg) {
  if (!cfg) return false;
  return PHASES.some((p) => cfg.phases[p] && cfg.phases[p].uri)
    || Object.values(cfg.categories || {}).some((c) => c && c.uri);
}

export { PLAYABLE, CATEGORY_LABELS };
