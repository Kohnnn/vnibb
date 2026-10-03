/**
 * Service worker activation hook -- purge any cached private research share
 * responses (API, pages) that matched /research-shares/* before this worker
 * became active. This protects against replay of revoked or expired shares.
 *
 * This static script is loaded by next-pwa via the `importScripts` option
 * in next.config.ts, executed before the generated Workbox code, and
 * attaches its handler directly to self in the ServiceWorker global scope.
 */

const PRIVATE_SHARE_PATH_RE = /\/research-shares(\/|$)/;

/**
 * Iterate over all registered caches (apis, others, cross-origin, etc.) and
 * delete every request whose URL pathname matches /research-shares. This
 * removes snapshots cached by older worker versions (or by the default
 * NetworkFirst rules for /api/* etc.).
 */
async function purgeCachedPrivateShares() {
  const cacheNames = await caches.keys();
  for (const cacheName of cacheNames) {
    const cache = await caches.open(cacheName);
    const requests = await cache.keys();
    const privateShareRequests = requests.filter((request) =>
      PRIVATE_SHARE_PATH_RE.test(new URL(request.url).pathname)
    );
    if (privateShareRequests.length > 0) {
      await Promise.all(privateShareRequests.map((request) => cache.delete(request)));
    }
  }
}

self.addEventListener("activate", (event) => {
  event.waitUntil(purgeCachedPrivateShares());
});
