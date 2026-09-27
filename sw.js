/**
 * GeeksPulse Service Worker
 *
 * Lives at the site root so its scope covers the whole app (GitHub Pages
 * serves the repository root, and cannot send a Service-Worker-Allowed header).
 *
 * Strategies:
 *   - Pages, CSS and JS modules      → Network-first, cache fallback (offline).
 *                                      The app ships unhashed ES modules, so a
 *                                      cache-first shell could pin visitors to
 *                                      stale code or mix module versions.
 *   - feed.json / feed-health.json   → Stale-while-revalidate
 *   - Same-origin images             → Cache-first (bounded)
 *   - Everything else same-origin    → Network-first with cache fallback
 *
 * Bump VERSION whenever caching behaviour changes; old caches are purged.
 */

const VERSION       = 'v2';
const SHELL_CACHE   = `gp-shell-${VERSION}`;
const FEED_CACHE    = `gp-feed-${VERSION}`;
const IMAGE_CACHE   = `gp-images-${VERSION}`;
const RUNTIME_CACHE = `gp-runtime-${VERSION}`;

const ALL_CACHES = [SHELL_CACHE, FEED_CACHE, IMAGE_CACHE, RUNTIME_CACHE];

// Minimal offline shell, precached on install
const SHELL_ASSETS = [
  '/',
  '/styles.css',
  '/favicon.svg',
  '/manifest.json',
];

// ── Install: precache shell ───────────────────────────────────────

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .catch(() => { /* a missing asset must not block installation */ })
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

  // Feed data → stale-while-revalidate
  if (path === '/public/feed.json' || path === '/public/feed-health.json' ||
      path === '/feed.json'        || path === '/feed-health.json') {
    event.respondWith(staleWhileRevalidate(request, FEED_CACHE));
    return;
  }

  // Page navigations → network-first, offline falls back to the cached home page
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, SHELL_CACHE, '/'));
    return;
  }

  // CSS / JS → network-first so deploys take effect on the next load
  if (/\.(js|mjs|css)(\?|$)/i.test(path)) {
    event.respondWith(networkFirst(request, SHELL_CACHE));
    return;
  }

  // Same-origin images (fallback art, icons) → cache-first
  if (/\.(jpe?g|png|webp|avif|gif|svg|ico)(\?|$)/i.test(path)) {
    event.respondWith(cacheFirst(request, IMAGE_CACHE, { maxEntries: 150 }));
    return;
  }

  // Everything else → network-first, fall back to cache
  event.respondWith(networkFirst(request, RUNTIME_CACHE));
});

// ── Strategy helpers ──────────────────────────────────────────────

async function cacheFirst(request, cacheName, { maxEntries } = {}) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);
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
  const cached = await cache.match(request, { ignoreSearch: true });
  // Kick off background revalidation regardless
  const networkPromise = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  // Serve cache immediately if available, otherwise await network
  return cached ?? (await networkPromise) ??
    new Response('Offline — feed unavailable', { status: 503 });
}

async function networkFirst(request, cacheName, fallbackPath) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request) ?? (fallbackPath ? await cache.match(fallbackPath) : undefined);
    return cached ?? new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }
}

// Trim a cache to at most `max` entries (LRU approximation — remove oldest keys)
async function trimCache(cache, max) {
  const keys = await cache.keys();
  if (keys.length > max) {
    await Promise.all(keys.slice(0, keys.length - max).map(k => cache.delete(k)));
  }
}
