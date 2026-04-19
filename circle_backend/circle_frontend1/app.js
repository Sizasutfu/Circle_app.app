const API = "http://localhost:5000";
let posts = [],
  currentUser = null,
  pendingImageDataUrl = null,
  repostTargetId = null;
let currentFeedTab = "global";
let feedPage = 1,
  feedHasMore = true,
  feedLoading = false;

/* ═══════════════════════════════════════════════════════════════
   POST CACHE  —  in-memory + localStorage persistence
   ═══════════════════════════════════════════════════════════════
   Strategy:
     • In-memory Map for O(1) lookups by post id
     • localStorage snapshot for instant paint on revisit
     • Per-feed page cursors so pagination never re-fetches seen pages
     • TTL of 5 min per feed; stale data shown instantly then
       background-refreshed (stale-while-revalidate)
     • Mutations (create/delete/like/comment/repost) update both
       the in-memory cache and the rendered DOM surgically — no
       full re-renders unless necessary
═══════════════════════════════════════════════════════════════ */
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

/*  API  */
async function api(method, path, body = null) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  // Attach auth header so protected routes (follow/unfollow) work
  if (currentUser) opts.headers["X-User-Id"] = currentUser.id;
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(API + path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || "Something went wrong.");
  return data;
}

/*  THEME */
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("circle_theme", theme);
  const isLight = theme === "light";
  const cb = document.getElementById("theme-toggle");
  if (cb) cb.checked = isLight;
  const icon = document.getElementById("theme-icon-top");
  if (icon)
    icon.innerHTML = isLight
      ? '<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>'
      : '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
}
function toggleTheme() {
  applyTheme(
    document.documentElement.getAttribute("data-theme") === "dark"
      ? "light"
      : "dark",
  );
}

/*NAV */
function goTo(view) {
  document
    .querySelectorAll(".view")
    .forEach((v) => v.classList.remove("active"));
  document.getElementById("view-" + view).classList.add("active");
  document
    .querySelectorAll(".nav-item")
    .forEach((n) => n.classList.remove("active"));
  const sn = document.getElementById("snav-" + view);
  if (sn) sn.classList.add("active");
  document
    .querySelectorAll(".mnav-item")
    .forEach((n) => n.classList.remove("active"));
  const mn = document.getElementById("mnav-" + view);
  if (mn) mn.classList.add("active");
  if (view === "messages") {
    if (!currentUser) {
      goTo("login");
      return;
    }
    DM.init(); // reload inbox from backend
  }
  if (view === "feed") loadPosts();
  if (view === "profile") renderProfile();
  if (view === "feed" && currentUser && !_suggestionsLoaded)
    loadSuggestions();
  if (view === "feed" && currentUser && !_newMembersLoaded)
    loadNewMembers();
  if (view === "feed" && !currentUser) {
    const sw = document.getElementById("suggestions-widget");
    if (sw) sw.style.display = "none";
    // Show feed tabs for guests too (Following tab will redirect to login)
    const ft = document.getElementById("feed-tabs");
    if (ft) ft.style.display = "flex";
    // Hide the Following tab label hint for guests
    const ftFollowing = document.getElementById("ftab-following");
    if (ftFollowing) ftFollowing.style.opacity = "0.5";
  }
  if (view === "settings") populateSettings();
  if (view === "explore") loadExplore();
  if (view === "search") {
    searchTab = "posts";
    document.getElementById("search-input").value = "";
    renderSearchHint();
  }
  window.scrollTo(0, 0);
}

/*AUTH  */
async function registerUser() {
  const name = document.getElementById("reg-name").value.trim();
  const email = document.getElementById("reg-email").value.trim();
  const password = document.getElementById("reg-password").value;
  const dialCode = document.getElementById("reg-dial-code").value;
  const phoneRaw = document.getElementById("reg-phone").value.trim();
  const phone = phoneRaw ? dialCode + phoneRaw.replace(/\D/g, "") : undefined;
  const el = document.getElementById("register-alert");
  el.className = "alert";
  if (!name || !email || !password)
    return showAlert(el, "All fields are required.", "error");
  if (password.length < 6)
    return showAlert(el, "Password must be at least 6 characters.", "error");
  try {
    const res = await api("POST", "/api/users/register", {
      name, email, password,
      phone: phone || undefined,
    });
    setCurrentUser(res.data);
    showAlert(el, "Account created! Welcome 🎉", "success");
    setTimeout(() => goTo("feed"), 900);
  } catch (e) {
    showAlert(el, e.message, "error");
  }
}

async function loginUser() {
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  const el = document.getElementById("login-alert");
  el.className = "alert";
  if (!email || !password)
    return showAlert(el, "Email and password are required.", "error");
  try {
    const res = await api("POST", "/api/users/login", {
      email,
      password,
    });
    setCurrentUser(res.data);
    showToast("Welcome back, " + res.data.name.split(" ")[0] + "! 👋");
    setTimeout(() => goTo("feed"), 400);
  } catch (e) {
    showAlert(el, e.message, "error");
  }
}

/* ── PHONE / OTP AUTH ─────────────────────────────────────────── */
let _otpTimerInterval = null;

function switchLoginMethod(method) {
  const isPhone = method === "phone";
  document.getElementById("login-tab-email").classList.toggle("active", !isPhone);
  document.getElementById("login-tab-phone").classList.toggle("active", isPhone);
  document.getElementById("login-email-method").style.display = isPhone ? "none" : "block";
  document.getElementById("login-phone-method").style.display = isPhone ? "block" : "none";
  document.getElementById("login-alert").className = "alert";
  if (isPhone) {
    // Reset to step 1
    phoneLoginBack();
    setTimeout(() => document.getElementById("login-phone-number").focus(), 80);
  }
}

function phoneLoginBack() {
  document.getElementById("login-phone-step1").classList.add("active");
  document.getElementById("login-phone-step2").classList.remove("active");
  _clearOtpTimer();
  _clearOtpDigits("login");
}

async function phoneLoginSendOtp(isResend = false) {
  const dialCode = document.getElementById("login-dial-code").value;
  const raw = document.getElementById("login-phone-number").value.trim();
  const el = document.getElementById("login-alert");
  el.className = "alert";

  if (!raw) return showAlert(el, "Please enter your phone number.", "error");
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 5) return showAlert(el, "Please enter a valid phone number.", "error");

  const phone = dialCode + digits;
  const btn = document.getElementById("login-send-otp-btn");
  if (btn) { btn.disabled = true; btn.textContent = "Sending…"; }

  try {
    await api("POST", "/api/auth/phone/send-otp", { phone });
    document.getElementById("login-otp-phone-display").textContent = dialCode + " " + raw;
    document.getElementById("login-phone-step1").classList.remove("active");
    document.getElementById("login-phone-step2").classList.add("active");
    _clearOtpDigits("login");
    setTimeout(() => document.querySelector("#login-otp-group .otp-digit").focus(), 80);
    _startOtpTimer("login");
    if (isResend) showToast("New code sent! 📱");
  } catch (e) {
    showAlert(el, e.message || "Failed to send code. Please try again.", "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Send Code"; }
  }
}

async function phoneLoginVerifyOtp() {
  const dialCode = document.getElementById("login-dial-code").value;
  const raw = document.getElementById("login-phone-number").value.trim().replace(/\D/g, "");
  const phone = dialCode + raw;
  const code = _getOtpValue("login");
  const el = document.getElementById("login-alert");
  el.className = "alert";

  if (code.length < 6) return showAlert(el, "Please enter the full 6-digit code.", "error");

  const btn = document.getElementById("login-verify-otp-btn");
  if (btn) { btn.disabled = true; btn.textContent = "Verifying…"; }

  try {
    const res = await api("POST", "/api/auth/phone/verify-otp", { phone, code });
    _clearOtpTimer();
    setCurrentUser(res.data);
    showToast("Welcome back, " + res.data.name.split(" ")[0] + "! 👋");
    setTimeout(() => goTo("feed"), 400);
  } catch (e) {
    showAlert(el, e.message || "Invalid code. Please try again.", "error");
    _shakeOtpGroup("login");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Verify & Sign In"; }
  }
}

// ── OTP input helpers ─────────────────────────────────────────
function otpInput(el, prefix) {
  el.value = el.value.replace(/\D/g, "").slice(-1);
  el.classList.toggle("filled", !!el.value);
  if (el.value) {
    const next = el.nextElementSibling;
    if (next && next.classList.contains("otp-digit")) next.focus();
    else {
      // All filled — auto-submit
      if (prefix === "login") phoneLoginVerifyOtp();
    }
  }
}

function otpKeydown(e, el, prefix) {
  if (e.key === "Backspace" && !el.value) {
    const prev = el.previousElementSibling;
    if (prev && prev.classList.contains("otp-digit")) {
      prev.value = "";
      prev.classList.remove("filled");
      prev.focus();
    }
  }
  if (e.key === "ArrowLeft") { const prev = el.previousElementSibling; if (prev && prev.classList.contains("otp-digit")) prev.focus(); }
  if (e.key === "ArrowRight") { const next = el.nextElementSibling; if (next && next.classList.contains("otp-digit")) next.focus(); }
  if (e.key === "Enter") { if (prefix === "login") phoneLoginVerifyOtp(); }
}

function otpPaste(e, prefix) {
  e.preventDefault();
  const text = (e.clipboardData || window.clipboardData).getData("text").replace(/\D/g, "").slice(0, 6);
  const digits = document.querySelectorAll(`#${prefix}-otp-group .otp-digit`);
  text.split("").forEach((ch, i) => {
    if (digits[i]) { digits[i].value = ch; digits[i].classList.add("filled"); }
  });
  const lastFilled = Math.min(text.length, 5);
  if (digits[lastFilled]) digits[lastFilled].focus();
  if (text.length === 6) {
    if (prefix === "login") setTimeout(phoneLoginVerifyOtp, 120);
  }
}

function _getOtpValue(prefix) {
  return [...document.querySelectorAll(`#${prefix}-otp-group .otp-digit`)]
    .map(d => d.value).join("");
}

function _clearOtpDigits(prefix) {
  document.querySelectorAll(`#${prefix}-otp-group .otp-digit`).forEach(d => {
    d.value = "";
    d.classList.remove("filled");
  });
}

function _shakeOtpGroup(prefix) {
  const g = document.getElementById(`${prefix}-otp-group`);
  if (!g) return;
  g.style.animation = "none";
  g.offsetHeight; // reflow
  g.style.animation = "otpShake 0.4s ease";
  setTimeout(() => { g.style.animation = ""; _clearOtpDigits(prefix); document.querySelector(`#${prefix}-otp-group .otp-digit`).focus(); }, 420);
}

function _startOtpTimer(prefix) {
  _clearOtpTimer();
  let secs = 30;
  const timerEl = document.getElementById(`${prefix}-otp-timer`);
  const resendBtn = document.getElementById(`${prefix}-resend-btn`);
  if (resendBtn) resendBtn.disabled = true;
  const tick = () => {
    if (timerEl) timerEl.textContent = `(${secs}s)`;
    if (secs <= 0) {
      _clearOtpTimer();
      if (resendBtn) { resendBtn.disabled = false; }
      if (timerEl) timerEl.textContent = "";
      return;
    }
    secs--;
    _otpTimerInterval = setTimeout(tick, 1000);
  };
  tick();
}

function _clearOtpTimer() {
  if (_otpTimerInterval) { clearTimeout(_otpTimerInterval); _otpTimerInterval = null; }
}

function logout() {
  currentUser = null;
  localStorage.removeItem("circle_user");
  // ── Cache: clear all cached data on logout ──────────────────
  PostCache.clear();
  posts = [];
  document.getElementById("sidebar-user-area").style.display = "none";
  document.getElementById("compose-box").style.display = "none";
  document.getElementById("login-nudge").style.display = "flex";
  document.getElementById("feed-tabs").style.display = "none";
  const ta = document.getElementById("topbar-avatar");
  if (ta) {
    ta.style.background = "var(--border2)";
    ta.innerHTML = `<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="16" height="16"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
  }
  stopNotifPolling();
  updateNotifBadge(0);
  E2E.clearCache();
  showToast("Logged out successfully.");
  goTo("feed");
}

function setCurrentUser(user) {
  _suggestionsLoaded = false;
  _feedSugDismissed  = false;
  _feedSugUsers      = [];
  _newMembersLoaded  = false;
  _feedNewDismissed  = false;
  _newMembers        = [];
  if (
    user &&
    document.getElementById("view-feed").classList.contains("active")
  ) {
    setTimeout(loadSuggestions, 700);
  }
  currentUser = user;
  localStorage.setItem("circle_user", JSON.stringify(user));
  const initial = user.name.charAt(0).toUpperCase(),
    color = stringToColor(user.name);
  const pic = user.picture || null;

  function applyAv(el) {
    if (!el) return;
    if (pic) {
      el.style.background = "transparent";
      el.innerHTML = `<img src="${pic}" alt="${initial}" loading="lazy" style="width:100%;height:100%;border-radius:inherit;object-fit:cover;display:block"/>`;
    } else {
      el.innerHTML = initial;
      el.style.background = color;
    }
  }

  const sa = document.getElementById("sb-avatar");
  applyAv(sa);
  document.getElementById("sb-name").textContent = user.name;
  document.getElementById("sb-email").textContent = user.email;
  document.getElementById("sidebar-user-area").style.display = "block";
  const ca = document.getElementById("compose-av");
  applyAv(ca);
  const ta = document.getElementById("topbar-avatar");
  if (ta) {
    ta.style.display = "grid";
    if (pic) {
      ta.style.background = "transparent";
      ta.innerHTML = `<img src="${pic}" alt="${initial}" loading="lazy" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block"/>`;
    } else {
      ta.innerHTML = initial;
      ta.style.background = color;
    }
  }
  document.getElementById("compose-box").style.display = "block";
  document.getElementById("login-nudge").style.display = "none";
  document.getElementById("feed-tabs").style.display = "flex";
  startNotifPolling();
  loadSuggestions();
  // Generate / load E2E key-pair and publish public key to server
  E2E.publishMyPublicKey().catch(() => {});
}

async function sendResetEmail() {
  const email = document.getElementById("reset-email").value.trim();
  const el = document.getElementById("reset-alert");
  el.className = "alert";
  if (!email) return showAlert(el, "Please enter your email.", "error");
  try {
    await api("POST", "/api/users/reset-password", { email });
    showAlert(
      el,
      "If that email exists, a reset link has been sent.",
      "success",
    );
  } catch (e) {
    showAlert(el, e.message, "error");
  }
}

async function setNewPassword() {
  const pw = document.getElementById("newpw-password").value;
  const cfm = document.getElementById("newpw-confirm").value;
  const el = document.getElementById("newpw-alert");
  el.className = "alert";

  if (!pw || pw.length < 6)
    return showAlert(
      el,
      "Password must be at least 6 characters.",
      "error",
    );
  if (pw !== cfm)
    return showAlert(el, "Passwords do not match.", "error");

  const token = new URLSearchParams(window.location.search).get("token");
  if (!token)
    return showAlert(el, "Invalid or expired reset link.", "error");

  try {
    await api("POST", "/api/users/reset-password/confirm", {
      token,
      password: pw,
    });
    showAlert(el, "Password updated! Redirecting to login…", "success");
    history.replaceState({}, "", window.location.pathname); // strip ?token from URL
    setTimeout(() => goTo("login"), 1400);
  } catch (e) {
    showAlert(el, e.message, "error");
  }
}

/* SETTINGS */
function populateSettings() {
  if (!currentUser) {
    goTo("login");
    return;
  }
  document.getElementById("settings-name").value = currentUser.name || "";
  document.getElementById("settings-email").value = currentUser.email || "";
  document.getElementById("settings-bio").value = currentUser.bio || "";
  document.getElementById("settings-password").value = "";
  const sav = document.getElementById("settings-av");
  if (sav) {
    const pic = currentUser.picture || null,
      initial = currentUser.name.charAt(0).toUpperCase(),
      color = stringToColor(currentUser.name);
    if (pic) {
      sav.style.background = "transparent";
      sav.innerHTML = `<img src="${pic}" alt="${initial}" loading="lazy" style="width:100%;height:100%;border-radius:inherit;object-fit:cover;display:block"/>`;
    } else {
      sav.innerHTML = initial;
      sav.style.background = color;
    }
  }
  const p = JSON.parse(
    localStorage.getItem("circle_notif_prefs") || "{}",
  );
  ["likes", "comments", "reposts", "push", "new_post", "profile_pic", "mention", "milestone"].forEach((k) => {
    const el = document.getElementById("notif-" + k);
    if (el && p[k] !== undefined) el.checked = p[k];
  });
  ["account", "activity"].forEach((k) => {
    const el = document.getElementById("priv-" + k);
    if (el && p[k] !== undefined) el.checked = p[k];
  });
}

async function saveProfile() {
  if (!currentUser) return;
  const name = document.getElementById("settings-name").value.trim();
  const email = document.getElementById("settings-email").value.trim();
  const bio = document.getElementById("settings-bio").value.trim();
  const password = document.getElementById("settings-password").value;
  if (!name || !email) {
    showToast("Name and email are required.");
    return;
  }
  const prefs = {
    likes: document.getElementById("notif-likes").checked,
    comments: document.getElementById("notif-comments").checked,
    reposts: document.getElementById("notif-reposts").checked,
    push: document.getElementById("notif-push").checked,
    new_post: document.getElementById("notif-new_post").checked,
    profile_pic: document.getElementById("notif-profile_pic").checked,
    mention: document.getElementById("notif-mention").checked,
    milestone: document.getElementById("notif-milestone").checked,
    account: document.getElementById("priv-account").checked,
    activity: document.getElementById("priv-activity").checked,
  };
  localStorage.setItem("circle_notif_prefs", JSON.stringify(prefs));
  try {
    const res = await api("PUT", `/api/users/${currentUser.id}`, {
      name,
      email,
      bio: bio || undefined,
      password: password || undefined,
    });
    const updatedUser = {
      ...res.data,
      bio: bio || res.data.bio || "",
      picture: currentUser.picture || res.data.picture || null,
    };
    localStorage.setItem("circle_user", JSON.stringify(updatedUser));
    setCurrentUser(updatedUser);
    showToast("Profile updated! ✅");
    setTimeout(() => goTo("profile"), 600);
  } catch (e) {
    showToast("Error: " + e.message);
  }
}

/* FEED TABS */
function switchFeedTab(tab) {
  if (!currentUser && tab === "following") {
    showToast("Log in to see posts from people you follow.");
    goTo("login");
    return;
  }
  currentFeedTab = tab;
  document
    .getElementById("ftab-global")
    .classList.toggle("active", tab === "global");
  document
    .getElementById("ftab-following")
    .classList.toggle("active", tab === "following");
  // Reset pagination state — cache will serve page 1 instantly if fresh
  feedPage = 1;
  feedHasMore = true;
  feedLoading = false;
  posts = [];
  loadPosts();
}

/* POSTS */
async function loadPosts() {
  // Guests can view the global feed without logging in
  feedPage = 1;
  feedHasMore = true;
  feedLoading = false;
  posts = [];

  // ── Cache: paint instantly if page 1 is fresh ────────────────
  const cached = PostCache.getFeedPage(currentFeedTab, 1);
  const c = document.getElementById("feed-list");
  if (cached) {
    posts = cached.posts;
    feedHasMore = cached.hasMore;
    feedPage = 2;
    renderFeed();
    updateScrollSentinel();
    // Background refresh — update silently if data changed
    _backgroundRefreshFeed();
    return;
  }

  // No valid cache — show spinner and fetch
  c.innerHTML = `<div class="empty"><div class="empty-icon"><div class="spinner" style="border-color:rgba(124,107,255,.3);border-top-color:var(--accent);width:24px;height:24px"></div></div><p>Loading posts…</p></div>`;
  await fetchMorePosts(true);
}

async function _backgroundRefreshFeed() {
  try {
    const feedTab = currentUser ? currentFeedTab : "global";
    const qs = currentUser
      ? `?feed=${feedTab}&page=1`
      : `?feed=global&page=1`;
    const res = await api("GET", `/api/posts${qs}`);
    const { posts: fresh, hasMore } = res.data;
    PostCache.storeFeedPage(currentFeedTab, 1, fresh, hasMore);
    // Only re-render if content actually changed
    const currentIds = posts
      .slice(0, fresh.length)
      .map((p) => p.id)
      .join(",");
    const freshIds = fresh.map((p) => p.id).join(",");
    if (currentIds !== freshIds) {
      posts = fresh;
      feedHasMore = hasMore;
      feedPage = 2;
      renderFeed();
      updateScrollSentinel();
    } else {
      // Same posts — just patch any changed like/comment counts silently
      fresh.forEach((fp) => {
        const existing = posts.find((p) => p.id === fp.id);
        if (existing) {
          existing.likes = fp.likes;
          existing.comments = fp.comments;
          existing.reposts = fp.reposts;
          PostCache.putPost(existing);
        }
      });
    }
  } catch (e) {
    /* silent — user already sees cached data */
  }
}

async function fetchMorePosts(isFirstPage = false) {
  if (feedLoading || !feedHasMore) return;

  // ── Cache: serve subsequent pages from cache if fresh ─────────
  const cached = PostCache.getFeedPage(currentFeedTab, feedPage);
  if (cached && !isFirstPage) {
    posts = [...posts, ...cached.posts];
    feedHasMore = cached.hasMore;
    feedPage++;
    const c = document.getElementById("feed-list");
    const frag = document.createDocumentFragment();
    cached.posts.forEach((p) => {
      const d = document.createElement("div");
      d.innerHTML = buildPostCard(p);
      frag.appendChild(d.firstElementChild);
    });
    c.appendChild(frag);
    updateScrollSentinel();
    return;
  }

  feedLoading = true;
  try {
    // Guests always see global; only logged-in users can switch to following
    const feedTab = currentUser ? currentFeedTab : "global";
    const qs = currentUser
      ? `?feed=${feedTab}&page=${feedPage}`
      : `?feed=global&page=${feedPage}`;
    const res = await api("GET", `/api/posts${qs}`);
    let { posts: newPosts, hasMore } = res.data;

    // ── New user with no interactions: fall back to all global posts ──
    if (isFirstPage && currentFeedTab === "global" && !newPosts.length) {
      const fallback = await api("GET", `/api/posts?feed=global&page=1`);
      newPosts = fallback.data?.posts  || [];
      hasMore  = fallback.data?.hasMore || false;
    }

    feedHasMore = hasMore;
    PostCache.storeFeedPage(currentFeedTab, feedPage, newPosts, hasMore);
    feedPage++;
    posts = isFirstPage ? newPosts : [...posts, ...newPosts].slice(-100);
    if (isFirstPage) {
      renderFeed();
    } else {
      const c = document.getElementById("feed-list");
      const frag = document.createDocumentFragment();
      newPosts.forEach((p) => {
        const d = document.createElement("div");
        d.innerHTML = buildPostCard(p);
        frag.appendChild(d.firstElementChild);
      });
      c.appendChild(frag);
    }
    updateScrollSentinel();
  } catch (e) {
    if (isFirstPage)
      document.getElementById("feed-list").innerHTML =
        `<div class="empty"><div class="empty-icon"><svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div><h3>Can\'t reach the server</h3><p>${e.message}</p></div>`;
  } finally {
    feedLoading = false;
  }
}

let _scrollObserver = null;
function updateScrollSentinel() {
  let s = document.getElementById("feed-sentinel");
  if (!feedHasMore) {
    if (s) s.remove();
    return;
  }
  if (!s) {
    s = document.createElement("div");
    s.id = "feed-sentinel";
    s.style.cssText = "height:40px;width:100%";
    document.getElementById("feed-list").appendChild(s);
  }
  if (_scrollObserver) _scrollObserver.disconnect();
  _scrollObserver = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting) fetchMorePosts();
    },
    { rootMargin: "200px" },
  );
  _scrollObserver.observe(s);
}
async function createPost() {
  if (!currentUser) {
    showToast("Please log in first.");
    return;
  }
  const text = document.getElementById("post-text").value.trim();
  if (!text && !pendingImageDataUrl) {
    showToast("Write something or add a photo!");
    return;
  }
  const btn = document.getElementById("post-submit-btn");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';
  try {
    const res = await api("POST", "/api/posts", {
      text,
      image: pendingImageDataUrl || null,
    });
    const newPost = res.data;
    // ── Cache: store new post and invalidate stale feed pages ───
    PostCache.putPost(newPost);
    PostCache.invalidateFeed(currentFeedTab);
    posts.unshift(newPost);
    document.getElementById("post-text").value = "";
    removeImage();
    renderFeed();
    showToast("Posted! ✨");
  } catch (e) {
    showToast("Error: " + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Post";
  }
}

async function deletePost(postId) {
  if (!currentUser) return;
  try {
    await api("DELETE", `/api/posts/${postId}`);
    // ── Cache: remove from store and invalidate feeds ───────────
    PostCache.removePost(postId);
    PostCache.invalidateFeed("global");
    PostCache.invalidateFeed("following");
    posts = posts.filter((p) => p.id !== postId);
    renderFeed();
    if (
      document.getElementById("view-profile").classList.contains("active")
    )
      renderProfile();
    showToast("Post deleted.");
  } catch (e) {
    showToast("Error: " + e.message);
  }
}

/*LIKES */
async function toggleLike(postId) {
  if (!currentUser) {
    showToast("Log in to like posts.");
    goTo("login");
    return;
  }
  // ── Optimistic update in cache and UI ───────────────────────
  const post = posts.find((p) => p.id === postId);
  if (post) {
    const i = post.likes.indexOf(currentUser.id);
    if (i === -1) post.likes.push(currentUser.id);
    else post.likes.splice(i, 1);
    PostCache.putPost(post);
    refreshLikeBtn(postId);
  }
  try {
    await api("POST", `/api/posts/${postId}/like`, {
      userId: currentUser.id,
    });
  } catch (e) {
    // Revert optimistic update on failure
    if (post) {
      const i = post.likes.indexOf(currentUser.id);
      if (i === -1) post.likes.push(currentUser.id);
      else post.likes.splice(i, 1);
      PostCache.putPost(post);
      refreshLikeBtn(postId);
    }
    showToast("Error: " + e.message);
  }
}

function refreshLikeBtn(postId) {
  const card = document.querySelector(`[data-post-id="${postId}"]`);
  if (!card) return;
  const post = posts.find((p) => p.id === postId);
  if (!post) return;
  const liked = currentUser && post.likes && post.likes.includes(currentUser.id);
  const btn = card.querySelector(".like-btn");
  btn.className = "act-btn like-btn" + (liked ? " liked" : "");
  btn.innerHTML = `<svg fill="${liked ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg><span>${(post.likes && post.likes.length) || ""}</span>`;
}

/* COMMENTS  */
function toggleComments(postId) {
  document
    .querySelector(`[data-post-id="${postId}"] .comments-panel`)
    .classList.toggle("open");
}

async function addComment(postId) {
  if (!currentUser) {
    showToast("Log in to comment.");
    goTo("login");
    return;
  }
  const input = document.querySelector(
    `[data-post-id="${postId}"] .comment-input`,
  );
  const text = input.value.trim();
  if (!text) return;
  try {
    const res = await api("POST", `/api/posts/${postId}/comment`, {
      userId: currentUser.id,
      text,
    });
    const post = posts.find((p) => p.id === postId);
    if (post) {
      post.comments.push(res.data);
      // ── Cache: patch comment into stored post ───────────────
      PostCache.putPost(post);
    }
    input.value = "";
    renderCommentList(postId);
    const ce = document.querySelector(
      `[data-post-id="${postId}"] .comment-count`,
    );
    if (ce && post) ce.textContent = (post.comments && post.comments.length) || "";
    showToast("Comment added!");
  } catch (e) {
    showToast("Error: " + e.message);
  }
}

function renderCommentList(postId) {
  const post = posts.find((p) => p.id === postId);
  const panel = document.querySelector(
    `[data-post-id="${postId}"] .comments-panel`,
  );
  if (!panel || !post) return;
  panel.querySelector(".comment-list").innerHTML = buildCommentItems(
    post.comments,
  );
}

function buildCommentItems(comments) {
  return comments
    .map((c) => {
      const col = stringToColor(c.author);
      const avInner = c.authorPicture
        ? `<img src="${c.authorPicture}" alt="${escHtml(c.author.charAt(0))}" loading="lazy" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block"/>`
        : escHtml(c.author.charAt(0));
      return `<div class="comment-row"><div class="av sm" style="background:${c.authorPicture ? "transparent" : col}">${avInner}</div><div class="comment-bubble"><div class="comment-name">${escHtml(c.author)}</div><div class="comment-txt">${escHtml(c.text)}</div></div></div>`;
    })
    .join("");
}

/* REPOSTS */
function openRepostModal(postId) {
  if (!currentUser) {
    showToast("Log in to repost.");
    goTo("login");
    return;
  }
  const post = posts.find((p) => p.id === postId);
  if (!post) return;
  if (post.reposts && post.reposts.includes(currentUser.id)) {
    showToast("Already reposted!");
    return;
  }
  repostTargetId = postId;
  document.getElementById("modal-orig-author").textContent = post.author;
  document.getElementById("modal-orig-text").textContent =
    post.text || "";
  document.getElementById("repost-quote").value = "";
  const img = document.getElementById("modal-orig-img");
  if (post.image) {
    img.src = post.image;
    img.style.display = "block";
  } else {
    img.src = "";
    img.style.display = "none";
  }
  document.getElementById("repost-modal").classList.add("open");
  setTimeout(() => document.getElementById("repost-quote").focus(), 120);
}

function closeRepostModal(e) {
  if (e && e.target !== document.getElementById("repost-modal")) return;
  document.getElementById("repost-modal").classList.remove("open");
  repostTargetId = null;
}

async function confirmRepost() {
  if (!currentUser || !repostTargetId) return;
  const orig = posts.find((p) => p.id === repostTargetId);
  if (!orig) return;
  const quote = document.getElementById("repost-quote").value.trim();
  try {
    const res = await api("POST", `/api/posts/${repostTargetId}/repost`, {
      userId: currentUser.id,
      text: quote || null,
    });
    const repost = res.data;
    if (!orig.reposts) orig.reposts = [];
    orig.reposts.push(currentUser.id);
    posts.unshift(repost);
    document.getElementById("repost-modal").classList.remove("open");
    repostTargetId = null;
    renderFeed();
    showToast("Reposted! ♻️");
  } catch (e) {
    showToast("Error: " + e.message);
  }
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    document.getElementById("repost-modal").classList.remove("open");
    repostTargetId = null;
    closeNotifPanel();
    const rm = document.getElementById("report-modal");
    if (rm) rm.classList.remove("open");
    reportTargetPostId = null;
  }
});

/* IMAGE */
function previewImage(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    pendingImageDataUrl = e.target.result;
    document.getElementById("img-preview").src = e.target.result;
    document.getElementById("img-preview-wrap").style.display = "block";
  };
  reader.readAsDataURL(file);
}
function removeImage() {
  pendingImageDataUrl = null;
  document.getElementById("img-preview").src = "";
  document.getElementById("img-preview-wrap").style.display = "none";
  document.getElementById("img-input").value = "";
}

/*  RENDER */
function renderFeed() {
  const c = document.getElementById("feed-list");
  if (!posts.length) {
    if (currentFeedTab === "following") {
      // Following tab empty — nudge to discover people
      c.innerHTML = `<div class="empty">
        <div class="empty-icon"><svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg></div>
        <h3>No posts yet</h3>
        <p>Follow people to see their posts here.</p>
        <button class="btn btn-primary" style="margin-top:14px;padding:10px 24px;border-radius:20px;font-size:14px" onclick="switchFeedTab('global')">Explore Global Feed</button>
      </div>`;
    } else {
      // Global tab truly empty — very unlikely but handle it
      c.innerHTML = `<div class="empty"><div class="empty-icon"><svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg></div><h3>Nothing here yet</h3><p>Be the first to post something!</p></div>`;
    }
    return;
  }
  const parts = posts.map((p) => buildPostCard(p));
  // Inject inline suggestions card after 5th post if not dismissed
  if (!_feedSugDismissed && currentUser && parts.length >= 5) {
    parts.splice(5, 0, buildFeedSugCard());
  }
  // Inject new members card after 8th post if not dismissed
  if (!_feedNewDismissed && currentUser && _newMembers.length && parts.length >= 8) {
    parts.splice(8, 0, buildFeedNewCard());
  }
  c.innerHTML = parts.join("");
}

/* -- VIEW PROFILE (click author name/avatar) ------------------- */
/* -- VIEW ANOTHER USER'S PROFILE -------------------------------- */

function viewProfile(userId) {
  document
    .querySelectorAll(".view")
    .forEach((v) => v.classList.remove("active"));
  document.getElementById("view-profile").classList.add("active");
  document
    .querySelectorAll(".nav-item")
    .forEach((n) => n.classList.remove("active"));
  const sn = document.getElementById("snav-profile");
  if (sn) sn.classList.add("active");
  document
    .querySelectorAll(".mnav-item")
    .forEach((n) => n.classList.remove("active"));
  const mn = document.getElementById("mnav-profile");
  if (mn) mn.classList.add("active");
  window.scrollTo(0, 0);
  renderProfile(userId);
}



async function renderProfile(viewedUserId = null) {
  if (!currentUser) {
    goTo("login");
    return;
  }
  const targetId =
    viewedUserId !== null && viewedUserId !== undefined
      ? parseInt(viewedUserId, 10)
      : currentUser.id;
  const isOwnProfile = targetId === currentUser.id;
  let profileData = null;
  try {
    const res = await api("GET", `/api/users/${targetId}/profile`);
    profileData = res.data;
  } catch (e) {}
  const name = profileData?.name || currentUser.name;
  const email = profileData?.email || currentUser.email;
  const pic =
    profileData?.picture || (isOwnProfile ? currentUser.picture : null);
  const initial = name.charAt(0).toUpperCase();
  const color = stringToColor(name);
  const av = document.getElementById("profile-av");
  if (pic) {
    av.style.background = "transparent";
    av.innerHTML = `<img src="${pic}" alt="${initial}" loading="lazy" style="width:100%;height:100%;border-radius:inherit;object-fit:cover;display:block"/>`;
  } else {
    av.innerHTML = initial;
    av.style.background = color;
  }
  document.getElementById("profile-name").textContent = name;
  document.getElementById("profile-email").textContent = isOwnProfile ? email : "";
  const bio = profileData?.bio || (isOwnProfile ? currentUser.bio || "" : "");
  const bioEl = document.getElementById("profile-bio");
  if (bioEl) { bioEl.textContent = bio; bioEl.style.display = bio ? "block" : "none"; }
  document.getElementById("stat-posts").textContent =
    profileData?.postCount || 0;
  document.getElementById("stat-followers").textContent =
    profileData?.followerCount || 0;
  document.getElementById("stat-following").textContent =
    profileData?.followingCount || 0;
  const liked = posts.reduce(
    (n, p) => n + (p.likes.includes(currentUser.id) ? 1 : 0),
    0,
  );
  document.getElementById("stat-likes").textContent = liked;
  const actionsEl = document.getElementById("profile-actions");
  if (isOwnProfile) {
    actionsEl.innerHTML = `
<button class="btn btn-ghost" onclick="goTo('settings')" style="font-size:13px;padding:8px 16px">
  <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="14" height="14"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
  Edit Profile
</button>
<button class="logout-btn-sm" onclick="logout()">
  <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
  Log Out
</button>`;
  } else {
    const isFollowing = profileData?.isFollowing || false;
    const _dmUser = JSON.stringify({ id: targetId, name, picture: pic || null });
    actionsEl.innerHTML = `
      <button class="btn ${isFollowing ? "btn-outline" : "btn-primary"}" style="font-size:13px;padding:8px 20px" data-following="${isFollowing}" onclick="toggleFollow(${targetId}, this)">${isFollowing ? "Following" : "Follow"}</button>
      <button class="btn btn-ghost" style="font-size:13px;padding:8px 18px;gap:7px" onclick='DM.startConvWithUser(${_dmUser})'>
        <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="14" height="14"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
        Message
      </button>`;
  }
  const c = document.getElementById("profile-feed");

  // Always fetch from API to show all posts including older ones
  c.innerHTML = `<div style="text-align:center;padding:32px;color:var(--txt2)"><div class="spinner" style="margin:0 auto 12px"></div></div>`;
  try {
    const res = await api("GET", `/api/posts?userId=${targetId}&page=1`);
    const userPosts = res.data?.posts || [];
    // Hydrate into cache so engagement works
    userPosts.forEach((p) => {
      if (!Array.isArray(p.likes))    p.likes    = [];
      if (!Array.isArray(p.reposts))  p.reposts  = [];
      if (!Array.isArray(p.comments)) p.comments = [];
      PostCache.putPost(p);
    });
    c.innerHTML = userPosts.length
      ? userPosts.map((p) => buildPostCard(p, isOwnProfile)).join("")
      : `<div class="empty"><div class="empty-icon"><svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></div><h3>No posts yet</h3><p>${isOwnProfile ? "Share your first post!" : "Nothing posted yet."}</p></div>`;
  } catch (e) {
    c.innerHTML = `<div class="empty"><h3>Could not load posts</h3><p>${e.message}</p></div>`;
  }
}

function buildPostCard(post, showDelete = false) {
  const liked = currentUser && post.likes && post.likes.includes(currentUser.id);
  const reposted =
    currentUser && post.reposts && post.reposts.includes(currentUser.id);
  const canDelete =
    currentUser && (currentUser.id === post.userId || showDelete);
  if (!Array.isArray(post.likes))    post.likes    = [];
  if (!Array.isArray(post.reposts))  post.reposts  = [];
  if (!Array.isArray(post.comments)) post.comments = [];
  const color = stringToColor(post.author);
  return `<div class="post-card" data-post-id="${post.id}" onclick="openPostDetail(event,${post.id})" style="cursor:pointer">
    ${post.isRepost ? `<div class="repost-strip"><svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>${escHtml(post.author)} reposted</div>` : ""}
    <div class="post-head">
<div class="av" style="background:${post.authorPicture ? "transparent" : color};cursor:pointer" onclick="viewProfile(${post.userId})" title="View profile">${post.authorPicture ? `<img src="${post.authorPicture}" alt="${escHtml(post.author.charAt(0))}" loading="lazy" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block"/>` : escHtml(post.author.charAt(0))}</div>
<div class="post-meta"><div class="post-name" onclick="viewProfile(${post.userId})" style="cursor:pointer" title="View profile">${escHtml(post.author)}</div><div class="post-time">${formatTime(post.createdAt)}</div></div>
${canDelete ? `<button class="post-del" onclick="deletePost(${post.id})"><svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg></button>` : ""}
    </div>
    ${post.text ? `<div class="post-body">${escHtml(post.text)}</div>` : ""}
    ${post.isRepost && post.originalPost ? `<div class="repost-embed"><div class="repost-embed-name">${escHtml(post.originalPost.author)}</div>${post.originalPost.text ? `<div class="repost-embed-text">${escHtml(post.originalPost.text)}</div>` : ""}${post.originalPost.image ? `<img class="repost-embed-img lb-thumb" src="${post.originalPost.image}" loading="lazy" data-lb-name="${escHtml(post.originalPost.author)}" data-lb-picture="${escHtml(post.originalPost.authorPicture || "")}" data-lb-user-id="${post.originalPost.userId || ""}" onclick="openLightbox(this,collectFeedImages())" title="View full image"/>` : ""}</div>` : !post.isRepost && post.image ? `<img class="post-img lb-thumb" src="${post.image}" loading="lazy" data-lb-name="${escHtml(post.author)}" data-lb-picture="${escHtml(post.authorPicture || "")}" data-lb-user-id="${post.userId}" onclick="openLightbox(this,collectFeedImages())" title="View full image"/>` : ""}
    <div class="post-actions">
<button class="act-btn like-btn${liked ? " liked" : ""}" onclick="toggleLike(${post.id})">
  <svg fill="${liked ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
  <span>${(post.likes && post.likes.length) || ""}</span>
</button>
<button class="act-btn" onclick="toggleComments(${post.id})">
  <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
  <span class="comment-count">${(post.comments && post.comments.length) || ""}</span>
</button>
${!post.isRepost ? `<button class="act-btn repost-btn${reposted ? " reposted" : ""}" onclick="openRepostModal(${post.id})"><svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg><span>${post.reposts ? post.reposts.length || "" : ""}</span></button>` : ""}
${!canDelete && !post.isRepost ? `<button class="act-btn report" style="margin-left:auto" title="Report post" onclick="reportPost(${post.id})"><svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></button>` : ""}
    </div>
    <div class="comments-panel">
<div class="comment-list">${buildCommentItems(post.comments)}</div>
<div class="comment-input-row">
  <input class="comment-input" type="text" placeholder="Write a comment…" onkeydown="if(event.key==='Enter')addComment(${post.id})"/>
  <button class="send-btn" onclick="addComment(${post.id})"><svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>
</div>
    </div>
  </div>`;
}

/*  PROFILE PICTURE */
async function handleProfilePicUpload(event) {
  if (!currentUser) {
    showToast("Log in first.");
    return;
  }
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    showToast("Image must be under 5 MB.");
    return;
  }
  showToast("Uploading…");
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const res = await api(
        "PUT",
        `/api/users/${currentUser.id}/picture`,
        { picture: e.target.result },
      );
      currentUser.picture = res.data.picture;
      localStorage.setItem("circle_user", JSON.stringify(currentUser));
      setCurrentUser(currentUser);
      renderProfile();
      populateSettings();
      showToast("Profile photo updated! 📸");
    } catch (e) {
      showToast("Upload failed: " + e.message);
    }
  };
  reader.readAsDataURL(file);
  event.target.value = "";
}

/* FOLLOW / UNFOLLOW  */
function buildSuggestionCard(user) {
  const initial = (user.name || "?").charAt(0).toUpperCase();
  const color = stringToColor(user.name);
  const avBg = user.picture ? "transparent" : color;
  const avInner = user.picture
    ? '<img src="' +
      escHtml(user.picture) +
      '" alt="' +
      initial +
      '" loading="lazy" ' +
      'onerror="this.parentElement.style.background=' +
      color +
      ";this.parentElement.innerHTML=" +
      initial +
      '"/>'
    : initial;
  return (
    '<div class="sug-card" data-user-id="' +
    user.id +
    '">' +
    '<div class="sug-av" style="background:' +
    avBg +
    '" onclick="viewProfile(' +
    user.id +
    ')" title="View profile">' +
    avInner +
    "</div>" +
    '<div class="sug-name" onclick="viewProfile(' +
    user.id +
    ')" title="' +
    escHtml(user.name) +
    '">' +
    escHtml(user.name) +
    "</div>" +
    '<div class="sug-score">' +
    user.score +
    " interaction" +
    (user.score == 1 ? "" : "s") +
    "</div>" +
    '<button class="sug-follow-btn follow" onclick="event.stopPropagation();sugFollow(' +
    user.id +
    ',this)">Follow</button>' +
    "</div>"
  );
}

async function sugFollow(userId, btn) {
  if (!currentUser) {
    showToast("Log in to follow people.");
    goTo("login");
    return;
  }
  const following = btn.classList.contains("unfollow");
  btn.disabled = true;
  try {
    if (following) {
      await api("DELETE", "/api/unfollow/" + userId);
      btn.classList.replace("unfollow", "follow");
      btn.textContent = "Follow";
      showToast("Unfollowed.");
    } else {
      await api("POST", "/api/follow/" + userId);
      btn.classList.replace("follow", "unfollow");
      btn.textContent = "Following";
      showToast("Following! Refreshing feed...");
      setTimeout(() => {
        const card = btn.closest(".sug-card");
        if (card) {
          card.style.cssText +=
            ";transition:opacity .3s,transform .3s;opacity:0;transform:scale(.9)";
          setTimeout(() => {
            card.remove();
            if (!document.querySelectorAll(".sug-card").length)
              loadSuggestions(true);
          }, 300);
        }
      }, 900);
      setTimeout(() => {
        feedPage = 1;
        feedHasMore = true;
        loadPosts();
      }, 1200);
    }
  } catch (e) {
    showToast("Error: " + e.message);
  } finally {
    btn.disabled = false;
  }
}


async function toggleFollow(targetId, btn) {
  if (!currentUser) {
    showToast("Log in to follow people.");
    goTo("login");
    return;
  }
  const isFollowing = btn.dataset.following === "true";
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = "…";
  try {
    if (isFollowing) {
      await api("DELETE", `/api/unfollow/${targetId}`);
      btn.dataset.following = "false";
      btn.textContent = "Follow";
      btn.classList.remove("btn-outline", "unfollow");
      btn.classList.add("btn-primary", "follow");
      showToast("Unfollowed.");
    } else {
      await api("POST", `/api/follow/${targetId}`);
      btn.dataset.following = "true";
      btn.textContent = "Following";
      btn.classList.remove("btn-primary", "follow");
      btn.classList.add("btn-outline", "unfollow");
      showToast("Following! 🎉");
    }
    const pv = document.getElementById("view-profile");
    if (pv && pv.classList.contains("active"))
      renderProfile(targetId === currentUser.id ? null : targetId);
  } catch (e) {
    btn.textContent = orig;
    showToast("Error: " + e.message);
  } finally {
    btn.disabled = false;
  }
}

/* SEARCH */
let searchTab = "posts",
  searchTimer = null;

function switchSearchTab(tab) {
  searchTab = tab;
  document
    .getElementById("stab-posts")
    .classList.toggle("active", tab === "posts");
  document
    .getElementById("stab-people")
    .classList.toggle("active", tab === "people");
  const q = document.getElementById("search-input").value.trim();
  if (q.length >= 2) runSearch(q);
  else renderSearchHint();
}

function onSearchInput() {
  clearTimeout(searchTimer);
  const q = document.getElementById("search-input").value.trim();
  if (q.length < 2) {
    renderSearchHint();
    return;
  }
  searchTimer = setTimeout(() => runSearch(q), 400);
}

function renderSearchHint() {
  document.getElementById("search-results").innerHTML =
    `<div class="search-hint"><svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><p>Type to search ${searchTab === "posts" ? "posts" : "people"}</p></div>`;
}

async function runSearch(q) {
  if (!currentUser) {
    showToast("Log in to search.");
    goTo("login");
    return;
  }
  const box = document.getElementById("search-results");
  box.innerHTML = `<div class="search-hint"><div class="spinner" style="border-color:rgba(124,107,255,.3);border-top-color:var(--accent);width:24px;height:24px;margin:0 auto 12px"></div><p>Searching…</p></div>`;
  try {
    const res = await api(
      "GET",
      `/api/search?q=${encodeURIComponent(q)}&type=${searchTab}`,
    );
    // If searching people, also fetch follow status for each
    if (searchTab === "people" && currentUser && res.data.length) {
      // Batch-check follow status by fetching each user's status
      await Promise.all(
        res.data.map(async (user) => {
          try {
            const s = await api(
              "GET",
              `/api/follow/${user.id}/status?viewerId=${currentUser.id}`,
            );
            user.isFollowing = s.data.isFollowing;
          } catch (e) {
            user.isFollowing = false;
          }
        }),
      );
    }
    renderSearchResults(res.data, q);
  } catch (e) {
    box.innerHTML = `<div class="search-hint"><p style="color:var(--rose)">Error: ${escHtml(e.message)}</p></div>`;
  }
}

function highlight(text, q) {
  if (!text) return "";
  const safe = escHtml(text);
  const safeQ = escHtml(q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return safe.replace(
    new RegExp(`(${safeQ})`, "gi"),
    '<mark class="hl">$1</mark>',
  );
}

function renderSearchResults(data, q) {
  const box = document.getElementById("search-results");
  if (!data || !data.length) {
    box.innerHTML = `<div class="search-hint"><svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><p>No ${searchTab} found for "<strong>${escHtml(q)}</strong>"</p></div>`;
    return;
  }
  if (searchTab === "posts") {
    // Hydrate search results into cache so engagement works
    data.forEach((post) => {
      post.likes    = Array.isArray(post.likes)    ? post.likes    : [];
      post.reposts  = Array.isArray(post.reposts)  ? post.reposts  : [];
      post.comments = Array.isArray(post.comments) ? post.comments : [];
      PostCache.putPost(post);
      if (!posts.find((p) => p.id === post.id)) posts.unshift(post);
    });
    box.innerHTML = data.map((post) => buildPostCard(post, false)).join("");
  } else {
    box.innerHTML = data
      .map((user) => {
        const color = stringToColor(user.name);
        const avHtml = user.picture
          ? `<img src="${user.picture}" alt="${escHtml(user.name.charAt(0))}" loading="lazy" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block"/>`
          : escHtml(user.name.charAt(0));
        const isOwnProfile = currentUser && currentUser.id === user.id;
        const followBtnHtml =
          !isOwnProfile && currentUser
            ? `<button class="follow-btn ${user.isFollowing ? "unfollow" : "follow"}" onclick="toggleFollow(${user.id}, this)">${user.isFollowing ? "Unfollow" : "Follow"}</button>`
            : "";
        return `<div class="people-card" onclick="viewProfile(${user.id})" style="cursor:pointer">
  <div class="av" style="background:${user.picture ? "transparent" : color}">${avHtml}</div>
  <div class="people-card-info">
    <div class="people-card-name">${highlight(user.name, q)}</div>
    <div class="people-card-email">${highlight(user.email, q)}</div>
    <div class="people-card-posts">${user.postCount || 0} post${user.postCount === 1 ? "" : "s"} · ${user.followerCount || 0} followers</div>
  </div>
  ${followBtnHtml}
</div>`;
      })
      .join("");
  }
}

/*  NOTIFICATIONS */
let notifPollTimer = null;

const NOTIF_ICONS = {
  like: `<svg fill="currentColor" viewBox="0 0 24 24" width="16" height="16"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>`,
  comment: `<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="16" height="16"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>`,
  repost: `<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="16" height="16"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>`,
  follow: `<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="16" height="16"><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>`,
  new_post: `<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="16" height="16"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`,
  profile_pic: `<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="16" height="16"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  mention: `<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 006 0v-1a10 10 0 10-3.92 7.94"/></svg>`,
  milestone: `<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="16" height="16"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
};
const NOTIF_COPY = {
  like: (name) => `<strong>${escHtml(name)}</strong> liked your post`,
  comment: (name) =>
    `<strong>${escHtml(name)}</strong> commented on your post`,
  repost: (name) =>
    `<strong>${escHtml(name)}</strong> reposted your post`,
  follow: (name) =>
    `<strong>${escHtml(name)}</strong> started following you`,
  new_post: (name) =>
    `<strong>${escHtml(name)}</strong> published a new post`,
  profile_pic: (name) =>
    `<strong>${escHtml(name)}</strong> updated their profile picture`,
  mention: (name) =>
    `<strong>${escHtml(name)}</strong> mentioned you in a post`,
  milestone: (name) =>
    `🎉 <strong>${escHtml(name)}</strong>`,
};

async function fetchNotifications() {
  if (!currentUser) return;
  try {
    const res = await api("GET", `/api/notifications/${currentUser.id}`);
    renderNotifList(res.data);
    updateNotifBadge(res.data.filter((n) => !n.isRead).length);
  } catch (e) {
    /* silent */
  }
}

async function fetchUnreadCount() {
  if (!currentUser) return;
  try {
    const res = await api(
      "GET",
      `/api/notifications/${currentUser.id}/unread-count`,
    );
    updateNotifBadge(res.data.count);
  } catch (e) {
    /* silent */
  }
}

function updateNotifBadge(count) {
  const b1 = document.getElementById("topbar-notif-badge");
  const b2 = document.getElementById("snav-notif-badge");
  if (b1) {
    b1.textContent = count > 99 ? "99+" : count > 0 ? count : "";
    b1.classList.toggle("show", count > 0);
  }
  if (b2) {
    b2.textContent = count > 99 ? "99+" : count > 0 ? count : "";
    b2.classList.toggle("show", count > 0);
  }
}

function renderNotifList(notifs) {
  const list = document.getElementById("notif-list");
  if (!notifs || !notifs.length) {
    list.innerHTML = `<div class="notif-empty"><svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg><p>No notifications yet</p></div>`;
    return;
  }

  // Filter out types the user has turned off in prefs
  const prefs = JSON.parse(localStorage.getItem("circle_notif_prefs") || "{}");
  const PREF_KEY = { like: "likes", comment: "comments", repost: "reposts",
                     follow: null, new_post: "new_post", profile_pic: "profile_pic",
                     mention: "mention", milestone: "milestone" };
  const visible = notifs.filter(n => {
    const key = PREF_KEY[n.type];
    if (key === null) return true;           // follow always shown
    if (key === undefined) return true;      // unknown type → show
    return prefs[key] !== false;             // default on unless explicitly off
  });

  if (!visible.length) {
    list.innerHTML = `<div class="notif-empty"><svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg><p>All notification types are muted</p></div>`;
    return;
  }

  list.innerHTML = visible
    .map((n) => {
      const color = stringToColor(n.actorName || "?");
      const avHtml = n.actorPicture
        ? `<img src="${n.actorPicture}" alt="${escHtml((n.actorName || "?").charAt(0))}" loading="lazy" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block"/>`
        : escHtml((n.actorName || "?").charAt(0));
      // For profile_pic — show the new picture as a thumbnail if available
      const picThumb = (n.type === "profile_pic" && n.actorPicture)
        ? `<img src="${n.actorPicture}" loading="lazy" style="width:36px;height:36px;border-radius:50%;object-fit:cover;border:2px solid var(--accent);flex-shrink:0" alt="new pic"/>`
        : "";
      return `<div class="notif-item${n.isRead ? "" : " unread"}" onclick="onNotifClick(${n.id}, ${n.postId || "null"}, '${n.type}', ${n.actorId || "null"})">
<div class="av sm" style="background:${n.actorPicture ? "transparent" : color}">${avHtml}</div>
<div class="notif-body">
  <div class="notif-text">${(NOTIF_COPY[n.type] || NOTIF_COPY.like)(n.actorName || "Someone")}</div>
  ${n.postSnippet ? `<div class="notif-snippet">"${escHtml(n.postSnippet)}"</div>` : ""}
  <div class="notif-time">${formatTime(n.createdAt)}</div>
</div>
${picThumb || `<div class="notif-icon ${n.type}">${NOTIF_ICONS[n.type] || ""}</div>`}
${!n.isRead ? '<div class="notif-dot"></div>' : ""}
    </div>`;
    })
    .join("");
}

async function onNotifClick(notifId, postId, type, actorId) {
  try {
    await api("PUT", `/api/notifications/${notifId}/read`);
  } catch (e) {
    /* silent */
  }
  closeNotifPanel();

  // Smart routing based on notification type
  if (type === "profile_pic" || type === "follow") {
    // Go to the actor's profile
    if (actorId) { viewProfile(actorId); }
    else goTo("feed");
  } else if (type === "new_post" && postId) {
    // Open the specific post directly
    const post = posts.find((p) => p.id === postId) || PostCache.get(postId);
    if (post) { renderPostDetail(post); goTo("post-detail"); }
    else { goTo("feed"); }
  } else if (type === "mention" && postId) {
    const post = posts.find((p) => p.id === postId) || PostCache.get(postId);
    if (post) { renderPostDetail(post); goTo("post-detail"); }
    else { goTo("feed"); }
  } else if (type === "milestone") {
    goTo("profile");
  } else {
    goTo("feed");
    if (postId) {
      setTimeout(() => {
        const card = document.querySelector(`[data-post-id="${postId}"]`);
        if (card)
          card.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 400);
    }
  }
  fetchNotifications();
}

async function markAllRead() {
  if (!currentUser) return;
  try {
    await api("PUT", `/api/notifications/${currentUser.id}/read-all`);
    fetchNotifications();
    showToast("All notifications marked as read ✓");
  } catch (e) {
    showToast("Error: " + e.message);
  }
}

function openNotifPanel() {
  if (!currentUser) {
    showToast("Log in to see notifications.");
    return;
  }
  fetchNotifications();
  document.getElementById("notif-panel").classList.add("open");
  document.getElementById("notif-backdrop").classList.add("open");
  document.body.style.overflow = "hidden";
}

function closeNotifPanel() {
  document.getElementById("notif-panel").classList.remove("open");
  document.getElementById("notif-backdrop").classList.remove("open");
  document.body.style.overflow = "";
}

function startNotifPolling() {
  stopNotifPolling();
  fetchUnreadCount();
  notifPollTimer = setInterval(fetchUnreadCount, 30_000);
}
function stopNotifPolling() {
  if (notifPollTimer) {
    clearInterval(notifPollTimer);
    notifPollTimer = null;
  }
}

/* HELPERS */

/*  REPORT POST */
let reportTargetPostId = null;

function reportPost(postId) {
  if (!currentUser) {
    showToast("Log in to report posts.");
    goTo("login");
    return;
  }
  reportTargetPostId = postId;
  document.getElementById("report-reason-select").value = "";
  document.getElementById("report-other-field").style.display = "none";
  document.getElementById("report-other-text").value = "";
  document.getElementById("report-modal").classList.add("open");
}

function onReportReasonChange() {
  const val = document.getElementById("report-reason-select").value;
  document.getElementById("report-other-field").style.display =
    val === "Other" ? "block" : "none";
}

function closeReportModal(e) {
  if (e && e.target !== document.getElementById("report-modal")) return;
  document.getElementById("report-modal").classList.remove("open");
  reportTargetPostId = null;
}

async function submitReport() {
  if (!reportTargetPostId) return;
  let reason = document.getElementById("report-reason-select").value;
  if (!reason) {
    showToast("Please select a reason.");
    return;
  }
  if (reason === "Other") {
    const other = document
      .getElementById("report-other-text")
      .value.trim();
    if (!other || other.length < 5) {
      showToast("Please describe the issue (min 5 chars).");
      return;
    }
    reason = other;
  }
  const btn = document.getElementById("report-submit-btn");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';
  try {
    await api("POST", "/api/admin/reports", {
      postId: reportTargetPostId,
      reason,
    });
    document.getElementById("report-modal").classList.remove("open");
    reportTargetPostId = null;
    showToast("Report submitted. Thank you for keeping Circle safe!");
  } catch (e) {
    showToast("Error: " + e.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = "Submit Report";
  }
}

/*  SUGGESTED USERS  */
let _suggestionsLoaded = false;
let _feedSugUsers     = [];   // cached suggestion users for inline card
let _feedSugDismissed = false; // session-only dismiss flag

// ── Build inline feed suggestions card ──────────────────────────
function buildFeedSugCard() {
  if (!_feedSugUsers.length) return "";
  const pills = _feedSugUsers.map((user) => {
    const initial = (user.name || "?").charAt(0).toUpperCase();
    const color   = stringToColor(user.name);
    const avBg    = user.picture ? "transparent" : color;
    const avInner = user.picture
      ? `<img src="${escHtml(user.picture)}" alt="${initial}" loading="lazy" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block"/>`
      : initial;
    const score = user.score || 0;
    const reason = score === 0
      ? "New to Circle"
      : score === 1
        ? `<strong>1</strong> interaction`
        : `<strong>${score}</strong> interactions`;
    return `<div class="feed-sug-pill">
      <div class="sug-av" style="background:${avBg}" onclick="viewProfile(${user.id})">${avInner}</div>
      <div class="feed-sug-pill-name" onclick="viewProfile(${user.id})" title="${escHtml(user.name)}">${escHtml(user.name)}</div>
      <div class="feed-sug-reason">${reason}</div>
      <button class="feed-sug-pill-btn" onclick="feedSugFollow(${user.id},this)">Follow</button>
    </div>`;
  }).join("");

  return `<div class="feed-sug-card" id="feed-sug-inline">
    <div class="feed-sug-header">
      <span class="feed-sug-title">✨ People you may know</span>
      <span class="feed-sug-dismiss" onclick="dismissFeedSug()">✕ Dismiss</span>
    </div>
    <div class="feed-sug-scroll">${pills}</div>
  </div>`;
}

function dismissFeedSug() {
  _feedSugDismissed = true;
  const el = document.getElementById("feed-sug-inline");
  if (el) {
    el.style.cssText += ";transition:opacity .25s,max-height .3s;opacity:0;max-height:0;overflow:hidden;margin:0;padding:0;border:none";
    setTimeout(() => el.remove(), 320);
  }
}

async function feedSugFollow(userId, btn) {
  if (!currentUser) { showToast("Log in to follow."); goTo("login"); return; }
  btn.disabled = true;
  try {
    await api("POST", "/api/follow/" + userId);
    btn.textContent = "Following";
    btn.classList.add("following");
    // Remove from inline list after short delay
    const pill = btn.closest(".feed-sug-pill");
    if (pill) {
      pill.style.cssText += ";transition:opacity .3s,transform .3s;opacity:0;transform:scale(.85)";
      setTimeout(() => {
        pill.remove();
        _feedSugUsers = _feedSugUsers.filter(u => u.id !== userId);
        if (!document.querySelectorAll(".feed-sug-pill").length) dismissFeedSug();
      }, 300);
    }
    showToast("Following!");
    setTimeout(() => { feedPage = 1; feedHasMore = true; loadPosts(); }, 1200);
  } catch (e) {
    showToast("Error: " + e.message);
  } finally {
    btn.disabled = false;
  }
}

async function loadSuggestions(force = false) {
  if (!currentUser) return;
  if (_suggestionsLoaded && !force) return;

  try {
    const res = await api(
      "GET",
      "/api/recommendations?userId=" + currentUser.id + "&limit=10",
    );
    _feedSugUsers = res.data || [];
    _suggestionsLoaded = true;

    // If feed is already rendered, inject the card now
    if (!_feedSugDismissed && _feedSugUsers.length) {
      const feedList = document.getElementById("feed-list");
      if (feedList && !document.getElementById("feed-sug-inline")) {
        const postCards = feedList.querySelectorAll(".post-card");
        if (postCards.length >= 5) {
          const cardHtml = buildFeedSugCard();
          const temp = document.createElement("div");
          temp.innerHTML = cardHtml;
          const fifthPost = postCards[4];
          fifthPost.insertAdjacentElement("afterend", temp.firstElementChild);
        }
      }
    }
  } catch (e) {
    console.error("Suggestions error:", e);
  }
}

/* ═══════════════════ EXPLORE ═══════════════════════════ */
let _exploreLoaded = false;

// ── Trending state ────────────────────────────────────────────
let _trendingRaw       = [];   // full unfiltered data from API
let _trendingCategory  = "all";
let _trendingSort      = "hot";

function loadExplore() {
  // Guests can see trending too — only people-follow requires login
  loadExplorePeople();
  loadExploreTrending();
  if (currentUser) loadExploreNewMembers();
}

async function loadExplorePeople(force = false) {
  const list = document.getElementById("explore-people-list");
  const btn  = document.getElementById("explore-people-refresh");
  if (!list) return;

  // Hide people section for guests; show a login nudge instead
  if (!currentUser) {
    list.innerHTML = `<div class="explore-trending-empty">
      <button class="link" onclick="goTo('login')">Log in</button> to see people you may know.
    </div>`;
    return;
  }

  if (btn) { btn.classList.add("spinning"); btn.disabled = true; }
  list.innerHTML = `<div class="explore-skeleton-row">${[1,2,3,4].map(() => '<div class="explore-skel-card"></div>').join("")}</div>`;

  try {
    const res   = await api("GET", `/api/recommendations?userId=${currentUser.id}&limit=12`);
    const users = res.data || [];

    if (!users.length) {
      list.innerHTML = `<div class="explore-trending-empty">No suggestions right now. Interact with posts to get recommendations!</div>`;
      return;
    }

    list.innerHTML = `<div class="explore-people-scroll">${users.map(u => buildExplorePersonCard(u)).join("")}</div>`;
  } catch (e) {
    list.innerHTML = `<div class="explore-trending-empty" style="color:var(--rose)">Could not load suggestions.</div>`;
  } finally {
    if (btn) { btn.classList.remove("spinning"); btn.disabled = false; }
  }
}

function buildExplorePersonCard(user) {
  const initial = (user.name || "?").charAt(0).toUpperCase();
  const color   = stringToColor(user.name);
  const avBg    = user.picture ? "transparent" : color;
  const avInner = user.picture
    ? `<img src="${escHtml(user.picture)}" alt="${initial}" loading="lazy" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block"/>`
    : initial;
  const score = user.score || 0;
  const meta  = score > 0 ? `${score} interaction${score === 1 ? "" : "s"}` : "New member";
  return `<div class="explore-person-card" onclick="viewProfile(${user.id})">
    <div class="explore-person-av" style="background:${avBg}">${avInner}</div>
    <div class="explore-person-name" title="${escHtml(user.name)}">${escHtml(user.name)}</div>
    <div class="explore-person-meta">${meta}</div>
    <button class="explore-person-follow" onclick="event.stopPropagation();exploreFollow(${user.id},this)">Follow</button>
  </div>`;
}

async function exploreFollow(userId, btn) {
  if (!currentUser) { showToast("Log in to follow."); goTo("login"); return; }
  btn.disabled = true;
  try {
    await api("POST", "/api/follow/" + userId);
    btn.textContent = "Following";
    btn.classList.add("following");
    showToast("Following!");
    setTimeout(() => { feedPage = 1; feedHasMore = true; loadPosts(); }, 1200);
  } catch (e) {
    showToast("Error: " + e.message);
    btn.disabled = false;
  }
}

// ── Router: set active category ───────────────────────────────
function setTrendingCategory(category, btn) {
  _trendingCategory = category;
  document.querySelectorAll(".trending-route-btn").forEach(b => b.classList.remove("active"));
  if (btn) btn.classList.add("active");
  renderTrendingList();
}

// ── Controller: set active sort ───────────────────────────────
function setTrendingSort(sort, btn) {
  _trendingSort = sort;
  document.querySelectorAll(".trending-sort-btn").forEach(b => b.classList.remove("active"));
  if (btn) btn.classList.add("active");
  renderTrendingList();
}

// ── Filter + sort the cached raw data and render ──────────────
function renderTrendingList() {
  const list = document.getElementById("explore-trending-list");
  if (!list) return;

  let items = [..._trendingRaw];

  // ── Router filter ──
  switch (_trendingCategory) {
    case "popular":
      items = items.filter(p => (p.likes?.length || 0) > 0);
      break;
    case "discussed":
      items = items.filter(p => (p.comments?.length || 0) > 0);
      break;
    case "shared":
      items = items.filter(p => (p.reposts?.length || 0) > 0);
      break;
    case "media":
      items = items.filter(p => !!p.image);
      break;
    // "all" → no filter
  }

  // ── Controller sort ──
  switch (_trendingSort) {
    case "hot":
      // Engagement score weighted by recency
      items.sort((a, b) => {
        const engA = (a.likes?.length || 0) * 3 + (a.comments?.length || 0) * 2 + (a.reposts?.length || 0) * 2;
        const engB = (b.likes?.length || 0) * 3 + (b.comments?.length || 0) * 2 + (b.reposts?.length || 0) * 2;
        const ageA = Date.now() - new Date(a.createdAt);
        const ageB = Date.now() - new Date(b.createdAt);
        // Decay: divide by hours since post
        const scoreA = engA / (1 + ageA / 3600000);
        const scoreB = engB / (1 + ageB / 3600000);
        return scoreB - scoreA;
      });
      break;
    case "newest":
      items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      break;
    case "top":
      items.sort((a, b) => {
        const eA = (a.likes?.length || 0) + (a.comments?.length || 0) + (a.reposts?.length || 0);
        const eB = (b.likes?.length || 0) + (b.comments?.length || 0) + (b.reposts?.length || 0);
        return eB - eA;
      });
      break;
  }

  // Update count badge
  const badge = document.getElementById("trending-count-badge");
  if (badge) badge.textContent = `${items.length} post${items.length !== 1 ? "s" : ""}`;

  if (!items.length) {
    list.innerHTML = `<div class="explore-trending-empty">🔍 No posts match this filter. Try a different category!</div>`;
    return;
  }

  list.innerHTML = items.map(p => buildPostCard(p, false)).join("");
}

async function loadExploreTrending(force = false) {
  const list = document.getElementById("explore-trending-list");
  const btn  = document.getElementById("explore-trending-refresh");
  if (!list) return;

  if (btn) { btn.classList.add("spinning"); btn.disabled = true; }
  list.innerHTML = [1,2,3].map(() => `<div class="explore-post-skeleton"></div>`).join("");

  try {
    const res      = await api("GET", "/api/explore/trending");
    const trending = res.data || [];

    if (!trending.length) {
      _trendingRaw = [];
      list.innerHTML = `<div class="explore-trending-empty">🔥 No trending posts yet. Check back soon!</div>`;
      const badge = document.getElementById("trending-count-badge");
      if (badge) badge.textContent = "0 posts";
      return;
    }

    // Hydrate posts so engagement works
    trending.forEach((post) => {
      post.likes    = Array.isArray(post.likes)    ? post.likes    : [];
      post.reposts  = Array.isArray(post.reposts)  ? post.reposts  : [];
      post.comments = Array.isArray(post.comments) ? post.comments : [];
      PostCache.putPost(post);
      if (!posts.find(p => p.id === post.id)) posts.unshift(post);
    });

    // Store raw data and let the controller/router render
    _trendingRaw = trending;
    renderTrendingList();
  } catch (e) {
    list.innerHTML = `<div class="explore-trending-empty" style="color:var(--rose)">Could not load trending posts.</div>`;
  } finally {
    if (btn) { btn.classList.remove("spinning"); btn.disabled = false; }
  }
}
/* ═══════════════════ END EXPLORE ════════════════════════ */

/* ═══════════════════ NEW MEMBERS ═══════════════════════ */
let _newMembers       = [];
let _newMembersLoaded = false;
let _feedNewDismissed = false;

function _joinedAgo(dateStr) {
  const d    = new Date(dateStr);
  const diff = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (diff === 0) return "Joined today";
  if (diff === 1) return "Joined yesterday";
  return `Joined ${diff}d ago`;
}

async function loadNewMembers(force = false) {
  if (!currentUser) return;
  if (_newMembersLoaded && !force) return;
  try {
    const res    = await api("GET", "/api/users/new-members?limit=10");
    _newMembers  = (res.data || []).filter(u => u.id !== currentUser.id);
    _newMembersLoaded = true;

    // Inject into feed if already rendered and not dismissed
    if (!_feedNewDismissed && _newMembers.length) {
      const feedList   = document.getElementById("feed-list");
      if (feedList && !document.getElementById("feed-new-inline")) {
        const postCards = feedList.querySelectorAll(".post-card");
        if (postCards.length >= 8) {
          const temp = document.createElement("div");
          temp.innerHTML = buildFeedNewCard();
          postCards[7].insertAdjacentElement("afterend", temp.firstElementChild);
        }
      }
    }

    // Update explore section
    loadExploreNewMembers();
  } catch (e) {
    console.error("New members error:", e);
  }
}

function buildFeedNewCard() {
  if (!_newMembers.length) return "";
  const pills = _newMembers.map(u => {
    const initial = (u.name || "?").charAt(0).toUpperCase();
    const color   = stringToColor(u.name || "");
    const avBg    = u.picture ? "transparent" : color;
    const avInner = u.picture
      ? `<img src="${escHtml(u.picture)}" alt="${initial}" loading="lazy" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block"/>`
      : initial;
    return `<div class="feed-new-pill" onclick="viewProfile(${u.id})">
      <span class="feed-new-badge">NEW</span>
      <div class="sug-av" style="background:${avBg}">${avInner}</div>
      <div class="feed-new-pill-name" title="${escHtml(u.name)}">${escHtml(u.name)}</div>
      <div class="feed-new-pill-joined">${_joinedAgo(u.createdAt)}</div>
      <button class="feed-new-pill-btn" onclick="event.stopPropagation();feedNewFollow(${u.id},this)">Welcome</button>
    </div>`;
  }).join("");

  return `<div class="feed-new-card" id="feed-new-inline">
    <div class="feed-new-header">
      <span class="feed-new-title">🆕 New to Circle</span>
      <span class="feed-new-dismiss" onclick="dismissFeedNew()">✕ Got it</span>
    </div>
    <p class="feed-new-tagline">Say hello to people who just joined!</p>
    <div class="feed-new-scroll">${pills}</div>
  </div>`;
}

function dismissFeedNew() {
  _feedNewDismissed = true;
  const el = document.getElementById("feed-new-inline");
  if (el) {
    el.style.cssText += ";transition:opacity .25s,max-height .3s;opacity:0;max-height:0;overflow:hidden;margin:0;padding:0;border:none";
    setTimeout(() => el.remove(), 320);
  }
}

async function feedNewFollow(userId, btn) {
  if (!currentUser) { showToast("Log in to follow."); goTo("login"); return; }
  btn.disabled = true;
  try {
    await api("POST", "/api/follow/" + userId);
    btn.textContent = "Following!";
    btn.classList.add("following");
    showToast("Welcome them to Circle! 🎉");
    const pill = btn.closest(".feed-new-pill");
    if (pill) {
      pill.style.cssText += ";transition:opacity .3s,transform .3s;opacity:0;transform:scale(.85)";
      setTimeout(() => {
        pill.remove();
        _newMembers = _newMembers.filter(u => u.id !== userId);
        if (!document.querySelectorAll(".feed-new-pill").length) dismissFeedNew();
      }, 300);
    }
  } catch (e) {
    showToast("Error: " + e.message);
    btn.disabled = false;
  }
}

async function loadExploreNewMembers(force = false) {
  const section = document.getElementById("explore-new-section");
  const list    = document.getElementById("explore-new-list");
  const btn     = document.getElementById("explore-new-refresh");
  if (!section || !list) return;

  if (btn) { btn.classList.add("spinning"); btn.disabled = true; }

  try {
    let members = _newMembers;
    if (!_newMembersLoaded || force) {
      const res = await api("GET", "/api/users/new-members?limit=10");
      members   = (res.data || []).filter(u => u.id !== currentUser?.id);
      _newMembers = members;
      _newMembersLoaded = true;
    }

    if (!members.length) {
      section.style.display = "none";
      return;
    }

    section.style.display = "block";
    list.innerHTML = `<div class="explore-people-scroll">${members.map(u => {
      const initial = (u.name || "?").charAt(0).toUpperCase();
      const color   = stringToColor(u.name || "");
      const avBg    = u.picture ? "transparent" : color;
      const avInner = u.picture
        ? `<img src="${escHtml(u.picture)}" alt="${initial}" loading="lazy" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block"/>`
        : initial;
      return `<div class="explore-person-card" onclick="viewProfile(${u.id})" style="border-color:var(--green);position:relative">
        <span style="position:absolute;top:-7px;right:-7px;background:var(--green);color:#fff;font-size:9px;font-weight:800;padding:2px 5px;border-radius:20px;text-transform:uppercase">NEW</span>
        <div class="explore-person-av" style="background:${avBg}">${avInner}</div>
        <div class="explore-person-name" title="${escHtml(u.name)}">${escHtml(u.name)}</div>
        <div class="explore-person-meta" style="color:var(--green)">${_joinedAgo(u.createdAt)}</div>
        <button class="explore-person-follow" onclick="event.stopPropagation();exploreNewFollow(${u.id},this)" style="background:var(--green);border-color:var(--green)">Welcome</button>
      </div>`;
    }).join("")}</div>`;
  } catch (e) {
    if (section) section.style.display = "none";
  } finally {
    if (btn) { btn.classList.remove("spinning"); btn.disabled = false; }
  }
}

async function exploreNewFollow(userId, btn) {
  if (!currentUser) { showToast("Log in to follow."); goTo("login"); return; }
  btn.disabled = true;
  try {
    await api("POST", "/api/follow/" + userId);
    btn.textContent = "Following!";
    btn.style.opacity = "0.7";
    showToast("Welcome them to Circle! 🎉");
    _newMembers = _newMembers.filter(u => u.id !== userId);
  } catch (e) {
    showToast("Error: " + e.message);
    btn.disabled = false;
  }
}
/* ═══════════════════ END NEW MEMBERS ════════════════════ */

function escHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
function formatTime(date) {
  const d = new Date(date),
    now = new Date(),
    diff = Math.floor((now - d) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return Math.floor(diff / 60) + "m ago";
  if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
function showAlert(el, msg, type) {
  el.textContent = msg;
  el.className = "alert " + type;
}
let _tt;
function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(_tt);
  _tt = setTimeout(() => t.classList.remove("show"), 2800);
}
function stringToColor(s) {
  const c = [
    "#7c6bff",
    "#ff5f7a",
    "#22d48f",
    "#f5a623",
    "#00b4d8",
    "#e040fb",
    "#26c6da",
    "#ff7043",
  ];
  let h = 0;
  for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h);
  return c[Math.abs(h) % c.length];
}

/* ═══════════════════════════════════════════
   LIGHTBOX — image viewer
═══════════════════════════════════════════ */

/* ── State ── */
let _lbImages = [],
  _lbIndex = 0,
  _lbScale = 1,
  _lbOrigin = null;
let _lbDragStartX = 0,
  _lbDragStartY = 0,
  _lbTranslateX = 0,
  _lbTranslateY = 0;
let _lbPinchStartDist = 0,
  _lbPointers = new Map();
let _lbSwipeStartX = 0,
  _lbSwiping = false,
  _lbAnimating = false;
let _lbMeta = []; // [{name, picture, userId}] parallel to _lbImages

/* ── Render profile chip ── */
function _lbRenderProfile(idx) {
  const meta = _lbMeta[idx] || {};
  const chip = document.getElementById("lb-profile");
  const av = document.getElementById("lb-profile-av");
  const nm = document.getElementById("lb-profile-name");
  if (!meta.name) {
    chip.style.display = "none";
    return;
  }
  nm.textContent = meta.name;
  // Parse to number so strict equality works in viewProfile/renderProfile
  const uid = meta.userId ? parseInt(meta.userId, 10) : null;
  chip.onclick = function () {
    closeLightbox();
    // Wait for the lightbox fade-out (180ms) before navigating
    if (uid)
      setTimeout(function () {
        viewProfile(uid);
      }, 200);
  };
  if (meta.picture) {
    av.innerHTML =
      '<img src="' +
      meta.picture +
      '" alt="' +
      escHtml(meta.name.charAt(0)) +
      '" loading="lazy" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block"/>';
    av.style.background = "transparent";
  } else {
    av.innerHTML = escHtml(meta.name.charAt(0).toUpperCase());
    av.style.background = stringToColor(meta.name);
  }
  chip.style.display = "flex";
  chip.style.animation = "none";
  chip.offsetHeight;
  chip.style.animation =
    "lbFadeSlideDown 0.3s cubic-bezier(0.34,1.4,0.64,1) both";
}

/* ── Open ── */
function openLightbox(imgEl, allImgsInContext) {
  const images = allImgsInContext || [imgEl.src];
  const idx = images.indexOf(imgEl.src);
  _lbImages = images;
  _lbIndex = idx >= 0 ? idx : 0;
  _lbScale = 1;
  _lbTranslateX = 0;
  _lbTranslateY = 0;
  _lbOrigin = imgEl.getBoundingClientRect();

  // Build meta array from data-lb-* attributes on every .lb-thumb in the DOM
  const _allThumbs = document.querySelectorAll(".lb-thumb");
  _lbMeta = images.map(function (src) {
    var found = null;
    _allThumbs.forEach(function (el) {
      if (el.src === src && el.dataset.lbName) found = el;
    });
    if (found)
      return {
        name: found.dataset.lbName,
        picture: found.dataset.lbPicture || null,
        userId: found.dataset.lbUserId || null,
      };
    // fallback: read from the clicked element itself
    if (imgEl.src === src && imgEl.dataset.lbName)
      return {
        name: imgEl.dataset.lbName,
        picture: imgEl.dataset.lbPicture || null,
        userId: imgEl.dataset.lbUserId || null,
      };
    return {};
  });

  const lb = document.getElementById("lightbox");
  const lbImg = document.getElementById("lb-img");
  lb.style.display = "flex";

  /* hero entry animation from thumbnail position */
  const ox = _lbOrigin.left + _lbOrigin.width / 2 - window.innerWidth / 2;
  const oy =
    _lbOrigin.top + _lbOrigin.height / 2 - window.innerHeight / 2;
  const sx = _lbOrigin.width / window.innerWidth;
  const sy = _lbOrigin.height / window.innerHeight;
  lbImg.style.transition = "none";
  lbImg.style.transform = `translate(${ox}px,${oy}px) scale(${sx},${sy})`;
  lbImg.style.opacity = "0";
  lbImg.src = _lbImages[_lbIndex];
  lbImg.onload = () => {
    requestAnimationFrame(() => {
      lbImg.style.transition =
        "transform 0.38s cubic-bezier(0.34,1.2,0.64,1), opacity 0.22s ease";
      lbImg.style.transform = "translate(0,0) scale(1)";
      lbImg.style.opacity = "1";
    });
  };
  if (lbImg.complete) lbImg.onload();

  document.getElementById("lb-counter").textContent =
    `${_lbIndex + 1} / ${_lbImages.length}`;
  document.getElementById("lb-counter").style.display =
    _lbImages.length > 1 ? "flex" : "none";
  document.getElementById("lb-prev").style.display =
    _lbImages.length > 1 && _lbIndex > 0 ? "flex" : "none";
  document.getElementById("lb-next").style.display =
    _lbImages.length > 1 && _lbIndex < _lbImages.length - 1
      ? "flex"
      : "none";
  _lbRenderProfile(_lbIndex);

  lb.style.opacity = "0";
  lb.style.transition = "opacity 0.18s ease";
  requestAnimationFrame(() => {
    lb.style.opacity = "1";
  });
  document.body.style.overflow = "hidden";
  // auto-hide hint
  const hint = document.getElementById("lb-hint");
  if (hint) {
    hint.style.opacity = "1";
    clearTimeout(hint._t);
    hint._t = setTimeout(() => (hint.style.opacity = "0"), 3000);
  }
}

function closeLightbox() {
  const lb = document.getElementById("lightbox");
  lb.style.transition = "opacity 0.18s ease";
  lb.style.opacity = "0";
  setTimeout(() => {
    lb.style.display = "none";
    lb.style.opacity = "";
    document.body.style.overflow = "";
    _lbScale = 1;
    _lbTranslateX = 0;
    _lbTranslateY = 0;
    const lbImg = document.getElementById("lb-img");
    lbImg.style.transform = "";
    lbImg.style.transition = "";
  }, 180);
}

function lbGoTo(newIdx) {
  if (_lbAnimating || newIdx < 0 || newIdx >= _lbImages.length) return;
  _lbAnimating = true;
  const dir = newIdx > _lbIndex ? 1 : -1;
  const lbImg = document.getElementById("lb-img");
  _lbIndex = newIdx;
  _lbScale = 1;
  _lbTranslateX = 0;
  _lbTranslateY = 0;
  lbImg.style.transition =
    "transform 0.28s cubic-bezier(0.4,0,0.2,1), opacity 0.22s ease";
  lbImg.style.transform = `translateX(${-dir * 60}px) scale(0.88)`;
  lbImg.style.opacity = "0.2";
  setTimeout(() => {
    lbImg.src = _lbImages[_lbIndex];
    lbImg.style.transition = "none";
    lbImg.style.transform = `translateX(${dir * 60}px) scale(0.88)`;
    lbImg.style.opacity = "0.2";
    requestAnimationFrame(() => {
      lbImg.style.transition =
        "transform 0.3s cubic-bezier(0.34,1.2,0.64,1), opacity 0.22s ease";
      lbImg.style.transform = "translateX(0) scale(1)";
      lbImg.style.opacity = "1";
      setTimeout(() => {
        _lbAnimating = false;
      }, 320);
    });
  }, 200);
  document.getElementById("lb-counter").textContent =
    `${_lbIndex + 1} / ${_lbImages.length}`;
  document.getElementById("lb-prev").style.display =
    _lbIndex > 0 ? "flex" : "none";
  document.getElementById("lb-next").style.display =
    _lbIndex < _lbImages.length - 1 ? "flex" : "none";
  _lbRenderProfile(_lbIndex);
}

function lbDownload() {
  const src = _lbImages[_lbIndex];
  const a = document.createElement("a");
  a.href = src;
  a.download = "image.jpg";
  a.target = "_blank";
  a.click();
}

function lbShare() {
  const src = _lbImages[_lbIndex];
  if (navigator.share) {
    navigator.share({ url: src }).catch(() => {});
  } else {
    navigator.clipboard
      .writeText(src)
      .then(() => showToast("Image URL copied!"));
  }
}

/* ── Touch / Pointer events for zoom & swipe ── */
function lbPointerDown(e) {
  _lbPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (_lbPointers.size === 1) {
    _lbSwipeStartX = e.clientX;
    _lbDragStartX = e.clientX - _lbTranslateX;
    _lbDragStartY = e.clientY - _lbTranslateY;
    _lbSwiping = _lbScale <= 1;
  } else if (_lbPointers.size === 2) {
    _lbSwiping = false;
    const pts = [..._lbPointers.values()];
    _lbPinchStartDist = Math.hypot(
      pts[1].x - pts[0].x,
      pts[1].y - pts[0].y,
    );
  }
}

function lbPointerMove(e) {
  _lbPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const lbImg = document.getElementById("lb-img");
  if (_lbPointers.size === 2) {
    const pts = [..._lbPointers.values()];
    const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    const newScale = Math.min(
      5,
      Math.max(1, _lbScale * (dist / _lbPinchStartDist)),
    );
    _lbPinchStartDist = dist;
    _lbScale = newScale;
    lbImg.style.transition = "none";
    lbImg.style.transform = `translate(${_lbTranslateX}px, ${_lbTranslateY}px) scale(${_lbScale})`;
  } else if (_lbPointers.size === 1 && _lbScale > 1) {
    _lbTranslateX = e.clientX - _lbDragStartX;
    _lbTranslateY = e.clientY - _lbDragStartY;
    lbImg.style.transition = "none";
    lbImg.style.transform = `translate(${_lbTranslateX}px, ${_lbTranslateY}px) scale(${_lbScale})`;
  }
}

function lbPointerUp(e) {
  const startX = _lbSwipeStartX;
  _lbPointers.delete(e.pointerId);
  if (_lbPointers.size === 0 && _lbSwiping && _lbScale <= 1) {
    const dx = e.clientX - startX;
    if (Math.abs(dx) > 55) {
      lbGoTo(_lbIndex + (dx < 0 ? 1 : -1));
    }
    _lbSwiping = false;
  }
}

/* ── Wheel zoom ── */
function lbWheel(e) {
  e.preventDefault();
  const lbImg = document.getElementById("lb-img");
  _lbScale = Math.min(
    5,
    Math.max(1, _lbScale * (e.deltaY < 0 ? 1.12 : 0.9)),
  );
  if (_lbScale <= 1) {
    _lbTranslateX = 0;
    _lbTranslateY = 0;
  }
  lbImg.style.transition = "transform 0.12s ease";
  lbImg.style.transform = `translate(${_lbTranslateX}px, ${_lbTranslateY}px) scale(${_lbScale})`;
}

/* ── Double tap/click to reset zoom ── */
function lbDblClick() {
  const lbImg = document.getElementById("lb-img");
  _lbScale = _lbScale > 1 ? 1 : 2.2;
  _lbTranslateX = 0;
  _lbTranslateY = 0;
  lbImg.style.transition = "transform 0.3s cubic-bezier(0.34,1.2,0.64,1)";
  lbImg.style.transform = _lbScale > 1 ? `scale(${_lbScale})` : "none";
}

/* ── Keyboard ── */
document.addEventListener("keydown", (e) => {
  const lb = document.getElementById("lightbox");
  if (lb.style.display !== "flex") return;
  if (e.key === "Escape") closeLightbox();
  if (e.key === "ArrowRight") lbGoTo(_lbIndex + 1);
  if (e.key === "ArrowLeft") lbGoTo(_lbIndex - 1);
});

/* ── Collect all images from feed for gallery context ── */
function collectFeedImages() {
  return [...document.querySelectorAll(".post-img, .repost-embed-img")]
    .map((i) => i.src)
    .filter(Boolean);
}

/* ═══════════════════════════════════════════════════════════════
   E2E ENCRYPTION  —  ECDH key exchange + AES-GCM per-message
   ═══════════════════════════════════════════════════════════════
   How it works:
     1. On first login each device generates a persistent ECDH key-pair
        (P-256). The PUBLIC key is uploaded to the server so other users
        can fetch it.  The PRIVATE key never leaves localStorage.
     2. When Alice opens a conversation with Bob she fetches Bob's public
        key, derives a shared AES-GCM secret via ECDH, and caches it.
     3. Every outgoing message body is encrypted:
          ciphertext  = AES-GCM-encrypt(sharedKey, plaintext)
          wire format = "e2e:" + base64(iv + ciphertext)
     4. On receipt the same derivation gives the same shared key and the
        message is decrypted before display.
     5. The server only ever stores/sees the "e2e:…" blob — plaintext
        never touches the server.
   ═══════════════════════════════════════════════════════════════ */
const E2E = (() => {
  const STORE_KEY = "circle_e2e_keypair";   // localStorage key
  let _myKeyPair  = null;                    // CryptoKeyPair (this device)
  let _sharedKeys = {};                      // { userId: CryptoKey }

  // ── Helpers ─────────────────────────────────────────────
  function _b64(buf) {
    return btoa(String.fromCharCode(...new Uint8Array(buf)));
  }
  function _unb64(b64) {
    return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  }

  // ── Generate or load this device's ECDH key-pair ────────
  async function ensureMyKeys() {
    if (_myKeyPair) return _myKeyPair;
    const stored = localStorage.getItem(STORE_KEY);
    if (stored) {
      try {
        const { pub, priv } = JSON.parse(stored);
        const publicKey  = await crypto.subtle.importKey(
          "spki", _unb64(pub),
          { name: "ECDH", namedCurve: "P-256" }, true, []
        );
        const privateKey = await crypto.subtle.importKey(
          "pkcs8", _unb64(priv),
          { name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey"]
        );
        _myKeyPair = { publicKey, privateKey };
        return _myKeyPair;
      } catch (e) { /* corrupt — regenerate */ }
    }
    _myKeyPair = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey"]
    );
    // Persist to localStorage
    const pub  = _b64(await crypto.subtle.exportKey("spki",  _myKeyPair.publicKey));
    const priv = _b64(await crypto.subtle.exportKey("pkcs8", _myKeyPair.privateKey));
    localStorage.setItem(STORE_KEY, JSON.stringify({ pub, priv }));
    return _myKeyPair;
  }

  // ── Upload our public key to server ─────────────────────
  // PUT /api/users/:id/publickey  { publicKey: "<b64 spki>" }
  async function publishMyPublicKey() {
    if (!currentUser) return;
    try {
      const kp  = await ensureMyKeys();
      const pub = _b64(await crypto.subtle.exportKey("spki", kp.publicKey));
      await api("PUT", `/api/users/${currentUser.id}/publickey`, { publicKey: pub });
    } catch (e) { /* server may not support yet — silently ignore */ }
  }

  // ── Fetch a peer's public key from server ───────────────
  // GET /api/users/:id/publickey  → { publicKey: "<b64 spki>" }
  async function _fetchPeerKey(userId) {
    try {
      const res = await api("GET", `/api/users/${userId}/publickey`);
      const b64 = res.data?.publicKey || res.publicKey;
      if (!b64) return null;
      return await crypto.subtle.importKey(
        "spki", _unb64(b64),
        { name: "ECDH", namedCurve: "P-256" }, true, []
      );
    } catch (e) { return null; }
  }

  // ── Derive (or return cached) shared AES-GCM key ────────
  async function _sharedKey(peerUserId) {
    if (_sharedKeys[peerUserId]) return _sharedKeys[peerUserId];
    const kp       = await ensureMyKeys();
    const peerPub  = await _fetchPeerKey(peerUserId);
    if (!peerPub) return null;
    const key = await crypto.subtle.deriveKey(
      { name: "ECDH", public: peerPub },
      kp.privateKey,
      { name: "AES-GCM", length: 256 },
      false, ["encrypt", "decrypt"]
    );
    _sharedKeys[peerUserId] = key;
    return key;
  }

  // ── Encrypt plaintext → "e2e:<b64(iv+ct)>" ──────────────
  async function encrypt(peerUserId, plaintext) {
    const key = await _sharedKey(peerUserId);
    if (!key) return plaintext;                  // fall back to plaintext
    const iv  = crypto.getRandomValues(new Uint8Array(12));
    const ct  = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(plaintext)
    );
    const blob = new Uint8Array(12 + ct.byteLength);
    blob.set(iv, 0);
    blob.set(new Uint8Array(ct), 12);
    return "e2e:" + _b64(blob.buffer);
  }

  // ── Decrypt "e2e:…" → plaintext ─────────────────────────
  async function decrypt(peerUserId, body) {
    if (!body || !body.startsWith("e2e:")) return body;
    try {
      const key  = await _sharedKey(peerUserId);
      if (!key) return "[🔒 Encrypted — open conversation to decrypt]";
      const blob = _unb64(body.slice(4));
      const iv   = blob.slice(0, 12);
      const ct   = blob.slice(12);
      const pt   = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv }, key, ct
      );
      return new TextDecoder().decode(pt);
    } catch (e) {
      return "[🔒 Encrypted message]";
    }
  }

  // ── Clear cached shared keys (e.g. on logout) ───────────
  function clearCache() { _sharedKeys = {}; _myKeyPair = null; }

  // ── Check if E2E is active for a peer ────────────────────
  async function isEnabled(peerUserId) {
    const key = await _sharedKey(peerUserId);
    return !!key;
  }

  return { ensureMyKeys, publishMyPublicKey, encrypt, decrypt, clearCache, isEnabled };
})();

/* ═══════════════════════════════════════════════════════════════
   DIRECT MESSAGES  —  localStorage-backed private messaging
   ═══════════════════════════════════════════════════════════════ */
const DM = (() => {
  // State
  let _inbox        = [];   // rows from GET /api/dm/inbox
  let _activeConvId = null;
  let _activeOther  = null;
  let _messages     = [];
  let _inboxFilter  = "";
  let _polling      = null;
  let _sending      = false;

  // ── Time helpers ────────────────────────────────────────
  function _fmtTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  function _fmtDate(ts) {
    const d = new Date(ts), now = new Date();
    if (d.toDateString() === now.toDateString()) return "Today";
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return "Yesterday";
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  }
  function _fmtPreviewTime(ts) {
    if (!ts) return "";
    const d = new Date(ts), now = new Date();
    return d.toDateString() === now.toDateString()
      ? _fmtTime(ts)
      : d.toLocaleDateString([], { month: "short", day: "numeric" });
  }

  // ── Load inbox from backend ─────────────────────────────
  // GET /api/dm/inbox
  async function _loadInbox() {
    if (!currentUser) return;
    try {
      const res = await api("GET", "/api/dm/inbox");
      _inbox = Array.isArray(res.data) ? res.data : [];
      renderInbox();
      _refreshBadge();
    } catch (e) { _inbox = []; }
  }

  // ── Polling ─────────────────────────────────────────────
  function _startPolling() {
    _stopPolling();
    _polling = setInterval(async () => {
      if (!currentUser) return;
      await _loadInbox();
      if (_activeConvId) await _fetchMessages(_activeConvId, false);
    }, 4000);
  }
  function _stopPolling() {
    if (_polling) { clearInterval(_polling); _polling = null; }
  }

  // ── Render inbox list ───────────────────────────────────
  function renderInbox() {
    const list = document.getElementById("dm-conv-list");
    if (!currentUser) {
      list.innerHTML = '<div class="dm-conv-empty"><svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" width="36" height="36"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg><p>Log in to use messages</p></div>';
      return;
    }
    const q = _inboxFilter.toLowerCase();
    const convs = _inbox.filter(c => !q || (c.other_name || "").toLowerCase().includes(q));
    if (!convs.length) {
      list.innerHTML = '<div class="dm-conv-empty"><svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" width="36" height="36"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg><p>No conversations yet.<br/>Start one!</p></div>';
      return;
    }

    // Render synchronously first; then async-decrypt e2e previews
    const renderConv = (conv, plainPreview) => {
      const unread  = conv.unread_count || 0;
      const preview = plainPreview !== undefined
        ? plainPreview
        : (conv.last_message
          ? (conv.last_sender_id === currentUser.id ? "You: " : "") + conv.last_message
          : "No messages yet");
      const timeStr = _fmtPreviewTime(conv.last_message_at);
      const initial = (conv.other_name || "?").charAt(0).toUpperCase();
      const color   = stringToColor(conv.other_name || "");
      const avHtml  = conv.other_picture
        ? `<div class="av sm" style="background:transparent;overflow:hidden;flex-shrink:0"><img src="${conv.other_picture}" loading="lazy" style="width:100%;height:100%;object-fit:cover;border-radius:50%" alt="${initial}"/></div>`
        : `<div class="av sm" style="background:${color};flex-shrink:0">${initial}</div>`;
      return `<div class="dm-conv-item${unread ? " unread" : ""}${conv.id === _activeConvId ? " active" : ""}" id="dm-conv-${conv.id}" onclick="DM.openConv(${conv.id})">
        ${avHtml}
        <div class="dm-conv-info">
          <div class="dm-conv-name">${escHtml(conv.other_name || "")}</div>
          <div class="dm-conv-preview">${escHtml((preview || "").slice(0, 60))}</div>
        </div>
        <div class="dm-conv-meta">
          ${timeStr ? `<div class="dm-conv-time">${timeStr}</div>` : ""}
          ${unread ? `<div class="dm-unread-dot"></div>` : ""}
        </div>
      </div>`;
    };

    list.innerHTML = convs.map(conv => renderConv(conv)).join("");

    // Async: decrypt e2e last_message previews
    convs.forEach(async conv => {
      if (conv.last_message && conv.last_message.startsWith("e2e:") && conv.other_id) {
        const plain = await E2E.decrypt(conv.other_id, conv.last_message);
        const sender = conv.last_sender_id === currentUser.id ? "You: " : "";
        const el = document.getElementById(`dm-conv-${conv.id}`);
        if (el) {
          const previewEl = el.querySelector(".dm-conv-preview");
          if (previewEl) previewEl.textContent = ("🔒 " + sender + plain).slice(0, 60);
        }
      }
    });

    _refreshBadge();
  }

  // ── Open a conversation ─────────────────────────────────
  async function openConv(cid) {
    if (!currentUser) { goTo("login"); return; }
    _activeConvId = cid;
    const row = _inbox.find(c => c.id == cid);
    _activeOther = row
      ? { name: row.other_name, picture: row.other_picture, id: row.other_id }
      : { name: "…", picture: null, id: null };

    document.getElementById("dm-inbox").classList.add("hidden-mobile");
    document.getElementById("dm-chat").classList.add("visible-mobile");

    const avEl = document.getElementById("dm-chat-av");
    if (_activeOther.picture) {
      avEl.style.background = "transparent";
      avEl.innerHTML = `<img src="${_activeOther.picture}" loading="lazy" style="width:100%;height:100%;object-fit:cover;border-radius:50%" alt="${_activeOther.name.charAt(0)}"/>`;
    } else {
      avEl.innerHTML = _activeOther.name.charAt(0).toUpperCase();
      avEl.style.background = stringToColor(_activeOther.name);
    }
    document.getElementById("dm-chat-name").textContent = _activeOther.name;
    document.getElementById("dm-chat-empty").style.display  = "none";
    document.getElementById("dm-chat-active").style.display = "flex";
    document.getElementById("dm-messages").innerHTML =
      `<div style="text-align:center;padding:40px 16px;color:var(--txt3);font-size:13.5px">Loading…</div>`;

    // Show/update E2E badge in header
    let e2eBadge = document.getElementById("dm-e2e-badge");
    if (!e2eBadge) {
      e2eBadge = document.createElement("span");
      e2eBadge.id = "dm-e2e-badge";
      e2eBadge.style.cssText = "display:none;align-items:center;gap:4px;font-size:11px;font-weight:700;color:var(--green);background:var(--green-bg);border:1px solid var(--green);border-radius:20px;padding:2px 9px;cursor:default;";
      e2eBadge.title = "Messages in this conversation are end-to-end encrypted";
      e2eBadge.innerHTML = "🔒 End-to-end encrypted";
      const nameEl = document.getElementById("dm-chat-name");
      if (nameEl && nameEl.parentNode) nameEl.parentNode.appendChild(e2eBadge);
    }

    // Check if E2E is available for this peer
    if (_activeOther.id) {
      E2E.isEnabled(_activeOther.id).then(enabled => {
        e2eBadge.style.display = enabled ? "inline-flex" : "none";
      });
    }

    await _fetchMessages(cid, true);
    _startPolling();
  }

  // ── Fetch messages ──────────────────────────────────────
  // GET /api/dm/conversations/:id/messages
  async function _fetchMessages(cid, markRead) {
    try {
      const res  = await api("GET", `/api/dm/conversations/${cid}/messages`);
      const msgs = Array.isArray(res.data) ? res.data : [];

      // Determine peer user id for decryption
      const otherUserId = _inbox.find(c => c.id == cid)?.other_id;

      // Decrypt each message (skip if already has _plain or no e2e prefix)
      const decrypted = await Promise.all(msgs.map(async m => {
        if (m._plain) return m;                            // already decoded
        if (m.body && m.body.startsWith("e2e:") && otherUserId) {
          return { ...m, _plain: await E2E.decrypt(otherUserId, m.body) };
        }
        return { ...m, _plain: m.body };
      }));

      if (decrypted.length !== _messages.length || markRead) {
        _messages = decrypted;
        _renderMessages(decrypted);
      }
      if (markRead) {
        const row = _inbox.find(c => c.id == cid);
        if (row) row.unread_count = 0;
        renderInbox();
      }
    } catch (e) {
      if (markRead)
        document.getElementById("dm-messages").innerHTML =
          `<div style="text-align:center;padding:40px 16px;color:var(--rose);font-size:13.5px">Failed to load messages.</div>`;
    }
  }

  // ── Render message bubbles ──────────────────────────────
  // Backend fields: sender_id, body, created_at
  function _renderMessages(msgs) {
    const el = document.getElementById("dm-messages");
    if (!msgs.length) {
      el.innerHTML = `<div style="text-align:center;padding:40px 16px;color:var(--txt3);font-size:13.5px">Send a message to start the conversation ✨</div>`;
      return;
    }
    let lastDate = "";
    el.innerHTML = msgs.map(msg => {
      const mine    = msg.sender_id === currentUser.id;
      const dateStr = _fmtDate(msg.created_at);
      let divider   = "";
      if (dateStr !== lastDate) { lastDate = dateStr; divider = `<div class="dm-date-divider">${dateStr}</div>`; }
      // Use decrypted _plain if available, otherwise fall back to raw body
      const displayText = msg._plain !== undefined ? msg._plain : msg.body;
      const isE2E = msg.body && msg.body.startsWith("e2e:");
      return `${divider}<div class="dm-msg ${mine ? "mine" : "theirs"}">
        <div class="dm-bubble">
          ${escHtml(displayText || "").replace(/\n/g, "<br>")}
          <span class="dm-bubble-time">${_fmtTime(msg.created_at)}${isE2E ? ' <span title="End-to-end encrypted" style="opacity:0.7">🔒</span>' : ''}</span>
        </div>
      </div>`;
    }).join("");
    el.scrollTop = el.scrollHeight;
  }

  // ── Send a message ──────────────────────────────────────
  // POST /api/dm/conversations/:id/messages  { body }
  async function sendMessage() {
    if (!currentUser || !_activeConvId || _sending) return;
    const input = document.getElementById("dm-compose-input");
    const text  = input.value.trim();
    if (!text) return;
    _sending = true;

    // Optimistic bubble shows plaintext immediately
    const tempId  = "tmp_" + Date.now();
    const tempMsg = { id: tempId, sender_id: currentUser.id, body: text, created_at: new Date().toISOString(), _plain: text };
    _messages = [..._messages, tempMsg];
    _renderMessages(_messages);
    input.value = "";
    input.style.height = "";

    try {
      // Encrypt before sending to server
      const otherUserId = _inbox.find(c => c.id == _activeConvId)?.other_id;
      const wireBody    = otherUserId
        ? await E2E.encrypt(otherUserId, text)
        : text;

      const res   = await api("POST", `/api/dm/conversations/${_activeConvId}/messages`, { body: wireBody });
      const saved = res.data || res;
      _messages   = _messages.filter(m => m.id !== tempId);
      // Store plaintext on the saved message so we don't re-decrypt our own
      if (saved && saved.id) { saved._plain = text; _messages.push(saved); }
      _renderMessages(_messages);
      await _loadInbox();
    } catch (e) {
      showToast("Failed to send: " + e.message);
      _messages = _messages.filter(m => m.id !== tempId);
      _renderMessages(_messages);
    } finally {
      _sending = false;
    }
  }

  // ── Badge ───────────────────────────────────────────────
  function _refreshBadge() {
    const count = _inbox.reduce((n, c) => n + (c.unread_count || 0), 0);
    const badge = document.getElementById("snav-dm-badge");
    if (badge) { badge.textContent = count > 9 ? "9+" : count; badge.classList.toggle("show", count > 0); }
    const mbadge = document.getElementById("mnav-dm-badge");
    if (mbadge) { mbadge.textContent = count > 9 ? "9+" : count; mbadge.classList.toggle("show", count > 0); }
    const tbadge = document.getElementById("topbar-dm-badge");
    if (tbadge) { tbadge.textContent = count > 9 ? "9+" : count; tbadge.classList.toggle("show", count > 0); }
  }

  function filterInbox() {
    _inboxFilter = document.getElementById("dm-inbox-search").value;
    renderInbox();
  }
  function updateDMBadge() { _refreshBadge(); }

  // ── Start conversation from profile / picker ────────────
  // POST /api/dm/conversations  { recipientId }
  async function startConvWithUser(user) {
    if (!currentUser) { goTo("login"); return; }
    try {
      const res  = await api("POST", "/api/dm/conversations", { recipientId: user.id });
      const conv = res.data || res;
      if (!conv || !conv.id) throw new Error("Invalid response.");
      if (!_inbox.find(c => c.id === conv.id)) {
        _inbox.unshift({
          id: conv.id, other_id: user.id,
          other_name: user.name, other_picture: user.picture || null,
          last_message: null, last_sender_id: null,
          last_message_at: null, unread_count: 0,
          created_at: conv.created_at || new Date().toISOString(),
        });
      }
      goTo("messages");
      setTimeout(() => openConv(conv.id), 60);
    } catch (e) {
      showToast("Could not open conversation: " + e.message);
    }
  }

  return {
    init: _loadInbox,
    renderInbox,
    openConv,
    sendMessage,
    filterInbox,
    updateDMBadge,
    startConvWithUser,
    getActiveConvId: () => _activeConvId,
  };
})();

/* DM UI helpers */
function dmFilterInbox() {
  DM.filterInbox();
}
function dmSendMessage() {
  DM.sendMessage();
}
function dmAutoResize(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 120) + "px";
}
function dmSendOnEnter(e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    DM.sendMessage();
  }
}
function dmBackToInbox() {
  document.getElementById("dm-inbox").classList.remove("hidden-mobile");
  document.getElementById("dm-chat").classList.remove("visible-mobile");
}

/* New DM modal */
let _dmSearchDebounce = null;
function openNewDMModal() {
  if (!currentUser) { goTo("login"); return; }
  document.getElementById("dm-new-modal").classList.add("open");
  document.getElementById("dm-new-search").value = "";
  document.getElementById("dm-new-results").innerHTML =
    '<div class="dm-new-empty">Search for someone to message</div>';
  setTimeout(() => document.getElementById("dm-new-search").focus(), 80);
}
function closeNewDMModal() {
  document.getElementById("dm-new-modal").classList.remove("open");
}
function dmSearchPeople() {
  const q   = document.getElementById("dm-new-search").value.trim();
  const res = document.getElementById("dm-new-results");
  if (!q) {
    res.innerHTML = '<div class="dm-new-empty">Search for someone to message</div>';
    return;
  }
  clearTimeout(_dmSearchDebounce);
  res.innerHTML = '<div class="dm-new-empty">Searching…</div>';
  _dmSearchDebounce = setTimeout(async () => {
    try {
      const data  = await api("GET", `/api/users?search=${encodeURIComponent(q)}&limit=8`);
      let users   = Array.isArray(data.data) ? data.data : (Array.isArray(data) ? data : []);
      users       = users.filter(u => u.id !== currentUser.id).slice(0, 8);
      if (!users.length) { res.innerHTML = '<div class="dm-new-empty">No users found</div>'; return; }
      res.innerHTML = users.map(u => {
        const initial = (u.name || "?").charAt(0).toUpperCase();
        const color   = stringToColor(u.name || "");
        const avHtml  = u.picture
          ? `<div class="av sm" style="background:transparent;overflow:hidden;flex-shrink:0"><img src="${u.picture}" loading="lazy" style="width:100%;height:100%;object-fit:cover;border-radius:50%" alt="${initial}"/></div>`
          : `<div class="av sm" style="background:${color};flex-shrink:0">${initial}</div>`;
        return `<div class="dm-new-result" data-user="${escHtml(JSON.stringify(u))}" onclick="dmPickUser(this)">
          ${avHtml}
          <div class="dm-new-result-info">
            <div class="dm-new-result-name">${escHtml(u.name || "")}</div>
            <div class="dm-new-result-email">${escHtml(u.email || "")}</div>
          </div>
        </div>`;
      }).join("");
    } catch (e) {
      res.innerHTML = '<div class="dm-new-empty">Search failed — try again</div>';
    }
  }, 300);
}
function dmPickUser(el) {
  try {
    const u = JSON.parse(el.dataset.user);
    closeNewDMModal();
    DM.startConvWithUser(u);
  } catch (e) { console.error("dmPickUser error:", e); }
}

/* ── COUNTRY DIAL CODES — all ITU-T E.164 countries ─────────── */
const DIAL_COUNTRIES = [
  ["+93","🇦🇫","Afghanistan"],["+355","🇦🇱","Albania"],["+213","🇩🇿","Algeria"],
  ["+1684","🇦🇸","American Samoa"],["+376","🇦🇩","Andorra"],["+244","🇦🇴","Angola"],
  ["+1264","🇦🇮","Anguilla"],["+1268","🇦🇬","Antigua & Barbuda"],["+54","🇦🇷","Argentina"],
  ["+374","🇦🇲","Armenia"],["+297","🇦🇼","Aruba"],["+61","🇦🇺","Australia"],
  ["+43","🇦🇹","Austria"],["+994","🇦🇿","Azerbaijan"],["+1242","🇧🇸","Bahamas"],
  ["+973","🇧🇭","Bahrain"],["+880","🇧🇩","Bangladesh"],["+1246","🇧🇧","Barbados"],
  ["+375","🇧🇾","Belarus"],["+32","🇧🇪","Belgium"],["+501","🇧🇿","Belize"],
  ["+229","🇧🇯","Benin"],["+1441","🇧🇲","Bermuda"],["+975","🇧🇹","Bhutan"],
  ["+591","🇧🇴","Bolivia"],["+387","🇧🇦","Bosnia & Herzegovina"],["+267","🇧🇼","Botswana"],
  ["+55","🇧🇷","Brazil"],["+246","🇮🇴","British Indian Ocean Ter."],["+1284","🇻🇬","British Virgin Islands"],
  ["+673","🇧🇳","Brunei"],["+359","🇧🇬","Bulgaria"],["+226","🇧🇫","Burkina Faso"],
  ["+257","🇧🇮","Burundi"],["+238","🇨🇻","Cabo Verde"],["+855","🇰🇭","Cambodia"],
  ["+237","🇨🇲","Cameroon"],["+1","🇨🇦","Canada"],["+1345","🇰🇾","Cayman Islands"],
  ["+236","🇨🇫","Central African Republic"],["+235","🇹🇩","Chad"],["+56","🇨🇱","Chile"],
  ["+86","🇨🇳","China"],["+61","🇨🇽","Christmas Island"],["+61","🇨🇨","Cocos Islands"],
  ["+57","🇨🇴","Colombia"],["+269","🇰🇲","Comoros"],["+243","🇨🇩","Congo (DRC)"],
  ["+242","🇨🇬","Congo (Republic)"],["+682","🇨🇰","Cook Islands"],["+506","🇨🇷","Costa Rica"],
  ["+225","🇨🇮","Côte d'Ivoire"],["+385","🇭🇷","Croatia"],["+53","🇨🇺","Cuba"],
  ["+599","🇨🇼","Curaçao"],["+357","🇨🇾","Cyprus"],["+420","🇨🇿","Czech Republic"],
  ["+45","🇩🇰","Denmark"],["+253","🇩🇯","Djibouti"],["+1767","🇩🇲","Dominica"],
  ["+1809","🇩🇴","Dominican Republic"],["+593","🇪🇨","Ecuador"],["+20","🇪🇬","Egypt"],
  ["+503","🇸🇻","El Salvador"],["+240","🇬🇶","Equatorial Guinea"],["+291","🇪🇷","Eritrea"],
  ["+372","🇪🇪","Estonia"],["+268","🇸🇿","Eswatini"],["+251","🇪🇹","Ethiopia"],
  ["+500","🇫🇰","Falkland Islands"],["+298","🇫🇴","Faroe Islands"],["+679","🇫🇯","Fiji"],
  ["+358","🇫🇮","Finland"],["+33","🇫🇷","France"],["+594","🇬🇫","French Guiana"],
  ["+689","🇵🇫","French Polynesia"],["+241","🇬🇦","Gabon"],["+220","🇬🇲","Gambia"],
  ["+995","🇬🇪","Georgia"],["+49","🇩🇪","Germany"],["+233","🇬🇭","Ghana"],
  ["+350","🇬🇮","Gibraltar"],["+30","🇬🇷","Greece"],["+299","🇬🇱","Greenland"],
  ["+1473","🇬🇩","Grenada"],["+590","🇬🇵","Guadeloupe"],["+1671","🇬🇺","Guam"],
  ["+502","🇬🇹","Guatemala"],["+224","🇬🇳","Guinea"],["+245","🇬🇼","Guinea-Bissau"],
  ["+592","🇬🇾","Guyana"],["+509","🇭🇹","Haiti"],["+504","🇭🇳","Honduras"],
  ["+852","🇭🇰","Hong Kong"],["+36","🇭🇺","Hungary"],["+354","🇮🇸","Iceland"],
  ["+91","🇮🇳","India"],["+62","🇮🇩","Indonesia"],["+98","🇮🇷","Iran"],
  ["+964","🇮🇶","Iraq"],["+353","🇮🇪","Ireland"],["+972","🇮🇱","Israel"],
  ["+39","🇮🇹","Italy"],["+1876","🇯🇲","Jamaica"],["+81","🇯🇵","Japan"],
  ["+962","🇯🇴","Jordan"],["+7","🇰🇿","Kazakhstan"],["+254","🇰🇪","Kenya"],
  ["+686","🇰🇮","Kiribati"],["+383","🇽🇰","Kosovo"],["+965","🇰🇼","Kuwait"],
  ["+996","🇰🇬","Kyrgyzstan"],["+856","🇱🇦","Laos"],["+371","🇱🇻","Latvia"],
  ["+961","🇱🇧","Lebanon"],["+266","🇱🇸","Lesotho"],["+231","🇱🇷","Liberia"],
  ["+218","🇱🇾","Libya"],["+423","🇱🇮","Liechtenstein"],["+370","🇱🇹","Lithuania"],
  ["+352","🇱🇺","Luxembourg"],["+853","🇲🇴","Macao"],["+261","🇲🇬","Madagascar"],
  ["+265","🇲🇼","Malawi"],["+60","🇲🇾","Malaysia"],["+960","🇲🇻","Maldives"],
  ["+223","🇲🇱","Mali"],["+356","🇲🇹","Malta"],["+692","🇲🇭","Marshall Islands"],
  ["+596","🇲🇶","Martinique"],["+222","🇲🇷","Mauritania"],["+230","🇲🇺","Mauritius"],
  ["+52","🇲🇽","Mexico"],["+691","🇫🇲","Micronesia"],["+373","🇲🇩","Moldova"],
  ["+377","🇲🇨","Monaco"],["+976","🇲🇳","Mongolia"],["+382","🇲🇪","Montenegro"],
  ["+1664","🇲🇸","Montserrat"],["+212","🇲🇦","Morocco"],["+258","🇲🇿","Mozambique"],
  ["+95","🇲🇲","Myanmar"],["+264","🇳🇦","Namibia"],["+674","🇳🇷","Nauru"],
  ["+977","🇳🇵","Nepal"],["+31","🇳🇱","Netherlands"],["+687","🇳🇨","New Caledonia"],
  ["+64","🇳🇿","New Zealand"],["+505","🇳🇮","Nicaragua"],["+227","🇳🇪","Niger"],
  ["+234","🇳🇬","Nigeria"],["+683","🇳🇺","Niue"],["+672","🇳🇫","Norfolk Island"],
  ["+850","🇰🇵","North Korea"],["+389","🇲🇰","North Macedonia"],["+1670","🇲🇵","Northern Mariana Islands"],
  ["+47","🇳🇴","Norway"],["+968","🇴🇲","Oman"],["+92","🇵🇰","Pakistan"],
  ["+680","🇵🇼","Palau"],["+970","🇵🇸","Palestine"],["+507","🇵🇦","Panama"],
  ["+675","🇵🇬","Papua New Guinea"],["+595","🇵🇾","Paraguay"],["+51","🇵🇪","Peru"],
  ["+63","🇵🇭","Philippines"],["+48","🇵🇱","Poland"],["+351","🇵🇹","Portugal"],
  ["+1787","🇵🇷","Puerto Rico"],["+974","🇶🇦","Qatar"],["+262","🇷🇪","Réunion"],
  ["+40","🇷🇴","Romania"],["+7","🇷🇺","Russia"],["+250","🇷🇼","Rwanda"],
  ["+590","🇧🇱","Saint Barthélemy"],["+290","🇸🇭","Saint Helena"],["+1869","🇰🇳","Saint Kitts & Nevis"],
  ["+1758","🇱🇨","Saint Lucia"],["+1721","🇸🇽","Saint Martin"],["+508","🇵🇲","Saint Pierre & Miquelon"],
  ["+1784","🇻🇨","Saint Vincent & Grenadines"],["+685","🇼🇸","Samoa"],["+378","🇸🇲","San Marino"],
  ["+239","🇸🇹","São Tomé & Príncipe"],["+966","🇸🇦","Saudi Arabia"],["+221","🇸🇳","Senegal"],
  ["+381","🇷🇸","Serbia"],["+248","🇸🇨","Seychelles"],["+232","🇸🇱","Sierra Leone"],
  ["+65","🇸🇬","Singapore"],["+1721","🇸🇽","Sint Maarten"],["+421","🇸🇰","Slovakia"],
  ["+386","🇸🇮","Slovenia"],["+677","🇸🇧","Solomon Islands"],["+252","🇸🇴","Somalia"],
  ["+27","🇿🇦","South Africa"],["+82","🇰🇷","South Korea"],["+211","🇸🇸","South Sudan"],
  ["+34","🇪🇸","Spain"],["+94","🇱🇰","Sri Lanka"],["+249","🇸🇩","Sudan"],
  ["+597","🇸🇷","Suriname"],["+47","🇸🇯","Svalbard & Jan Mayen"],["+46","🇸🇪","Sweden"],
  ["+41","🇨🇭","Switzerland"],["+963","🇸🇾","Syria"],["+886","🇹🇼","Taiwan"],
  ["+992","🇹🇯","Tajikistan"],["+255","🇹🇿","Tanzania"],["+66","🇹🇭","Thailand"],
  ["+670","🇹🇱","Timor-Leste"],["+228","🇹🇬","Togo"],["+690","🇹🇰","Tokelau"],
  ["+676","🇹🇴","Tonga"],["+1868","🇹🇹","Trinidad & Tobago"],["+216","🇹🇳","Tunisia"],
  ["+90","🇹🇷","Turkey"],["+993","🇹🇲","Turkmenistan"],["+1649","🇹🇨","Turks & Caicos Islands"],
  ["+688","🇹🇻","Tuvalu"],["+256","🇺🇬","Uganda"],["+380","🇺🇦","Ukraine"],
  ["+971","🇦🇪","United Arab Emirates"],["+44","🇬🇧","United Kingdom"],["+1","🇺🇸","United States"],
  ["+598","🇺🇾","Uruguay"],["+1340","🇻🇮","US Virgin Islands"],["+998","🇺🇿","Uzbekistan"],
  ["+678","🇻🇺","Vanuatu"],["+379","🇻🇦","Vatican City"],["+58","🇻🇪","Venezuela"],
  ["+84","🇻🇳","Vietnam"],["+681","🇼🇫","Wallis & Futuna"],["+212","🇪🇭","Western Sahara"],
  ["+967","🇾🇪","Yemen"],["+260","🇿🇲","Zambia"],["+263","🇿🇼","Zimbabwe"]
];

function _buildDialOptions(defaultCode) {
  return DIAL_COUNTRIES
    .sort((a, b) => a[2].localeCompare(b[2]))
    .map(([code, flag, name]) => {
      const sel = code === defaultCode ? ' selected' : '';
      return `<option value="${code}"${sel} title="${name}">${flag} ${code}</option>`;
    }).join('');
}

function _populateDialSelects() {
  // Try to detect user's country from timezone as a hint (best-effort)
  let defaultCode = "+268"; // Eswatini default given app origin
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    const tzMap = {
      "Africa/Mbabane":"+268","America/New_York":"+1","America/Chicago":"+1",
      "America/Denver":"+1","America/Los_Angeles":"+1","America/Toronto":"+1",
      "America/Vancouver":"+1","Europe/London":"+44","Europe/Paris":"+33",
      "Europe/Berlin":"+49","Europe/Rome":"+39","Europe/Madrid":"+34",
      "Africa/Johannesburg":"+27","Africa/Nairobi":"+254","Africa/Lagos":"+234",
      "Africa/Accra":"+233","Africa/Dar_es_Salaam":"+255","Africa/Kampala":"+256",
      "Africa/Lusaka":"+260","Africa/Harare":"+263","Africa/Addis_Ababa":"+251",
      "Africa/Cairo":"+20","Asia/Kolkata":"+91","Asia/Tokyo":"+81",
      "Asia/Shanghai":"+86","Asia/Seoul":"+82","Asia/Dubai":"+971",
      "Asia/Singapore":"+65","Australia/Sydney":"+61","Pacific/Auckland":"+64",
    };
    if (tzMap[tz]) defaultCode = tzMap[tz];
  } catch(e) {}
  const html = _buildDialOptions(defaultCode);
  ["login-dial-code","reg-dial-code"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  });
}

/*  BOOT*/
(function boot() {
  PostCache.init(); // hydrate from localStorage
  _populateDialSelects(); // fill country code dropdowns
  DM.init(); // load inbox from backend (no-ops if not logged in)
  applyTheme(localStorage.getItem("circle_theme") || "dark");
  try {
    const s = localStorage.getItem("circle_user");
    if (s) setCurrentUser(JSON.parse(s));
  } catch (e) {
    localStorage.removeItem("circle_user");
  }

  // If arriving via reset link, show new-password view and skip loadPosts
  const resetToken = new URLSearchParams(window.location.search).get(
    "token",
  );
  if (resetToken) {
    goTo("new-password");
    return;
  }

  // Show the global feed tab even for guests
  const ftGuest = document.getElementById("feed-tabs");
  if (ftGuest && !currentUser) {
    ftGuest.style.display = "flex";
    const ftFollowing = document.getElementById("ftab-following");
    if (ftFollowing) ftFollowing.style.opacity = "0.5";
  }
  loadPosts();
})();

/* ── POST DETAIL ──────────────────────────────────────────── */
let _postDetailPrevView = "feed";

function openPostDetail(e, postId) {
  // Don't open if clicking on a button, link, avatar, or input
  const tag = e.target.tagName.toLowerCase();
  if (
    [
      "button",
      "svg",
      "path",
      "polyline",
      "line",
      "circle",
      "polygon",
      "input",
      "textarea",
      "img",
    ].includes(tag)
  )
    return;
  if (
    e.target.closest("button") ||
    e.target.closest("a") ||
    e.target.closest(".av")
  )
    return;

  // Remember which view we came from
  const active = document.querySelector(".view.active");
  _postDetailPrevView = active ? active.id.replace("view-", "") : "feed";

  const post =
    posts.find((p) => p.id === postId) || PostCache.get(postId);
  if (!post) return;

  renderPostDetail(post);
  goTo("post-detail");
}

function closePostDetail() {
  goTo(_postDetailPrevView);
}

function renderPostDetail(post) {
  const liked =
    currentUser && post.likes && post.likes.includes(currentUser.id);
  const reposted =
    currentUser && post.reposts && post.reposts.includes(currentUser.id);
  const canDelete = currentUser && currentUser.id === post.userId;
  const color = stringToColor(post.author);

  const avHtml = post.authorPicture
    ? `<img src="${post.authorPicture}" alt="${escHtml(post.author.charAt(0))}" loading="lazy" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block"/>`
    : escHtml(post.author.charAt(0));

  const detailDate = new Date(
    post.createdAt.includes("T")
      ? post.createdAt
      : post.createdAt.replace(" ", "T"),
  );
  const dateStr = detailDate.toLocaleString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  document.getElementById("post-detail-content").innerHTML = `
    <div class="post-detail-card">
      ${post.isRepost ? `<div class="repost-strip" style="margin-bottom:12px"><svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" width="14" height="14"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg> ${escHtml(post.author)} reposted</div>` : ""}
      <div class="post-detail-head">
        <div class="av" style="background:${post.authorPicture ? "transparent" : color};cursor:pointer;flex-shrink:0" onclick="viewProfile(${post.userId})">${avHtml}</div>
        <div class="post-detail-author">
          <span class="post-detail-name" onclick="viewProfile(${post.userId})">${escHtml(post.author)}</span>
          <span class="post-detail-time">${dateStr}</span>
        </div>
        ${canDelete ? `<button class="post-del" style="margin-left:auto" onclick="deletePost(${post.id})"><svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg></button>` : ""}
      </div>

      ${post.text ? `<div class="post-detail-body">${escHtml(post.text)}</div>` : ""}

      ${
        post.isRepost && post.originalPost
          ? `<div class="repost-embed" style="margin-bottom:14px">
            <div class="repost-embed-name">${escHtml(post.originalPost.author)}</div>
            ${post.originalPost.text ? `<div class="repost-embed-text">${escHtml(post.originalPost.text)}</div>` : ""}
            ${post.originalPost.image ? `<img class="post-detail-img" src="${post.originalPost.image}" loading="lazy"/>` : ""}
          </div>`
          : post.image
            ? `<img class="post-detail-img" src="${post.image}" loading="lazy" onclick="openLightbox(this,collectFeedImages())" data-lb-name="${escHtml(post.author)}" data-lb-picture="${escHtml(post.authorPicture || "")}" data-lb-user-id="${post.userId}"/>`
            : ""
      }

      <div class="post-detail-stats">
        <span class="post-detail-stat"><strong>${post.reposts ? post.reposts.length : 0}</strong> Reposts</span>
        <span class="post-detail-stat"><strong>${post.likes ? post.likes.length : 0}</strong> Likes</span>
        <span class="post-detail-stat"><strong>${post.comments ? post.comments.length : 0}</strong> Comments</span>
      </div>

      <div class="post-detail-actions">
        <button class="act-btn like-btn${liked ? " liked" : ""}" id="pd-like-btn" onclick="pdToggleLike(${post.id})">
          <svg fill="${liked ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
          <span id="pd-like-count">${post.likes ? post.likes.length : 0}</span>
        </button>
        <button class="act-btn" onclick="document.getElementById('post-detail-reply-input').focus()">
          <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
          <span>Reply</span>
        </button>
        ${
          !post.isRepost
            ? `<button class="act-btn repost-btn${reposted ? " reposted" : ""}" onclick="openRepostModal(${post.id})">
          <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>
          <span>${post.reposts ? post.reposts.length : 0}</span>
        </button>`
            : ""
        }
      </div>
    </div>`;

  // Show reply bar only if logged in
  document.getElementById("post-detail-reply-bar").style.display =
    currentUser ? "block" : "none";

  // Render comments
  renderPostDetailComments(post);

  // Store current post id for reply use
  document.getElementById("post-detail-reply-input").dataset.postId =
    post.id;
}

function renderPostDetailComments(post) {
  const comments = post.comments || [];
  const section = document.getElementById("post-detail-comments");

  if (!comments.length) {
    section.innerHTML = `<div class="post-detail-comments-section"><div class="post-detail-no-comments">No replies yet. Be the first! 💬</div></div>`;
    return;
  }

  const items = comments
    .map((c) => {
      const col = stringToColor(c.author);
      const avInner = c.authorPicture
        ? `<img src="${c.authorPicture}" alt="${escHtml(c.author.charAt(0))}" loading="lazy" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block"/>`
        : escHtml(c.author.charAt(0));
      return `<div class="post-detail-comment-item">
        <div class="av sm" style="background:${c.authorPicture ? "transparent" : col};flex-shrink:0">${avInner}</div>
        <div class="post-detail-comment-bubble">
          <div class="post-detail-comment-name">${escHtml(c.author)}</div>
          <div class="post-detail-comment-text">${escHtml(c.text)}</div>
          ${c.createdAt ? `<div class="post-detail-comment-time">${formatTime(c.createdAt)}</div>` : ""}
        </div>
      </div>`;
    })
    .join("");

  section.innerHTML = `<div class="post-detail-comments-section">
    <div class="post-detail-comments-title">Replies (${comments.length})</div>
    ${items}
  </div>`;
}

async function pdToggleLike(postId) {
  if (!currentUser) {
    showToast("Log in to like posts.");
    goTo("login");
    return;
  }
  await toggleLike(postId);
  // Refresh the detail view with updated post
  const post =
    posts.find((p) => p.id === postId) || PostCache.get(postId);
  if (post) renderPostDetail(post);
}

async function postDetailAddComment() {
  const input = document.getElementById("post-detail-reply-input");
  const postId = parseInt(input.dataset.postId);
  const text = input.value.trim();
  if (!text || !postId) return;
  if (!currentUser) {
    showToast("Log in to reply.");
    goTo("login");
    return;
  }

  try {
    await api("POST", `/api/posts/${postId}/comment`, {
      userId: currentUser.id,
      text,
    });
    input.value = "";
    // Re-fetch post to get updated comments
    // Update locally
    const post =
      posts.find((p) => p.id === postId) || PostCache.get(postId);
    if (post) {
      post.comments = post.comments || [];
      post.comments.push({
        author: currentUser.name,
        authorPicture: currentUser.picture || "",
        text,
        userId: currentUser.id,
        createdAt: new Date().toISOString(),
      });
      renderPostDetailComments(post);
      // Update comment count in stats
      const stat = document.querySelector(
        "#post-detail-content .post-detail-stat:last-child strong",
      );
      if (stat) stat.textContent = (post.comments && post.comments.length) || 0;
      const actCount = document.querySelector(
        "#post-detail-content .act-btn:nth-child(2) span",
      );
    }
    showToast("Reply posted! 💬");
  } catch (e) {
    showToast("Failed to post reply: " + e.message);
  }
}

function mobileOpenCompose() {
  if (!currentUser) {
    showToast("Log in to create a post.");
    goTo("login");
    return;
  }
  // Navigate to feed and scroll/focus the compose box
  goTo("feed");
  setTimeout(() => {
    const box = document.getElementById("compose-box");
    const field = document.getElementById("post-text");
    if (box) box.scrollIntoView({ behavior: "smooth", block: "center" });
    if (field) field.focus();
  }, 120);
}

function togglePw(fieldId, btn) {
  const input = document.getElementById(fieldId);
  if (!input) return;
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  btn.innerHTML = showing
    ? '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'
    : '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
  btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
  input.focus();
}

/* ── Lazy-load Intersection Observer ──────────────────────────────
   Uses IntersectionObserver for a smooth fade-in on content images.
   Handles three cases:
     1. Images present in the DOM at parse time (static HTML)
     2. Images injected later by JS (posts, avatars, comments)
     3. Images inside views that are display:none when first observed
        — re-scanned whenever goTo() makes a view visible.
──────────────────────────────────────────────────────────────── */
/* ── Hide mobile nav on scroll down, reveal on scroll up ────────── */
(function initNavHide() {
  const nav = document.querySelector('.mobile-nav');
  if (!nav) return;
  let lastY = window.scrollY;
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const currentY = window.scrollY;
      const delta = currentY - lastY;
      if (delta > 8) {
        nav.classList.add('nav-hidden');      // scrolling down
      } else if (delta < -8) {
        nav.classList.remove('nav-hidden');   // scrolling up
      }
      lastY = currentY;
      ticking = false;
    });
  }, { passive: true });
})();

(function initLazyFade() {
  // These UI-critical images must always be visible instantly.
  const SKIP_IDS = new Set(['lb-img', 'img-preview', 'modal-orig-img']);

  function shouldFade(img) {
    if (SKIP_IDS.has(img.id)) return false;
    if (!img.getAttribute('loading')) return false;
    return true;
  }

  function revealImg(img) {
    img.classList.remove('lazy');
    img.classList.add('loaded');
  }

  function scheduleReveal(img) {
    if (img.complete && img.naturalWidth > 0) {
      revealImg(img);
    } else {
      img.addEventListener('load',  () => revealImg(img), { once: true });
      img.addEventListener('error', () => revealImg(img), { once: true });
    }
  }

  // IO fires when image scrolls into the 200px pre-load buffer
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      io.unobserve(entry.target);
      scheduleReveal(entry.target);
    });
  }, { rootMargin: '200px 0px' });

  function observeImg(img) {
    if (!shouldFade(img) || img.dataset.lazyObserved) return;
    img.dataset.lazyObserved = '1';

    // If the image or any ancestor is hidden (display:none), the IO
    // will never fire. Reveal immediately in that case so the image
    // is never stuck invisible when the view later becomes visible.
    function isHidden(el) {
      while (el && el !== document.body) {
        if (getComputedStyle(el).display === 'none') return true;
        el = el.parentElement;
      }
      return false;
    }

    if (isHidden(img)) {
      // Don't apply fade — just ensure it shows when the view opens
      return;
    }

    img.classList.add('lazy');
    if (img.complete && img.naturalWidth > 0) {
      revealImg(img);
    } else {
      io.observe(img);
    }
  }

  // Scan a container (or whole doc) for unobserved lazy images
  function scanImages(root) {
    (root || document).querySelectorAll('img[loading="lazy"]').forEach(observeImg);
  }
  scanImages();

  // MutationObserver: cover images injected by JS after initial render
  const mo = new MutationObserver((mutations) => {
    mutations.forEach(m => {
      m.addedNodes.forEach(node => {
        if (node.nodeType !== 1) return;
        if (node.tagName === 'IMG') observeImg(node);
        else if (node.querySelectorAll) scanImages(node);
      });
    });
  });
  mo.observe(document.body, { childList: true, subtree: true });

  // Hook into goTo so images in a newly-visible view get observed.
  // Images that were hidden when first scanned (isHidden → skipped)
  // are now in a visible container and will fade in correctly.
  const _origGoTo = goTo;
  window.goTo = function(view) {
    _origGoTo(view);
    // Let the view become visible in the next frame before scanning
    requestAnimationFrame(() => {
      const el = document.getElementById('view-' + view);
      if (el) {
        el.querySelectorAll('img[loading="lazy"]').forEach(img => {
          if (img.dataset.lazyObserved) return;
          img.classList.add('lazy');
          img.dataset.lazyObserved = '1';
          if (img.complete && img.naturalWidth > 0) {
            revealImg(img);
          } else {
            io.observe(img);
          }
        });
      }
    });
  };
})();
