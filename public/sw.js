/**
 * GeeksPulse Service Worker
 *
 * Strategies:
 *   - Static shell (HTML, CSS, JS bundles)  → Cache-first, updated on each SW install
 *   - feed.json / feed-health.json          → Stale-while-revalidate (serve cache, refresh in bg)
 *   - Article images                        → Cache-first with network fallback (images are immutable)
 *   - Everything else                       → Network-first with cache fallback
 *
 * Cache names are versioned so old caches are purged on SW update.
 */

const SHELL_CACHE   = 'gp-shell-v1';
const FEED_CACHE    = 'gp-feed-v1';
const IMAGE_CACHE   = 'gp-images-v1';
const RUNTIME_CACHE = 'gp-runtime-v1';

const ALL_CACHES = [SHELL_CACHE, FEED_CACHE, IMAGE_CACHE, RUNTIME_CACHE];

// Static shell assets to precache on install
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/favicon.svg',
];

// ── Install: precache shell ───────────────────────────────────────

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: purge old caches ────────────────────────────────────

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => !ALL_CACHES.includes(k)).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: route requests ─────────────────────────────────────────

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin GET requests
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  const path = url.pathname;

  // feed.json and feed-health.json → stale-while-revalidate
  if (path === '/public/feed.json' || path === '/public/feed-health.json' ||
      path === '/feed.json'        || path === '/feed-health.json') {
    event.respondWith(staleWhileRevalidate(request, FEED_CACHE));
    return;
  }

  // Images → cache-first
  if (/\.(jpe?g|png|webp|avif|gif|svg)(\?|$)/i.test(path)) {
    event.respondWith(cacheFirst(request, IMAGE_CACHE, { maxEntries: 150 }));
    return;
  }

  // Shell assets → cache-first (already in SHELL_CACHE)
  if (SHELL_ASSETS.includes(path) || path === '/') {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }

  // JS / CSS bundles → cache-first
  if (/\.(js|css)(\?|$)/i.test(path)) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }

  // Everything else → network-first, fall back to cache
  event.respondWith(networkFirst(request, RUNTIME_CACHE));
});

// ── Strategy helpers ──────────────────────────────────────────────

async function cacheFirst(request, cacheName, { maxEntries } = {}) {
  const cache    = await caches.open(cacheName);
  const cached   = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      if (maxEntries) await trimCache(cache, maxEntries - 1);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline — asset unavailable', { status: 503 });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);
  // Kick off background revalidation regardless
  const networkPromise = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  // Serve cache immediately if available, otherwise await network
  return cached ?? (await networkPromise) ??
    new Response('Offline — feed unavailable', { status: 503 });
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    return cached ?? new Response('Offline', { status: 503 });
  }
}

// Trim a cache to at most `max` entries (LRU approximation — remove oldest keys)
async function trimCache(cache, max) {
  const keys = await cache.keys();
  if (keys.length > max) {
    await Promise.all(keys.slice(0, keys.length - max).map(k => cache.delete(k)));
  }
}

