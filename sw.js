const VERSION = 'v2';
const CACHE = 'convivium-' + VERSION;
const ASSETS = [
  './', './index.html', './style.css', './app.js', './cards.js', './engine.js',
  './manifest.webmanifest', './icon.svg',
  './faces/face_vanya.png', './faces/face_olya.png', './faces/face_den.png',
  './faces/face_shurik.png', './faces/face_pavel.png', './faces/face_vova.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).then((resp) => {
        const cp = resp.clone();
        caches.open(CACHE).then((c) => c.put('./index.html', cp));
        return resp;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then((r) => {
      const network = fetch(e.request).then((resp) => {
        if (resp && resp.status === 200) {
          caches.open(CACHE).then((c) => c.put(e.request, resp.clone()));
        }
        return resp;
      }).catch(() => r);
      return r || network;
    })
  );
});
