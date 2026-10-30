// Service worker for the Tartlet playground: makes it installable and lets it start offline.
// The tartlet-pwa plugin in vite.config.ts fills in VERSION and PRECACHE at build time.
// Audio is not played here (service workers have no audio output); see src/background-audio.ts.
/* eslint-disable */
const VERSION = '__VERSION__';
const CACHE = `tartlet-${VERSION}`;
const PRECACHE = /*__PRECACHE__*/ [];
const SCOPE = new URL('./', self.location.href).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        Promise.allSettled(
          PRECACHE.map((path) => cache.add(new Request(new URL(path, SCOPE).href, { cache: 'reload' }))),
        ),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k.startsWith('tartlet-') && k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

/** Fresh when online, cached when offline (pages and album files). */
async function networkFirst(request, key = request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok && !response.redirected) cache.put(key, response.clone()).catch(() => {});
    return response;
  } catch (err) {
    const hit = (await cache.match(key)) || (await cache.match(request, { ignoreSearch: true }));
    if (hit) return hit;
    throw err;
  }
}

/** Hashed build assets never change, so the cache wins. */
async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok && response.type === 'basic') cache.put(request, response.clone()).catch(() => {});
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Cross-origin requests (AI proxy, mounted albums) and API calls go straight to the network.
  if (url.origin !== self.location.origin || !url.href.startsWith(SCOPE)) return;
  if (url.pathname.includes('/api-proxy/')) return;
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, SCOPE));
    return;
  }
  if (url.pathname.includes('/albums/') || url.pathname.includes('/samples/')) {
    event.respondWith(networkFirst(request));
    return;
  }
  event.respondWith(cacheFirst(request));
});
