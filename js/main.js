const status = document.getElementById('status');

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js')
    .then(() => { status.textContent = navigator.onLine ? 'online · cached for offline' : 'offline · running from cache'; })
    .catch((err) => { status.textContent = 'sw failed: ' + err.message; });
} else {
  status.textContent = 'no service worker support';
}
