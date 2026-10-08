// Pass-through service worker (also a kill-switch for the previous caching SW).
//
// It caches NOTHING and purges any caches left by older versions. This prevents
// the "client-side exception" you get when a stale cached JS chunk from a
// previous deploy no longer matches the freshly deployed HTML. It still
// registers a fetch handler so the app stays installable as a PWA.

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Delete every cache from any previous service worker version.
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

// No event.respondWith() → the browser performs its normal network fetch,
// so assets are always fresh (Next.js already sets long-lived HTTP caching
// on its content-hashed files).
self.addEventListener("fetch", () => {});
