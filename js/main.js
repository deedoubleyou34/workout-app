import { initDb } from './db.js';
import { renderHome } from './ui/home.js';
import { renderDay } from './ui/day.js';

const app = document.getElementById('app');

function route() {
  const m = location.hash.match(/^#\/day\/(\d+)/);
  if (m) renderDay(app, Number(m[1]));
  else renderHome(app);
}

(async () => {
  try {
    await initDb();
    window.addEventListener('hashchange', route);
    route();
  } catch (err) {
    app.innerHTML = '';
    const h = document.createElement('h1');
    h.textContent = 'db error';
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = err.message;
    app.append(h, p);
  }
})();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js')
    .then((reg) => {
      // iOS standalone PWAs resuming from memory are not a navigation, so
      // Safari never checks for a new service worker on its own. Check on
      // launch and every time the app returns to the foreground.
      reg.update().catch(() => {});
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    })
    .catch(() => {});

  // When an updated service worker takes control, load the new shell.
  // TODO(phase 2): defer this reload while a workout session is running.
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    location.reload();
  });
}
