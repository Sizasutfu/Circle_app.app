// ── Trending Component ──────────────────────────────────────────────────────
// extractTrending, renderTrending, applyFilter, loadTrending from API.

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
        if (!_feedNewDismissed && currentUser && _newMembers.length && parts.length >= 8) parts.splice(8, 0, buildFeedNewCard());
        c.innerHTML = parts.join("");
      }

