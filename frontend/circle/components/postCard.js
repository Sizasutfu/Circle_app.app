// ── Post Card Component ─────────────────────────────────────────────────────
// buildPostCard(), post three-dot menu, like/repost/delete actions.

/* ── Post three-dot menu ── */
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

      function postMenuFollow(userId, postId) {
        closePostMenu(postId);
        if (!currentUser) { showToast("Log in to follow people."); goTo("login"); return; }
        api("POST", "/api/follow/" + userId)
          .then(() => showToast("Following! 🎉"))
          .catch(e => showToast("Error: " + e.message));
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


/* ── Report Post ── */
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

/* ── Build Post Card HTML ── */
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


