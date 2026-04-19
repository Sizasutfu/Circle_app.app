// ── main.js — Bootstrap ─────────────────────────────────────────────────────
// Initialises PostCache, restores session, wires listeners, boots the app.
// Also owns: post detail view, lazy-load IO, mobile nav hide on scroll.

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


/* ── Post Detail ── */

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
          posts.find((p) => p.id === postId) || PostCache.getPost(postId);
        if (!post) return;

        renderPostDetail(post);
        goTo("post-detail");
      }

      function closePostDetail() {
        goTo(_postDetailPrevView);
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
                  ${post.originalPost.image ? `<img class="post-detail-img" src="${post.originalPost.image}" loading="lazy" onclick="event.stopPropagation()"/>` : ""}
                </div>`
                : post.video
                  ? `<div class="post-video-wrap" onclick="openVideoLightbox(this, collectFeedVideos())" data-lb-video="${post.video}" data-lb-name="${escHtml(post.author)}" data-lb-picture="${escHtml(post.authorPicture || '')}" data-lb-user-id="${post.userId}" data-lb-post-id="${post.id}" data-lb-caption="${escHtml(post.text || '')}" title="Watch video"><video src="${post.video}" preload="metadata" playsinline muted></video><div class="post-video-play-btn"><svg viewBox="0 0 56 56" xmlns="http://www.w3.org/2000/svg"><circle cx="28" cy="28" r="28" fill="rgba(0,0,0,0.45)"/><polygon points="22,16 42,28 22,40" fill="white"/></svg></div></div>`
                  : post.image
                  ? `<img class="post-detail-img lb-thumb" src="${post.image}" loading="lazy" onclick="openLightbox(this,collectFeedImages())" data-lb-name="${escHtml(post.author)}" data-lb-picture="${escHtml(post.authorPicture || "")}" data-lb-user-id="${post.userId}" data-lb-post-id="${post.id}" data-lb-caption="${escHtml(post.text || "")}"/>`
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

        // Assign stable IDs to top-level comments so replies can reference them
        const topLevel = comments.filter(c => c.parentCommentId === undefined || c.parentCommentId === null || c.parentCommentId === "");
        topLevel.forEach((c, i) => { if (c._idx === undefined) c._idx = i; });

        const replies = comments.filter(c => c.parentCommentId !== undefined && c.parentCommentId !== null && c.parentCommentId !== "");

        function buildAvatar(c, size) {
          const col = stringToColor(c.author);
          const inner = c.authorPicture
            ? `<img src="${escHtml(c.authorPicture)}" alt="${escHtml(c.author.charAt(0))}" loading="lazy" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block"/>`
            : escHtml(c.author.charAt(0));
          return `<div class="av${size === "xs" ? " xs" : " sm"}" style="background:${c.authorPicture ? "transparent" : col};flex-shrink:0">${inner}</div>`;
        }

        function buildReplyBtn(c, idx) {
          return `<button class="comment-reply-btn" data-author="${escHtml(c.author)}" data-idx="${idx}" onclick="startReplyTo(this.dataset.author, parseInt(this.dataset.idx))">
            <svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 00-4-4H4"/></svg>
            Reply
          </button>`;
        }

        const totalCount = comments.length;

        const items = topLevel.map((c, idx) => {
          const children = replies.filter(r => parseInt(r.parentCommentId) === idx);

          const nestedHtml = children.length
            ? `<div class="nested-replies">${children.map(r => `
              <div class="nested-reply-item">
                ${buildAvatar(r, "xs")}
                <div class="post-detail-comment-bubble" style="flex:1">
                  <div class="post-detail-comment-name">${escHtml(r.author)}</div>
                  <div class="post-detail-comment-text">${escHtml(r.text)}</div>
                  ${r.createdAt ? `<div class="post-detail-comment-time">${formatTime(r.createdAt)}</div>` : ""}
                </div>
              </div>`).join("")}</div>`
            : "";

          return `<div class="post-detail-comment-item">
            ${buildAvatar(c, "sm")}
            <div class="post-detail-comment-content">
              <div class="post-detail-comment-bubble">
                <div class="post-detail-comment-name">${escHtml(c.author)}</div>
                <div class="post-detail-comment-text">${escHtml(c.text)}</div>
              </div>
              ${c.createdAt ? `<div class="post-detail-comment-time">${formatTime(c.createdAt)}</div>` : ""}
              ${buildReplyBtn(c, idx)}
              ${nestedHtml}
            </div>
          </div>`;
        }).join("");

        section.innerHTML = `<div class="post-detail-comments-section">
          <div class="post-detail-comments-title">Replies (${totalCount})</div>
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
          posts.find((p) => p.id === postId) || PostCache.getPost(postId);
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

        // Get parent comment index if replying to a specific comment
        const parentCommentId = input.dataset.parentCommentId !== undefined && input.dataset.parentCommentId !== ""
          ? parseInt(input.dataset.parentCommentId)
          : undefined;

        try {
          const body = { userId: currentUser.id, text };
          if (parentCommentId !== undefined) body.parentCommentId = parentCommentId;

          await api("POST", `/api/posts/${postId}/comment`, body);
          input.value = "";
          cancelReply();

          const post =
            posts.find((p) => p.id === postId) || PostCache.getPost(postId);
          if (post) {
            post.comments = post.comments || [];
            const newComment = {
              author: currentUser.name,
              authorPicture: currentUser.picture || "",
              text,
              userId: currentUser.id,
              createdAt: new Date().toISOString(),
            };
            if (parentCommentId !== undefined) newComment.parentCommentId = parseInt(parentCommentId);
            post.comments.push(newComment);
            renderPostDetailComments(post);
            const stat = document.querySelector(
              "#post-detail-content .post-detail-stat:last-child strong",
            );
            if (stat) stat.textContent = (post.comments && post.comments.length) || 0;
          }
          showToast("Reply posted! 💬");
        } catch (e) {
          showToast("Failed to post reply: " + e.message);
        }
      }

      function startReplyTo(authorName, commentIdx) {
        const input = document.getElementById("post-detail-reply-input");
        const banner = document.getElementById("reply-to-banner");
        const label = document.getElementById("reply-to-label");

        input.dataset.parentCommentId = commentIdx;
        label.innerHTML = `Replying to <strong>${escHtml(authorName)}</strong>`;
        banner.style.display = "flex";
        input.placeholder = `Reply to ${authorName}…`;
        input.focus();
      }

      function cancelReply() {
        const input = document.getElementById("post-detail-reply-input");
        const banner = document.getElementById("reply-to-banner");
        delete input.dataset.parentCommentId;
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

/* ── Lazy-load Intersection Observer ── */
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
   
