// ── Notifications Module ────────────────────────────────────────────────────
// Polling, badge count, panel render, markAllRead.

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

