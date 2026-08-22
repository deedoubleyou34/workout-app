const status = document.getElementById('status');

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js')
    .then((reg) => {
      status.textContent = navigator.onLine ? 'online · cached for offline' : 'offline · running from cache';
      // iOS standalone PWAs resuming from memory are not a navigation, so
      // Safari never checks for a new service worker on its own. Check on
      // launch and every time the app returns to the foreground.
      reg.update().catch(() => {});
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    })
    .catch((err) => { status.textContent = 'sw failed: ' + err.message; });

  // When an updated service worker takes control, load the new shell.
  // TODO(phase 2): defer this reload while a workout session is running.
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    location.reload();
  });
} else {
  status.textContent = 'no service worker support';
}
