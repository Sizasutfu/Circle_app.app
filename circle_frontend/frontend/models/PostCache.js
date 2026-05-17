// ─────────────────────────────────────────────────────────────
//  models/PostCache.js
//  In-memory post store with localStorage persistence.
//
//  Strategy:
//    • O(1) lookups via an in-memory Map keyed by post id
//    • localStorage snapshot for instant paint on revisit
//    • Per-feed page cursors — pagination never re-fetches seen pages
//    • TTL of 5 min per feed; stale data shown instantly then
//      background-refreshed (stale-while-revalidate)
//    • Mutations (create/delete/like/comment/repost) update both
//      the Map and the rendered DOM surgically — no full re-renders
//
//  Usage:
//    import PostCache from '../models/PostCache.js';
//    PostCache.init();                          // call once at boot
//    PostCache.storeFeedPage('global', 1, posts, hasMore);
//    const cached = PostCache.getFeedPage('global', 1);
// ─────────────────────────────────────────────────────────────

import { CACHE, STORAGE_KEYS } from "../config/index.js";
import { resolvePostMedia } from "../utils/media.js";

const PostCache = (() => {
  // ── In-memory structures ────────────────────────────────────
  const _byId     = new Map();  // postId → post object
  const _feeds    = {};         // "global|1" → { ids[], ts, hasMore }
  const _profiles = {};         // userId   → { ids[], ts }

  // ── Persistence ─────────────────────────────────────────────
  let _saveTimer = null;

  /**
   * Debounced write to localStorage.
   * Batches rapid consecutive mutations (e.g. rendering 20 posts at once)
   * into a single write CACHE.SAVE_DEBOUNCE_MS after the last call.
   */
  function _save() {
    if (_saveTimer) return;
    _saveTimer = setTimeout(() => {
      _saveTimer = null;
      try {
        const recent = [..._byId.values()]
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
          .slice(0, CACHE.MAX_STORED);
        const payload = {
          posts: recent,
          feeds: _feeds,
          profiles: _profiles,
          savedAt: Date.now(),
        };
        localStorage.setItem(
          STORAGE_KEYS.POST_CACHE,
          JSON.stringify(payload),
        );
      } catch {
        // Storage quota exceeded — clear and give up for this session
        try { localStorage.removeItem(STORAGE_KEYS.POST_CACHE); } catch { /* noop */ }
      }
    }, CACHE.SAVE_DEBOUNCE_MS);
  }

  /** Hydrate in-memory structures from localStorage on boot. */
  function _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.POST_CACHE);
      if (!raw) return;
      const { posts: stored, feeds, profiles } = JSON.parse(raw);
      if (Array.isArray(stored)) {
        stored.forEach((p) => _byId.set(p.id, p));
      }
      if (feeds)    Object.assign(_feeds,    feeds);
      if (profiles) Object.assign(_profiles, profiles);
    } catch {
      try { localStorage.removeItem(STORAGE_KEYS.POST_CACHE); } catch { /* noop */ }
    }
  }

  // ── Helpers ──────────────────────────────────────────────────
  const _feedKey  = (tab, page) => `${tab}|${page}`;
  const _isStale  = (ts) => !ts || Date.now() - ts > CACHE.TTL_MS;

  // ── Public API ───────────────────────────────────────────────
  return {

    /**
     * Call once at application boot to hydrate from localStorage.
     */
    init() {
      _load();
    },

    // ── Feed pages ─────────────────────────────────────────────

    /**
     * Store a page of posts returned from the API.
     * @param {string}  tab      - "global" | "following"
     * @param {number}  page     - 1-based page number
     * @param {Array}   newPosts - post objects from the API
     * @param {boolean} hasMore  - whether the API has a next page
     */
    storeFeedPage(tab, page, newPosts, hasMore) {
      newPosts.forEach((p) => _byId.set(p.id, p));
      _feeds[_feedKey(tab, page)] = {
        ids: newPosts.map((p) => p.id),
        ts: Date.now(),
        hasMore,
      };
      _save();
    },

    /**
     * Retrieve a cached page.
     * Returns null if missing, stale, or any post has been evicted.
     * @returns {{ posts: Array, hasMore: boolean } | null}
     */
    getFeedPage(tab, page) {
      const entry = _feeds[_feedKey(tab, page)];
      if (!entry || _isStale(entry.ts)) return null;
      const resolved = entry.ids.map((id) => _byId.get(id)).filter(Boolean);
      if (resolved.length !== entry.ids.length) return null; // partial — refetch
      return { posts: resolved, hasMore: entry.hasMore };
    },

    /**
     * Check freshness without resolving posts (cheap staleness check).
     * @returns {boolean}
     */
    isFeedPageFresh(tab, page) {
      const entry = _feeds[_feedKey(tab, page)];
      return !!(entry && !_isStale(entry.ts));
    },

    // ── Profile pages ──────────────────────────────────────────

    /**
     * Store all posts for a user's profile page.
     * @param {string} userId
     * @param {Array}  profilePosts
     */
    storeProfile(userId, profilePosts) {
      profilePosts.forEach((p) => _byId.set(p.id, p));
      _profiles[userId] = {
        ids: profilePosts.map((p) => p.id),
        ts: Date.now(),
      };
      _save();
    },

    /**
     * Retrieve cached profile posts.
     * Returns null if missing or stale.
     * @returns {Array | null}
     */
    getProfile(userId) {
      const entry = _profiles[userId];
      if (!entry || _isStale(entry.ts)) return null;
      return entry.ids.map((id) => _byId.get(id)).filter(Boolean);
    },

    // ── Single post ────────────────────────────────────────────

    /**
     * Retrieve a single post by id, with media URLs resolved.
     * Returns null if not cached.
     * @returns {object | null}
     */
    getPost(id) {
      const p = _byId.get(id) || null;
      if (p) resolvePostMedia(p);
      return p;
    },

    /**
     * Insert or update a single post (create / server-refresh).
     * @param {object} post
     */
    putPost(post) {
      _byId.set(post.id, post);
      _save();
    },

    /**
     * Apply a patch function to a post in-place.
     * Use for surgical mutations (likes, comment counts, repost flags)
     * that don't warrant a full re-fetch.
     * @param {string}   id
     * @param {Function} patchFn - receives the post object; mutate it directly
     */
    patchPost(id, patchFn) {
      const post = _byId.get(id);
      if (post) {
        patchFn(post);
        _save();
      }
    },

    /**
     * Remove a post from the cache and all feed / profile index arrays.
     * @param {string} id
     */
    removePost(id) {
      _byId.delete(id);
      Object.keys(_feeds).forEach((k) => {
        _feeds[k].ids = _feeds[k].ids.filter((i) => i !== id);
      });
      Object.keys(_profiles).forEach((k) => {
        _profiles[k].ids = _profiles[k].ids.filter((i) => i !== id);
      });
      _save();
    },

    // ── Invalidation ───────────────────────────────────────────

    /**
     * Invalidate all cached pages for a tab, forcing a fresh fetch next load.
     * @param {string} tab - "global" | "following"
     */
    invalidateFeed(tab) {
      Object.keys(_feeds).forEach((k) => {
        if (k.startsWith(tab + "|")) delete _feeds[k];
      });
      _save();
    },

    /**
     * Wipe the entire cache (called on logout).
     * Cancels any pending debounced save so stale data isn't written after logout.
     */
    clear() {
      _byId.clear();
      Object.keys(_feeds).forEach((k)    => delete _feeds[k]);
      Object.keys(_profiles).forEach((k) => delete _profiles[k]);
      if (_saveTimer) {
        clearTimeout(_saveTimer);
        _saveTimer = null;
      }
      try { localStorage.removeItem(STORAGE_KEYS.POST_CACHE); } catch { /* noop */ }
    },

    // ── Debug ──────────────────────────────────────────────────

    /** Return a summary of what's currently cached. */
    stats() {
      return {
        posts:     _byId.size,
        feedKeys:  Object.keys(_feeds).length,
        profiles:  Object.keys(_profiles).length,
      };
    },
  };
})();

export default PostCache;
