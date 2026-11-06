// Service worker : garde une copie de l'app pour fonctionner hors ligne.
// Change CACHE (v2, v3...) à chaque mise à jour pour forcer le rafraîchissement.
const CACHE = 'genoux-v1';
const FILES = ['./', 'index.html', 'style.css', 'engine.js', 'app.js',
               'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

// Réseau d'abord (dernière version), copie locale si pas de réseau
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && new URL(e.request.url).origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((m) => m || caches.match('index.html')))
  );
});
