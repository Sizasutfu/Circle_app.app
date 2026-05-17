// ─────────────────────────────────────────────────────────────
//  models/state.js
//  Central store for every piece of mutable runtime state.
//
//  Rules:
//    • No DOM access. No fetch calls. Pure data only.
//    • Controllers and services import the atoms they need.
//    • Call resetState() on logout to wipe everything back to defaults.
// ─────────────────────────────────────────────────────────────

import { FEED, ROUTING, LIGHTBOX } from "../config/index.js";

// ── Auth ──────────────────────────────────────────────────────
// The signed-in user object (id, name, email, picture, …) or null.
export let currentUser = null;

export function setCurrentUser(user) {
  currentUser = user;
}

// ── Following ─────────────────────────────────────────────────
// Set of user IDs that currentUser follows.  Populated lazily on login.
export const followingSet = new Set();
export let followingSetLoaded = false;

export function setFollowingSetLoaded(val) {
  followingSetLoaded = val;
}

// ── Feed ──────────────────────────────────────────────────────
// The currently active tab ("global" | "following").
export let currentFeedTab = FEED.DEFAULT_TAB;

export function setCurrentFeedTab(tab) {
  currentFeedTab = tab;
}

// Master post array — never wiped on tab switch; only on logout/full reload.
export let masterPosts = [];

// Per-tab scroll + pagination cursor (restored when switching back).
export const tabState = {
  global:    { scrollY: 0, page: 1, hasMore: true },
  following: { scrollY: 0, page: 1, hasMore: true },
};

// Scroll position saved when navigating away from the feed view.
export let feedScrollY = 0;

export function setFeedScrollY(y) {
  feedScrollY = y;
}

// Legacy flat pagination vars — kept for any code that still reads them
// directly until it's migrated to tabState.
export let feedPage    = 1;
export let feedHasMore = true;
export let feedLoading = false;

export function setFeedPage(v)    { feedPage    = v; }
export function setFeedHasMore(v) { feedHasMore = v; }
export function setFeedLoading(v) { feedLoading = v; }

// Live-feed polling state.
export let liveQueue   = [];   // new posts waiting to be injected
export let liveSeenIds = new Set();
export let liveTimer   = null;

export function setLiveTimer(t) { liveTimer = t; }

// ── Compose (modal) ───────────────────────────────────────────
export let pendingImageDataUrl   = null;
export let pendingVideoDataUrl   = null;
export let pendingVideoCompressed = false;
export let repostTargetId         = null;

export function setPendingImage(url)           { pendingImageDataUrl    = url; }
export function setPendingVideo(url, compressed = false) {
  pendingVideoDataUrl      = url;
  pendingVideoCompressed   = compressed;
}
export function setRepostTargetId(id)          { repostTargetId         = id; }

// ── Compose tab (full-screen create view) ────────────────────
export let composeTabPendingImage    = null;
export let composeTabPendingVideo    = null;
export let composeTabVideoCompressed = false;
export let composePrevView           = "feed";

export function setComposeTabPendingImage(v)    { composeTabPendingImage    = v; }
export function setComposeTabPendingVideo(v, c = false) {
  composeTabPendingVideo    = v;
  composeTabVideoCompressed = c;
}
export function setComposePrevView(v)           { composePrevView = v; }

// ── Inline post editing ───────────────────────────────────────
export let editingPostId = null;
export function setEditingPostId(id) { editingPostId = id; }

// ── Profile view ──────────────────────────────────────────────
export let profileUserId = null;
export function setProfileUserId(id) { profileUserId = id; }

// ── Search ────────────────────────────────────────────────────
export let searchTab      = "posts";
export let searchTimer    = null;   // debounce timer handle
export let searchAbort    = null;   // AbortController for in-flight request
export let searchPage     = 1;
export let searchHasMore  = false;
export let searchLastQ    = "";

export function setSearchTab(v)     { searchTab     = v; }
export function setSearchTimer(v)   { searchTimer   = v; }
export function setSearchAbort(v)   { searchAbort   = v; }
export function setSearchPage(v)    { searchPage    = v; }
export function setSearchHasMore(v) { searchHasMore = v; }
export function setSearchLastQ(v)   { searchLastQ   = v; }

// ── Notifications ─────────────────────────────────────────────
export let notifPollTimer   = null;
export let notifPage        = 1;
export let notifHasMore     = true;
export let notifLoading     = false;
export let notifItems       = [];
export let prevNotifCount   = null;

export function setNotifPollTimer(v)  { notifPollTimer = v; }
export function setNotifPage(v)       { notifPage      = v; }
export function setNotifHasMore(v)    { notifHasMore   = v; }
export function setNotifLoading(v)    { notifLoading   = v; }
export function setNotifItems(v)      { notifItems     = v; }
export function setPrevNotifCount(v)  { prevNotifCount = v; }

// ── Reporting ─────────────────────────────────────────────────
export let reportTargetPostId = null;
export function setReportTargetPostId(id) { reportTargetPostId = id; }

// ── Post detail ───────────────────────────────────────────────
export let postDetailPrevView = "feed";
export let postDetailScrollY  = 0;

export function setPostDetailPrevView(v) { postDetailPrevView = v; }
export function setPostDetailScrollY(v)  { postDetailScrollY  = v; }

// ── Lightbox ──────────────────────────────────────────────────
export let lbItems        = [];
export let lbIndex        = 0;
export let lbDragStartX   = 0;
export let lbDragStartY   = 0;
export let lbPinchStartDist = 0;
export let lbScale        = 1;
export let lbSwipeStartX  = 0;
export let lbSwipeStartY  = 0;
export let lbMeta         = [];
export let lbPostId       = null;
export let lbReplyToId    = null;
export let lbSelectedReason = null;
export let lbNavAxis = LIGHTBOX.DEFAULT_NAV_AXIS;

export function setLbNavAxis(v) { lbNavAxis = v; }
export function setLbPostId(v)  { lbPostId  = v; }
export function setLbItems(items, index = 0) {
  lbItems = items;
  lbIndex = index;
}

// ── Explore / trending ────────────────────────────────────────
export let exploreLoaded      = false;
export let trendingRaw        = [];
export let trendingCategory   = "all";
export let trendingSort       = "hot";
export let trendingWords      = [];
export let trendingLoading    = false;
export let trendingLoaded     = false;
export let activeFilter       = null;

export function setTrendingCategory(v) { trendingCategory = v; }
export function setTrendingSort(v)     { trendingSort     = v; }
export function setActiveFilter(v)     { activeFilter     = v; }

// ── Topic feed ────────────────────────────────────────────────
export let topicFeedCurrent = null;
export let topicFeedPage    = 1;
export let topicFeedMore    = true;
export let topicFeedLoading = false;

export function setTopicFeedCurrent(v) { topicFeedCurrent = v; }
export function setTopicFeedPage(v)    { topicFeedPage    = v; }
export function setTopicFeedMore(v)    { topicFeedMore    = v; }
export function setTopicFeedLoading(v) { topicFeedLoading = v; }

// ── New-member suggestions (inline feed cards) ────────────────
export let newMembers        = [];
export let newMembersLoaded  = false;
export let feedNewDismissed  = false;  // hydrated from localStorage at boot
export let feedNewIndex      = 0;
export let dismissedNewIds   = new Set();

export function setFeedNewDismissed(v) { feedNewDismissed = v; }
export function setFeedNewIndex(v)     { feedNewIndex     = v; }

// ── Inline suggestion widget ──────────────────────────────────
export let suggestionsLoaded  = false;
export let feedSugUsers       = [];
export let feedSugDismissed   = false;

export function setFeedSugDismissed(v) { feedSugDismissed = v; }

// ── Groups ────────────────────────────────────────────────────
export let groupsPage        = 1;
export let groupsHasMore     = false;
export let groupsLoading     = false;
export let groupsList        = [];
export let currentGroup      = null;
export let groupFeedPage     = 1;
export let groupFeedHasMore  = false;
export let groupFeedLoading  = false;
export let groupFeedPosts    = [];
export let activeGroupTab    = "feed";
export let groupComposePendingImage = null;
export let groupComposePendingVideo = null;

export function setGroupComposePendingImage(v) { groupComposePendingImage = v; }
export function setGroupComposePendingVideo(v) { groupComposePendingVideo = v; }

export function setCurrentGroup(g)       { currentGroup      = g; }
export function setActiveGroupTab(v)     { activeGroupTab    = v; }
export function setGroupsPage(v)         { groupsPage        = v; }
export function setGroupsHasMore(v)      { groupsHasMore     = v; }
export function setGroupsLoading(v)      { groupsLoading     = v; }
export function setGroupFeedPage(v)      { groupFeedPage     = v; }
export function setGroupFeedHasMore(v)   { groupFeedHasMore  = v; }
export function setGroupFeedLoading(v)   { groupFeedLoading  = v; }

// ── DMs ───────────────────────────────────────────────────────
export let dmSearchDebounce  = null;
export function setDmSearchDebounce(v) { dmSearchDebounce = v; }

// ── Routing ───────────────────────────────────────────────────
export let historyNavigating = false;
export const navStack        = [ROUTING.DEFAULT_VIEW];

export function setHistoryNavigating(v) { historyNavigating = v; }

// ── Service worker ────────────────────────────────────────────
export let swRegistration = null;
export function setSwRegistration(r) { swRegistration = r; }

// ── OTP ───────────────────────────────────────────────────────
export let otpTimerInterval = null;
export function setOtpTimerInterval(v) { otpTimerInterval = v; }

// ── Toast ─────────────────────────────────────────────────────
export let toastTimer = null;
export function setToastTimer(v) { toastTimer = v; }

// ── Scroll / intersection observers (feed) ────────────────────
export let scrollObserver   = null;
export let prefetchObserver = null;
export let prefetching      = false;

export function setScrollObserver(v)   { scrollObserver   = v; }
export function setPrefetchObserver(v) { prefetchObserver = v; }
export function setPrefetching(v)      { prefetching      = v; }

// ── FFmpeg (video compression) ────────────────────────────────
export let ffmpegInstance    = null;
export let ffmpegLoaded      = false;
export let ffmpegUnavailable = false;  // true if CDN load failed

export function setFfmpegInstance(v)    { ffmpegInstance    = v; }
export function setFfmpegLoaded(v)      { ffmpegLoaded      = v; }
export function setFfmpegUnavailable(v) { ffmpegUnavailable = v; }

// ─────────────────────────────────────────────────────────────
//  resetState()
//  Called on logout. Wipes all runtime state back to defaults
//  without touching anything in localStorage (that's the caller's job).
// ─────────────────────────────────────────────────────────────
export function resetState() {
  currentUser           = null;
  followingSet.clear();
  followingSetLoaded    = false;

  currentFeedTab        = FEED.DEFAULT_TAB;
  masterPosts           = [];
  tabState.global       = { scrollY: 0, page: 1, hasMore: true };
  tabState.following    = { scrollY: 0, page: 1, hasMore: true };
  feedScrollY           = 0;
  feedPage              = 1;
  feedHasMore           = true;
  feedLoading           = false;

  liveQueue             = [];
  liveSeenIds           = new Set();
  if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }

  pendingImageDataUrl   = null;
  pendingVideoDataUrl   = null;
  pendingVideoCompressed = false;
  repostTargetId        = null;

  editingPostId         = null;
  profileUserId         = null;

  notifItems            = [];
  notifPage             = 1;
  notifHasMore          = true;
  notifLoading          = false;
  prevNotifCount        = null;
  if (notifPollTimer) { clearInterval(notifPollTimer); notifPollTimer = null; }

  searchPage            = 1;
  searchHasMore         = false;
  searchLastQ           = "";

  newMembers            = [];
  newMembersLoaded      = false;
  feedNewDismissed      = false;
  feedNewIndex          = 0;
  dismissedNewIds       = new Set();

  suggestionsLoaded     = false;
  feedSugUsers          = [];
  feedSugDismissed      = false;

  groupsList            = [];
  currentGroup          = null;
  groupFeedPosts        = [];
  activeGroupTab        = "feed";
}