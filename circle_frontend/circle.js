      const API = "http://localhost:5000";
      let posts = [],
        currentUser = null,
        pendingImageDataUrl = null,
        repostTargetId = null;
      let currentFeedTab = "global";
      let feedPage = 1,
        feedHasMore = true,
        feedLoading = false;

      /* ── API ──────────────────────────────────────────────────── */
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

      /* ── THEME ────────────────────────────────────────────────── */
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

      /* ── NAV ──────────────────────────────────────────────────── */
      function goTo(view) {
        // Page map — each view is its own HTML file
        const PAGE_MAP = {
          feed:     'index.html',
          search:   'search.html',
          login:    'login.html',
          register: 'register.html',
          profile:  'profile.html',
          settings: 'settings.html',
        };

        // Detect which page we are currently on
        const currentPage = window.location.pathname.split('/').pop() || 'index.html';
        const targetPage  = PAGE_MAP[view] || 'index.html';

        // If navigating to a different page — go there
        if (currentPage !== targetPage) {
          // Save any pending state before leaving
          if (currentUser) localStorage.setItem('circle_user', JSON.stringify(currentUser));
          window.location.href = targetPage;
          return;
        }

        // Same page — just run the page-specific logic
        window.scrollTo(0, 0);
        if (view === 'feed')    { loadPosts(); loadSuggestions(); }
        if (view === 'profile') { renderProfile(); }
        if (view === 'settings') { populateSettings(); }
        if (view === 'search') {
          searchTab = 'posts';
          const si = document.getElementById('search-input');
          if (si) si.value = '';
          renderSearchHint();
        }
      }

      /* ── AUTH ─────────────────────────────────────────────────── */
      async function registerUser() {
        const name = document.getElementById("reg-name").value.trim();
        const email = document.getElementById("reg-email").value.trim();
        const password = document.getElementById("reg-password").value;
        const el = document.getElementById("register-alert");
        el.className = "alert";
        if (!name || !email || !password)
          return showAlert(el, "All fields are required.", "error");
        if (password.length < 6)
          return showAlert(
            el,
            "Password must be at least 6 characters.",
            "error",
          );
        try {
          const res = await api("POST", "/api/users/register", {
            name,
            email,
            password,
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

      function logout() {
        currentUser = null;
        localStorage.removeItem("circle_user");
        document.getElementById("sidebar-user-area").style.display = "none";
        document.getElementById("compose-box").style.display = "none";
        document.getElementById("login-nudge").style.display = "flex";
        document.getElementById("feed-tabs").style.display = "none";
        const ta = document.getElementById("topbar-avatar");
        if (ta) ta.style.display = "none";
        stopNotifPolling();
        updateNotifBadge(0);
        const topBtn = document.getElementById("topbar-notif-btn");
        if (topBtn) topBtn.style.display = "none";
        showToast("Logged out successfully.");
        goTo("feed");
      }

      function setCurrentUser(user) {
        _suggestionsLoaded = false;
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
            el.innerHTML = `<img src="${pic}" alt="${initial}" style="width:100%;height:100%;border-radius:inherit;object-fit:cover;display:block"/>`;
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
            ta.innerHTML = `<img src="${pic}" alt="${initial}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block"/>`;
          } else {
            ta.innerHTML = initial;
            ta.style.background = color;
          }
        }
        document.getElementById("compose-box").style.display = "block";
        document.getElementById("login-nudge").style.display = "none";
        document.getElementById("feed-tabs").style.display = "flex";
        const topBtn = document.getElementById("topbar-notif-btn");
        if (topBtn) topBtn.style.display = "grid";
        startNotifPolling();
        loadSuggestions();
      }

      /* ── SETTINGS ─────────────────────────────────────────────── */
      function populateSettings() {
        if (!currentUser) {
          goTo("login");
          return;
        }
        document.getElementById("settings-name").value = currentUser.name || "";
        document.getElementById("settings-email").value =
          currentUser.email || "";
        document.getElementById("settings-password").value = "";
        const sav = document.getElementById("settings-av");
        if (sav) {
          const pic = currentUser.picture || null,
            initial = currentUser.name.charAt(0).toUpperCase(),
            color = stringToColor(currentUser.name);
          if (pic) {
            sav.style.background = "transparent";
            sav.innerHTML = `<img src="${pic}" alt="${initial}" style="width:100%;height:100%;border-radius:inherit;object-fit:cover;display:block"/>`;
          } else {
            sav.innerHTML = initial;
            sav.style.background = color;
          }
        }
        const p = JSON.parse(
          localStorage.getItem("circle_notif_prefs") || "{}",
        );
        ["likes", "comments", "reposts", "push"].forEach((k) => {
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
          account: document.getElementById("priv-account").checked,
          activity: document.getElementById("priv-activity").checked,
        };
        localStorage.setItem("circle_notif_prefs", JSON.stringify(prefs));
        try {
          const res = await api("PUT", `/api/users/${currentUser.id}`, {
            name,
            email,
            password: password || undefined,
          });
          const updatedUser = {
            ...res.data,
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

      /* ── FEED TABS ────────────────────────────────────────────── */
      function switchFeedTab(tab) {
        currentFeedTab = tab;
        document
          .getElementById("ftab-global")
          .classList.toggle("active", tab === "global");
        document
          .getElementById("ftab-following")
          .classList.toggle("active", tab === "following");
        loadPosts();
      }

      /* ── POSTS ────────────────────────────────────────────────── */
      async function loadPosts() {
        if (!currentUser) {
          goTo("login");
          return;
        }
        feedPage = 1;
        feedHasMore = true;
        feedLoading = false;
        posts = [];
        const c = document.getElementById("feed-list");
        c.innerHTML = `<div class="empty"><div class="empty-icon"><div class="spinner" style="border-color:rgba(124,107,255,.3);border-top-color:var(--accent);width:24px;height:24px"></div></div><p>Loading posts…</p></div>`;
        await fetchMorePosts(true);
      }

      async function fetchMorePosts(isFirstPage = false) {
        if (feedLoading || !feedHasMore) return;
        feedLoading = true;
        try {
          const qs = `?userId=${currentUser.id}&feed=${currentFeedTab}&page=${feedPage}`;
          const res = await api("GET", `/api/posts${qs}`);
          const { posts: newPosts, hasMore } = res.data;
          feedHasMore = hasMore;
          feedPage++;
          posts = isFirstPage ? newPosts : [...posts, ...newPosts];
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
          posts.unshift(res.data);
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

      /* ── LIKES ────────────────────────────────────────────────── */
      async function toggleLike(postId) {
        if (!currentUser) {
          showToast("Log in to like posts.");
          goTo("login");
          return;
        }
        try {
          await api("POST", `/api/posts/${postId}/like`, {
            userId: currentUser.id,
          });
          const post = posts.find((p) => p.id === postId);
          if (post) {
            const i = post.likes.indexOf(currentUser.id);
            if (i === -1) post.likes.push(currentUser.id);
            else post.likes.splice(i, 1);
          }
          refreshLikeBtn(postId);
        } catch (e) {
          showToast("Error: " + e.message);
        }
      }

      function refreshLikeBtn(postId) {
        const card = document.querySelector(`[data-post-id="${postId}"]`);
        if (!card) return;
        const post = posts.find((p) => p.id === postId);
        if (!post) return;
        const liked = currentUser && post.likes.includes(currentUser.id);
        const btn = card.querySelector(".like-btn");
        btn.className = "act-btn like-btn" + (liked ? " liked" : "");
        btn.innerHTML = `<svg fill="${liked ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg><span>${post.likes.length || ""}</span>`;
      }

      /* ── COMMENTS ─────────────────────────────────────────────── */
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
          if (post) post.comments.push(res.data);
          input.value = "";
          renderCommentList(postId);
          const ce = document.querySelector(
            `[data-post-id="${postId}"] .comment-count`,
          );
          if (ce && post) ce.textContent = post.comments.length || "";
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
              ? `<img src="${c.authorPicture}" alt="${escHtml(c.author.charAt(0))}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block"/>`
              : escHtml(c.author.charAt(0));
            return `<div class="comment-row"><div class="av sm" style="background:${c.authorPicture ? "transparent" : col}">${avInner}</div><div class="comment-bubble"><div class="comment-name">${escHtml(c.author)}</div><div class="comment-txt">${escHtml(c.text)}</div></div></div>`;
          })
          .join("");
      }

      /* ── REPOSTS ──────────────────────────────────────────────── */
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

      /* ── IMAGE ────────────────────────────────────────────────── */
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

      /* ── RENDER ───────────────────────────────────────────────── */
      function renderFeed() {
        const c = document.getElementById("feed-list");
        if (!posts.length) {
          const emptyMsg =
            currentFeedTab === "following"
              ? "<h3>No posts yet</h3><p>Follow some people to see their posts here!</p>"
              : "<h3>Nothing here yet</h3><p>Be the first to post something!</p>";
          c.innerHTML = `<div class="empty"><div class="empty-icon"><svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg></div>${emptyMsg}</div>`;
          return;
        }
        c.innerHTML = posts.map((p) => buildPostCard(p)).join("");
      }


      /* -- VIEW ANOTHER USER'S PROFILE -------------------------------- */
      function viewProfile(userId) {
        if (!userId) return;
        if (currentUser && userId === currentUser.id) {
          sessionStorage.removeItem('circle_view_user');
          goTo('profile');
          return;
        }
        // Store userId so profile.html can load the right user
        sessionStorage.setItem('circle_view_user', userId);
        goTo('profile');
      }

      async function renderProfile(viewedUserId = null) {
        if (!currentUser) { goTo('login'); return; }
        const targetId     = viewedUserId ? parseInt(viewedUserId) : currentUser.id;
        const isOwnProfile = targetId === currentUser.id;

        // Back button
        const backRow = document.getElementById('profile-back-row');
        if (backRow) backRow.style.display = isOwnProfile ? 'none' : 'block';

        // Avatar wrapper — show upload UI only on own profile
        const avWrap = document.getElementById('profile-av-wrap');
        if (avWrap) {
          if (isOwnProfile) {
            avWrap.innerHTML = `
              <label class="av-upload-wrap" for="profile-pic-input" title="Change profile picture">
                <div class="av lg" id="profile-av">?</div>
                <div class="av-upload-overlay"><svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg></div>
                <div class="av-upload-badge"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></div>
                <input type="file" id="profile-pic-input" accept="image/*" onchange="handleProfilePicUpload(event)"/>
              </label>`;
          } else {
            avWrap.innerHTML = `<div class="av lg" id="profile-av">?</div>`;
          }
        }

        // Fetch profile data from server
        let profileData = null;
        try {
          const res = await api('GET', `/api/users/${targetId}/profile`);
          profileData = res.data;
        } catch (e) { console.error('Profile fetch error:', e); }

        const name    = profileData?.name    || (isOwnProfile ? currentUser.name  : 'Unknown');
        const email   = profileData?.email   || (isOwnProfile ? currentUser.email : '');
        const pic     = profileData?.picture || (isOwnProfile ? currentUser.picture : null);
        const initial = (name || '?').charAt(0).toUpperCase();
        const color   = stringToColor(name);

        // Set avatar
        const av = document.getElementById('profile-av');
        if (av) {
          if (pic) {
            av.style.background = 'transparent';
            av.innerHTML = `<img src="${pic}" alt="${initial}" style="width:100%;height:100%;border-radius:inherit;object-fit:cover;display:block"/>`;
          } else {
            av.innerHTML = initial;
            av.style.background = color;
          }
        }

        document.getElementById('profile-name').textContent  = name;
        document.getElementById('profile-email').textContent = isOwnProfile ? email : '';

        // Stats
        document.getElementById('stat-posts').textContent     = profileData?.postCount     ?? 0;
        document.getElementById('stat-followers').textContent = profileData?.followerCount  ?? 0;
        document.getElementById('stat-following').textContent = profileData?.followingCount ?? 0;

        // Likes — only show on own profile
        const likesEl = document.getElementById('stat-likes');
        if (likesEl) {
          if (isOwnProfile) {
            const liked = posts.reduce((n, p) => n + (p.likes && p.likes.includes(currentUser.id) ? 1 : 0), 0);
            likesEl.textContent = liked;
            likesEl.closest('.stat').style.display = '';
          } else {
            likesEl.closest('.stat').style.display = 'none';
          }
        }

        // Actions
        const actionsEl = document.getElementById('profile-actions');
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
          actionsEl.innerHTML = `
            <button class="btn ${isFollowing ? 'btn-outline' : 'btn-primary'}"
              style="font-size:13px;padding:8px 24px;border-radius:20px"
              data-following="${isFollowing}"
              onclick="toggleFollow(${targetId}, this)">
              ${isFollowing ? 'Following' : 'Follow'}
            </button>`;
        }

        // Section label
        const labelEl = document.getElementById('profile-posts-label');
        if (labelEl) labelEl.textContent = isOwnProfile ? 'My Posts' : `${name}'s Posts`;

        // Posts
        const feedEl = document.getElementById('profile-feed');
        feedEl.innerHTML = `<div style="text-align:center;padding:32px;color:var(--txt2)"><div class="spinner" style="margin:0 auto 12px;width:24px;height:24px;border:2.5px solid rgba(124,107,255,.3);border-top-color:var(--accent);border-radius:50%;animation:spin .7s linear infinite"></div><p>Loading…</p></div>`;

        if (isOwnProfile) {
          const userPosts = posts.filter(p => p.userId === targetId);
          const sorted    = [...userPosts].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
          feedEl.innerHTML = sorted.length
            ? sorted.map(p => buildPostCard(p, true)).join('')
            : `<div class="empty"><div class="empty-icon"><svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></div><h3>No posts yet</h3><p>Share your first post!</p></div>`;
        } else {
          try {
            const res    = await api('GET', `/api/posts?profileUserId=${targetId}&page=${feedPage || 1}`);
            const posts2 = res.data?.posts || [];
            feedEl.innerHTML = posts2.length
              ? posts2.map(p => buildPostCard(p, false)).join('')
              : `<div class="empty"><div class="empty-icon"><svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></div><h3>No posts yet</h3><p>Nothing posted yet.</p></div>`;
          } catch (e) {
            feedEl.innerHTML = `<div class="empty"><h3>Could not load posts</h3><p>${e.message}</p></div>`;
          }
        }
      }


      function buildPostCard(post, showDelete = false) {
        const liked = currentUser && post.likes.includes(currentUser.id);
        const reposted =
          currentUser && post.reposts && post.reposts.includes(currentUser.id);
        const canDelete =
          currentUser && (currentUser.id === post.userId || showDelete);
        const color = stringToColor(post.author);
        return `<div class="post-card" data-post-id="${post.id}">
    ${post.isRepost ? `<div class="repost-strip"><svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>${escHtml(post.author)} reposted</div>` : ""}
    <div class="post-head">
      <div class="av" style="background:${post.authorPicture ? "transparent" : color};cursor:pointer" onclick="viewProfile(${post.userId})" title="View profile">${post.authorPicture ? `<img src="${post.authorPicture}" alt="${escHtml(post.author.charAt(0))}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block"/>` : escHtml(post.author.charAt(0))}</div>
      <div class="post-meta"><div class="post-name" onclick="viewProfile(${post.userId})" style="cursor:pointer" title="View profile">${escHtml(post.author)}</div><div class="post-time">${formatTime(post.createdAt)}</div></div>
      ${canDelete ? `<button class="post-del" onclick="deletePost(${post.id})"><svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg></button>` : ""}
    </div>
    ${post.text ? `<div class="post-body">${escHtml(post.text)}</div>` : ""}
    ${post.isRepost && post.originalPost ? `<div class="repost-embed"><div class="repost-embed-name">${escHtml(post.originalPost.author)}</div>${post.originalPost.text ? `<div class="repost-embed-text">${escHtml(post.originalPost.text)}</div>` : ""}${post.originalPost.image ? `<img class="repost-embed-img" src="${post.originalPost.image}" loading="lazy"/>` : ""}</div>` : !post.isRepost && post.image ? `<img class="post-img" src="${post.image}" loading="lazy"/>` : ""}
    <div class="post-actions">
      <button class="act-btn like-btn${liked ? " liked" : ""}" onclick="toggleLike(${post.id})">
        <svg fill="${liked ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
        <span>${post.likes.length || ""}</span>
      </button>
      <button class="act-btn" onclick="toggleComments(${post.id})">
        <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
        <span class="comment-count">${post.comments.length || ""}</span>
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

      /* ── PROFILE PICTURE ──────────────────────────────────────── */
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

      /* ── FOLLOW / UNFOLLOW ────────────────────────────────────── */
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

      /**/

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
      /* ── SEARCH ───────────────────────────────────────────────── */
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
        searchTimer = setTimeout(() => runSearch(q), 280);
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
          box.innerHTML = data
            .map((post) => {
              const color = stringToColor(post.author);
              const avHtml = post.authorPicture
                ? `<img src="${post.authorPicture}" alt="${escHtml(post.author.charAt(0))}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block"/>`
                : escHtml(post.author.charAt(0));
              return `<div class="post-card" style="cursor:default">
        <div class="post-head">
          <div class="av" style="background:${post.authorPicture ? "transparent" : color}">${avHtml}</div>
          <div class="post-meta"><div class="post-name">${highlight(post.author, q)}</div><div class="post-time">${formatTime(post.createdAt)}</div></div>
        </div>
        ${post.text ? `<div class="post-body">${highlight(post.text, q)}</div>` : ""}
        ${post.image ? `<img class="post-img" src="${post.image}" loading="lazy"/>` : ""}
        <div class="post-actions" style="padding:8px 12px;gap:14px;font-size:12px;color:var(--txt2)">
          <span>❤️ ${post.likeCount || 0}</span><span>💬 ${post.commentCount || 0}</span><span>🔁 ${post.repostCount || 0}</span>
        </div>
      </div>`;
            })
            .join("");
        } else {
          box.innerHTML = data
            .map((user) => {
              const color = stringToColor(user.name);
              const avHtml = user.picture
                ? `<img src="${user.picture}" alt="${escHtml(user.name.charAt(0))}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block"/>`
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

      /* ── NOTIFICATIONS ────────────────────────────────────────── */
      let notifPollTimer = null;

      const NOTIF_ICONS = {
        like: `<svg fill="currentColor" viewBox="0 0 24 24" width="16" height="16"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>`,
        comment: `<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="16" height="16"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>`,
        repost: `<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="16" height="16"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>`,
        follow: `<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="16" height="16"><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>`,
      };
      const NOTIF_COPY = {
        like: (name) => `<strong>${escHtml(name)}</strong> liked your post`,
        comment: (name) =>
          `<strong>${escHtml(name)}</strong> commented on your post`,
        repost: (name) =>
          `<strong>${escHtml(name)}</strong> reposted your post`,
        follow: (name) =>
          `<strong>${escHtml(name)}</strong> started following you`,
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
        list.innerHTML = notifs
          .map((n) => {
            const color = stringToColor(n.actorName || "?");
            const avHtml = n.actorPicture
              ? `<img src="${n.actorPicture}" alt="${escHtml((n.actorName || "?").charAt(0))}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block"/>`
              : escHtml((n.actorName || "?").charAt(0));
            return `<div class="notif-item${n.isRead ? "" : " unread"}" onclick="onNotifClick(${n.id}, ${n.postId || "null"})">
      <div class="av sm" style="background:${n.actorPicture ? "transparent" : color}">${avHtml}</div>
      <div class="notif-body">
        <div class="notif-text">${(NOTIF_COPY[n.type] || NOTIF_COPY.like)(n.actorName || "Someone")}</div>
        ${n.postSnippet ? `<div class="notif-snippet">"${escHtml(n.postSnippet)}"</div>` : ""}
        <div class="notif-time">${formatTime(n.createdAt)}</div>
      </div>
      <div class="notif-icon ${n.type}">${NOTIF_ICONS[n.type] || ""}</div>
      ${!n.isRead ? '<div class="notif-dot"></div>' : ""}
    </div>`;
          })
          .join("");
      }

      async function onNotifClick(notifId, postId) {
        try {
          await api("PUT", `/api/notifications/${notifId}/read`);
        } catch (e) {
          /* silent */
        }
        closeNotifPanel();
        goTo("feed");
        if (postId) {
          setTimeout(() => {
            const card = document.querySelector(`[data-post-id="${postId}"]`);
            if (card)
              card.scrollIntoView({ behavior: "smooth", block: "center" });
          }, 400);
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

      /* ── HELPERS ──────────────────────────────────────────────── */

      /* -- REPORT POST -------------------------------------------- */
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

      /* ── SUGGESTED USERS ──────────────────────────────────────── */
      let _suggestionsLoaded = false;

      async function loadSuggestions(force = false) {
        if (!currentUser) return;
        if (_suggestionsLoaded && !force) return;

        const section = document.getElementById("suggestions-section");
        const listEl = document.getElementById("suggestions-list");
        const refreshBtn = document.getElementById("sug-refresh-btn");

        if (!section || !listEl) return;
        section.style.display = "block";

        // Skeleton loading placeholders
        listEl.innerHTML = [1, 2, 3, 4]
          .map(
            () =>
              '<div class="sug-skeleton">' +
              '<div class="sug-skel-av"></div>' +
              '<div class="sug-skel-line" style="width:80%"></div>' +
              '<div class="sug-skel-line" style="width:55%"></div>' +
              '<div class="sug-skel-btn"></div>' +
              "</div>",
          )
          .join("");

        if (refreshBtn) {
          refreshBtn.classList.add("spinning");
          refreshBtn.disabled = true;
        }

        try {
          const res = await api(
            "GET",
            "/api/recommendations?userId=" + currentUser.id + "&limit=10",
          );
          const users = res.data || [];

          if (!users.length) {
            listEl.innerHTML =
              '<div class="suggestions-empty">' +
              '<svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" width="28" height="28" style="margin:0 auto 8px;display:block;color:var(--txt3)">' +
              '<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>' +
              '<path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>' +
              "Interact with posts to get suggestions!</div>";
          } else {
            listEl.innerHTML = users
              .map((u) => buildSuggestionCard(u))
              .join("");
          }
          _suggestionsLoaded = true;
        } catch (e) {
          listEl.innerHTML =
            '<div class="suggestions-empty" style="color:var(--rose)">Could not load suggestions.</div>';
          console.error("Suggestions error:", e);
        } finally {
          if (refreshBtn) {
            refreshBtn.classList.remove("spinning");
            refreshBtn.disabled = false;
          }
        }
      }

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

      /* ── BOOT ─────────────────────────────────────────────────── */
      (function boot() {
        applyTheme(localStorage.getItem("circle_theme") || "dark");
        try {
          const s = localStorage.getItem("circle_user");
          if (s) setCurrentUser(JSON.parse(s));
        } catch (e) {
          localStorage.removeItem("circle_user"); }

        // Per-page initialisation
        const page = window.location.pathname.split("/").pop() || "index.html";

        if (page === "index.html" || page === "" || page === "/") {
          loadPosts();
        }
        if (page === "profile.html") {
          const viewUserId = sessionStorage.getItem("circle_view_user");
          if (viewUserId) {
            const br = document.getElementById("profile-back-row");
            if (br) br.style.display = "block";
            renderProfile(parseInt(viewUserId));
          } else {
            const br = document.getElementById("profile-back-row");
            if (br) br.style.display = "none";
            renderProfile();
          }
        }
        if (page === "settings.html") { populateSettings(); }
        if (page === "search.html")   { renderSearchHint(); }
      })();
