// Cache-first app shell. Bump CACHE on every deploy that changes shell files.
const CACHE = 'shell-v13';

const SHELL = [
  './',
  './index.html',
  './css/app.css',
  './js/main.js',
  './js/audio.js',
  './audio/manifest.json',
  './js/db.js',
  './js/seed.js',
  './js/schema.sql',
  './js/ui/home.js',
  './js/ui/day.js',
  './js/progression.js',
  './js/sessions.js',
  './js/runner.js',
  './js/ui/run.js',
  './tests/test.html',
  './tests/cases.mjs',
  './vendor/sql-wasm.js',
  './vendor/sql-wasm.wasm',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// Every voice clip in audio/manifest.json is precached too — the gym has no
// wifi and a silent runner is a broken runner. The list is read from the
// manifest rather than hardcoded, so regenerating audio needs no sw.js edit.
async function cacheAudio(cache) {
  try {
    const manifest = await fetch(new Request('./audio/manifest.json', { cache: 'reload' }))
      .then((r) => r.json());
    const files = Object.values(manifest).map((c) => './audio/' + c.file);
    // one at a time in chunks: ~140 parallel requests upsets iOS Safari
    for (let i = 0; i < files.length; i += 12) {
      await cache.addAll(files.slice(i, i + 12).map((u) => new Request(u, { cache: 'reload' })));
    }
  } catch {
    // audio missing or offline at install — cues fall back to silence, the
    // rest of the app still works
  }
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // cache: 'reload' bypasses the HTTP cache — GitHub Pages serves max-age=600,
      // and stale install fetches would rebuild the "new" cache from old files.
      .then(async (c) => {
        await c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })));
        await cacheAudio(c);
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(
      (hit) => hit || fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
    )
  );
});
