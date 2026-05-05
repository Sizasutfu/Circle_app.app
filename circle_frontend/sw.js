// ============================================================
//  sw.js  –  Circle Service Worker
//  Strategy:
//    • App shell (HTML, icons, manifest) → Cache-first
//    • API calls (/api/*)                → Network-only
//    • Static assets (JS/CSS inline)     → Cache-first
//    • Everything else                   → Network, fall back to cache
//    • Push notifications                → Show system notification
//                                           + deep-link on click
// ============================================================

const CACHE_NAME  = 'circle-v1';
const OFFLINE_URL = './index.html';

const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
];

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
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Push: receive and display notification ────────────────
//
//  Expected server payload (JSON):
//  {
//    title: "Alex liked your post",
//    body:  "Your post about the mountains…",
//    icon:  "./icon.svg",          // optional
//    badge: "./icon.svg",          // optional
//    tag:   "like-42",             // deduplication key
//    data: {
//      notifType: "like",          // like | comment | reply | repost
//                                  // mention | follow | new_post
//                                  // profile_pic | milestone
//      postId:    42,              // null for follow/profile_pic/milestone
//      actorId:   7,               // who triggered the notification
//      notifId:   123,             // DB row id – used to mark as read
//      url:       "./"             // fallback URL if app must be opened fresh
//    }
//  }
//
self.addEventListener('push', event => {
  let payload = {
    title: 'Circle',
    body:  'You have a new notification',
    icon:  './icon.svg',
    badge: './icon.svg',
    tag:   'circle-notification',
    data:  { url: './' },
  };

  if (event.data) {
    try {
      const incoming = event.data.json();
      payload = { ...payload, ...incoming };
      // Ensure nested data object is merged, not overwritten
      if (incoming.data) payload.data = { ...payload.data, ...incoming.data };
    } catch {
      payload.body = event.data.text();
    }
  }

  const options = {
    body:               payload.body,
    icon:               payload.icon  || './icon.svg',
    badge:              payload.badge || './icon.svg',
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
//
//  The notificationclick handler posts a NOTIFICATION_CLICK message
//  to the open page.  index.html's _handlePushNotifClick() reads it
//  and calls the appropriate navigation function (renderPostDetail,
//  viewProfile, etc.) — exactly the same logic as onNotifClick().
//
//  Message shape posted to the page:
//  {
//    type:      'NOTIFICATION_CLICK',
//    notifType: string | null,   // same as data.notifType
//    postId:    number | null,
//    actorId:   number | null,
//    notifId:   number | null,
//  }
//
self.addEventListener('notificationclick', event => {
  event.notification.close();

  const notifData = event.notification.data || {};
  const tag       = event.notification.tag  || '';

  // Primary source: structured data object from the server payload
  let notifType = notifData.notifType || null;
  let postId    = notifData.postId    ? Number(notifData.postId)  : null;
  let actorId   = notifData.actorId   ? Number(notifData.actorId) : null;
  let notifId   = notifData.notifId   ? Number(notifData.notifId) : null;
  const fallback = notifData.url || './';

  // Fallback: parse type and id from the notification tag when the server
  // doesn't yet include a structured data object.
  // Supported tag formats:
  //   "like-42"        → notifType=like,        postId=42
  //   "comment-42"     → notifType=comment,      postId=42
  //   "reply-42"       → notifType=reply,         postId=42
  //   "repost-42"      → notifType=repost,        postId=42
  //   "mention-42"     → notifType=mention,       postId=42
  //   "new_post-42"    → notifType=new_post,      postId=42
  //   "follow-7"       → notifType=follow,        actorId=7
  //   "profile_pic-7"  → notifType=profile_pic,  actorId=7
  //   "milestone"      → notifType=milestone
  //   "circle-welcome" → ignored (welcome toast)
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

  // Debug trace — visible in DevTools › Application › Service Workers
  console.log('[Circle SW] notificationclick', { notifType, postId, actorId, notifId, tag, notifData });

  // Build deep-link URL for the cold-start case (app not already open)
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
      // Prefer an already-open tab from this origin
      for (const client of windowClients) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          client.postMessage(msgPayload);
          return client.focus();
        }
      }

      // No open tab — open a new one; the hash will be read on load
      if (clients.openWindow) {
        return clients.openWindow(deepUrl);
      }
    })
  );
});

// ── Push subscription change: re-subscribe automatically ──
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

  // API calls → network only (never serve stale data)
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) {
    return;
  }

  // App shell + static assets → cache-first, network fallback
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
