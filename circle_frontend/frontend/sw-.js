// ============================================================
//  sw.js  –  Circle Service Worker
//  Strategy:
//    • App shell (HTML, JS, CSS, JSON)   → Cache-first (text only)
//    • API calls (/api/*)                → Stale-while-revalidate
//                                           (JSON responses only)
//    • Uploaded media (/uploads/*)       → Network only (never cached)
//    • Images, fonts, binary assets      → Network only (never cached)
//    • Everything else                   → Network, fall back to cache
//    • Push notifications                → Show system notification
//                                           + deep-link on click
// ============================================================

const CACHE_NAME    = 'circle-v6';
const API_CACHE     = 'circle-api-v6';
const OFFLINE_URL   = './index.html';

// Max age for cached API responses (5 minutes)
const API_MAX_AGE_MS    = 5 * 60 * 1000;
// Max number of API responses to cache
const API_MAX_ENTRIES   = 15;

const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  // icon.png excluded — only text assets are cached
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

// Strip imageUrl/videoUrl from a single post object
function stripPostMedia(post) {
  if (!post || typeof post !== 'object') return post;
  const clean = { ...post };
  delete clean.imageUrl;
  delete clean.videoUrl;
  delete clean.image;
  delete clean.video;
  return clean;
}

// Walk a parsed API response body and strip media from any post objects found
function stripMediaFromBody(body) {
  if (!body || typeof body !== 'object') return body;

  // Array of posts at root
  if (Array.isArray(body)) return body.map(stripPostMedia);

  const out = { ...body };

  // Common envelope shapes: { data: post[] }, { posts: post[] }, { data: { posts: post[] } }
  if (Array.isArray(out.data))            out.data    = out.data.map(stripPostMedia);
  if (Array.isArray(out.posts))           out.posts   = out.posts.map(stripPostMedia);
  if (out.data && Array.isArray(out.data.posts)) {
    out.data = { ...out.data, posts: out.data.posts.map(stripPostMedia) };
  }
  // Single post envelope: { data: post }
  if (out.data && !Array.isArray(out.data) && out.data.id) {
    out.data = stripPostMedia(out.data);
  }

  return out;
}

// Build a cache-safe Response with media stripped from JSON body
async function stripMediaFromResponse(response) {
  const ct = (response.headers.get('Content-Type') || '');
  if (!ct.includes('application/json')) return response;

  try {
    const body = await response.json();
    const clean = stripMediaFromBody(body);
    const headers = new Headers(response.headers);
    headers.set('sw-cached-at', Date.now().toString());
    return new Response(JSON.stringify(clean), {
      status:     response.status,
      statusText: response.statusText,
      headers,
    });
  } catch {
    // If JSON parsing fails, fall back to plain stamp
    return stampResponse(response);
  }
}

// Returns true if the cached response is older than API_MAX_AGE_MS
function isStale(cachedResponse) {
  const cachedAt = cachedResponse.headers.get('sw-cached-at');
  if (!cachedAt) return true;
  return Date.now() - parseInt(cachedAt, 10) > API_MAX_AGE_MS;
}

// Returns true only for text-based content types (HTML, JS, CSS, JSON, etc.)
// Images, fonts, audio, video, and other binary types are excluded.
const TEXT_CONTENT_TYPES = [
  'text/html',
  'text/css',
  'text/javascript',
  'application/javascript',
  'application/json',
  'text/plain',
  'application/manifest+json',
  'application/x-javascript',
];
function isTextResponse(response) {
  const ct = (response.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  return TEXT_CONTENT_TYPES.some(t => ct === t || ct.startsWith('text/'));
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
  const KEEP = [CACHE_NAME, API_CACHE];
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

  // ── Uploaded media → network only (not cached) ──────
  if (url.pathname.startsWith('/uploads/')) return;

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

    // Only cache posts endpoints — all other API calls are network-only
    const shouldCache = url.pathname.startsWith('/api/posts') ||
                        url.pathname.startsWith('/api/groups') && url.pathname.includes('/feed');

    if (!shouldCache) return;

    event.respondWith(
      caches.open(API_CACHE).then(async cache => {
        const cached = await cache.match(request);

        // Always fire a background network request to refresh the cache
        const networkFetch = fetch(request)
          .then(async response => {
            if (response && response.status === 200 && isTextResponse(response)) {
              const stripped = await stripMediaFromResponse(response.clone());
              await cache.put(request, stripped);
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