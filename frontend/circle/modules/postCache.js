// ── PostCache — in-memory + localStorage post caching ──────────────────────
// Strategy: in-memory Map for O(1) lookups, localStorage persistence,
// per-feed page cursors, 5-min TTL, stale-while-revalidate.

      const PostCache = (() => {
        const STORAGE_KEY = "circle_post_cache_v1";
        const TTL_MS = 5 * 60 * 1000; // 5 minutes
        const MAX_STORED = 60; // max posts kept in localStorage

        // In-memory structures
        const _byId = new Map(); // postId → post object
        const _feeds = {}; // "global|1" → { ids[], ts, hasMore }
        const _profiles = {}; // userId → { ids[], ts }

        // ── Persistence ─────────────────────────────────────────────
        function _save() {
          try {
            // Only persist the most recent posts to stay under 5MB quota
            const recent = [..._byId.values()]
              .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
              .slice(0, MAX_STORED);
            const payload = {
              posts: recent,
              feeds: _feeds,
              profiles: _profiles,
              savedAt: Date.now(),
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
          } catch (e) {
            // Storage quota exceeded — clear and retry once
            try {
              localStorage.removeItem(STORAGE_KEY);
            } catch (_) {}
          }
        }

        function _load() {
          try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            const { posts: stored, feeds, profiles } = JSON.parse(raw);
            if (Array.isArray(stored)) {
              stored.forEach((p) => _byId.set(p.id, p));
            }
            if (feeds) Object.assign(_feeds, feeds);
            if (profiles) Object.assign(_profiles, profiles);
          } catch (e) {
            try {
              localStorage.removeItem(STORAGE_KEY);
            } catch (_) {}
          }
        }

        // ── Cache key helpers ────────────────────────────────────────
        function _feedKey(tab, page) {
          return `${tab}|${page}`;
        }
        function _isStale(ts) {
          return !ts || Date.now() - ts > TTL_MS;
        }

        // ── Public API ───────────────────────────────────────────────
        return {
          // Called once at boot to hydrate from localStorage
          init() {
            _load();
          },

          // Store a page of posts from the API
          storeFeedPage(tab, page, newPosts, hasMore) {
            newPosts.forEach((p) => _byId.set(p.id, p));
            _feeds[_feedKey(tab, page)] = {
              ids: newPosts.map((p) => p.id),
              ts: Date.now(),
              hasMore,
            };
            _save();
          },

          // Get a cached page — returns null if missing or stale
          getFeedPage(tab, page) {
            const entry = _feeds[_feedKey(tab, page)];
            if (!entry || _isStale(entry.ts)) return null;
            const resolved = entry.ids
              .map((id) => _byId.get(id))
              .filter(Boolean);
            if (resolved.length !== entry.ids.length) return null; // partial — refetch
            return { posts: resolved, hasMore: entry.hasMore };
          },

          // Check freshness without resolving posts
          isFeedPageFresh(tab, page) {
            const entry = _feeds[_feedKey(tab, page)];
            return entry && !_isStale(entry.ts);
          },

          // Store profile posts
          storeProfile(userId, profilePosts) {
            profilePosts.forEach((p) => _byId.set(p.id, p));
            _profiles[userId] = {
              ids: profilePosts.map((p) => p.id),
              ts: Date.now(),
            };
            _save();
          },

          // Get cached profile posts
          getProfile(userId) {
            const entry = _profiles[userId];
            if (!entry || _isStale(entry.ts)) return null;
            return entry.ids.map((id) => _byId.get(id)).filter(Boolean);
          },

          // Get a single post by id
          getPost(id) {
            return _byId.get(id) || null;
          },

          // Upsert a single post (create / update)
          putPost(post) {
            _byId.set(post.id, post);
            _save();
          },

          // Remove a post
          removePost(id) {
            _byId.delete(id);
            // Purge from all feed pages and profiles
            Object.keys(_feeds).forEach((k) => {
              _feeds[k].ids = _feeds[k].ids.filter((i) => i !== id);
            });
            Object.keys(_profiles).forEach((k) => {
              _profiles[k].ids = _profiles[k].ids.filter((i) => i !== id);
            });
            _save();
          },

          // Patch a post in-place (likes, comments, reposts)
          patchPost(id, patchFn) {
            const post = _byId.get(id);
            if (post) {
              patchFn(post);
              _save();
            }
          },

          // Invalidate all pages for a feed tab (forces re-fetch on next load)
          invalidateFeed(tab) {
            Object.keys(_feeds).forEach((k) => {
              if (k.startsWith(tab + "|")) delete _feeds[k];
            });
            _save();
          },

          // Invalidate everything (e.g. on logout)
          clear() {
            _byId.clear();
            Object.keys(_feeds).forEach((k) => delete _feeds[k]);
            Object.keys(_profiles).forEach((k) => delete _profiles[k]);
            try {
              localStorage.removeItem(STORAGE_KEY);
            } catch (_) {}
          },

          // Debug info
          stats() {
            return {
              posts: _byId.size,
              feedKeys: Object.keys(_feeds).length,
              profiles: Object.keys(_profiles).length,
            };
          },
        };
      })();
      /* END PostCache ════════════════════════════════════════════════ */
