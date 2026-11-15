// Offline fallback service worker. It does ONE thing: when a page navigation fails because there is no connection at
// all, it shows /offline.html instead of the browser's "No internet" screen. It caches nothing else (no app files, no
// API answers), so it can never serve an outdated version of the app.
const CACHE = 'offline-v1';
const OFFLINE_URL = new URL('offline.html', self.registration.scope).pathname;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(OFFLINE_URL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('offline-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return; // only page loads; scripts, images and API calls are never touched
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE_URL)));
});
