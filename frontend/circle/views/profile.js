// ── Profile View ────────────────────────────────────────────────────────────
// renderProfile, viewProfile, toggleFollow.

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
      <div class="post-menu-wrap" onclick="event.stopPropagation()">
        <button class="post-menu-btn" onclick="togglePostMenu(event,${post.id})" title="More options">⋯</button>
        <div class="post-dropdown" id="post-menu-${post.id}">
          ${!canDelete ? `<button class="post-dropdown-item" onclick="postMenuFollow(${post.userId},${post.id})">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
            Follow
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
    ${post.isRepost && post.originalPost ? `<div class="repost-embed" style="cursor:pointer" onclick="event.stopPropagation();openOriginalPost(${post.originalPost.id})" title="View original post by ${escHtml(post.originalPost.author)}"><div class="repost-embed-name">${escHtml(post.originalPost.author)}</div>${post.originalPost.text ? `<div class="repost-embed-text">${escHtml(post.originalPost.text)}</div>` : ""}${post.originalPost.image ? `<img class="repost-embed-img lb-thumb" src="${post.originalPost.image}" loading="lazy" data-lb-name="${escHtml(post.originalPost.author)}" data-lb-picture="${escHtml(post.originalPost.authorPicture || "")}" data-lb-user-id="${post.originalPost.userId || ""}" data-lb-post-id="${post.id}" data-lb-caption="${escHtml(post.text || "")}" onclick="event.stopPropagation();openLightbox(this,collectFeedImages())" title="View full image"/>` : ""}</div>` : !post.isRepost && post.video ? `<div class="post-video-wrap" onclick="openVideoLightbox(this, collectFeedVideos())" data-lb-video="${post.video}" data-lb-name="${escHtml(post.author)}" data-lb-picture="${escHtml(post.authorPicture || '')}" data-lb-user-id="${post.userId}" data-lb-post-id="${post.id}" data-lb-caption="${escHtml(post.text || '')}" title="Watch video"><video src="${post.video}" preload="metadata" playsinline muted></video><div class="post-video-play-btn"><svg viewBox="0 0 56 56" xmlns="http://www.w3.org/2000/svg"><circle cx="28" cy="28" r="28" fill="rgba(0,0,0,0.45)"/><polygon points="22,16 42,28 22,40" fill="white"/></svg></div></div>` : !post.isRepost && post.image ? `<img class="post-img lb-thumb" src="${post.image}" loading="lazy" data-lb-name="${escHtml(post.author)}" data-lb-picture="${escHtml(post.authorPicture || "")}" data-lb-user-id="${post.userId}" data-lb-post-id="${post.id}" data-lb-caption="${escHtml(post.text || "")}" onclick="openLightbox(this,collectFeedImages())" title="View full image"/>` : ""}
    <div class="post-actions">
      <button class="act-btn like-btn${liked ? " liked" : ""}" data-post-id="${post.id}" onclick="toggleLike(${post.id})">
        <svg fill="${liked ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
        <span>${(post.likes && post.likes.length) || ""}</span>
      </button>
      <button class="act-btn" onclick="toggleComments(${post.id})">
        <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
        <span class="comment-count">${(post.comments && post.comments.length) || ""}</span>
      </button>
      ${!post.isRepost ? `<button class="act-btn repost-btn${reposted ? " reposted" : ""}" onclick="openRepostModal(${post.id})"><svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg><span>${post.reposts ? post.reposts.length || "" : ""}</span></button>` : ""}
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
