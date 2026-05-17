// ─────────────────────────────────────────────────────────────
//  config/index.js
//  Single source of truth for every tunable value in Circle.
//  Import what you need:
//    import { API, STORAGE_KEYS, POST } from './config/index.js';
// ─────────────────────────────────────────────────────────────

// ── API ───────────────────────────────────────────────────────
// Dynamically resolves to whatever host served the page —
// works on localhost, LAN (192.168.x.x), and production with no changes.
export const API = window.location.origin;

// ── Local / session storage keys ─────────────────────────────
// All keys in one place so a rename never silently breaks a reader.
export const STORAGE_KEYS = {
  TOKEN:              "circle_token",
  USER:               "circle_user",
  THEME:              "circle_theme",
  POST_CACHE:         "circle_post_cache_v1",
  NOTIF_PREFS:        "circle_notif_prefs",
  FINGERPRINT:        "circle_fp",
  E2E_KEYPAIR:        "circle_e2e_keypair",
  LIGHTBOX_NAV_AXIS:  "circle_lb_nav_axis",
  NEW_DISMISSED:      "circle_new_dismissed",
  NEW_DISMISSED_IDS:  "circle_new_dismissed_ids",
  REDIRECT_AFTER_LOGIN: "_redirectAfterLogin",   // sessionStorage
};

// ── Post cache ────────────────────────────────────────────────
export const CACHE = {
  // How long a feed page is considered fresh before a background re-fetch.
  TTL_MS:      5 * 60 * 1000,   // 5 minutes
  // Maximum number of post objects persisted to localStorage.
  MAX_STORED:  60,
  // How long to wait before flushing in-memory changes to localStorage
  // (debounces rapid consecutive mutations, e.g. rendering 20 posts at once).
  SAVE_DEBOUNCE_MS: 200,
};

// ── Pagination ────────────────────────────────────────────────
export const PAGINATION = {
  FEED_PAGE_SIZE:         20,
  PROFILE_PAGE_SIZE:      20,
  SEARCH_PAGE_SIZE:       20,
  NOTIFICATIONS_PAGE_SIZE: 10,
  GROUPS_PAGE_SIZE:       12,
  GROUP_FEED_PAGE_SIZE:   20,
  DM_MESSAGES_PAGE_SIZE:  10,
  USER_SEARCH_LIMIT:       8,
  TOPICS_LIMIT:           20,
  RECOMMENDATIONS_LIMIT:  12,
  NEW_MEMBERS_LIMIT:      20,
};

// ── Feed ──────────────────────────────────────────────────────
export const FEED = {
  // Max "new member" suggestion cards shown inline in the feed.
  NEW_MEMBER_CARD_LIMIT: 3,
  // Default tab on first load.
  DEFAULT_TAB: "global",
};

// ── Post / compose ────────────────────────────────────────────
export const POST = {
  // Hard character limit enforced on create and inline-edit.
  MAX_CHARS: 500,
  EDIT_MAX_CHARS: 500,
};

// ── Media uploads ─────────────────────────────────────────────
export const MEDIA = {
  // Hard size limits (bytes) — rejected before any upload attempt.
  IMAGE_MAX_BYTES:        10  * 1024 * 1024,  // 10 MB  (post images)
  VIDEO_MAX_BYTES:        200 * 1024 * 1024,  // 200 MB (post videos)
  AVATAR_MAX_BYTES:       100 * 1024 * 1024,  // 100 MB (profile photo)

  // Client-side image compression defaults.
  IMAGE_COMPRESS: {
    maxW:    1920,
    maxH:    1080,
    quality: 0.82,
  },

  // Profile-photo compression is slightly higher quality.
  AVATAR_COMPRESS: {
    maxW:    400,
    maxH:    400,
    quality: 0.88,
  },
};

// ── OTP / phone auth ──────────────────────────────────────────
export const OTP = {
  // Seconds before the "Resend code" button re-enables.
  RESEND_COUNTDOWN_SECS: 30,
  // Number of digit inputs in the OTP entry widget.
  DIGIT_COUNT: 6,
};

// ── Toast notifications ───────────────────────────────────────
export const TOAST = {
  // How long (ms) a toast stays visible before auto-hiding.
  DURATION_MS: 2800,
};

// ── Push / service worker ─────────────────────────────────────
// Replace VAPID_PUBLIC_KEY with your real key.
// Generate a new pair with:  npx web-push generate-vapid-keys
export const PUSH = {
  VAPID_PUBLIC_KEY:
    "BDrQXFG6fUBbN110-JFtCCpHYAcHYvIdoExS1tolzULYEOBI1Ky2d-Rdsk-q071dk1DE7o_n2sje_xvxLUOFPWQ",
  SW_PATH: "./sw.js",
};

// ── Routing ───────────────────────────────────────────────────
export const ROUTING = {
  // Views that should NOT push a history entry (back button skips them).
  NO_HISTORY_VIEWS: new Set(["login", "register", "reset", "new-password"]),
  // The view rendered on first load / after logout.
  DEFAULT_VIEW: "feed",
};

// ── Lightbox ──────────────────────────────────────────────────
export const LIGHTBOX = {
  // Default swipe/arrow navigation axis: "lr" = left-right, "ud" = up-down.
  DEFAULT_NAV_AXIS: "lr",
};

// ── App metadata ──────────────────────────────────────────────
export const APP = {
  NAME:        "Circle",
  TAGLINE:     "Where real connections happen.",
  THEME_DEFAULT: "dark",
};
