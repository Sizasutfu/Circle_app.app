// ── Feed Module ─────────────────────────────────────────────────────────────
// loadPosts, fetchMorePosts, scroll sentinel, createPost, like/comment/repost.

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
        if (!text && !pendingImageDataUrl && !pendingVideoDataUrl) {
          showToast("Write something or add a photo/video!");
          return;
        }
        const btn = document.getElementById("post-submit-btn");
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span>';
        try {
          const res = await api("POST", "/api/posts", {
            text,
            image: pendingImageDataUrl || null,
            video: pendingVideoDataUrl || null,
          });
          const newPost = res.data;
          // ── Cache: store new post and invalidate stale feed pages ───
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

      /* IMAGE & VIDEO */
      function previewImage(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
          pendingImageDataUrl = e.target.result;
          pendingVideoDataUrl = null;
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
        if (file.size > 50 * 1024 * 1024) {
          showToast("Video must be under 50 MB.");
          return;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
          pendingVideoDataUrl = e.target.result;
          pendingImageDataUrl = null;
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
        // Inject new members card after 8th post if not dismissed
        if (!_feedNewDismissed && currentUser && _newMembers.length && parts.length >= 8) {
          parts.splice(8, 0, buildFeedNewCard());
        }
        c.innerHTML = parts.join("");
      }

