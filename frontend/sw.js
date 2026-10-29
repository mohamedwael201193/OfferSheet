/* OfferSheet service worker — READY-TO-MERGE file (do not edit the live tree from here).
 *
 * Caching rule, enforced in code below:
 *  - NEVER caches verdict responses: every request to /api/* is network-only,
 *    never read from and never written to any cache. A failed verdict fetch
 *    propagates as a network error, so the app shows its own honest error —
 *    never a stale verdict.
 *  - Caches ONLY static shell content: the landing + app HTML shells, styles,
 *    scripts, images and fonts served same-origin. Static assets use
 *    stale-while-revalidate so a redeploy reaches the phone on next visit.
 *  - Offline: a navigation that cannot reach the network serves offline.html
 *    (honest "needs connection" page, also a ready-to-merge file). The app
 *    itself never renders a verdict offline.
 *  - Cross-origin requests (including the Render backend API) are passed
 *    through untouched and never cached.
 */
'use strict';

var CACHE = 'offersheet-static-v1';
var OFFLINE_PAGE = '/offline.html';

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      // Shell only. No /api/* entry is ever added here or anywhere else.
      return cache.addAll([OFFLINE_PAGE]);
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function isApiRequest(url) {
  return url.pathname.indexOf('/api/') === 0;
}

function isStaticAsset(url) {
  return /\.(?:css|js|png|jpg|jpeg|webp|svg|woff|woff2|ico|webmanifest)$/i.test(url.pathname);
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  var url = new URL(req.url);

  // Rule 1: verdict/API traffic — network only, never cached, never served stale.
  // Only GET is cacheable at all; anything else passes through untouched.
  if (req.method !== 'GET' || isApiRequest(url) || url.origin !== self.location.origin) {
    event.respondWith(fetch(req));
    return;
  }

  // Rule 2: navigations — network first; offline falls back to the honest page.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(function () { return caches.match(OFFLINE_PAGE); })
    );
    return;
  }

  // Rule 3: same-origin static assets — stale-while-revalidate.
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(req).then(function (cached) {
        var network = fetch(req).then(function (res) {
          if (res && res.ok) {
            var copy = res.clone();
            caches.open(CACHE).then(function (cache) { cache.put(req, copy); });
          }
          return res;
        }).catch(function () { return cached; });
        return cached || network;
      })
    );
    return;
  }

  // Everything else same-origin: network only.
  event.respondWith(fetch(req));
});
