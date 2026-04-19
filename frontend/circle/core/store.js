// ── Global State Store ──────────────────────────────────────────────────────
// Holds shared mutable state. All modules read/write through these exports.
// currentUser is managed by modules/auth.js via setCurrentUser().

export const API = "http://192.168.180.203:5000";

export let posts             = [];
export let currentUser       = null;
export let pendingImageDataUrl = null;
export let pendingVideoDataUrl = null;
export let repostTargetId    = null;
export let currentFeedTab    = "global";
export let feedPage          = 1;
export let feedHasMore       = true;
export let feedLoading       = false;
export let notifPollTimer    = null;

// Setters ────────────────────────────────────────────────────────────────────
export function setPosts(v)               { posts = v; }
export function setCurrentUser(v)         { currentUser = v; }
export function setPendingImage(v)        { pendingImageDataUrl = v; }
export function setPendingVideo(v)        { pendingVideoDataUrl = v; }
export function setRepostTargetId(v)      { repostTargetId = v; }
export function setCurrentFeedTab(v)      { currentFeedTab = v; }
export function setFeedPage(v)            { feedPage = v; }
export function setFeedHasMore(v)         { feedHasMore = v; }
export function setFeedLoading(v)         { feedLoading = v; }
export function setNotifPollTimer(v)      { notifPollTimer = v; }
