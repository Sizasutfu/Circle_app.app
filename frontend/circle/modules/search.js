// ── Search Module ───────────────────────────────────────────────────────────
// Search logic: posts and people tabs, debounce, highlight.

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
        const stSection = document.getElementById("search-trending-section");
        if (q.length < 2) {
          if (stSection) stSection.style.display = "block";
          renderSearchHint();
          return;
        }
        if (stSection) stSection.style.display = "none";
        searchTimer = setTimeout(function() { runSearch(q); }, 400);
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
