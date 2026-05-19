// ============================================================
//  sw.js  –  Circle Service Worker
//  Strategy:
//    • App shell (HTML, icons, manifest) → Cache-first
//    • API calls (/api/*)                → Stale-while-revalidate
//                                           (serve cache, update in bg)
//    • Uploaded media (/uploads/*)       → Cache-first, network fallback
//    • Everything else                   → Network, fall back to cache
//    • Push notifications                → Show system notification
//                                           + deep-link on click
// ============================================================

const CACHE_NAME    = 'circle-v4';
const API_CACHE     = 'circle-api-v3';
const MEDIA_CACHE   = 'circle-media-v3';
const OFFLINE_URL   = './index.html';

// Max age for cached API responses (5 minutes)
const API_MAX_AGE_MS    = 30 * 60 * 1000;
// Max number of API responses to cache
const API_MAX_ENTRIES   = 20;
// Max number of media files to cache
const MEDIA_MAX_ENTRIES = 100;

const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './icon.png',
];

// ── Helpers ───────────────────────────────────────────────

// Stamp a response with a custom header so we can check its age later
function stampResponse(response) {
  const headers = new Headers(response.headers);
  headers.set('sw-cached-at', Date.now().toString());
  return new Response(response.body, {
    status:     response.status,
    statusText: response.statusText,
    headers,
  });
}

// Returns true if the cached response is older than API_MAX_AGE_MS
function isStale(cachedResponse) {
  const cachedAt = cachedResponse.headers.get('sw-cached-at');
  if (!cachedAt) return true;
  return Date.now() - parseInt(cachedAt, 10) > API_MAX_AGE_MS;
}

// Trim a cache to a max number of entries (evict oldest first)
async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys  = await cache.keys();
  if (keys.length > maxEntries) {
    await cache.delete(keys[0]);
    await trimCache(cacheName, maxEntries);
  }
}

// ── Install: pre-cache app shell ──────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: remove old caches ───────────────────────────
self.addEventListener('activate', event => {
  const KEEP = [CACHE_NAME, API_CACHE, MEDIA_CACHE];
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => !KEEP.includes(key))
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Push: receive and display notification ────────────────
self.addEventListener('push', event => {
  let payload = {
    title: 'Circle',
    body:  'You have a new notification',
    icon:  self.location.origin + '/icon.png',
    badge: self.location.origin + '/icon.png',
    tag:   'circle-notification',
    data:  { url: './' },
  };

  if (event.data) {
    try {
      const incoming = event.data.json();
      payload = { ...payload, ...incoming };
      if (incoming.data) payload.data = { ...payload.data, ...incoming.data };
    } catch {
      payload.body = event.data.text();
    }
  }

  const options = {
    body:               payload.body,
    icon:               payload.icon  || (self.location.origin + '/icon.png'),
    badge:              payload.badge || (self.location.origin + '/icon.png'),
    tag:                payload.tag   || 'circle-notification',
    data:               payload.data,
    vibrate:            [100, 50, 100],
    renotify:           true,
    requireInteraction: false,
    actions:            payload.actions || [],
  };

  event.waitUntil(
    self.registration.showNotification(payload.title, options)
  );
});

// ── Notification click: focus app and deep-navigate ───────
self.addEventListener('notificationclick', event => {
  event.notification.close();

  const notifData = event.notification.data || {};
  const tag       = event.notification.tag  || '';

  let notifType = notifData.notifType || null;
  let postId    = notifData.postId    ? Number(notifData.postId)  : null;
  let actorId   = notifData.actorId   ? Number(notifData.actorId) : null;
  let notifId   = notifData.notifId   ? Number(notifData.notifId) : null;
  const fallback = notifData.url || './';

  if (!notifType && tag && tag !== 'circle-welcome' && tag !== 'circle-notification') {
    const POST_TYPES  = ['like','comment','reply','repost','mention','new_post'];
    const ACTOR_TYPES = ['follow','profile_pic'];
    const dashIdx = tag.lastIndexOf('-');
    const tagType = dashIdx > -1 ? tag.slice(0, dashIdx) : tag;
    const tagId   = dashIdx > -1 ? parseInt(tag.slice(dashIdx + 1), 10) : null;

    if (POST_TYPES.includes(tagType)) {
      notifType = tagType;
      if (!postId && tagId) postId = tagId;
    } else if (ACTOR_TYPES.includes(tagType)) {
      notifType = tagType;
      if (!actorId && tagId) actorId = tagId;
    } else if (tag === 'milestone') {
      notifType = 'milestone';
    }
  }

  console.log('[Circle SW] notificationclick', { notifType, postId, actorId, notifId, tag, notifData });

  let deepUrl = fallback;
  if (notifType === 'follow' || notifType === 'profile_pic') {
    deepUrl = `${fallback}#notif:profile:${actorId || ''}`;
  } else if (postId) {
    deepUrl = `${fallback}#notif:post:${postId}`;
  } else if (notifType === 'milestone') {
    deepUrl = `${fallback}#notif:profile:me`;
  }

  const msgPayload = {
    type:      'NOTIFICATION_CLICK',
    notifType,
    postId,
    actorId,
    notifId,
  };

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          client.postMessage(msgPayload);
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(deepUrl);
      }
    })
  );
});

// ── Push subscription change ──────────────────────────────
self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil(
    self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: event.oldSubscription
        ? event.oldSubscription.options.applicationServerKey
        : null,
    }).then(subscription =>
      fetch('/api/push/subscribe', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ subscription }),
      })
    )
  );
});

// ── Fetch: route by request type ─────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Never intercept non-GET or cross-origin requests
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // ── Uploaded media → cache-first, network fallback ──
  // Profile pictures and post images/videos are cached aggressively
  // since they rarely change. Evict oldest when cache gets too large.
  if (url.pathname.startsWith('/uploads/')) {
    event.respondWith(
      caches.open(MEDIA_CACHE).then(async cache => {
        const cached = await cache.match(request);
        if (cached) return cached;

        try {
          const response = await fetch(request);
          if (response && response.status === 200) {
            cache.put(request, response.clone());
            trimCache(MEDIA_CACHE, MEDIA_MAX_ENTRIES);
          }
          return response;
        } catch {
          // Media unavailable offline — return nothing (browser shows broken img)
          return new Response('', { status: 503 });
        }
      })
    );
    return;
  }

  // ── API calls → stale-while-revalidate ──────────────
  // Serve cached response immediately (so feed loads offline),
  // then fetch fresh data in the background and update the cache.
  // Skip caching for mutation-heavy or auth endpoints.
  if (url.pathname.startsWith('/api/')) {
    const SKIP_CACHE = [
      '/api/auth',
      '/api/push',
      '/api/admin',
    ];
    const shouldSkip = SKIP_CACHE.some(p => url.pathname.startsWith(p));

    if (shouldSkip) return; // network-only for auth/push/admin

    event.respondWith(
      caches.open(API_CACHE).then(async cache => {
        const cached = await cache.match(request);

        // Always fire a background network request to refresh the cache
        const networkFetch = fetch(request)
          .then(async response => {
            if (response && response.status === 200) {
              const stamped = stampResponse(response.clone());
              await cache.put(request, stamped);
              trimCache(API_CACHE, API_MAX_ENTRIES);
            }
            return response;
          })
          .catch(() => null);

        // If we have a cached response, return it immediately
        // — even if stale, the background fetch will update it
        if (cached) {
          // If cache is fresh, no need to wait for network
          // If stale, still return cache but network update is in flight
          return cached;
        }

        // No cache — wait for network
        const networkResponse = await networkFetch;
        if (networkResponse) return networkResponse;

        // Fully offline and no cache — return empty JSON so the app
        // can handle it gracefully instead of throwing a fetch error
        return new Response(JSON.stringify({ offline: true, data: [] }), {
          status:  200,
          headers: { 'Content-Type': 'application/json' },
        });
      })
    );
    return;
  }

  // ── App shell + static assets → cache-first ─────────
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;

      return fetch(request)
        .then(response => {
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          return response;
        })
        .catch(() => {
          if (request.mode === 'navigate') return caches.match(OFFLINE_URL);
        });
    })
  );
});