// ── Explore View ────────────────────────────────────────────────────────────
// loadExplorePeople, loadExploreTrending. Delegates new-members to suggestions.

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
