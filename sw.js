// Offline support, without the usual cache-first trap.
//
// A pure cache-first worker keeps serving an old build forever unless the
// cache name is bumped on every deploy — a discipline that is easy to forget
// and confusing when it fails. This uses stale-while-revalidate instead: the
// cached copy is served immediately (so the app opens instantly and works with
// no network), while a fresh copy is fetched in the background for next time.
// Updates land one reload late rather than never.
const CACHE = 'pillage-v1';

const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './icon.svg',
  './doctor.png',
  './js/app.js',
  './js/db.js',
  './js/dates.js',
  './js/store.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request, { ignoreSearch: true });

    const network = fetch(request).then((response) => {
      if (response.ok && response.type === 'basic') cache.put(request, response.clone());
      return response;
    });

    if (cached) {
      // Refresh in the background; a failure here just means we stay offline.
      event.waitUntil(network.catch(() => {}));
      return cached;
    }

    try {
      return await network;
    } catch (err) {
      if (request.mode === 'navigate') {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
