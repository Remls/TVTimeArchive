/* TV Time Archive Viewer, service worker.
   Bump VERSION on each deploy to invalidate old caches. */
const VERSION = '__BUILD__';   // stamped with the git commit SHA by Netlify at deploy (see netlify.toml)
const SHELL = 'shell-' + VERSION;
const RUNTIME = 'runtime-' + VERSION;

const APP_SHELL = [
  '/', '/index.html', '/styles.css',
  '/favicon.svg', '/manifest.webmanifest',
  '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/apple-touch-icon.png',
];

// APIs whose responses we never cache (they have their own local caches / must stay fresh).
const NO_CACHE = /(^|\.)tvmaze\.com$|(^|\.)wikidata\.org$|(^|\.)thetvdb\.com$|(^|\.)wikimedia\.org$/;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== RUNTIME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (NO_CACHE.test(url.hostname)) return;   // let metadata APIs hit the network directly

  if (url.origin === location.origin) {
    // App shell: network-first so deploys propagate, cache as offline fallback.
    e.respondWith(
      fetch(req)
        .then((res) => { const copy = res.clone(); caches.open(RUNTIME).then((c) => c.put(req, copy)); return res; })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('/index.html')))
    );
    return;
  }

  // Cross-origin CDN assets (JSZip, PapaParse, fonts, Phosphor): stale-while-revalidate.
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req)
        .then((res) => { const copy = res.clone(); caches.open(RUNTIME).then((c) => c.put(req, copy)); return res; })
        .catch(() => hit);
      return hit || net;
    })
  );
});
