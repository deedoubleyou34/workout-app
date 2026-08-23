import { initDb } from './db.js';
import { renderHome } from './ui/home.js';
import { renderDay } from './ui/day.js';
import { renderRun } from './ui/run.js';

const app = document.getElementById('app');

function route() {
  const run = location.hash.match(/^#\/run\/(\d+)/);
  if (run) return renderRun(app, Number(run[1]));
  const day = location.hash.match(/^#\/day\/(\d+)/);
  if (day) return renderDay(app, Number(day[1]));
  return renderHome(app);
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

  // When an updated service worker takes control, load the new shell — but
  // never mid-session. A reload during the runner would drop the wake lock and
  // the rest timer; the update waits until the runner is left.
  let reloaded = false;
  let pendingReload = false;
  const inSession = () => location.hash.startsWith('#/run/');
  const applyUpdate = () => {
    if (reloaded) return;
    if (inSession()) { pendingReload = true; return; }
    reloaded = true;
    location.reload();
  };
  navigator.serviceWorker.addEventListener('controllerchange', applyUpdate);
  window.addEventListener('hashchange', () => {
    if (pendingReload && !inSession()) applyUpdate();
  });
}
