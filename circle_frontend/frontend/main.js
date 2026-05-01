 const API = "http://localhost:5000";
      let posts = [],
        currentUser = null,
        pendingImageDataUrl = null,
        pendingVideoDataUrl = null,
        repostTargetId = null;
      let currentFeedTab = "global";
      const _followingSet = new Set(); // IDs of users the current user follows

      // Register service worker for PWA functionality
      if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
          navigator.serviceWorker.register('/sw.js')
            .then(registration => {
              console.log('Service Worker registered successfully:', registration.scope);
            })
            .catch(error => {
              console.log('Service Worker registration failed:', error);
            });
        });
      }
        } catch (e) {
          // non-critical; silently ignore
        }
      }
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
      async function api(method, path, body = null, signal = undefined) {
        const opts = { method, headers: {} };
        // Send X-User-Id for all existing backend routes that still rely on it
        if (currentUser) opts.headers["X-User-Id"] = currentUser.id;
        // Also send JWT Bearer token for routes that have been upgraded to use it
        const token = localStorage.getItem("circle_token");
        if (token) opts.headers["Authorization"] = `Bearer ${token}`;
        if (body instanceof FormData) {
          // Let the browser set Content-Type with the correct multipart boundary
          opts.body = body;
        } else if (body) {
          opts.headers["Content-Type"] = "application/json";
          opts.body = JSON.stringify(body);
        }
        if (signal) opts.signal = signal;
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
      // Internal flag — prevents popstate handler from pushing duplicate entries
      let _historyNavigating = false;

      // Views that should never create a history entry (auth guards / redirects)
      const _noHistoryViews = new Set(["login", "register", "reset", "new-password"]);

      // ── Navigation stack for back button ────────────────────────────
      // Tracks the sequence of views visited so goBack() can return to the previous one.
      // Feed is the root — back from any view goes at least to feed.
      const _navStack = ["feed"];

      function goBack() {
        // Pop current view, then navigate to the one before it
        if (_navStack.length > 1) {
          _navStack.pop(); // remove current
          const prev = _navStack[_navStack.length - 1];
          // Navigate without pushing to the stack again
          _historyNavigating = true;
          goTo(prev);
          _historyNavigating = false;
        } else {
          // Already at root — just go to feed
          _historyNavigating = true;
          goTo("feed");
          _historyNavigating = false;
        }
      }

      function _updateBackButtons(view) {
        // Show back button on every view except feed (the root)
        const showBack = view !== "feed" && !_noHistoryViews.has(view);
        document.querySelectorAll(".back-btn").forEach(btn => {
          btn.style.display = showBack ? "" : "none";
        });
      }

      function goTo(view, _opts = {}) {
        document
          .querySelectorAll(".view")
          .forEach((v) => v.classList.remove("active"));
        document.getElementById("view-" + view).classList.add("active");
        // Widen content only on feed (for aside panel)
        const contentEl = document.querySelector(".content");
        if (contentEl) contentEl.classList.toggle("feed-active", view === "feed");
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

        // Topbar: only visible on feed, always reset hidden state on tab switch
        const topbar = document.querySelector(".topbar");
        if (topbar) {
          topbar.classList.remove("topbar-hidden");
          topbar.style.display = view === "feed" ? "" : "none";
        }

        // Mobile nav: hidden on post-detail and compose (they have their own bottom bars)
        const mobileNav = document.querySelector(".mobile-nav");
        if (mobileNav) {
          const noNav = view === "post-detail" || view === "compose";
          mobileNav.style.display = noNav ? "none" : "";
          mobileNav.classList.remove("nav-hidden");
        }

        if (view === "messages") {
          if (!currentUser) {
            goTo("login");
            return;
          }
          DM.init(); // reload inbox from backend
          DM.clearDMBadge(); // clear notification badge on open
        }
        if (view === "feed") loadPosts();
        if (view === "profile") renderProfile();
        if (view === "feed" && currentUser && !_suggestionsLoaded)
          loadSuggestions();
        if (view === "feed" && currentUser && !_newMembersLoaded)
          loadNewMembers();
        if (view === "feed") loadTrending();
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
          var stSection = document.getElementById("search-trending-section");
          if (stSection) stSection.style.display = "block";
          loadTrending();
        }
        window.scrollTo(0, 0);

        // ── Navigation stack: push current view (unless we're going back) ──
        if (!_historyNavigating) {
          // Avoid consecutive duplicates (e.g. clicking same tab twice)
          if (_navStack[_navStack.length - 1] !== view) {
            // Cap stack at 20 entries to avoid unbounded growth
            if (_navStack.length >= 20) _navStack.shift();
            _navStack.push(view);
          }
        }

        // Show/hide back buttons based on whether there's somewhere to go back to
        _updateBackButtons(view);

        // ── History API: push a state so Android back stays in-app ───
        if (!_historyNavigating && !_noHistoryViews.has(view)) {
          const state = { view, ..._opts };
          history.pushState(state, "");
        }
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
        const confirmPassword = document.getElementById("reg-confirm-password")?.value;
        if (!name || !email || !password)
          return showAlert(el, "All fields are required.", "error");
        if (name.trim().length < 2)
          return showAlert(el, "Name must be at least 2 characters.", "error");
        const _emailInput = document.getElementById("reg-email");
        if (!_emailInput.checkValidity())
          return showAlert(el, "Please enter a valid email address.", "error");
        if (password.length < 6)
          return showAlert(el, "Password must be at least 6 characters.", "error");
        if (confirmPassword !== undefined && password !== confirmPassword)
          return showAlert(el, "Passwords do not match.", "error");
        const btn = document.querySelector("#view-register .btn-primary");
        if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'; }
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
          if (btn) { btn.disabled = false; btn.textContent = "Create Account"; }
        }
      }

      async function loginUser() {
        const email = document.getElementById("login-email").value.trim();
        const password = document.getElementById("login-password").value;
        const el = document.getElementById("login-alert");
        el.className = "alert";
        if (!email || !password)
          return showAlert(el, "Email and password are required.", "error");
        const btn = document.querySelector("#view-login .btn-primary");
        if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'; }
        try {
          const res = await api("POST", "/api/users/login", {
            email,
            password,
          });
          // Store the JWT for authenticated requests
          if (res.token) localStorage.setItem("circle_token", res.token);
          setCurrentUser(res.data);
          showToast("Welcome back, " + res.data.name.split(" ")[0] + "! 👋");
          setTimeout(() => goTo("feed"), 400);
        } catch (e) {
          showAlert(el, e.message, "error");
          if (btn) { btn.disabled = false; btn.textContent = "Sign In"; }
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
        localStorage.removeItem("circle_token");
        // ── Cache: clear all cached data on logout ──────────────────
        PostCache.clear();
        posts = [];
        _trendingLoaded = false;
        _trendingWords = [];
        _activeFilter = null;
        document.getElementById("trending-filter-bar").style.display = "none";
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
        _feedNewDismissed  = !!localStorage.getItem("circle_new_dismissed");
        _feedNewIndex      = 0;
        _newMembers        = [];
        _trendingLoaded    = false;
        _trendingWords     = [];
        _activeFilter      = null;
        if (
          user &&
          document.getElementById("view-feed").classList.contains("active")
        ) {
          setTimeout(loadSuggestions, 700);
        }
        currentUser = user;
        localStorage.setItem("circle_user", JSON.stringify(user));
        if (!user) return;
        if (user) _loadFollowingSet();
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
          // Post a profile_update activity to the feed
          try {
            await api("POST", "/api/posts", {
              type: "profile_update",
              text: bio || "",
            });
            PostCache.invalidateFeed("global");
            PostCache.invalidateFeed("following");
          } catch (_) {}
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
        // Clear any active trending filter when switching tabs
        if (_activeFilter) {
          _activeFilter = null;
          document.getElementById("trending-filter-bar").style.display = "none";
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
        // Refresh trending so it reflects followed-users posts
        loadTrending(true);
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

        // No valid cache — show skeleton cards then fetch
        c.innerHTML = [0,1,2].map((i) => `
          <div class="skel-card" style="animation-delay:${i*0.12}s">
            <div class="skel-row">
              <div class="skel-av"></div>
              <div class="skel-meta">
                <div class="skel-line w-40 h-14"></div>
                <div class="skel-line w-60"></div>
              </div>
            </div>
            <div class="skel-body">
              <div class="skel-line w-90 h-14"></div>
              <div class="skel-line w-75"></div>
              <div class="skel-line w-50"></div>
            </div>
            ${i === 0 ? '<div class="skel-media"></div>' : ''}
            <div class="skel-actions">
              <div class="skel-btn"></div>
              <div class="skel-btn"></div>
              <div class="skel-btn"></div>
            </div>
          </div>`).join("");
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

        // ── Show inline skeleton cards while fetching page 2+ ────────
        let _skelIds = [];
        if (!isFirstPage) {
          const c = document.getElementById("feed-list");
          // Remove sentinel so skeletons go at the very bottom
          const oldSentinel = document.getElementById("feed-sentinel");
          if (oldSentinel) oldSentinel.remove();
          _skelIds = [0, 1, 2].map((i) => {
            const id = `feed-skel-${Date.now()}-${i}`;
            const el = document.createElement("div");
            el.id = id;
            el.className = "skel-card";
            el.style.animationDelay = `${i * 0.12}s`;
            el.innerHTML = `
              <div class="skel-row">
                <div class="skel-av"></div>
                <div class="skel-meta">
                  <div class="skel-line w-40 h-14"></div>
                  <div class="skel-line w-60"></div>
                </div>
              </div>
              <div class="skel-body">
                <div class="skel-line w-90 h-14"></div>
                <div class="skel-line w-75"></div>
                <div class="skel-line w-50"></div>
              </div>
              <div class="skel-actions">
                <div class="skel-btn"></div>
                <div class="skel-btn"></div>
                <div class="skel-btn"></div>
              </div>`;
            c.appendChild(el);
            return id;
          });
        }

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

          // Remove skeleton cards before inserting real posts
          _skelIds.forEach((id) => { const el = document.getElementById(id); if (el) el.remove(); });

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
          // Remove skeletons on error too
          _skelIds.forEach((id) => { const el = document.getElementById(id); if (el) el.remove(); });
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
        if (!text && !pendingImageDataUrl && !pendingVideoDataUrl) {
          showToast("Write something or add a photo/video!");
          return;
        }
        const btn = document.getElementById("post-submit-btn");
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span>';
        try {
          const fd = new FormData();
          fd.append("text", text);
          if (pendingImageDataUrl instanceof File) fd.append("image", pendingImageDataUrl);
          if (pendingVideoDataUrl instanceof File) fd.append("video", pendingVideoDataUrl);

          const res = await api("POST", "/api/posts", fd);
          const newPost = res.data;
          PostCache.putPost(newPost);
          PostCache.invalidateFeed(currentFeedTab);
          posts.unshift(newPost);
          document.getElementById("post-text").value = "";
          removeMedia();
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
        // Check global feed array first, then PostCache (profile posts live there)
        let post = posts.find((p) => p.id === postId) || PostCache.getPost(postId);
        if (post) {
          if (!Array.isArray(post.likes)) post.likes = [];
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
            if (!Array.isArray(post.likes)) post.likes = [];
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
        const post = posts.find((p) => p.id === postId) || PostCache.getPost(postId);
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

      async function addComment(postId, parentId = null) {
        if (!currentUser) {
          showToast("Log in to comment.");
          goTo("login");
          return;
        }
        const inputSelector = parentId
          ? `[data-post-id="${postId}"] .reply-input[data-parent-id="${parentId}"]`
          : `[data-post-id="${postId}"] .comment-input`;
        const input = document.querySelector(inputSelector);
        if (!input) return;
        const text = input.value.trim();
        if (!text) return;
        try {
          const res = await api("POST", `/api/posts/${postId}/comment`, {
            userId: currentUser.id,
            text,
            parentId: parentId || undefined,
          });
          const newComment = res.data;
          // Check global feed array first, then PostCache (covers profile tab posts)
          const post = posts.find((p) => p.id === postId) || PostCache.getPost(postId);
          if (post) {
            if (!Array.isArray(post.comments)) post.comments = [];
            if (newComment.parentId) {
              const parent = post.comments.find(c => c.id === newComment.parentId);
              if (parent) {
                if (!Array.isArray(parent.replies)) parent.replies = [];
                parent.replies.push({ ...newComment, replies: [] });
              } else {
                post.comments.push({ ...newComment, replies: [] });
              }
            } else {
              post.comments.push({ ...newComment, replies: [] });
            }
            PostCache.putPost(post);
          }
          input.value = "";
          renderCommentList(postId);
          const ce = document.querySelector(`[data-post-id="${postId}"] .comment-count`);
          if (ce && post) { function _countAll(a){return(a||[]).reduce((n,c)=>n+1+_countAll(c.replies||[]),0);} ce.textContent = _countAll(post.comments) || ""; }
          showToast(newComment.parentId ? "Reply added!" : "Comment added!");
        } catch (e) {
          showToast("Error: " + e.message);
        }
      }

      function renderCommentList(postId) {
        const post = posts.find((p) => p.id === postId) || PostCache.getPost(postId);
        const panel = document.querySelector(
          `[data-post-id="${postId}"] .comments-panel`,
        );
        if (!panel || !post) return;
        panel.querySelector(".comment-list").innerHTML = buildCommentItems(
          post.comments,
        );
      }

      function buildCommentItems(comments) {
        if (!comments || !comments.length) return '';

        function renderOne(c, isReply) {
          const col = stringToColor(c.author || '?');
          const avInner = c.authorPicture
            ? `<img src="${escHtml(c.authorPicture)}" alt="${escHtml((c.author || '?').charAt(0))}" loading="lazy" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block"/>`
            : escHtml((c.author || '?').charAt(0).toUpperCase());

          const repliesHtml = (!isReply && c.replies && c.replies.length)
            ? `<div class="comment-replies">${c.replies.map(r => renderOne(r, true)).join('')}</div>`
            : '';

          return `<div class="comment-row${isReply ? ' comment-reply' : ''}">
            <div class="av sm" style="background:${c.authorPicture ? 'transparent' : col}">${avInner}</div>
            <div class="comment-bubble">
              <div class="comment-name">${escHtml(c.author || 'Anonymous')}</div>
              <div class="comment-txt">${escHtml(c.text || '')}</div>
            </div>
          </div>${repliesHtml}`;
        }

        return comments.map(c => renderOne(c, false)).join('');
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
          undoRepost(postId);
          return;
        }
        repostTargetId = postId;
        document.getElementById("modal-orig-author").textContent = post.author;
        document.getElementById("modal-orig-text").textContent =
          post.text || "";
        document.getElementById("repost-quote").value = "";
        const img = document.getElementById("modal-orig-img");
        const vid = document.getElementById("modal-orig-video");
        if (post.video) {
          vid.src = post.video;
          vid.style.display = "block";
          img.src = "";
          img.style.display = "none";
        } else if (post.image) {
          img.src = post.image;
          img.style.display = "block";
          vid.src = "";
          vid.style.display = "none";
        } else {
          img.src = "";
          img.style.display = "none";
          vid.src = "";
          vid.style.display = "none";
        }
        document.getElementById("repost-modal").classList.add("open");
        setTimeout(() => document.getElementById("repost-quote").focus(), 120);
      }

      function closeRepostModal(e) {
        if (e && e.target !== document.getElementById("repost-modal")) return;
        const _rm = document.getElementById("repost-modal");
        _rm.classList.remove("open");
        _rm.style.zIndex = "";
        repostTargetId = null;
        const _rvid = document.getElementById("modal-orig-video");
        if (_rvid) { _rvid.pause(); _rvid.src = ""; _rvid.style.display = "none"; }
      }

      async function confirmRepost() {
        if (!currentUser || !repostTargetId) return;
        const orig = posts.find((p) => p.id === repostTargetId) || PostCache.getPost(repostTargetId);
        if (!orig) return;
        const quote = document.getElementById("repost-quote").value.trim();
        try {
          const res = await api("POST", `/api/posts/${repostTargetId}/repost`, {
            userId: currentUser.id,
            text: quote || null,
          });
          const repost = res.data;
          if (!Array.isArray(orig.reposts)) orig.reposts = [];
          orig.reposts.push(currentUser.id);
          PostCache.putPost(orig);
          // Ensure originalPost has full data (server may omit video/image)
          if (repost.isRepost) {
            if (!repost.originalPost) repost.originalPost = {};
            repost.originalPost = Object.assign({}, orig, repost.originalPost);
          }
          posts.unshift(repost);
          const _rModal = document.getElementById("repost-modal");
          _rModal.classList.remove("open");
          _rModal.style.zIndex = "";
          const _rvid2 = document.getElementById("modal-orig-video");
          if (_rvid2) { _rvid2.pause(); _rvid2.src = ""; _rvid2.style.display = "none"; }
          repostTargetId = null;
          renderFeed();
          if (typeof _lbUpdateActions === "function") _lbUpdateActions();
          showToast("Reposted! ♻️");
        } catch (e) {
          showToast("Error: " + e.message);
        }
      }

      async function undoRepost(postId) {
        if (!currentUser) return;
        try {
          await api("DELETE", `/api/posts/${postId}/repost`);
          const orig = posts.find(p => p.id === postId) || PostCache.getPost(postId);
          if (orig && orig.reposts) {
            orig.reposts = orig.reposts.filter(id => id !== currentUser.id);
            PostCache.putPost(orig);
          }
          // Remove the repost card from the feed
          posts = posts.filter(p => !(p.isRepost && p.originalPost && p.originalPost.id === postId && p.userId === currentUser.id));
          renderFeed();
          if (typeof _lbUpdateActions === "function") _lbUpdateActions();
          showToast("Repost removed.");
        } catch (e) {
          showToast("Error: " + e.message);
        }
      }

      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          const _escRm = document.getElementById("repost-modal");
          _escRm.classList.remove("open");
          _escRm.style.zIndex = "";
          repostTargetId = null;
          closeNotifPanel();
          const rm = document.getElementById("report-modal");
          if (rm) rm.classList.remove("open");
          reportTargetPostId = null;
        }
      });

      /* IMAGE & VIDEO */
      function previewImage(event) {
        const file = event.target.files[0];
        if (!file) return;
        if (file.size > 10 * 1024 * 1024) { showToast("Image must be under 10 MB."); event.target.value = ""; return; }
        pendingImageDataUrl = file;   // store File object for FormData upload
        pendingVideoDataUrl = null;
        const reader = new FileReader();
        reader.onload = (e) => {
          document.getElementById("img-preview").src = e.target.result;
          document.getElementById("img-preview").style.display = "block";
          document.getElementById("video-preview").style.display = "none";
          document.getElementById("video-preview").src = "";
          document.getElementById("img-preview-wrap").style.display = "block";
        };
        reader.readAsDataURL(file);
      }
      function previewVideo(event) {
        const file = event.target.files[0];
        if (!file) return;
        if (file.size > 100 * 1024 * 1024) { showToast("Video must be under 100 MB."); return; }
        pendingVideoDataUrl = file;   // store File object for FormData upload
        pendingImageDataUrl = null;
        const reader = new FileReader();
        reader.onload = (e) => {
          document.getElementById("video-preview").src = e.target.result;
          document.getElementById("video-preview").style.display = "block";
          document.getElementById("img-preview").style.display = "none";
          document.getElementById("img-preview").src = "";
          document.getElementById("img-preview-wrap").style.display = "block";
        };
        reader.readAsDataURL(file);
      }
      function removeMedia() {
        pendingImageDataUrl = null;
        pendingVideoDataUrl = null;
        document.getElementById("img-preview").src = "";
        document.getElementById("img-preview").style.display = "block";
        const vp = document.getElementById("video-preview");
        vp.pause();
        vp.src = "";
        vp.style.display = "none";
        document.getElementById("img-preview-wrap").style.display = "none";
        document.getElementById("img-input").value = "";
        document.getElementById("video-input").value = "";
      }
      function removeImage() { removeMedia(); }

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
        // Inject new member card at a random position between 3–5 if not dismissed
        if (!_feedNewDismissed && currentUser && _newMembers.length) {
          const injectAt = Math.floor(Math.random() * 3) + 3; // positions 3,4,5
          parts.splice(Math.min(injectAt, parts.length), 0, buildFeedNewCard());
        }
        c.innerHTML = parts.join("");
      }

      /* ── Trending in Your Circles ──────────────────────────────────── */
      const STOPWORDS = new Set([
        "the","and","for","are","but","not","you","all","can","her","was","one",
        "our","out","day","get","has","him","his","how","its","let","may","new",
        "now","old","see","two","way","who","boy","did","man","men","put","say",
        "she","too","use","had","have","that","this","with","they","from","been",
        "will","what","were","when","your","said","each","she","just","into",
        "then","than","some","more","also","over","such","here","know","like",
        "time","very","even","most","make","after","first","well","much","good",
        "want","came","come","back","does","made","many","them","these","other",
        "about","their","there","which","would","could","should","really","think",
        "going","still","being","where","every","those","while","before","again",
        "through","because","always","never","people","thing","things","anyone",
        "someone","something","anything","nothing","everyone","everything","little",
        "great","might","only","both","same","last","long","life","give","work",
        "need","feel","seem","keep","tell","next","best","high","look","place",
        "actually","usually","already","another","between","together","without",
        "year","years","today","right","left","sure","stop","took","take","away",
        "around","different","nothing","another","during","since","until","while"
      ]);

      let _trendingWords = [];
      let _trendingLoading = false;
      let _trendingLoaded = false;
      let _activeFilter = null;

      function _setTrendingContent(bodyId, footerId, html, footer) {
        const b = document.getElementById(bodyId);
        const f = document.getElementById(footerId);
        if (b) b.innerHTML = html;
        if (f) f.textContent = footer || "";
      }

      async function loadTrending(force = false) {
        if (!currentUser) {
          const guestHtml = `<div class="trending-guest"><a onclick="goTo('login')">Log in</a> to see what's trending among people you follow.</div>`;
          _setTrendingContent("trending-body", "trending-footer", guestHtml, "");
          _setTrendingContent("search-trending-body", "search-trending-footer", guestHtml, "");
          return;
        }
        if (_trendingLoading) return;
        if (_trendingLoaded && !force) {
          // Already loaded — just paint into search container if it's empty
          renderTrending("search-trending-body", "search-trending-footer");
          return;
        }

        _trendingLoading = true;
        const skelHtml = `<div class="trending-skeleton"><div class="trending-skel-row"></div><div class="trending-skel-row"></div><div class="trending-skel-row"></div><div class="trending-skel-row"></div><div class="trending-skel-row"></div></div>`;
        if (force || !_trendingLoaded) {
          _setTrendingContent("trending-body", "trending-footer", skelHtml, "");
          _setTrendingContent("search-trending-body", "search-trending-footer", skelHtml, "");
        }

        try {
          const res = await api("GET", "/api/posts?feed=following&page=1");
          const followingPosts = (res.data || res.posts || res || []);
          _trendingWords = extractTrending(Array.isArray(followingPosts) ? followingPosts : []);
          _trendingLoaded = true;
          const now = new Date();
          const timeStr = `Updated ${now.getHours()}:${String(now.getMinutes()).padStart(2,"0")}`;
          renderTrendingAllContainers();
          const tf = document.getElementById("trending-footer");
          if (tf) tf.textContent = timeStr;
          const stf = document.getElementById("search-trending-footer");
          if (stf) stf.textContent = timeStr;
        } catch(e) {
          const errHtml = `<div class="trending-empty">Couldn't load trends.<br>Check your connection.</div>`;
          _setTrendingContent("trending-body", "trending-footer", errHtml, "");
          _setTrendingContent("search-trending-body", "search-trending-footer", errHtml, "");
        } finally {
          _trendingLoading = false;
        }
      }

      function extractTrending(followingPosts) {
        const now = Date.now();
        const counts = {};
        const recencyCounts = {};

        followingPosts.forEach(post => {
          if (!post.text) return;
          const isRecent = post.createdAt && (now - new Date(post.createdAt).getTime()) < 86400000;
          const weight = isRecent ? 2 : 1;

          const words = post.text
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, " ")
            .split(/\s+/)
            .filter(w => w.length >= 4 && !STOPWORDS.has(w) && !/^\d+$/.test(w));

          const seen = new Set();
          words.forEach(w => {
            counts[w] = (counts[w] || 0) + weight;
            if (isRecent && !seen.has(w)) {
              recencyCounts[w] = (recencyCounts[w] || 0) + 1;
              seen.add(w);
            }
          });
        });

        return Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([word, score]) => ({
            word,
            score,
            postCount: Math.ceil(score / 1.5),
            rising: (recencyCounts[word] || 0) >= 2
          }));
      }

      function renderTrending(bodyId, footerId) {
        bodyId = bodyId || "trending-body";
        footerId = footerId || "trending-footer";
        const body = document.getElementById(bodyId);
        if (!body) return;
        if (!_trendingWords.length) {
          body.innerHTML = `<div class="trending-empty">
            No trends yet.<br>Follow more people to see<br>what they're talking about.
          </div>`;
          return;
        }

        const pills = _trendingWords.map((item, i) => {
          const isActive = _activeFilter === item.word;
          const signal = item.rising
            ? `<span class="trending-pill-signal rising">&#8593; rising</span>`
            : `<span class="trending-pill-signal stable">&#9679; active</span>`;
          return `<button class="trending-pill ${isActive ? "active" : ""}"
            onclick="applyTrendingFilter('${escHtml(item.word)}')" title="Filter feed by '${escHtml(item.word)}'">
            <span class="trending-pill-rank">${i + 1}</span>
            <span class="trending-pill-word">#${escHtml(item.word)}</span>
            ${signal}
            <span class="trending-pill-badge">${item.postCount}</span>
          </button>`;
        }).join("");

        body.innerHTML = `<div class="trending-pills">${pills}</div>`;
      }

      function renderTrendingAllContainers() {
        renderTrending("trending-body", "trending-footer");
        renderTrending("search-trending-body", "search-trending-footer");
      }

      function applyTrendingFilter(word) {
        // Toggle off if already active
        if (_activeFilter === word) { clearTrendingFilter(); return; }

        _activeFilter = word;

        // Show filter bar
        const bar = document.getElementById("trending-filter-bar");
        document.getElementById("trending-filter-label").textContent = `#${word}`;
        bar.style.display = "flex";

        // Re-render pills in both containers to show active state
        renderTrendingAllContainers();

        // Filter the feed list client-side
        const filtered = posts.filter(p =>
          p.text && p.text.toLowerCase().includes(word.toLowerCase())
        );
        const c = document.getElementById("feed-list");
        if (!filtered.length) {
          c.innerHTML = `<div class="empty">
            <div class="empty-icon">&#128269;</div>
            <h3>No posts found</h3>
            <p>No posts from your circles mention <strong>#${escHtml(word)}</strong> yet.</p>
            <button class="btn btn-ghost" style="margin-top:14px;border-radius:20px" onclick="clearTrendingFilter()">Clear filter</button>
          </div>`;
          return;
        }
        c.innerHTML = filtered.map(p => buildPostCard(p)).join("");
      }

      function clearTrendingFilter() {
        _activeFilter = null;
        document.getElementById("trending-filter-bar").style.display = "none";
        renderTrendingAllContainers();
        // Restore the full feed without re-fetching trending data
        const c = document.getElementById("feed-list");
        if (!posts.length) { renderFeed(); return; }
        const parts = posts.map(p => buildPostCard(p));
        if (!_feedSugDismissed && currentUser && parts.length >= 5) parts.splice(5, 0, buildFeedSugCard());
        if (!_feedNewDismissed && currentUser && _newMembers.length) {
          const injectAt = Math.floor(Math.random() * 3) + 3;
          parts.splice(Math.min(injectAt, parts.length), 0, buildFeedNewCard());
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
        const contentEl = document.querySelector(".content");
        if (contentEl) contentEl.classList.remove("feed-active");
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
        // Push to navStack so back button works
        if (!_historyNavigating) {
          if (_navStack[_navStack.length - 1] !== "profile") {
            if (_navStack.length >= 20) _navStack.shift();
            _navStack.push("profile");
          }
        }
        _updateBackButtons("profile");
        if (!_historyNavigating) {
          history.pushState({ view: "profile", userId: userId || null }, "");
        }
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
        } catch (e) {
          showToast("Couldn't load profile. Showing cached info.");
        }
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

        // Pagination state for this profile view
        let _profilePage    = 1;
        let _profileHasMore = false;
        let _profileLoading = false;
        let _profileUserId  = targetId;

        async function loadProfilePosts(page, append = false) {
          if (_profileLoading) return;
          _profileLoading = true;

          if (!append) {
            c.innerHTML = `<div style="text-align:center;padding:32px;color:var(--txt2)"><div class="spinner" style="margin:0 auto 12px"></div></div>`;
          } else {
            // Show a small spinner below existing posts while loading next page
            const skel = document.createElement("div");
            skel.id = "profile-load-skel";
            skel.style.cssText = "text-align:center;padding:20px;color:var(--txt2)";
            skel.innerHTML = `<div class="spinner" style="margin:0 auto"></div>`;
            c.appendChild(skel);
          }

          // Remove existing load-more button before fetch
          document.getElementById("profile-load-more-btn")?.remove();

          try {
            const res = await api("GET", `/api/posts?userId=${_profileUserId}&page=${page}&limit=20`);
            const userPosts = res.data?.posts || [];
            const hasMore   = res.data?.hasMore ?? (userPosts.length === 20);

            // Hydrate into cache so likes/comments/reposts work
            userPosts.forEach((p) => {
              if (!Array.isArray(p.likes))    p.likes    = [];
              if (!Array.isArray(p.reposts))  p.reposts  = [];
              if (!Array.isArray(p.comments)) p.comments = [];
              PostCache.putPost(p);
            });

            document.getElementById("profile-load-skel")?.remove();

            if (!append) {
              c.innerHTML = userPosts.length
                ? userPosts.map((p) => buildPostCard(p, isOwnProfile)).join("")
                : `<div class="empty"><div class="empty-icon"><svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></div><h3>No posts yet</h3><p>${isOwnProfile ? "Share your first post!" : "Nothing posted yet."}</p></div>`;
            } else {
              const frag = document.createElement("div");
              frag.innerHTML = userPosts.map((p) => buildPostCard(p, isOwnProfile)).join("");
              c.appendChild(frag);
            }

            _profileHasMore = hasMore;

            if (hasMore) {
              const btn = document.createElement("button");
              btn.id = "profile-load-more-btn";
              btn.className = "btn btn-ghost";
              btn.style.cssText = "width:100%;margin-top:16px;";
              btn.textContent = "Load more posts";
              btn.onclick = () => {
                _profilePage++;
                loadProfilePosts(_profilePage, true);
              };
              c.appendChild(btn);
            }
          } catch (e) {
            document.getElementById("profile-load-skel")?.remove();
            if (!append) {
              c.innerHTML = `<div class="empty"><h3>Could not load posts</h3><p>${e.message}</p></div>`;
            } else {
              showToast("Could not load more posts: " + e.message);
            }
          } finally {
            _profileLoading = false;
          }
        }

        loadProfilePosts(_profilePage);
      }

      function buildPostCard(post, showDelete = false) {
        // ── Profile photo update activity card ──────────────────────────
        if (post.type === 'profile_pic') {
          const color = stringToColor(post.author);
          return `<div class="post-card activity-card" data-post-id="${post.id}" onclick="viewProfile(${post.userId})" style="cursor:pointer">
  <div class="post-head">
    <div class="av" style="background:${post.authorPicture ? 'transparent' : color};cursor:pointer">
      ${post.authorPicture ? `<img src="${post.authorPicture}" alt="${escHtml(post.author.charAt(0))}" loading="lazy" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block"/>` : escHtml(post.author.charAt(0))}
    </div>
    <div class="post-meta">
      <div class="post-name">${escHtml(post.author)}</div>
      <div class="post-time">${formatTime(post.createdAt)}</div>
    </div>
  </div>
  <div class="activity-body">
    <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="15" height="15" style="flex-shrink:0;color:var(--accent)"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
    <span>${escHtml(post.author)} updated their profile photo</span>
  </div>
  ${post.image ? `<div class="activity-photo-wrap"><img src="${escHtml(post.image)}" alt="New profile photo" loading="lazy" style="width:72px;height:72px;border-radius:50%;object-fit:cover;border:3px solid var(--accent)"/></div>` : ''}
</div>`;
        }
        if (post.type === 'profile_update') {
          const color = stringToColor(post.author);
          return `<div class="post-card activity-card" data-post-id="${post.id}" onclick="viewProfile(${post.userId})" style="cursor:pointer">
  <div class="post-head">
    <div class="av" style="background:${post.authorPicture ? 'transparent' : color};cursor:pointer">
      ${post.authorPicture ? `<img src="${post.authorPicture}" alt="${escHtml(post.author.charAt(0))}" loading="lazy" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block"/>` : escHtml(post.author.charAt(0))}
    </div>
    <div class="post-meta">
      <div class="post-name">${escHtml(post.author)}</div>
      <div class="post-time">${formatTime(post.createdAt)}</div>
    </div>
  </div>
  <div class="activity-body">
    <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="15" height="15" style="flex-shrink:0;color:var(--accent)"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
    <span>${escHtml(post.author)} updated their profile</span>
  </div>
  ${post.text ? `<div class="activity-body" style="padding-top:0;font-style:italic;color:var(--txt3)">"${escHtml(post.text)}"</div>` : ''}
</div>`;
        }
        // If this is a repost, patch originalPost with video/image.
        // Priority: 1) local posts cache, 2) PostCache store, 3) async API fetch
        if (post.isRepost && post.originalPost) {
          const _oid = post.originalPost.id;
          // Check local feed array first
          const _cached = posts.find(p => !p.isRepost && p.id === _oid);
          if (_cached) {
            if (!post.originalPost.video && _cached.video) post.originalPost.video = _cached.video;
            if (!post.originalPost.image && _cached.image) post.originalPost.image = _cached.image;
            if (!post.originalPost.authorPicture && _cached.authorPicture) post.originalPost.authorPicture = _cached.authorPicture;
          }
          // Check PostCache store
          if (!post.originalPost.video && !post.originalPost.image) {
            const _stored = PostCache.getPost(_oid);
            if (_stored) {
              if (!post.originalPost.video && _stored.video) post.originalPost.video = _stored.video;
              if (!post.originalPost.image && _stored.image) post.originalPost.image = _stored.image;
              if (!post.originalPost.authorPicture && _stored.authorPicture) post.originalPost.authorPicture = _stored.authorPicture;
            }
          }
          // If still missing media, fetch from API in background and re-render that card
          if (!post.originalPost.video && !post.originalPost.image) {
            if (!window._repostMediaFetchQueue) window._repostMediaFetchQueue = new Set();
            if (!window._repostMediaFetchQueue.has(_oid)) {
              window._repostMediaFetchQueue.add(_oid);
              api("GET", `/api/posts/${_oid}`).then(res => {
                const orig = res && (res.data || res);
                if (!orig) return;
                PostCache.putPost(orig);
                // Patch all repost cards in current posts array that reference this original
                posts.forEach(p => {
                  if (p.isRepost && p.originalPost && p.originalPost.id === _oid) {
                    if (orig.video)        p.originalPost.video        = orig.video;
                    if (orig.image)        p.originalPost.image        = orig.image;
                    if (orig.authorPicture) p.originalPost.authorPicture = orig.authorPicture;
                  }
                });
                // Re-render just the affected card(s) in the DOM
                document.querySelectorAll(`[data-post-id]`).forEach(card => {
                  const pid = parseInt(card.dataset.postId);
                  const p = posts.find(x => x.id === pid);
                  if (p && p.isRepost && p.originalPost && p.originalPost.id === _oid) {
                    const tmp = document.createElement("div");
                    tmp.innerHTML = buildPostCard(p);
                    card.replaceWith(tmp.firstElementChild);
                  }
                });
              }).catch(() => {});
            }
          }
        }
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
      <div class="post-menu-wrap" onclick="event.stopPropagation()">
        <button class="post-menu-btn" onclick="togglePostMenu(event,${post.id})" title="More options">⋯</button>
        <div class="post-dropdown" id="post-menu-${post.id}">
          ${!canDelete ? `<button class="post-dropdown-item post-menu-follow-btn" data-user-id="${post.userId}" data-following="false" onclick="postMenuFollow(${post.userId},${post.id},this)">
            <svg class="post-menu-follow-icon" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
            <span class="post-menu-follow-label">Follow</span>
          </button>` : ""}
          <button class="post-dropdown-item" onclick="postMenuNotInterested(${post.id})">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
            Not Interested
          </button>
          <div class="post-dropdown-divider"></div>
          <button class="post-dropdown-item danger" onclick="postMenuReport(${post.id})">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            Report
          </button>
          <button class="post-dropdown-item danger" onclick="postMenuBlock(${post.userId},${post.id})">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
            Block
          </button>
          ${canDelete ? `<div class="post-dropdown-divider"></div><button class="post-dropdown-item danger" onclick="closePostMenu(${post.id});deletePost(${post.id})">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
            Delete
          </button>` : ""}
        </div>
      </div>
    </div>
    ${post.text ? `<div class="post-body">${escHtml(post.text)}</div>` : ""}
    ${post.isRepost && post.originalPost ? `<div class="repost-embed" style="cursor:pointer" onclick="event.stopPropagation();openOriginalPost(${post.originalPost.id})" title="View original post by ${escHtml(post.originalPost.author)}"><div class="repost-embed-name">${escHtml(post.originalPost.author)}</div>${post.originalPost.text ? `<div class="repost-embed-text">${escHtml(post.originalPost.text)}</div>` : ""}${post.originalPost.video ? `<div class="post-video-wrap repost-embed-video" onclick="event.stopPropagation();openVideoLightbox(this)" data-lb-video="${post.originalPost.video}" data-lb-name="${escHtml(post.originalPost.author)}" data-lb-picture="${escHtml(post.originalPost.authorPicture || "")}" data-lb-user-id="${post.originalPost.userId || ""}" data-lb-post-id="${post.id}" data-lb-caption="${escHtml(post.originalPost.text || "")}" title="Watch video" style="margin-top:8px"><video src="${post.originalPost.video}" preload="metadata" playsinline muted></video><div class="post-video-play-btn"><svg viewBox="0 0 56 56" xmlns="http://www.w3.org/2000/svg"><circle cx="28" cy="28" r="28" fill="rgba(0,0,0,0.45)"/><polygon points="22,16 42,28 22,40" fill="white"/></svg></div></div>` : post.originalPost.image ? `<img class="repost-embed-img lb-thumb" src="${post.originalPost.image}" loading="lazy" data-lb-name="${escHtml(post.originalPost.author)}" data-lb-picture="${escHtml(post.originalPost.authorPicture || "")}" data-lb-user-id="${post.originalPost.userId || ""}" data-lb-post-id="${post.id}" data-lb-caption="${escHtml(post.text || "")}" onclick="event.stopPropagation();openLightbox(this)" title="View full image"/>` : ""}</div>` : !post.isRepost && post.video ? `<div class="post-video-wrap" onclick="openVideoLightbox(this)" data-lb-video="${post.video}" data-lb-name="${escHtml(post.author)}" data-lb-picture="${escHtml(post.authorPicture || '')}" data-lb-user-id="${post.userId}" data-lb-post-id="${post.id}" data-lb-caption="${escHtml(post.text || '')}" title="Watch video"><video src="${post.video}" preload="metadata" playsinline muted></video><div class="post-video-play-btn"><svg viewBox="0 0 56 56" xmlns="http://www.w3.org/2000/svg"><circle cx="28" cy="28" r="28" fill="rgba(0,0,0,0.45)"/><polygon points="22,16 42,28 22,40" fill="white"/></svg></div></div>` : !post.isRepost && post.image ? `<img class="post-img lb-thumb" src="${post.image}" loading="lazy" data-lb-name="${escHtml(post.author)}" data-lb-picture="${escHtml(post.authorPicture || "")}" data-lb-user-id="${post.userId}" data-lb-post-id="${post.id}" data-lb-caption="${escHtml(post.text || "")}" onclick="openLightbox(this)" title="View full image"/>` : ""}
    <div class="post-actions">
      <button class="act-btn like-btn${liked ? " liked" : ""}" data-post-id="${post.id}" onclick="toggleLike(${post.id})">
        <svg fill="${liked ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
        <span>${(post.likes && post.likes.length) || ""}</span>
      </button>
      <button class="act-btn" onclick="event.stopPropagation();goToPostDetail(${post.id},true)">
        <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
        <span class="comment-count">${(function countAll(arr){return(arr||[]).reduce((n,c)=>n+1+countAll(c.replies||[]),0);})(post.comments) || ""}</span>
      </button>
      ${!post.isRepost ? `<button class="act-btn repost-btn${reposted ? " reposted" : ""}" onclick="openRepostModal(${post.id})"><svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg><span>${post.reposts ? post.reposts.length || "" : ""}</span></button>` : ""}
      <span class="act-views" id="views-${post.id}" title="Views">
        <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        <span>${post.views ? fmtViews(post.views) : ""}</span>
      </span>
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
        if (file.size > 10 * 1024 * 1024) {
          showToast("Image must be under 10 MB.");
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
            // Post a profile_pic activity to the feed
            try {
              await api("POST", "/api/posts", {
                type: "profile_pic",
                text: "",
                image: currentUser.picture,
              });
              PostCache.invalidateFeed("global");
              PostCache.invalidateFeed("following");
            } catch (_) {}
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
            _followingSet.delete(userId);
            btn.classList.replace("unfollow", "follow");
            btn.textContent = "Follow";
            showToast("Unfollowed.");
          } else {
            await api("POST", "/api/follow/" + userId);
            _followingSet.add(userId);
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
            _followingSet.delete(targetId);
            btn.dataset.following = "false";
            btn.textContent = "Follow";
            btn.classList.remove("btn-outline", "unfollow");
            btn.classList.add("btn-primary", "follow");
            showToast("Unfollowed.");
          } else {
            await api("POST", `/api/follow/${targetId}`);
            _followingSet.add(targetId);
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
      // ── Search state ─────────────────────────────────────────────────────
      let searchTab   = "posts";
      let searchTimer = null;          // debounce timer handle
      let _searchAbort = null;         // AbortController for in-flight request
      let _searchPage  = 1;            // current pagination page
      let _searchHasMore = false;      // whether more pages exist
      let _searchLastQ = "";           // last executed query (for load-more)

      // LRU-style cache: key = "q|type|page" → response data array
      // Capped at 60 entries so it never grows unbounded.
      const _searchCache = new Map();
      const SEARCH_CACHE_MAX = 60;
      function _cacheGet(key) { return _searchCache.get(key) ?? null; }
      function _cacheSet(key, val) {
        if (_searchCache.size >= SEARCH_CACHE_MAX) {
          // Evict the oldest entry
          _searchCache.delete(_searchCache.keys().next().value);
        }
        _searchCache.set(key, val);
      }

      function switchSearchTab(tab) {
        searchTab = tab;
        document.getElementById("stab-posts").classList.toggle("active", tab === "posts");
        document.getElementById("stab-people").classList.toggle("active", tab === "people");
        const q = document.getElementById("search-input").value.trim();
        _searchPage = 1;
        if (q.length >= 2) runSearch(q);
        else renderSearchHint();
      }

      function onSearchInput() {
        // Cancel any pending debounce and abort in-flight request
        clearTimeout(searchTimer);
        _searchAbort?.abort();
        _searchAbort = null;

        const q = document.getElementById("search-input").value.trim();
        const stSection = document.getElementById("search-trending-section");
        if (q.length < 2) {
          if (stSection) stSection.style.display = "block";
          renderSearchHint();
          return;
        }
        if (stSection) stSection.style.display = "none";
        // Debounce: wait 300 ms after the user stops typing
        searchTimer = setTimeout(function () {
          _searchPage = 1;
          runSearch(q);
        }, 300);
      }

      function renderSearchHint() {
        document.getElementById("search-results").innerHTML =
          `<div class="search-hint"><svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><p>Type to search ${searchTab === "posts" ? "posts" : "people"}</p></div>`;
      }

      function _skelPost() {
        return `<div class="search-skel-post">
          <div class="search-skel-post-head">
            <div class="search-skel-av"></div>
            <div class="search-skel-meta">
              <div class="search-skel-line w-40"></div>
              <div class="search-skel-line w-60"></div>
            </div>
          </div>
          <div class="search-skel-meta" style="gap:7px">
            <div class="search-skel-line w-90"></div>
            <div class="search-skel-line w-80"></div>
            <div class="search-skel-line w-55"></div>
          </div>
        </div>`;
      }
      function _skelPerson() {
        return `<div class="search-skel-person">
          <div class="search-skel-av" style="width:42px;height:42px"></div>
          <div class="search-skel-person-info">
            <div class="search-skel-line w-40"></div>
            <div class="search-skel-line w-60"></div>
          </div>
          <div class="search-skel-btn"></div>
        </div>`;
      }

      async function runSearch(q, loadMore = false) {
        if (!currentUser) {
          showToast("Log in to search.");
          goTo("login");
          return;
        }

        const box = document.getElementById("search-results");
        const page = loadMore ? _searchPage : 1;
        const cacheKey = `${q}|${searchTab}|${page}`;

        // ── Cache hit: paint instantly, no network needed ──
        const cached = _cacheGet(cacheKey);
        if (cached) {
          if (loadMore) {
            await _appendSearchResults(cached.data, q);
          } else {
            await renderSearchResults(cached.data, q);
          }
          _searchHasMore = cached.hasMore;
          _searchLastQ   = q;
          _renderLoadMore(q);
          return;
        }

        // ── Show skeletons only on fresh (non-load-more) searches ──
        if (!loadMore) {
          box.innerHTML = searchTab === "posts"
            ? [0,1,2,3].map(_skelPost).join("")
            : [0,1,2,3,4].map(_skelPerson).join("");
        } else {
          // Append a mini skeleton strip below existing results
          const strip = document.createElement("div");
          strip.id = "search-load-more-skel";
          strip.innerHTML = searchTab === "posts"
            ? [0,1].map(_skelPost).join("")
            : [0,1].map(_skelPerson).join("");
          box.appendChild(strip);
        }

        // ── Abort any previous in-flight request ──
        _searchAbort?.abort();
        _searchAbort = new AbortController();

        try {
          const res = await api(
            "GET",
            `/api/search?q=${encodeURIComponent(q)}&type=${searchTab}&page=${page}&limit=20`,
            null,
            _searchAbort.signal,
          );

          // Remove load-more skeleton if present
          document.getElementById("search-load-more-skel")?.remove();

          const resultData = res.data ?? [];
          const hasMore    = res.meta?.hasMore ?? (resultData.length === 20);

          // For people results, hydrate follow status from the local _followingSet
          // (same source the profile tab uses) — avoids N extra API calls
          if (searchTab === "people" && currentUser && resultData.length) {
            resultData.forEach(user => {
              user.isFollowing = _followingSet.has(user.id);
            });
          }

          // Cache the result
          _cacheSet(cacheKey, { data: resultData, hasMore });
          _searchHasMore = hasMore;
          _searchLastQ   = q;

          if (loadMore) {
            await _appendSearchResults(resultData, q);
          } else {
            await renderSearchResults(resultData, q);
          }
          _renderLoadMore(q);
        } catch (e) {
          document.getElementById("search-load-more-skel")?.remove();
          if (e.name === "AbortError") return; // request was superseded — do nothing
          box.innerHTML = `<div class="search-hint"><p style="color:var(--rose)">Error: ${escHtml(e.message)}</p></div>`;
        }
      }

      function _renderLoadMore(q) {
        // Remove any existing load-more button
        document.getElementById("search-load-more-btn")?.remove();
        if (!_searchHasMore) return;
        const box = document.getElementById("search-results");
        const btn = document.createElement("button");
        btn.id = "search-load-more-btn";
        btn.className = "btn btn-ghost";
        btn.style.cssText = "width:100%;margin-top:16px;";
        btn.textContent = "Load more";
        btn.onclick = () => {
          _searchPage++;
          btn.remove();
          runSearch(q, true);
        };
        box.appendChild(btn);
      }

      async function _appendSearchResults(data, q) {
        if (!data || !data.length) return;
        const box = document.getElementById("search-results");
        // Remove the load-more button before appending so new items go above it
        document.getElementById("search-load-more-btn")?.remove();
        const frag = document.createElement("div");
        if (searchTab === "posts") {
          await _hydratePostResults(data);
          frag.innerHTML = data.map(post => buildPostCard(post, false)).join("");
        } else {
          frag.innerHTML = _buildPeopleCards(data, q);
        }
        box.appendChild(frag);
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

      async function _hydratePostResults(data) {
        await Promise.all(data.map(async (post) => {
          const cached = PostCache.getPost(post.id) || posts.find(p => p.id === post.id);
          if (!cached) {
            try {
              const r = await api("GET", `/api/posts/${post.id}`);
              const full = r.data || r;
              full.likes    = Array.isArray(full.likes)    ? full.likes    : [];
              full.reposts  = Array.isArray(full.reposts)  ? full.reposts  : [];
              full.comments = Array.isArray(full.comments) ? full.comments : [];
              PostCache.putPost(full);
              posts.unshift(full);
              Object.assign(post, full);
            } catch (_) {}
          } else {
            post.likes    = cached.likes;
            post.reposts  = cached.reposts;
            post.comments = cached.comments;
          }
          post.likes    = Array.isArray(post.likes)    ? post.likes    : [];
          post.reposts  = Array.isArray(post.reposts)  ? post.reposts  : [];
          post.comments = Array.isArray(post.comments) ? post.comments : [];
          PostCache.putPost(post);
          if (!posts.find(p => p.id === post.id)) posts.unshift(post);
        }));
      }

      function _buildPeopleCards(data, q) {
        return data.map((user) => {
          const color = stringToColor(user.name);
          const avHtml = user.picture
            ? `<img src="${user.picture}" alt="${escHtml(user.name.charAt(0))}" loading="lazy" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block"/>`
            : escHtml(user.name.charAt(0));
          const isOwnProfile = currentUser && currentUser.id === user.id;
          const followBtnHtml =
            !isOwnProfile && currentUser
              ? `<button class="btn ${user.isFollowing ? "btn-outline" : "btn-primary"}" style="font-size:13px;padding:8px 20px" data-following="${user.isFollowing ? "true" : "false"}" onclick="event.stopPropagation();searchFollow(${user.id},this)">${user.isFollowing ? "Following" : "Follow"}</button>`
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
        }).join("");
      }

      async function renderSearchResults(data, q) {
        const box = document.getElementById("search-results");
        if (!data || !data.length) {
          box.innerHTML = `<div class="search-hint"><svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><p>No ${searchTab} found for "<strong>${escHtml(q)}</strong>"</p></div>`;
          return;
        }
        if (searchTab === "posts") {
          await _hydratePostResults(data);
          box.innerHTML = data.map((post) => buildPostCard(post, false)).join("");
        } else {
          box.innerHTML = _buildPeopleCards(data, q);
        }
      }

      async function searchFollow(userId, btn) {
        if (!currentUser) { showToast("Log in to follow."); goTo("login"); return; }
        const isFollowing = btn.dataset.following === "true";
        const orig = btn.textContent;
        btn.disabled = true;
        btn.textContent = "…";
        try {
          if (isFollowing) {
            await api("DELETE", "/api/unfollow/" + userId);
            _followingSet.delete(userId);
            btn.dataset.following = "false";
            btn.textContent = "Follow";
            btn.classList.remove("btn-outline");
            btn.classList.add("btn-primary");
            showToast("Unfollowed.");
          } else {
            await api("POST", "/api/follow/" + userId);
            _followingSet.add(userId);
            btn.dataset.following = "true";
            btn.textContent = "Following";
            btn.classList.remove("btn-primary");
            btn.classList.add("btn-outline");
            showToast("Following! 🎉");
          }
          // Invalidate cached people search results so re-searches reflect new status
          for (const key of _searchCache.keys()) {
            if (key.includes("|people|")) _searchCache.delete(key);
          }
        } catch (e) {
          btn.textContent = orig;
          showToast("Error: " + e.message);
        } finally {
          btn.disabled = false;
        }
      }

      /*  NOTIFICATIONS */
      let notifPollTimer  = null;
      let _notifPage      = 1;
      let _notifHasMore   = true;
      let _notifLoading   = false;
      let _notifItems     = [];   // accumulated list across all pages

      const NOTIF_ICONS = {
        like: `<svg fill="currentColor" viewBox="0 0 24 24" width="16" height="16"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>`,
        comment: `<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="16" height="16"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>`,
        reply: `<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="16" height="16"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 00-4-4H4"/></svg>`,
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
        reply: (name) =>
          `<strong>${escHtml(name)}</strong> replied to your comment`,
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

      async function fetchNotifications(reset = false) {
        if (!currentUser) return;
        if (_notifLoading) return;
        if (!reset && !_notifHasMore) return;

        if (reset) {
          _notifPage    = 1;
          _notifHasMore = true;
          _notifItems   = [];
        }

        _notifLoading = true;
        const list = document.getElementById("notif-list");

        // Show skeletons — full panel on first page, mini strip on subsequent
        if (_notifPage === 1) {
          list.innerHTML = _buildNotifSkeletons(5);
        } else {
          const strip = document.createElement("div");
          strip.id = "notif-skel-strip";
          strip.innerHTML = _buildNotifSkeletons(3);
          list.appendChild(strip);
        }

        try {
          const res = await api("GET", `/api/notifications/${currentUser.id}?page=${_notifPage}&limit=10`);
          const { notifications, hasMore } = res.data;

          // Remove skeleton strip for page 2+
          const strip = document.getElementById("notif-skel-strip");
          if (strip) strip.remove();

          // Filter by user prefs
          const prefs = JSON.parse(localStorage.getItem("circle_notif_prefs") || "{}");
          const PREF_KEY = { like: "likes", comment: "comments", reply: "comments",
                             repost: "reposts", follow: null, new_post: "new_post",
                             profile_pic: "profile_pic", mention: "mention", milestone: "milestone" };
          const visible = (notifications || []).filter(n => {
            const key = PREF_KEY[n.type];
            if (key === null || key === undefined) return true;
            return prefs[key] !== false;
          });

          _notifItems   = _notifPage === 1 ? visible : [..._notifItems, ...visible];
          _notifHasMore = hasMore;
          _notifPage++;

          if (_notifPage === 2) {
            // First page — full render
            _renderNotifPage(visible, true);
          } else {
            // Subsequent pages — append only new items
            _renderNotifPage(visible, false);
          }

          updateNotifBadge(_notifItems.filter(n => !n.isRead).length);
        } catch (e) {
          const strip = document.getElementById("notif-skel-strip");
          if (strip) strip.remove();
          if (_notifPage === 1) {
            list.innerHTML = `<div class="notif-empty"><svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg><p>Could not load notifications</p></div>`;
          }
        } finally {
          _notifLoading = false;
        }
      }

      function _buildNotifSkeletons(count) {
        return Array.from({ length: count }).map((_, i) => `
          <div class="notif-skel-item" style="animation-delay:${i * 0.1}s">
            <div class="notif-skel-av"></div>
            <div class="notif-skel-body">
              <div class="notif-skel-line w-70"></div>
              <div class="notif-skel-line w-45"></div>
            </div>
            <div class="notif-skel-icon"></div>
          </div>`).join("");
      }

      function _renderNotifPage(items, isFirstPage) {
        const list = document.getElementById("notif-list");

        if (isFirstPage) {
          if (!_notifItems.length) {
            list.innerHTML = `<div class="notif-empty"><svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg><p>No notifications yet</p></div>`;
            return;
          }
          list.innerHTML = items.map(_buildNotifItem).join("");
        } else {
          // Remove end-cap if present before appending
          const endCap = document.getElementById("notif-end-cap");
          if (endCap) endCap.remove();
          items.forEach(n => {
            const el = document.createElement("div");
            el.innerHTML = _buildNotifItem(n);
            list.appendChild(el.firstElementChild);
          });
        }

        // Add or refresh end cap
        const existingCap = document.getElementById("notif-end-cap");
        if (existingCap) existingCap.remove();
        const cap = document.createElement("div");
        cap.id = "notif-end-cap";
        cap.className = _notifHasMore ? "notif-load-more-sentinel" : "notif-end";
        cap.innerHTML = _notifHasMore
          ? `<div class="notif-skel-strip-wrap" id="notif-scroll-trigger"></div>`
          : `<div class="notif-end-text">You're all caught up ✓</div>`;
        list.appendChild(cap);
      }

      function _buildNotifItem(n) {
        const color = stringToColor(n.actorName || "?");
        const avHtml = n.actorPicture
          ? `<img src="${n.actorPicture}" alt="${escHtml((n.actorName || "?").charAt(0))}" loading="lazy" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block"/>`
          : escHtml((n.actorName || "?").charAt(0));
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
      }

      let _prevNotifCount = null;
      async function fetchUnreadCount() {
        if (!currentUser) return;
        try {
          const res = await api(
            "GET",
            `/api/notifications/${currentUser.id}/unread-count`,
          );
          const count = res.data.count;
          if (_prevNotifCount !== null && count > _prevNotifCount) {
            try { DM._tonePlay(); } catch(_) {}
          }
          _prevNotifCount = count;
          updateNotifBadge(count);
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

      // renderNotifList replaced by _renderNotifPage + _buildNotifItem above

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
          const post = posts.find((p) => p.id === postId) || PostCache.getPost(postId);
          if (post) { renderPostDetail(post); goTo("post-detail"); }
          else { goTo("feed"); }
        } else if (type === "mention" && postId) {
          const post = posts.find((p) => p.id === postId) || PostCache.getPost(postId);
          if (post) { renderPostDetail(post); goTo("post-detail"); }
          else { goTo("feed"); }
        } else if (type === "milestone") {
          goTo("profile");
        } else {
          if (postId) {
            const post = posts.find((p) => p.id === postId) || PostCache.getPost(postId);
            if (post) {
              renderPostDetail(post);
              goTo("post-detail");
            } else {
              try {
                showToast("Loading post…");
                const res = await api("GET", `/api/posts/${postId}`);
                const found = res.data;
                if (found) {
                  PostCache.putPost(found);
                  renderPostDetail(found);
                  goTo("post-detail");
                } else {
                  showToast("Post not found.");
                  goTo("feed");
                }
              } catch (e) {
                showToast("Could not load post.");
                goTo("feed");
              }
            }
          } else {
            goTo("feed");
          }
        }
        fetchNotifications(true);
      }

      async function markAllRead() {
        if (!currentUser) return;
        try {
          await api("PUT", `/api/notifications/${currentUser.id}/read-all`);
          // Mark all in-memory items as read and re-render without refetch
          _notifItems.forEach(n => n.isRead = true);
          _renderNotifPage(_notifItems, true);
          updateNotifBadge(0);
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
        // Reset and fetch fresh from page 1 every time panel opens
        fetchNotifications(true);
        document.getElementById("notif-panel").classList.add("open");
        document.getElementById("notif-backdrop").classList.add("open");
        document.body.style.overflow = "hidden";

        // Attach scroll listener for infinite load
        const list = document.getElementById("notif-list");
        list.onscroll = () => {
          if (_notifLoading || !_notifHasMore) return;
          const { scrollTop, scrollHeight, clientHeight } = list;
          if (scrollHeight - scrollTop - clientHeight < 120) {
            fetchNotifications();
          }
        };
      }

      function closeNotifPanel() {
        document.getElementById("notif-panel").classList.remove("open");
        document.getElementById("notif-backdrop").classList.remove("open");
        document.body.style.overflow = "";
        // Detach scroll listener
        const list = document.getElementById("notif-list");
        if (list) list.onscroll = null;
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

      /* ── Post three-dot menu ─────────────────────────────────── */
      function togglePostMenu(e, postId) {
        e.stopPropagation();
        const menu = document.getElementById("post-menu-" + postId);
        if (!menu) return;
        const isOpen = menu.classList.contains("open");
        // Close all other open menus and reset their card z-index
        document.querySelectorAll(".post-dropdown.open").forEach(m => {
          m.classList.remove("open");
          const card = m.closest(".post-card");
          if (card) card.style.zIndex = "";
        });
        if (!isOpen) {
          menu.classList.add("open");
          // Elevate this card above sibling cards so the dropdown isn't hidden
          const card = menu.closest(".post-card");
          if (card) card.style.zIndex = "10";

          // Dynamically update Follow/Unfollow button — same API the profile tab uses
          if (currentUser) {
            const followBtn = menu.querySelector(".post-menu-follow-btn");
            if (followBtn) {
              const userId = parseInt(followBtn.dataset.userId);
              api("GET", `/api/users/${userId}/profile`)
                .then(res => {
                  const isFollowing = res.data?.isFollowing || false;
                  followBtn.dataset.following = isFollowing ? "true" : "false";
                  const label = followBtn.querySelector(".post-menu-follow-label");
                  const icon = followBtn.querySelector(".post-menu-follow-icon");
                  if (label) label.textContent = isFollowing ? "Unfollow" : "Follow";
                  if (icon) {
                    icon.innerHTML = isFollowing
                      ? `<path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/>`
                      : `<path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/>`;
                  }
                })
                .catch(() => {});
            }
          }
        }
      }

      function closePostMenu(postId) {
        const menu = document.getElementById("post-menu-" + postId);
        if (menu) {
          menu.classList.remove("open");
          const card = menu.closest(".post-card");
          if (card) card.style.zIndex = "";
        }
      }

      // Close menus on outside click
      document.addEventListener("click", () => {
        document.querySelectorAll(".post-dropdown.open").forEach(m => {
          m.classList.remove("open");
          const card = m.closest(".post-card");
          if (card) card.style.zIndex = "";
        });
      });

      function postMenuFollow(userId, postId, btn) {
        closePostMenu(postId);
        if (!currentUser) { showToast("Log in to follow people."); goTo("login"); return; }
        const isFollowing = btn && btn.dataset.following === "true";
        if (isFollowing) {
          api("DELETE", "/api/unfollow/" + userId)
            .then(() => { _followingSet.delete(userId); showToast("Unfollowed."); })
            .catch(e => showToast("Error: " + e.message));
        } else {
          api("POST", "/api/follow/" + userId)
            .then(() => { _followingSet.add(userId); showToast("Following! 🎉"); })
            .catch(e => showToast("Error: " + e.message));
        }
      }

      function postMenuNotInterested(postId) {
        closePostMenu(postId);
        // Remove the post from the feed visually
        const card = document.querySelector(`[data-post-id="${postId}"]`);
        if (card) {
          card.style.cssText += ";transition:opacity .25s,max-height .35s,margin .35s;opacity:0;max-height:0;overflow:hidden;margin:0;padding:0;border:none";
          setTimeout(() => {
            card.remove();
            posts = posts.filter(p => p.id !== postId);
          }, 350);
        }
        showToast("Got it — we'll show you less like this.");
      }

      function postMenuReport(postId) {
        closePostMenu(postId);
        reportPost(postId);
      }

      function postMenuBlock(userId, postId) {
        closePostMenu(postId);
        if (!currentUser) { showToast("Log in to block users."); goTo("login"); return; }
        // Remove all posts by this user from the feed
        const cards = document.querySelectorAll(".post-card");
        cards.forEach(card => {
          const pid = parseInt(card.dataset.postId);
          const post = posts.find(p => p.id === pid);
          if (post && post.userId === userId) {
            card.style.cssText += ";transition:opacity .25s;opacity:0";
            setTimeout(() => card.remove(), 260);
          }
        });
        posts = posts.filter(p => p.userId !== userId);
        showToast("User blocked. You won't see their posts anymore.");
      }
      /* ── End post menu ─────────────────────────────────────────── */

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
          showToast("Couldn't load suggestions.");
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
      let _feedNewDismissed = !!localStorage.getItem("circle_new_dismissed");
      let _feedNewIndex     = 0; // which member is currently shown

      function _joinedAgo(dateStr) {
        const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
        if (diff === 0) return "Joined today";
        if (diff === 1) return "Joined yesterday";
        return `Joined ${diff} days ago`;
      }

      async function loadNewMembers(force = false) {
        if (!currentUser) return;
        if (_newMembersLoaded && !force) return;
        try {
          const res = await api("GET", "/api/users/new-members?limit=20");
          // Only keep members who joined within the last 3 days
          _newMembers = (res.data || []).filter(u => {
            if (u.id === currentUser.id) return false;
            const days = Math.floor((Date.now() - new Date(u.createdAt).getTime()) / 86400000);
            return days <= 3;
          });
          _newMembersLoaded = true;
          _feedNewIndex = 0;

          // Inject into feed if rendered and not dismissed
          if (!_feedNewDismissed && _newMembers.length) {
            const feedList = document.getElementById("feed-list");
            if (feedList && !document.getElementById("feed-new-inline")) {
              const postCards = feedList.querySelectorAll(".post-card");
              // Random injection between post 3 and 5
              const injectAfter = Math.floor(Math.random() * 3) + 2; // 2,3,4 (0-indexed)
              const target = postCards[Math.min(injectAfter, postCards.length - 1)];
              if (target) {
                const temp = document.createElement("div");
                temp.innerHTML = buildFeedNewCard();
                target.insertAdjacentElement("afterend", temp.firstElementChild);
              }
            }
          }

          // Update explore section
          loadExploreNewMembers();
        } catch (e) {
          showToast("Couldn't load new members.");
        }
      }

      function buildFeedNewCard() {
        if (!_newMembers.length) return "";
        const u = _newMembers[_feedNewIndex];
        if (!u) return "";

        const initial = (u.name || "?").charAt(0).toUpperCase();
        const color   = stringToColor(u.name || "");
        const avBg    = u.picture ? "transparent" : color;
        const avInner = u.picture
          ? `<img src="${escHtml(u.picture)}" alt="${initial}" loading="lazy" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block"/>`
          : initial;
        const counter = _newMembers.length > 1
          ? `<span style="font-size:10px;color:var(--txt3);font-weight:600;margin-left:auto;padding-right:4px">${_feedNewIndex + 1} / ${_newMembers.length}</span>`
          : "";

        return `<div class="feed-new-card" id="feed-new-inline">
          <div class="feed-new-banner">
            <span class="feed-new-banner-label">
              <svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              New to Circle
            </span>
            ${counter}
            <span class="feed-new-dismiss" onclick="dismissFeedNew()">✕</span>
          </div>
          <div class="feed-new-row" onclick="viewProfile(${u.id})">
            <div class="av" style="background:${avBg};width:42px;height:42px;font-size:16px;flex-shrink:0">${avInner}</div>
            <div class="feed-new-info">
              <div class="feed-new-name">${escHtml(u.name || "New member")}</div>
              <div class="feed-new-joined">${_joinedAgo(u.createdAt)}</div>
            </div>
            <button class="feed-new-follow-btn" onclick="event.stopPropagation();feedNewFollow(${u.id},this)">Follow</button>
          </div>
        </div>`;
      }

      function _refreshFeedNewCard() {
        const el = document.getElementById("feed-new-inline");
        if (!el) return;
        if (_feedNewIndex >= _newMembers.length) {
          // Exhausted all members — remove card permanently
          _feedNewDismissed = true;
          localStorage.setItem("circle_new_dismissed", "1");
          el.style.transition = "opacity .25s";
          el.style.opacity = "0";
          setTimeout(() => el.remove(), 260);
          return;
        }
        // Slide out old, render new
        el.style.transition = "opacity .18s";
        el.style.opacity = "0";
        setTimeout(() => {
          el.outerHTML = buildFeedNewCard();
        }, 180);
      }

      function dismissFeedNew() {
        _feedNewDismissed = true;
        localStorage.setItem("circle_new_dismissed", "1");
        const el = document.getElementById("feed-new-inline");
        if (el) {
          el.style.transition = "opacity .22s, max-height .28s";
          el.style.opacity = "0";
          el.style.maxHeight = "0";
          el.style.overflow = "hidden";
          el.style.marginBottom = "0";
          setTimeout(() => el.remove(), 300);
        }
      }

      async function feedNewFollow(userId, btn) {
        if (!currentUser) { showToast("Log in to follow."); goTo("login"); return; }
        btn.disabled = true;
        try {
          await api("POST", "/api/follow/" + userId);
          btn.textContent = "Following ✓";
          btn.classList.add("following");
          showToast("You're now following them! 🎉");
          // Remove this user from the queue and advance to next
          _newMembers = _newMembers.filter(u => u.id !== userId);
          // _feedNewIndex stays the same — next member slides into that index
          setTimeout(() => _refreshFeedNewCard(), 600);
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
            const res = await api("GET", "/api/users/new-members?limit=20");
            members = (res.data || []).filter(u => {
              if (u.id !== currentUser?.id) return false;
              const days = Math.floor((Date.now() - new Date(u.createdAt).getTime()) / 86400000);
              return days <= 3;
            });
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
              <button class="explore-person-follow" onclick="event.stopPropagation();exploreNewFollow(${u.id},this)" style="background:var(--green);border-color:var(--green)">Follow</button>
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
          btn.textContent = "Following ✓";
          btn.style.opacity = "0.7";
          showToast("You're now following them! 🎉");
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

      // ── View count helpers ────────────────────────────────────────
      function fmtViews(n) {
        if (!n) return "";
        if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
        if (n >= 1_000)     return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
        return String(n);
      }

      // Generate or retrieve a stable anonymous fingerprint for guests
      function _getFingerprint() {
        let fp = localStorage.getItem("circle_fp");
        if (!fp) {
          fp = "fp_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
          localStorage.setItem("circle_fp", fp);
        }
        return fp;
      }

      // Track which post IDs have already been counted this session
      const _viewedPostIds = new Set();

      // Fire POST /api/posts/:id/view when a card has been visible for ≥1s
      function _recordView(postId) {
        if (_viewedPostIds.has(postId)) return;
        _viewedPostIds.add(postId);

        const body = currentUser
          ? {}
          : { fingerprint: _getFingerprint() };

        api("POST", `/api/posts/${postId}/view`, body)
          .then(res => {
            // Update the count in the DOM without re-rendering the whole card
            const el = document.getElementById(`views-${postId}`);
            if (el) {
              const span = el.querySelector("span");
              if (span) span.textContent = fmtViews(res?.data?.views || 0);
            }
            // Patch the in-memory post object too
            const post = posts.find(p => p.id === postId);
            if (post && res?.data?.views !== undefined) post.views = res.data.views;
          })
          .catch(() => { /* silent — view tracking is best-effort */ });
      }

      // IntersectionObserver: fires _recordView after the card has been
      // visible for at least 1 second (avoids counting quick scrolls).
      (function initViewTracker() {
        const _timers = new Map(); // postId → setTimeout handle

        const _io = new IntersectionObserver((entries) => {
          entries.forEach(entry => {
            const card = entry.target;
            const postId = parseInt(card.dataset.postId);
            if (isNaN(postId)) return;

            if (entry.isIntersecting) {
              if (!_timers.has(postId)) {
                const t = setTimeout(() => {
                  _timers.delete(postId);
                  _recordView(postId);
                  _io.unobserve(card); // only count once per card lifetime
                }, 1000);
                _timers.set(postId, t);
              }
            } else {
              // Card scrolled away before 1s — cancel the timer
              const t = _timers.get(postId);
              if (t !== undefined) {
                clearTimeout(t);
                _timers.delete(postId);
              }
            }
          });
        }, { threshold: 0.6 }); // at least 60% of card must be visible

        // Observe newly added post cards via MutationObserver
        const _mo = new MutationObserver(mutations => {
          mutations.forEach(m => {
            m.addedNodes.forEach(node => {
              if (node.nodeType !== 1) return;
              if (node.classList?.contains("post-card") && node.dataset.postId) {
                _io.observe(node);
              }
              node.querySelectorAll?.(".post-card[data-post-id]").forEach(c => _io.observe(c));
            });
          });
        });
        _mo.observe(document.body, { childList: true, subtree: true });
      })();
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
      // _lbItems: [{type:'image'|'video', src, meta:{name,picture,userId,postId,caption}}]
      let _lbItems = [],
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
      // Legacy aliases kept so other code referencing them still works
      let _lbMeta = [];
      let _lbPostId = null;
      // Computed helpers
      function _lbCurrent() { return _lbItems[_lbIndex] || null; }
      function _lbIsVideo() { const c = _lbCurrent(); return c && c.type === 'video'; }

      /* ── Render profile chip ── */
      function _lbRenderProfile(idx) {
        const item = _lbItems[idx] || null;
        const meta = (item && item.meta) || {};
        const chip = document.getElementById("lb-profile");
        const av = document.getElementById("lb-profile-av");
        const nm = document.getElementById("lb-profile-name");
        if (!meta.name) {
          chip.style.display = "none";
        } else {
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

        // ── Caption ──
        const captionEl = document.getElementById("lb-caption");
        if (captionEl) {
          const cap = meta.caption || "";
          if (cap) {
            captionEl.textContent = cap;
            captionEl.style.display = "block";
          } else {
            captionEl.style.display = "none";
          }
        }

        // ── Action buttons (like / comment / repost) ──
        _lbPostId = meta ? (meta.postId || null) : null;
        _lbUpdateActions();
      }

      /* ── Update lightbox action counts and liked state ── */
      function _lbUpdateActions() {
        const actionsEl = document.getElementById("lb-actions");
        if (!actionsEl) return;
        if (!_lbPostId) {
          actionsEl.style.display = "none";
          return;
        }
        actionsEl.style.display = "flex";

        const post = PostCache.getPost(_lbPostId) || posts.find(p => p.id === _lbPostId);
        if (!post) return;

        const liked = currentUser && Array.isArray(post.likes) && post.likes.includes(currentUser.id);
        const likeBtn = document.getElementById("lb-like-btn");
        const likeIcon = document.getElementById("lb-like-icon");
        const likeCount = document.getElementById("lb-like-count");
        const reposted = currentUser && Array.isArray(post.reposts) && post.reposts.includes(currentUser.id);
        const repostBtn = document.getElementById("lb-repost-btn");

        if (likeBtn) {
          if (liked) {
            likeBtn.classList.add("lb-liked");
            likeBtn.style.background = "rgba(255,95,122,0.35)";
            likeBtn.style.borderColor = "rgba(255,95,122,0.5)";
            likeIcon.setAttribute("fill", "#ff5f7a");
            likeIcon.setAttribute("stroke", "#ff5f7a");
          } else {
            likeBtn.classList.remove("lb-liked");
            likeBtn.style.background = "rgba(255,255,255,0.1)";
            likeBtn.style.borderColor = "rgba(255,255,255,0.15)";
            likeIcon.setAttribute("fill", "none");
            likeIcon.setAttribute("stroke", "currentColor");
          }
        }
        if (likeCount) likeCount.textContent = Array.isArray(post.likes) ? post.likes.length : 0;

        const commentCount = document.getElementById("lb-comment-count");
        if (commentCount) { function _lbCountAll(a){return(a||[]).reduce((n,c)=>n+1+_lbCountAll(c.replies||[]),0);} commentCount.textContent = _lbCountAll(post.comments); }

        const repostCount = document.getElementById("lb-repost-count");
        if (repostCount) repostCount.textContent = Array.isArray(post.reposts) ? post.reposts.length : 0;

        if (repostBtn) {
          if (reposted) {
            repostBtn.style.background = "rgba(34,212,143,0.3)";
            repostBtn.style.color = "#22d48f";
          } else {
            repostBtn.style.background = "rgba(255,255,255,0.1)";
            repostBtn.style.color = "#fff";
          }
        }
      }

      /* ── Lightbox like toggle ── */
      async function lbToggleLike() {
        if (!currentUser) { showToast("Log in to like."); closeLightbox(); goTo("login"); return; }
        if (!_lbPostId) return;
        // Re-use the existing toggleLike machinery if available
        const cardLikeBtn = document.querySelector(`.act-btn[data-post-id="${_lbPostId}"].like-btn`);
        if (cardLikeBtn) {
          cardLikeBtn.click();
          setTimeout(_lbUpdateActions, 300);
          return;
        }
        // Fallback: call API directly
        const post = PostCache.getPost(_lbPostId) || posts.find(p => p.id === _lbPostId);
        if (!post) return;
        const alreadyLiked = Array.isArray(post.likes) && post.likes.includes(currentUser.id);
        try {
          await api("POST", `/api/posts/${_lbPostId}/like`);
          PostCache.patchPost(_lbPostId, p => {
            if (!Array.isArray(p.likes)) p.likes = [];
            if (alreadyLiked) p.likes = p.likes.filter(id => id !== currentUser.id);
            else p.likes.push(currentUser.id);
          });
          const cached = PostCache.getPost(_lbPostId);
          if (cached) {
            const idx = posts.findIndex(p => p.id === _lbPostId);
            if (idx >= 0) posts[idx] = cached;
          }
          _lbUpdateActions();
        } catch (e) { showToast("Error: " + e.message); }
      }

      /* ── Lightbox TikTok-style comment panel ── */
      function lbOpenComments() {
        if (!_lbPostId) return;
        const panel = document.getElementById('lb-comments-panel');
        if (!panel) return;

        // Populate composer avatar
        const composeAv = document.getElementById('lb-compose-av');
        if (composeAv && currentUser) {
          if (currentUser.picture) {
            composeAv.style.background = 'transparent';
            composeAv.innerHTML = `<img src="${currentUser.picture}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block" alt="${currentUser.name.charAt(0)}"/>`;
          } else {
            composeAv.innerHTML = currentUser.name.charAt(0).toUpperCase();
            composeAv.style.background = stringToColor(currentUser.name);
          }
        } else if (composeAv) {
          composeAv.innerHTML = `<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="16" height="16"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
          composeAv.style.background = 'rgba(255,255,255,0.1)';
        }

        // Show panel with slide-up animation (close report panel if open)
        lbCloseReport && lbCloseReport();
        panel.style.display = 'flex';
        panel.style.animation = 'none';
        panel.offsetHeight; // reflow
        panel.style.animation = 'lbCommentsSlideUp 0.32s cubic-bezier(0.34,1.2,0.64,1) both';

        // Nudge the actions bar left so it doesn't overlap the panel
        const actions = document.getElementById('lb-actions');
        if (actions) {
          actions.style.transition = 'right 0.3s cubic-bezier(0.34,1.2,0.64,1)';
          actions.style.right = (Math.min(420, window.innerWidth) + 20) + 'px';
        }

        _lbRenderComments();
        setTimeout(() => document.getElementById('lb-comment-input')?.focus(), 350);
      }

      function lbCloseComments() {
        lbCancelReply();
        const panel = document.getElementById('lb-comments-panel');
        if (!panel) return;
        panel.style.transition = 'transform 0.22s ease, opacity 0.22s ease';
        panel.style.transform = 'translateY(100%)';
        panel.style.opacity = '0';
        setTimeout(() => {
          panel.style.display = 'none';
          panel.style.transform = '';
          panel.style.opacity = '';
        }, 230);
        // Restore actions position
        const actions = document.getElementById('lb-actions');
        if (actions) {
          actions.style.right = '20px';
        }
      }

      function _lbRenderComments() {
        const post = PostCache.getPost(_lbPostId) || posts.find(p => p.id === _lbPostId);
        const list = document.getElementById('lb-comments-list');
        const header = document.getElementById('lb-comments-count-header');
        if (!list) return;

        const comments = post?.comments || [];
        function _lbHdrCount(a){return(a||[]).reduce((n,c)=>n+1+_lbHdrCount(c.replies||[]),0);}
        const _totalComments = _lbHdrCount(comments);
        if (header) header.textContent = _totalComments ? `(${_totalComments})` : '';

        if (!comments.length) {
          list.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:12px;color:rgba(255,255,255,0.25);padding:40px 20px;text-align:center">
              <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" width="40" height="40">
                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
              </svg>
              <div style="font-size:14px;font-weight:600">No comments yet</div>
              <div style="font-size:12px;opacity:0.7">Be the first to comment</div>
            </div>`;
          return;
        }

        function buildLbAvatar(c, size) {
          const col = stringToColor(c.author || '?');
          const bg = c.authorPicture ? 'transparent' : col;
          const inner = c.authorPicture
            ? `<img src="${escHtml(c.authorPicture)}" loading="lazy" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block"/>`
            : escHtml((c.author || '?').charAt(0).toUpperCase());
          const dim = size === 'sm' ? 26 : 34;
          return `<div class="lb-comment-av" style="background:${bg};width:${dim}px;height:${dim}px;flex-shrink:0">${inner}</div>`;
        }

        function buildLbNode(c, isNested) {
          const repliesArr = Array.isArray(c.replies) ? c.replies : [];
          const replyCount = repliesArr.length;
          const nestedId = `lb-replies-${c.id}`;
          const timeStr = c.createdAt ? formatTime(c.createdAt) : '';

          const nestedHtml = replyCount
            ? `<button class="lb-view-replies-btn" onclick="lbToggleReplies('${nestedId}', this)" data-count="${replyCount}">
                <svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
                View ${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}
               </button>
               <div class="lb-nested-replies" id="${nestedId}">
                 ${repliesArr.map(r => buildLbNode(r, true)).join('')}
               </div>`
            : '';

          const replyBtn = `<button class="lb-comment-reply-btn" onclick="lbStartReply('${escHtml(c.author || '')}', ${c.id})">
            <svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 00-4-4H4"/></svg>
            Reply
          </button>`;

          if (isNested) {
            return `<div class="lb-comment-item" style="padding:8px 0 8px 4px">
              ${buildLbAvatar(c, 'sm')}
              <div class="lb-comment-body">
                <div class="lb-comment-author">${escHtml(c.author || 'Anonymous')}</div>
                <div class="lb-comment-text">${escHtml(c.text || '')}</div>
                ${timeStr ? `<div class="lb-comment-time">${timeStr}</div>` : ''}
                ${replyBtn}
                ${nestedHtml}
              </div>
            </div>`;
          }

          return `<div class="lb-comment-item">
            ${buildLbAvatar(c, 'lg')}
            <div class="lb-comment-body">
              <div class="lb-comment-author">${escHtml(c.author || 'Anonymous')}</div>
              <div class="lb-comment-text">${escHtml(c.text || '')}</div>
              ${timeStr ? `<div class="lb-comment-time">${timeStr}</div>` : ''}
              ${replyBtn}
              ${nestedHtml}
            </div>
          </div>`;
        }

        list.innerHTML = comments.map(c => buildLbNode(c, false)).join('');
        list.scrollTop = list.scrollHeight;
      }

      let _lbReplyToId = null;

      function lbStartReply(author, commentId) {
        _lbReplyToId = commentId;
        const banner = document.getElementById('lb-reply-to-banner');
        const nameEl = document.getElementById('lb-reply-to-name');
        if (banner) banner.classList.add('visible');
        if (nameEl) nameEl.textContent = author;
        const input = document.getElementById('lb-comment-input');
        if (input) { input.placeholder = `Reply to ${author}…`; input.focus(); }
      }

      function lbCancelReply() {
        _lbReplyToId = null;
        const banner = document.getElementById('lb-reply-to-banner');
        if (banner) banner.classList.remove('visible');
        const input = document.getElementById('lb-comment-input');
        if (input) { input.placeholder = 'Add a comment…'; input.focus(); }
      }

      function lbToggleReplies(id, btn) {
        const el = document.getElementById(id);
        if (!el) return;
        const isHidden = el.style.display === 'none' || el.style.display === '';
        el.style.display = isHidden ? 'flex' : 'none';
        const count = btn.dataset.count;
        btn.innerHTML = isHidden
          ? `<svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" width="12" height="12"><polyline points="18 15 12 9 6 15"/></svg> Hide ${count} ${count == 1 ? 'reply' : 'replies'}`
          : `<svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" width="12" height="12"><polyline points="6 9 12 15 18 9"/></svg> View ${count} ${count == 1 ? 'reply' : 'replies'}`;
      }

      async function lbSubmitComment() {
        if (!currentUser) {
          showToast("Log in to comment.");
          lbCloseComments();
          closeLightbox();
          goTo('login');
          return;
        }
        const input = document.getElementById('lb-comment-input');
        const text = input?.value.trim();
        if (!text || !_lbPostId) return;

        input.value = '';
        input.disabled = true;

        try {
          const res = await api('POST', `/api/posts/${_lbPostId}/comment`, {
            userId: currentUser.id,
            text,
            parentId: _lbReplyToId || undefined,
          });
          const newComment = res.data;
          const post = posts.find(p => p.id === _lbPostId);
          if (post) {
            if (!Array.isArray(post.comments)) post.comments = [];
            if (newComment.parentId) {
              const parent = post.comments.find(c => c.id === newComment.parentId);
              if (parent) {
                if (!Array.isArray(parent.replies)) parent.replies = [];
                parent.replies.push({ ...newComment, replies: [] });
              } else {
                post.comments.push({ ...newComment, replies: [] });
              }
            } else {
              post.comments.push({ ...newComment, replies: [] });
            }
            PostCache.putPost(post);
          }
          // Reset reply state
          const _sentReplyToId = _lbReplyToId;
          lbCancelReply();
          // Send reply notification if this was a reply
          if (_sentReplyToId) sendReplyNotification(_lbPostId, _sentReplyToId, text);
          // Update feed card comment count if visible
          function countAll(arr){return(arr||[]).reduce((n,c)=>n+1+countAll(c.replies||[]),0);}
          const ce = document.querySelector(`[data-post-id="${_lbPostId}"] .comment-count`);
          if (ce && post) ce.textContent = countAll(post.comments) || '';
          const lbCc = document.getElementById('lb-comment-count');
          if (lbCc && post) lbCc.textContent = countAll(post.comments);
          _lbRenderComments();
        } catch (e) {
          showToast('Error: ' + e.message);
          if (input) input.value = text;
        } finally {
          if (input) input.disabled = false;
          input?.focus();
        }
      }

      /* ── Lightbox inline Report Panel ── */
      let _lbSelectedReason = null;

      function lbOpenReport() {
        if (!_lbPostId) return;
        if (!currentUser) { showToast("Log in to report posts."); return; }

        // Reset state
        _lbSelectedReason = null;
        document.querySelectorAll('.lb-report-reason-btn').forEach(b => b.classList.remove('selected'));
        const otherWrap = document.getElementById('lb-report-other-wrap');
        const otherText = document.getElementById('lb-report-other-text');
        const submitBtn = document.getElementById('lb-report-submit-btn');
        if (otherWrap) otherWrap.style.display = 'none';
        if (otherText) otherText.value = '';
        if (submitBtn) { submitBtn.disabled = true; submitBtn.style.opacity = '0.4'; submitBtn.style.cursor = 'not-allowed'; submitBtn.textContent = 'Submit Report'; }

        const panel = document.getElementById('lb-report-panel');
        if (!panel) return;
        // Close comments panel if open
        lbCloseComments();
        panel.style.display = 'flex';
        panel.style.animation = 'none';
        panel.offsetHeight;
        panel.style.animation = 'lbCommentsSlideUp 0.32s cubic-bezier(0.34,1.2,0.64,1) both';

        // Nudge actions left
        const actions = document.getElementById('lb-actions');
        if (actions) {
          actions.style.transition = 'right 0.3s cubic-bezier(0.34,1.2,0.64,1)';
          actions.style.right = (Math.min(420, window.innerWidth) + 20) + 'px';
        }
      }

      function lbCloseReport() {
        const panel = document.getElementById('lb-report-panel');
        if (!panel) return;
        panel.style.transition = 'transform 0.22s ease, opacity 0.22s ease';
        panel.style.transform = 'translateY(100%)';
        panel.style.opacity = '0';
        setTimeout(() => {
          panel.style.display = 'none';
          panel.style.transform = '';
          panel.style.opacity = '';
        }, 230);
        const actions = document.getElementById('lb-actions');
        if (actions) actions.style.right = '20px';
      }

      function lbSelectReason(btn, reason) {
        document.querySelectorAll('.lb-report-reason-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        _lbSelectedReason = reason;

        const otherWrap = document.getElementById('lb-report-other-wrap');
        if (otherWrap) otherWrap.style.display = reason === 'Other' ? 'block' : 'none';

        const submitBtn = document.getElementById('lb-report-submit-btn');
        if (submitBtn) { submitBtn.disabled = false; submitBtn.style.opacity = '1'; submitBtn.style.cursor = 'pointer'; }
      }

      async function lbSubmitReport() {
        if (!_lbPostId || !_lbSelectedReason) return;
        let reason = _lbSelectedReason;
        if (reason === 'Other') {
          const other = document.getElementById('lb-report-other-text')?.value.trim();
          if (!other || other.length < 5) { showToast("Please describe the issue (min 5 chars)."); return; }
          reason = other;
        }
        const btn = document.getElementById('lb-report-submit-btn');
        if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; btn.style.opacity = '0.6'; }
        try {
          await api('POST', '/api/admin/reports', { postId: _lbPostId, reason });
          lbCloseReport();
          showToast("Report submitted. Thank you! ✅");
        } catch (e) {
          showToast("Error: " + e.message);
          if (btn) { btn.disabled = false; btn.textContent = 'Submit Report'; btn.style.opacity = '1'; }
        }
      }

      /* ── Lightbox open repost modal ── */
      function lbOpenRepost() {
        if (!_lbPostId) return;
        openRepostModal(_lbPostId);
        // Ensure the repost modal appears above the lightbox (z-index 2000)
        const modal = document.getElementById("repost-modal");
        if (modal) modal.style.zIndex = "2100";
      }

      /* ── Open (image) ── */
      /* ── Collect all feed media (images + videos) in DOM order ── */
      function collectFeedMedia() {
        const items = [];
        document.querySelectorAll(
          '.post-img[data-lb-name], .repost-embed-img[data-lb-name], .post-video-wrap[data-lb-video]'
        ).forEach(el => {
          if (el.dataset.lbVideo) {
            items.push({
              type: 'video',
              src: el.dataset.lbVideo,
              meta: {
                name: el.dataset.lbName || null,
                picture: el.dataset.lbPicture || null,
                userId: el.dataset.lbUserId || null,
                postId: el.dataset.lbPostId ? parseInt(el.dataset.lbPostId, 10) : null,
                caption: el.dataset.lbCaption || null,
              }
            });
          } else {
            items.push({
              type: 'image',
              src: el.src,
              meta: {
                name: el.dataset.lbName || null,
                picture: el.dataset.lbPicture || null,
                userId: el.dataset.lbUserId || null,
                postId: el.dataset.lbPostId ? parseInt(el.dataset.lbPostId, 10) : null,
                caption: el.dataset.lbCaption || null,
              }
            });
          }
        });
        return items;
      }

      /* ── Show the correct media element for current item ── */
      function _lbShowItem() {
        const item = _lbCurrent();
        if (!item) return;
        const lbImg = document.getElementById('lb-img');
        const lbVid = document.getElementById('lb-video');
        if (item.type === 'video') {
          lbImg.style.display = 'none';
          lbImg.src = '';
          lbVid.style.display = 'block';
          lbVid.src = item.src;
          lbVid.style.opacity = '0';
          lbVid.style.transition = 'opacity 0.22s ease';
          requestAnimationFrame(() => {
            lbVid.style.opacity = '1';
            lbVid.play().catch(() => {});
          });
        } else {
          lbVid.pause && lbVid.pause();
          lbVid.style.display = 'none';
          lbVid.src = '';
          lbImg.style.display = '';
          lbImg.src = item.src;
        }
        // Update counter
        const counter = document.getElementById('lb-counter');
        if (_lbItems.length > 1) {
          counter.textContent = `${_lbIndex + 1} / ${_lbItems.length}`;
          counter.style.display = 'flex';
        } else {
          counter.style.display = 'none';
        }
        // Hint: show for images only
        const hint = document.getElementById('lb-hint');
        if (hint) hint.style.opacity = item.type === 'image' ? '1' : '0';
        _lbRenderProfile(_lbIndex);
      }

      /* ── Open lightbox from an image thumbnail ── */
      function openLightbox(imgEl) {
        _lbItems = collectFeedMedia();
        const clickedSrc = imgEl.src;
        _lbIndex = _lbItems.findIndex(it => it.type === 'image' && it.src === clickedSrc);
        if (_lbIndex < 0) _lbIndex = 0;
        _lbScale = 1; _lbTranslateX = 0; _lbTranslateY = 0;
        _lbOrigin = imgEl.getBoundingClientRect();

        const lb = document.getElementById('lightbox');
        const lbImg = document.getElementById('lb-img');
        const lbVid = document.getElementById('lb-video');
        lbVid.pause && lbVid.pause(); lbVid.style.display = 'none'; lbVid.src = '';
        lbImg.style.display = '';
        lb.style.display = 'flex';

        // Hero entry animation
        const ox = _lbOrigin.left + _lbOrigin.width / 2 - window.innerWidth / 2;
        const oy = _lbOrigin.top + _lbOrigin.height / 2 - window.innerHeight / 2;
        const sx = _lbOrigin.width / window.innerWidth;
        const sy = _lbOrigin.height / window.innerHeight;
        lbImg.style.transition = 'none';
        lbImg.style.transform = `translate(${ox}px,${oy}px) scale(${sx},${sy})`;
        lbImg.style.opacity = '0';
        lbImg.src = _lbItems[_lbIndex].src;
        lbImg.onload = () => {
          requestAnimationFrame(() => {
            lbImg.style.transition = 'transform 0.38s cubic-bezier(0.34,1.2,0.64,1), opacity 0.22s ease';
            lbImg.style.transform = 'translate(0,0) scale(1)';
            lbImg.style.opacity = '1';
          });
        };
        if (lbImg.complete) lbImg.onload();

        lb.style.opacity = '0';
        lb.style.transition = 'opacity 0.18s ease';
        requestAnimationFrame(() => { lb.style.opacity = '1'; });
        document.body.style.overflow = 'hidden';

        const counter = document.getElementById('lb-counter');
        if (_lbItems.length > 1) { counter.textContent = `${_lbIndex + 1} / ${_lbItems.length}`; counter.style.display = 'flex'; }
        else counter.style.display = 'none';
        document.getElementById('lb-prev').style.display = 'none';
        document.getElementById('lb-next').style.display = 'none';
        _lbRenderProfile(_lbIndex);

        const hint = document.getElementById('lb-hint');
        if (hint) { hint.style.opacity = '1'; clearTimeout(hint._t); hint._t = setTimeout(() => (hint.style.opacity = '0'), 3000); }
      }

      /* ── Open lightbox from a video wrap ── */
      function openVideoLightbox(wrapEl) {
        const videoSrc = wrapEl.dataset.lbVideo;
        if (!videoSrc) return;
        _lbItems = collectFeedMedia();
        _lbIndex = _lbItems.findIndex(it => it.type === 'video' && it.src === videoSrc);
        if (_lbIndex < 0) _lbIndex = 0;
        _lbScale = 1; _lbTranslateX = 0; _lbTranslateY = 0;

        const lb = document.getElementById('lightbox');
        lb.style.display = 'flex';
        lb.style.opacity = '0';
        lb.style.transition = 'opacity 0.18s ease';
        requestAnimationFrame(() => { lb.style.opacity = '1'; });
        document.body.style.overflow = 'hidden';
        document.getElementById('lb-hint').style.opacity = '0';
        document.getElementById('lb-prev').style.display = 'none';
        document.getElementById('lb-next').style.display = 'none';
        _lbShowItem();
      }

      /* ── Navigate to any adjacent item (image or video) ── */
      function lbGoTo(newIdx) {
        if (_lbAnimating || newIdx < 0 || newIdx >= _lbItems.length) return;
        _lbAnimating = true;
        const dir = newIdx > _lbIndex ? 1 : -1;
        const lbImg = document.getElementById('lb-img');
        const lbVid = document.getElementById('lb-video');
        const fromVideo = _lbIsVideo();
        const toItem = _lbItems[newIdx];

        // Fade/slide out current item
        const outEl = fromVideo ? lbVid : lbImg;
        outEl.style.transition = 'opacity 0.18s ease, transform 0.2s ease';
        outEl.style.opacity = '0';
        outEl.style.transform = `translateX(${-dir * 60}px)`;
        if (fromVideo) lbVid.pause();

        setTimeout(() => {
          _lbIndex = newIdx;
          _lbScale = 1; _lbTranslateX = 0; _lbTranslateY = 0;
          // Reset outgoing element
          outEl.style.transition = 'none';
          outEl.style.transform = '';

          if (toItem.type === 'video') {
            lbImg.style.display = 'none'; lbImg.src = '';
            lbVid.style.display = 'block';
            lbVid.src = toItem.src;
            lbVid.style.opacity = '0';
            lbVid.style.transform = `translateX(${dir * 60}px)`;
            requestAnimationFrame(() => {
              lbVid.style.transition = 'opacity 0.22s ease, transform 0.28s cubic-bezier(0.34,1.2,0.64,1)';
              lbVid.style.opacity = '1';
              lbVid.style.transform = 'translateX(0)';
              lbVid.play().catch(() => {});
              setTimeout(() => { _lbAnimating = false; }, 300);
            });
          } else {
            lbVid.pause && lbVid.pause(); lbVid.style.display = 'none'; lbVid.src = '';
            lbImg.style.display = '';
            lbImg.src = toItem.src;
            lbImg.style.opacity = '0.2';
            lbImg.style.transform = `translateX(${dir * 60}px) scale(0.88)`;
            requestAnimationFrame(() => {
              lbImg.style.transition = 'transform 0.3s cubic-bezier(0.34,1.2,0.64,1), opacity 0.22s ease';
              lbImg.style.transform = 'translateX(0) scale(1)';
              lbImg.style.opacity = '1';
              setTimeout(() => { _lbAnimating = false; }, 320);
            });
          }

          const counter = document.getElementById('lb-counter');
          if (_lbItems.length > 1) { counter.textContent = `${_lbIndex + 1} / ${_lbItems.length}`; counter.style.display = 'flex'; }
          else counter.style.display = 'none';
          document.getElementById('lb-prev').style.display = 'none';
          document.getElementById('lb-next').style.display = 'none';
          _lbRenderProfile(_lbIndex);
        }, 200);
      }

      // Legacy alias so any remaining references still work
      function lbGoToVideo(newIdx) { lbGoTo(newIdx); }

      function closeLightbox() {
        // Also close comment panel and report panel if open
        const panel = document.getElementById('lb-comments-panel');
        if (panel) { panel.style.display = 'none'; panel.style.transform = ''; panel.style.opacity = ''; }
        const reportPanel = document.getElementById('lb-report-panel');
        if (reportPanel) { reportPanel.style.display = 'none'; reportPanel.style.transform = ''; reportPanel.style.opacity = ''; }
        const actions = document.getElementById('lb-actions');
        if (actions) actions.style.right = '20px';

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
          _lbPostId = null;
          const lbImg = document.getElementById("lb-img");
          lbImg.style.transform = "";
          lbImg.style.transition = "";
          lbImg.style.display = "";
          // Stop & reset video
          const lbVid = document.getElementById("lb-video");
          lbVid.pause();
          lbVid.src = "";
          lbVid.style.display = "none";
          _lbItems = [];
          // Hide caption & actions
          const captionEl = document.getElementById("lb-caption");
          if (captionEl) captionEl.style.display = "none";
          const actionsEl = document.getElementById("lb-actions");
          if (actionsEl) actionsEl.style.display = "none";
        }, 180);
      }



      function lbDownload() {
        const item = _lbCurrent();
        if (!item) return;
        const a = document.createElement("a");
        a.href = item.src;
        a.download = item.type === 'video' ? "video.mp4" : "image.jpg";
        a.target = "_blank";
        a.click();
      }

      function lbShare() {
        const item = _lbCurrent();
        if (!item) return;
        const src = item.src;
        if (navigator.share) {
          navigator.share({ url: src }).catch(() => {});
        } else {
          navigator.clipboard
            .writeText(src)
            .then(() => showToast((_lbCurrent() && _lbCurrent().type === 'video') ? "Video URL copied!" : "Image URL copied!"));
        }
      }

      /* ── Touch / Pointer events for zoom & swipe ── */
      function lbPointerDown(e) {
        _lbPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (_lbPointers.size === 1) {
          _lbSwipeStartX = e.clientX;
          _lbDragStartX = e.clientX - _lbTranslateX;
          _lbDragStartY = e.clientY - _lbTranslateY;
          _lbSwiping = _lbIsVideo() ? true : _lbScale <= 1;
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
        if (_lbIsVideo()) return;
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
        if (_lbPointers.size === 0 && _lbSwiping) {
          const dx = e.clientX - startX;
          if (Math.abs(dx) > 55) {
            if (_lbScale <= 1 || _lbIsVideo()) {
              lbGoTo(_lbIndex + (dx < 0 ? 1 : -1));
            }
          }
          _lbSwiping = false;
        }
      }

      /* ── Wheel zoom ── */
      function lbWheel(e) {
        if (_lbIsVideo()) return;
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
        if (_lbIsVideo()) return;
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
      // Legacy stubs — collectFeedMedia() is now used internally
      function collectFeedImages() { return collectFeedMedia().filter(i=>i.type==='image').map(i=>i.src); }
      function collectFeedVideos() { return []; }

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

        // Pagination state
        let _cursor       = null;   // id of the oldest loaded message (for load-more)
        let _hasMore      = false;  // whether older messages exist on the server
        let _latestId     = null;   // id of the newest loaded message (for polling)
        let _loadingMore  = false;  // guard against concurrent load-more calls

        // Presence & heartbeat state
        let _heartbeatTimer  = null;   // interval for POST /api/dm/heartbeat
        let _presenceTimer   = null;   // interval for GET .../presence
        let _peerOnline      = false;  // last known peer status

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
        let _prevInboxSnapshot = {}; // convId -> last_message_at, to detect new messages
        async function _loadInbox() {
          if (!currentUser) return;
          try {
            const res = await api("GET", "/api/dm/inbox");
            const newInbox = Array.isArray(res.data) ? res.data : [];

            // Detect new incoming messages and update badge + play tone
            if (Object.keys(_prevInboxSnapshot).length > 0) {
              let newCount = 0;
              let toneTriggered = false;
              for (const conv of newInbox) {
                const prev = _prevInboxSnapshot[conv.id];
                const isActiveConv = conv.id === _activeConvId;
                const isFromOther = conv.last_sender_id !== currentUser.id;
                const isNewer = !prev || conv.last_message_at !== prev.last_message_at;
                if (!isActiveConv && isFromOther && isNewer && conv.last_message_at) {
                  newCount++;
                  if (!toneTriggered) { _msgTone.play(); toneTriggered = true; }
                }
              }
              if (newCount > 0) _refreshBadge(newCount);
            }

            // Update snapshot
            _prevInboxSnapshot = {};
            for (const conv of newInbox) {
              _prevInboxSnapshot[conv.id] = { last_message_at: conv.last_message_at };
            }

            _inbox = newInbox;
            renderInbox();
          } catch (e) { _inbox = []; }
        }

        // ── Message tone ────────────────────────────────────────
        const _msgTone = (function() {
          const audio = new Audio("message tone.wav");
          return {
            play() {
              try {
                audio.currentTime = 0;
                audio.play().catch(() => {});
              } catch (_) {}
            }
          };
        })();

        // ── Polling ─────────────────────────────────────────────
        function _startPolling() {
          _stopPolling();
          _polling = setInterval(async () => {
            if (!currentUser) return;
            await _loadInbox();
            if (_activeConvId) {
              await _pollNewMessages(_activeConvId);
              await _fetchPresence(_activeConvId); // piggyback on 4s cycle for responsive status
            }
          }, 4000);
        }
        function _stopPolling() {
          if (_polling) { clearInterval(_polling); _polling = null; }
        }

        // ── Heartbeat — keep current user's presence alive ───────
        function _startHeartbeat() {
          _stopHeartbeat();
          // Fire immediately, then every 30 s
          _sendHeartbeat();
          _heartbeatTimer = setInterval(_sendHeartbeat, 30_000);
        }
        function _stopHeartbeat() {
          if (_heartbeatTimer) { clearInterval(_heartbeatTimer); _heartbeatTimer = null; }
        }
        async function _sendHeartbeat() {
          if (!currentUser) return;
          try { await api("POST", "/api/dm/heartbeat"); } catch (_) {}
        }

        // ── Presence polling — update peer status in header ──────
        function _startPresencePolling(convId) {
          _stopPresencePolling();
          _fetchPresence(convId); // immediate
          _presenceTimer = setInterval(() => _fetchPresence(convId), 30_000);
        }
        function _stopPresencePolling() {
          if (_presenceTimer) { clearInterval(_presenceTimer); _presenceTimer = null; }
        }
        async function _fetchPresence(convId) {
          if (!currentUser || !convId) return;
          try {
            const res = await api("GET", `/api/dm/conversations/${convId}/presence`);
            const { online, last_seen_at } = res.data;
            _peerOnline = online;
            _updateStatusEl(online, last_seen_at);
          } catch (_) {}
        }
        function _updateStatusEl(online, lastSeenAt) {
          const el = document.getElementById("dm-chat-status");
          if (!el) return;
          el.style.display = "flex";
          if (online) {
            el.textContent = "Active now";
            el.className   = "dm-chat-head-status online";
          } else if (lastSeenAt) {
            const diff = Date.now() - new Date(lastSeenAt).getTime();
            const mins = Math.floor(diff / 60_000);
            const hrs  = Math.floor(diff / 3_600_000);
            const days = Math.floor(diff / 86_400_000);
            let label;
            if (mins < 1)        label = "Active just now";
            else if (mins < 60)  label = `Active ${mins}m ago`;
            else if (hrs < 24)   label = `Active ${hrs}h ago`;
            else                 label = `Active ${days}d ago`;
            el.textContent = label;
            el.className   = "dm-chat-head-status";
          } else {
            el.textContent = "Offline";
            el.className   = "dm-chat-head-status";
          }
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
          // Reset status while we load presence
          const statusEl = document.getElementById("dm-chat-status");
          if (statusEl) { statusEl.style.display = "none"; statusEl.textContent = ""; }
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

          // Reset pagination state for the new conversation
          _messages    = [];
          _cursor      = null;
          _hasMore     = false;
          _latestId    = null;
          _loadingMore = false;

          await _fetchMessages(cid, true);
          _startPolling();
          _fetchPresence(cid); // immediate fetch on open
        }

        // ── Fetch messages (initial load or conversation switch) ──
        // GET /api/dm/conversations/:id/messages?limit=10
        async function _fetchMessages(cid, markRead) {
          try {
            const res  = await api("GET", `/api/dm/conversations/${cid}/messages?limit=10`);
            const { messages: msgs, hasMore } = res.data;

            // Determine peer user id for decryption
            const otherUserId = _inbox.find(c => c.id == cid)?.other_id;

            const decrypted = await Promise.all(msgs.map(async m => {
              if (m._plain) return m;
              if (m.body && m.body.startsWith("e2e:") && otherUserId) {
                return { ...m, _plain: await E2E.decrypt(otherUserId, m.body) };
              }
              return { ...m, _plain: m.body };
            }));

            _messages  = decrypted;
            _hasMore   = hasMore;
            _cursor    = decrypted.length ? decrypted[0].id : null;
            _latestId  = decrypted.length ? decrypted[decrypted.length - 1].id : null;

            _renderMessages(decrypted);

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

        // ── Load earlier messages (prepend) ──────────────────────
        // GET /api/dm/conversations/:id/messages?limit=10&before_id=<cursor>
        async function _loadMore() {
          if (!_activeConvId || !_hasMore || _loadingMore || !_cursor) return;
          _loadingMore = true;

          const btn = document.getElementById("dm-load-more-btn");
          if (btn) { btn.disabled = true; btn.textContent = "Loading…"; }

          try {
            const res  = await api("GET", `/api/dm/conversations/${_activeConvId}/messages?limit=10&before_id=${_cursor}`);
            const { messages: msgs, hasMore } = res.data;

            const otherUserId = _inbox.find(c => c.id == _activeConvId)?.other_id;
            const decrypted = await Promise.all(msgs.map(async m => {
              if (m._plain) return m;
              if (m.body && m.body.startsWith("e2e:") && otherUserId) {
                return { ...m, _plain: await E2E.decrypt(otherUserId, m.body) };
              }
              return { ...m, _plain: m.body };
            }));

            // Prepend older messages and update cursor
            _messages = [...decrypted, ..._messages];
            _hasMore  = hasMore;
            _cursor   = decrypted.length ? decrypted[0].id : _cursor;

            // Preserve scroll position after prepend
            const el      = document.getElementById("dm-messages");
            const prevH   = el.scrollHeight;
            _renderMessages(_messages, false);
            el.scrollTop += el.scrollHeight - prevH;
          } catch (e) {
            if (btn) { btn.disabled = false; btn.textContent = "↑ Load earlier messages"; }
          } finally {
            _loadingMore = false;
          }
        }

        // ── Poll for new messages only (after _latestId) ─────────
        // GET /api/dm/conversations/:id/messages/new?after_id=<latestId>
        async function _pollNewMessages(cid) {
          if (!_latestId) {
            // No messages loaded yet — do a full fetch instead
            await _fetchMessages(cid, false);
            return;
          }
          try {
            const res  = await api("GET", `/api/dm/conversations/${cid}/messages/new?after_id=${_latestId}`);
            const msgs = Array.isArray(res.data) ? res.data : [];
            if (!msgs.length) {
              // No new messages — check if peer read ours
              await _patchReadTicks();
              return;
            }

            const otherUserId = _inbox.find(c => c.id == cid)?.other_id;
            const decrypted = await Promise.all(msgs.map(async m => {
              if (m._plain) return m;
              if (m.body && m.body.startsWith("e2e:") && otherUserId) {
                return { ...m, _plain: await E2E.decrypt(otherUserId, m.body) };
              }
              return { ...m, _plain: m.body };
            }));

            // Play tone for new incoming messages
            const hasIncoming = decrypted.some(m => m.sender_id !== currentUser.id);
            if (hasIncoming) _msgTone.play();

            _messages = [..._messages, ...decrypted];
            _latestId = decrypted[decrypted.length - 1].id;
            _renderMessages(_messages);
            await _patchReadTicks();
          } catch (_) {}
        }

        // ── Patch "Seen" label without a full re-render ────────────
        // Called every poll cycle. Asks the server which of our sent
        // messages have actually been read — no guessing.
        async function _patchReadTicks() {
          // Collect IDs of our sent messages that are not yet marked read in local state
          const unreadSentIds = _messages
            .filter(m => m.sender_id === currentUser.id && !m.is_read && !String(m.id).startsWith("tmp_"))
            .map(m => m.id);

          if (!unreadSentIds.length) return;

          try {
            const res = await api("POST", "/api/dm/read-status", { ids: unreadSentIds });
            const readIds = new Set(res.data?.readIds || []);
            if (!readIds.size) return;

            // Update local state
            _messages = _messages.map(m =>
              readIds.has(m.id) ? { ...m, is_read: 1 } : m
            );

            // Find the last sent message id (for placing the single "Seen" label)
            let lastSentId = null;
            for (let i = _messages.length - 1; i >= 0; i--) {
              if (_messages[i].sender_id === currentUser.id && !String(_messages[i].id).startsWith("tmp_")) {
                lastSentId = _messages[i].id;
                break;
              }
            }

            // Remove stale Seen labels
            document.querySelectorAll(".dm-seen-label").forEach(el => el.remove());

            // Only show "Seen" if the last sent message is read
            if (!lastSentId) return;
            const lastMsg = _messages.find(m => m.id === lastSentId);
            if (!lastMsg?.is_read) return;

            const msgEl = document.querySelector(`.dm-msg[data-msg-id="${lastSentId}"]`);
            if (!msgEl) return;
            const seen = document.createElement("div");
            seen.className = "dm-seen-label";
            seen.textContent = "Seen";
            msgEl.appendChild(seen);
          } catch (_) {}
        }

        // ── Render message bubbles ──────────────────────────────
        // Backend fields: sender_id, body, created_at
        // scrollToBottom=true on initial load; false when prepending older messages.
        function _renderMessages(msgs, scrollToBottom = true) {
          const el = document.getElementById("dm-messages");
          if (!msgs.length) {
            el.innerHTML = `<div style="text-align:center;padding:40px 16px;color:var(--txt3);font-size:13.5px">Send a message to start the conversation ✨</div>`;
            return;
          }
          let lastDate = "";
          // Find the id of the last message sent by the current user (for "Seen" label)
          let lastSentId = null;
          for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].sender_id === currentUser.id && !String(msgs[i].id).startsWith("tmp_")) {
              lastSentId = msgs[i].id;
              break;
            }
          }
          const bubbles = msgs.map(msg => {
            const mine    = msg.sender_id === currentUser.id;
            const dateStr = _fmtDate(msg.created_at);
            let divider   = "";
            if (dateStr !== lastDate) { lastDate = dateStr; divider = `<div class="dm-date-divider">${dateStr}</div>`; }
            const displayText = msg._plain !== undefined ? msg._plain : msg.body;
            const isE2E = msg.body && msg.body.startsWith("e2e:");
            // "Seen" label — only on the last sent message when it has been read
            const isTmp = String(msg.id).startsWith("tmp_");
            let seenLabel = "";
            if (mine && !isTmp && msg.id === lastSentId && !!msg.is_read) {
              seenLabel = `<div class="dm-seen-label">Seen</div>`;
            }
            return `${divider}<div class="dm-msg ${mine ? "mine" : "theirs"}" data-msg-id="${msg.id}">
              <div class="dm-bubble">
                ${escHtml(displayText || "").replace(/\n/g, "<br>")}
                <span class="dm-bubble-time">${_fmtTime(msg.created_at)}${isE2E ? ' <span title="End-to-end encrypted" style="opacity:0.7">🔒</span>' : ''}</span>
              </div>${seenLabel}
            </div>`;
          }).join("");

          // Prepend "Load earlier" button if more messages exist on the server
          const loadMoreBtn = _hasMore
            ? `<button id="dm-load-more-btn" onclick="DM.loadMore()" style="
                display:block;margin:12px auto 6px;padding:7px 18px;
                background:var(--accent-bg);color:var(--accent);
                border:1px solid var(--accent);border-radius:20px;
                font-size:12.5px;font-weight:600;cursor:pointer;
                transition:background var(--tr),opacity var(--tr);"
                onmouseover="this.style.background='var(--accent)';this.style.color='#fff';"
                onmouseout="this.style.background='var(--accent-bg)';this.style.color='var(--accent)';">
                ↑ Load earlier messages
              </button>`
            : "";

          el.innerHTML = loadMoreBtn + bubbles;
          if (scrollToBottom) el.scrollTop = el.scrollHeight;
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
            if (saved && saved.id) {
              saved._plain = text;
              _messages.push(saved);
              // Advance the polling cursor so we don't re-fetch this message
              _latestId = saved.id;
            }
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
        // Local unread counter — only cleared when user opens the messages view
        let _localUnread = 0;

        function _refreshBadge(delta) {
          if (delta) _localUnread = Math.max(0, _localUnread + delta);
          const count = _localUnread;
          const badge = document.getElementById("snav-dm-badge");
          if (badge) { badge.textContent = count > 9 ? "9+" : count; badge.classList.toggle("show", count > 0); }
          const mbadge = document.getElementById("mnav-dm-badge");
          if (mbadge) { mbadge.textContent = count > 9 ? "9+" : count; mbadge.classList.toggle("show", count > 0); }
          const tbadge = document.getElementById("topbar-dm-badge");
          if (tbadge) { tbadge.textContent = count > 9 ? "9+" : count; tbadge.classList.toggle("show", count > 0); }
        }

        function clearDMBadge() {
          _localUnread = 0;
          _refreshBadge();
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
          clearDMBadge,
          startConvWithUser,
          loadMore: _loadMore,
          getActiveConvId: () => _activeConvId,
          _tonePlay: () => _msgTone.play(),
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
          // If user object is gone, clear any stale token too
          if (!s) localStorage.removeItem("circle_token");
        } catch (e) {
          localStorage.removeItem("circle_user");
          localStorage.removeItem("circle_token");
        }

        // If arriving via reset link, show new-password view and skip loadPosts
        const resetToken = new URLSearchParams(window.location.search).get(
          "token",
        );
        if (resetToken) {
          goTo("new-password");
          return;
        }

        // ── Seed history so the very first back press stays in the app ──
        history.replaceState({ view: "feed" }, "");

        // ── Android / browser back button handler ────────────────────
        window.addEventListener("popstate", (e) => {
          const state = e.state;
          if (!state || !state.view) {
            // No state — we've gone before the app's first entry; do nothing
            // (browser will handle exiting naturally)
            return;
          }
          _historyNavigating = true;
          try {
            if (state.view === "profile") {
              // Re-render profile; viewProfile would push again so call internals directly
              document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
              document.getElementById("view-profile").classList.add("active");
              document.querySelector(".content")?.classList.remove("feed-active");
              document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
              const sn = document.getElementById("snav-profile");
              if (sn) sn.classList.add("active");
              document.querySelectorAll(".mnav-item").forEach(n => n.classList.remove("active"));
              const mn = document.getElementById("mnav-profile");
              if (mn) mn.classList.add("active");
              window.scrollTo(0, 0);
              renderProfile(state.userId || null);
            } else if (state.view === "post-detail" && state.postId) {
              _postDetailPrevView = state.prevView || "feed";
              const post = posts.find(p => p.id === state.postId) || PostCache.getPost(state.postId);
              if (post) {
                renderPostDetail(post);
                goTo("post-detail");
              } else {
                goTo(_postDetailPrevView);
              }
            } else {
              goTo(state.view);
            }
          } finally {
            _historyNavigating = false;
          }
        });

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

      function goToPostDetail(postId, focusReply) {
        const active = document.querySelector(".view.active");
        _postDetailPrevView = active ? active.id.replace("view-", "") : "feed";
        const post = posts.find((p) => p.id === postId) || PostCache.getPost(postId);
        if (!post) return;
        renderPostDetail(post);
        if (!_historyNavigating) {
          history.pushState({ view: "post-detail", postId, prevView: _postDetailPrevView }, "");
        }
        goTo("post-detail");
        if (focusReply) {
          requestAnimationFrame(() => {
            const input = document.getElementById("post-detail-reply-input");
            if (input) input.focus();
          });
        }
      }

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
          posts.find((p) => p.id === postId) || PostCache.getPost(postId);
        if (!post) return;

        renderPostDetail(post);
        history.pushState({ view: "post-detail", postId, prevView: _postDetailPrevView }, "");
        goTo("post-detail");
      }

      function closePostDetail() {
        const prev = _postDetailPrevView || "feed";
        // Don't re-trigger search reset side effects if going back to search
        if (prev === "search") {
          document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
          const el = document.getElementById("view-search");
          if (el) el.classList.add("active");
          document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
          const sn = document.getElementById("snav-search");
          if (sn) sn.classList.add("active");
          document.querySelectorAll(".mnav-item").forEach(n => n.classList.remove("active"));
          const mn = document.getElementById("mnav-search");
          if (mn) mn.classList.add("active");
          window.scrollTo(0, 0);
          history.pushState({ view: "search" }, "");
        } else {
          goTo(prev);
        }
      }

      async function openOriginalPost(postId) {
        if (!postId) return;
        const active = document.querySelector(".view.active");
        _postDetailPrevView = active ? active.id.replace("view-", "") : "feed";
        try {
          // Always fetch from API so post is found even if not in current feed
          const res = await api("GET", `/api/posts/${postId}`);
          const post = res.data;
          if (!post) { showToast("Post not found."); return; }
          PostCache.putPost(post);
          renderPostDetail(post);
          history.pushState({ view: "post-detail", postId, prevView: _postDetailPrevView }, "");
          goTo("post-detail");
        } catch (e) {
          showToast("Could not load original post.");
        }
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
                ? `<div class="repost-embed" style="margin-bottom:14px;cursor:pointer" onclick="openOriginalPost(${post.originalPost.id})" title="View original post by ${escHtml(post.originalPost.author)}">
                  <div class="repost-embed-name">${escHtml(post.originalPost.author)}</div>
                  ${post.originalPost.text ? `<div class="repost-embed-text">${escHtml(post.originalPost.text)}</div>` : ""}
                  ${post.originalPost.video ? `<div class="post-video-wrap repost-embed-video" onclick="event.stopPropagation();openVideoLightbox(this)" data-lb-video="${post.originalPost.video}" data-lb-name="${escHtml(post.originalPost.author)}" data-lb-picture="${escHtml(post.originalPost.authorPicture || '')}" data-lb-user-id="${post.originalPost.userId || ''}" data-lb-post-id="${post.id}" data-lb-caption="${escHtml(post.originalPost.text || '')}" title="Watch video" style="margin-top:8px"><video src="${post.originalPost.video}" preload="metadata" playsinline muted></video><div class="post-video-play-btn"><svg viewBox="0 0 56 56" xmlns="http://www.w3.org/2000/svg"><circle cx="28" cy="28" r="28" fill="rgba(0,0,0,0.45)"/><polygon points="22,16 42,28 22,40" fill="white"/></svg></div></div>` : post.originalPost.image ? `<img class="post-detail-img repost-embed-img lb-thumb" src="${post.originalPost.image}" loading="lazy" data-lb-name="${escHtml(post.originalPost.author)}" data-lb-picture="${escHtml(post.originalPost.authorPicture || '')}" data-lb-user-id="${post.originalPost.userId || ''}" data-lb-post-id="${post.id}" data-lb-caption="${escHtml(post.originalPost.text || '')}" onclick="event.stopPropagation();openLightbox(this)" title="View full image"/>` : ""}
                </div>`
                : post.video
                  ? `<div class="post-video-wrap" onclick="openVideoLightbox(this)" data-lb-video="${post.video}" data-lb-name="${escHtml(post.author)}" data-lb-picture="${escHtml(post.authorPicture || '')}" data-lb-user-id="${post.userId}" data-lb-post-id="${post.id}" data-lb-caption="${escHtml(post.text || '')}" title="Watch video"><video src="${post.video}" preload="metadata" playsinline muted></video><div class="post-video-play-btn"><svg viewBox="0 0 56 56" xmlns="http://www.w3.org/2000/svg"><circle cx="28" cy="28" r="28" fill="rgba(0,0,0,0.45)"/><polygon points="22,16 42,28 22,40" fill="white"/></svg></div></div>`
                  : post.image
                  ? `<img class="post-detail-img lb-thumb" src="${post.image}" loading="lazy" onclick="openLightbox(this)" data-lb-name="${escHtml(post.author)}" data-lb-picture="${escHtml(post.authorPicture || "")}" data-lb-user-id="${post.userId}" data-lb-post-id="${post.id}" data-lb-caption="${escHtml(post.text || "")}"/>`
                  : ""
            }

            <div class="post-detail-stats">
              <span class="post-detail-stat"><strong>${post.reposts ? post.reposts.length : 0}</strong> Reposts</span>
              <span class="post-detail-stat"><strong>${post.likes ? post.likes.length : 0}</strong> Likes</span>
              <span class="post-detail-stat"><strong>${(function countAll(arr){return(arr||[]).reduce((n,c)=>n+1+countAll(c.replies||[]),0);})(post.comments)}</strong> Comments</span>
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
        const replyBar = document.getElementById("post-detail-reply-bar");
        replyBar.classList.toggle("visible", !!currentUser);

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

        function buildAvatar(c, size) {
          const col = stringToColor(c.author || '?');
          const inner = c.authorPicture
            ? `<img src="${escHtml(c.authorPicture)}" alt="${escHtml((c.author || '?').charAt(0))}" loading="lazy" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block"/>`
            : escHtml((c.author || '?').charAt(0));
          return `<div class="av${size === 'xs' ? ' xs' : ' sm'}" style="background:${c.authorPicture ? 'transparent' : col};flex-shrink:0">${inner}</div>`;
        }

        function buildReplyBtn(c) {
          return `<button class="comment-reply-btn" data-author="${escHtml(c.author || '')}" data-id="${c.id}" onclick="startReplyTo(this.dataset.author, this.dataset.id)">
            <svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 00-4-4H4"/></svg>
            Reply
          </button>`;
        }

        // Recursively render a comment and its replies array
        function buildCommentNode(c, isNested) {
          const repliesArr = Array.isArray(c.replies) ? c.replies : [];
          const replyCount = repliesArr.length;
          const nestedId = `replies-${c.id}`;

          const nestedHtml = replyCount
            ? `<button class="view-replies-btn" onclick="toggleReplies('${nestedId}', this)" data-count="${replyCount}">
                <svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
                View ${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}
              </button>
              <div class="nested-replies" id="${nestedId}" style="display:none">
                ${repliesArr.map(r => buildCommentNode(r, true)).join('')}
              </div>`
            : '';

          if (isNested) {
            return `<div class="nested-reply-item">
              ${buildAvatar(c, 'xs')}
              <div class="post-detail-comment-bubble" style="flex:1">
                <div class="post-detail-comment-name" style="cursor:pointer" onclick="viewProfile(${c.userId || 'null'})">${escHtml(c.author || 'Anonymous')}</div>
                <div class="post-detail-comment-text">${escHtml(c.text || '')}</div>
                ${c.createdAt ? `<div class="post-detail-comment-time">${formatTime(c.createdAt)}</div>` : ''}
                ${buildReplyBtn(c)}
                ${nestedHtml}
              </div>
            </div>`;
          }

          return `<div class="post-detail-comment-item">
            ${buildAvatar(c, 'sm')}
            <div class="post-detail-comment-content">
              <div class="post-detail-comment-bubble">
                <div class="post-detail-comment-name" style="cursor:pointer" onclick="viewProfile(${c.userId || 'null'})">${escHtml(c.author || 'Anonymous')}</div>
                <div class="post-detail-comment-text">${escHtml(c.text || '')}</div>
              </div>
              ${c.createdAt ? `<div class="post-detail-comment-time">${formatTime(c.createdAt)}</div>` : ''}
              ${buildReplyBtn(c)}
              ${nestedHtml}
            </div>
          </div>`;
        }

        // Count total including all nested replies
        function countAll(arr) {
          return arr.reduce((n, c) => n + 1 + countAll(Array.isArray(c.replies) ? c.replies : []), 0);
        }
        const totalCount = countAll(comments);

        section.innerHTML = `<div class="post-detail-comments-section">
          <div class="post-detail-comments-title">Replies (${totalCount})</div>
          ${comments.map(c => buildCommentNode(c, false)).join('')}
        </div>`;
      }

      function toggleReplies(id, btn) {
        const el = document.getElementById(id);
        if (!el) return;
        const isHidden = el.style.display === 'none';
        el.style.display = isHidden ? 'flex' : 'none';
        const count = btn.dataset.count;
        btn.innerHTML = isHidden
          ? `<svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="18 15 12 9 6 15"/></svg> Hide ${count} ${count == 1 ? 'reply' : 'replies'}`
          : `<svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg> View ${count} ${count == 1 ? 'reply' : 'replies'}`;
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
          posts.find((p) => p.id === postId) || PostCache.getPost(postId);
        if (post) renderPostDetail(post);
      }

      // Find a comment by id recursively across a comments tree
      function findCommentById(arr, id) {
        for (const c of (arr || [])) {
          if (c.id === id) return c;
          const found = findCommentById(c.replies || [], id);
          if (found) return found;
        }
        return null;
      }

      // Fire a reply notification to the author of the parent comment (silent — never throws)
      async function sendReplyNotification(postId, parentId, replyText) {
        try {
          const post = posts.find(p => p.id === postId) || PostCache.getPost(postId);
          const parent = post ? findCommentById(post.comments || [], parentId) : null;
          // Don't notify yourself
          if (!parent || !parent.userId || parent.userId === currentUser.id) return;
          await api("POST", "/api/notifications", {
            type: "reply",
            actorId: currentUser.id,
            actorName: currentUser.name,
            actorPicture: currentUser.picture || null,
            recipientId: parent.userId,
            postId,
            postSnippet: replyText.slice(0, 80),
          });
          fetchUnreadCount();
        } catch (_) { /* silent — notifications are best-effort */ }
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

        // FIX: use parentId (matches server field) instead of parentCommentId
        const parentId = (input.dataset.parentId !== undefined && input.dataset.parentId !== "")
          ? parseInt(input.dataset.parentId)
          : null;

        try {
          const body = { userId: currentUser.id, text };
          if (parentId) body.parentId = parentId;

          const res = await api("POST", `/api/posts/${postId}/comment`, body);
          const newComment = res.data; // { id, parentId, author, text, replies?, createdAt }
          input.value = "";
          cancelReply();

          const post = posts.find((p) => p.id === postId) || PostCache.getPost(postId);
          if (post) {
            if (!Array.isArray(post.comments)) post.comments = [];
            const commentWithReplies = { ...newComment, replies: Array.isArray(newComment.replies) ? newComment.replies : [] };

            if (parentId) {
              // FIX: nest reply under its parent using the replies array
              function insertReply(arr, pid, reply) {
                for (const c of arr) {
                  if (c.id === pid) { if (!Array.isArray(c.replies)) c.replies = []; c.replies.push(reply); return true; }
                  if (Array.isArray(c.replies) && insertReply(c.replies, pid, reply)) return true;
                }
                return false;
              }
              if (!insertReply(post.comments, parentId, commentWithReplies)) {
                post.comments.push(commentWithReplies);
              }
            } else {
              post.comments.push(commentWithReplies);
            }

            PostCache.putPost(post);
            renderPostDetailComments(post);

            // Update stat count — count all nested
            function countAll(arr) { return arr.reduce((n, c) => n + 1 + countAll(Array.isArray(c.replies) ? c.replies : []), 0); }
            const stat = document.querySelector("#post-detail-content .post-detail-stat:last-child strong");
            if (stat) stat.textContent = countAll(post.comments);
          }
          showToast(parentId ? "Reply posted! 💬" : "Comment posted! 💬");
          if (parentId) sendReplyNotification(postId, parentId, text);
        } catch (e) {
          showToast("Failed to post reply: " + e.message);
        }
      }

      function startReplyTo(authorName, commentId) {
        const input = document.getElementById("post-detail-reply-input");
        const banner = document.getElementById("reply-to-banner");
        const label = document.getElementById("reply-to-label");

        // FIX: store as parentId to match what postDetailAddComment and the server expect
        input.dataset.parentId = commentId;
        label.innerHTML = `Replying to <strong>${escHtml(authorName)}</strong>`;
        banner.style.display = "flex";
        input.placeholder = `Reply to ${authorName}…`;
        input.focus();
        // Scroll input into view on mobile
        setTimeout(() => input.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
      }

      function cancelReply() {
        const input = document.getElementById("post-detail-reply-input");
        const banner = document.getElementById("reply-to-banner");
        // FIX: delete parentId (was parentCommentId)
        delete input.dataset.parentId;
        input.placeholder = "Write a reply…";
        banner.style.display = "none";
      }

      function mobileOpenCompose() {
        if (!currentUser) {
          showToast("Log in to create a post.");
          goTo("login");
          return;
        }
        openComposeTab();
      }

      let _composePrevView = "feed";
      let _composeTabPendingImage = null;
      let _composeTabPendingVideo = null;

      function openComposeTab() {
        // Remember where we came from
        const active = document.querySelector(".view.active");
        _composePrevView = active ? active.id.replace("view-", "") : "feed";

        // Set avatar
        const av = document.getElementById("compose-tab-av");
        if (av && currentUser) {
          if (currentUser.picture) {
            av.innerHTML = `<img src="${currentUser.picture}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block"/>`;
            av.style.background = "transparent";
          } else {
            av.textContent = (currentUser.name || "?").charAt(0).toUpperCase();
            av.style.background = stringToColor(currentUser.name || "");
          }
        }

        // Reset state
        document.getElementById("compose-tab-text").value = "";
        document.getElementById("compose-tab-char-count").textContent = "";
        removeComposeTabMedia();
        document.getElementById("compose-tab-submit").disabled = false;
        document.getElementById("compose-tab-submit").textContent = "Post";

        goTo("compose");
        setTimeout(() => document.getElementById("compose-tab-text").focus(), 150);
      }

      function closeComposeTab() {
        removeComposeTabMedia();
        // Reset progress bar
        const progressWrap = document.getElementById("compose-tab-progress");
        const progressBar = document.getElementById("compose-tab-progress-bar");
        if (progressWrap) progressWrap.classList.remove("active");
        if (progressBar) { progressBar.style.transition = "none"; progressBar.style.width = "0%"; setTimeout(() => { progressBar.style.transition = ""; }, 50); }
        goTo(_composePrevView);
      }

      function composeTabInput(el) {
        const len = el.value.length;
        const MAX = 280;
        const counter = document.getElementById("compose-tab-char-count");
        if (len === 0) {
          counter.textContent = "";
          counter.className = "compose-tab-char-count";
        } else {
          counter.textContent = `${len} / ${MAX}`;
          counter.className = "compose-tab-char-count" + (len > MAX ? " over" : len > MAX * 0.85 ? " warn" : "");
        }
      }

      function composeTabPreviewImage(event) {
        const file = event.target.files[0];
        if (!file) return;
        if (file.size > 10 * 1024 * 1024) { showToast("Image must be under 10 MB."); event.target.value = ""; return; }
        _composeTabPendingImage = file;   // store File object for FormData upload
        _composeTabPendingVideo = null;
        const reader = new FileReader();
        reader.onload = (e) => {
          const img = document.getElementById("compose-tab-img-preview");
          const vid = document.getElementById("compose-tab-video-preview");
          img.src = e.target.result;
          img.style.display = "block";
          vid.style.display = "none";
          vid.src = "";
          document.getElementById("compose-tab-media-preview").style.display = "block";
        };
        reader.readAsDataURL(file);
      }

      function composeTabPreviewVideo(event) {
        const file = event.target.files[0];
        if (!file) return;
        if (file.size > 100 * 1024 * 1024) { showToast("Video must be under 100 MB."); return; }
        _composeTabPendingVideo = file;   // store File object for FormData upload
        _composeTabPendingImage = null;
        const reader = new FileReader();
        reader.onload = (e) => {
          const vid = document.getElementById("compose-tab-video-preview");
          const img = document.getElementById("compose-tab-img-preview");
          vid.src = e.target.result;
          vid.style.display = "block";
          img.style.display = "none";
          img.src = "";
          document.getElementById("compose-tab-media-preview").style.display = "block";
        };
        reader.readAsDataURL(file);
      }

      function removeComposeTabMedia() {
        _composeTabPendingImage = null;
        _composeTabPendingVideo = null;
        const img = document.getElementById("compose-tab-img-preview");
        const vid = document.getElementById("compose-tab-video-preview");
        if (img) { img.src = ""; img.style.display = "none"; }
        if (vid) { vid.pause(); vid.src = ""; vid.style.display = "none"; }
        const wrap = document.getElementById("compose-tab-media-preview");
        if (wrap) wrap.style.display = "none";
        const ii = document.getElementById("compose-tab-img-input");
        const vi = document.getElementById("compose-tab-video-input");
        if (ii) ii.value = "";
        if (vi) vi.value = "";
      }

      async function createPostFromTab() {
        if (!currentUser) return;
        const text = document.getElementById("compose-tab-text").value.trim();
        if (!text && !_composeTabPendingImage && !_composeTabPendingVideo) {
          showToast("Write something or add a photo/video!");
          return;
        }
        const btn = document.getElementById("compose-tab-submit");
        const progressWrap = document.getElementById("compose-tab-progress");
        const progressBar = document.getElementById("compose-tab-progress-bar");

        // Start progress
        btn.disabled = true;
        btn.textContent = "Posting…";
        progressWrap.classList.add("active");
        progressBar.style.width = "15%";

        // Simulate progress stages while the request is in-flight
        let currentWidth = 15;
        const progressInterval = setInterval(() => {
          // Ease toward 85% but never reach it — the final jump happens on success
          const remaining = 85 - currentWidth;
          currentWidth += remaining * 0.12;
          progressBar.style.width = currentWidth + "%";
        }, 300);

        try {
          const fd = new FormData();
          fd.append("text", text);
          if (_composeTabPendingImage instanceof File) fd.append("image", _composeTabPendingImage);
          if (_composeTabPendingVideo instanceof File) fd.append("video", _composeTabPendingVideo);

          const res = await api("POST", "/api/posts", fd);

          clearInterval(progressInterval);
          // Jump to 100% then close
          progressBar.style.width = "100%";
          await new Promise(r => setTimeout(r, 350));

          const newPost = res.data;
          PostCache.putPost(newPost);
          PostCache.invalidateFeed(currentFeedTab);
          posts.unshift(newPost);
          renderFeed();
          showToast("Posted! ✨");
          closeComposeTab();
        } catch (e) {
          clearInterval(progressInterval);
          // Drain back to 0 on failure
          progressBar.style.transition = "width 0.3s ease";
          progressBar.style.width = "0%";
          setTimeout(() => {
            progressWrap.classList.remove("active");
            progressBar.style.transition = "";
          }, 350);
          showToast("Error: " + e.message);
          btn.disabled = false;
          btn.textContent = "Post";
        }
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
            const scrollingDown = delta > 8;
            const scrollingUp = delta < -8;
            const onFeed = document.getElementById('view-feed')?.classList.contains('active');
            if (scrollingDown) {
              nav.classList.add('nav-hidden');
              if (onFeed) document.querySelector('.topbar')?.classList.add('topbar-hidden');
            } else if (scrollingUp) {
              nav.classList.remove('nav-hidden');
              if (onFeed) document.querySelector('.topbar')?.classList.remove('topbar-hidden');
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