// ── Suggestions & New Members Component ─────────────────────────────────────
// loadSuggestions, buildFeedSugCard, loadNewMembers, buildFeedNewCard.

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
          console.error("Suggestions error:", e);
        }
      }

      /* ═══════════════════ EXPLORE ═══════════════════════════ */

      /* ═══════════════════ NEW MEMBERS ═══════════════════════ */
      let _newMembers       = [];
      let _newMembersLoaded = false;
      let _feedNewDismissed = false;

      function _joinedAgo(dateStr) {
        const d    = new Date(dateStr);
        const diff = Math.floor((Date.now() - d.getTime()) / 86400000);
        if (diff === 0) return "Joined today";
        if (diff === 1) return "Joined yesterday";
        return `Joined ${diff}d ago`;
      }

      async function loadNewMembers(force = false) {
        if (!currentUser) return;
        if (_newMembersLoaded && !force) return;
        try {
          const res    = await api("GET", "/api/users/new-members?limit=10");
          _newMembers  = (res.data || []).filter(u => u.id !== currentUser.id);
          _newMembersLoaded = true;

          // Inject into feed if already rendered and not dismissed
          if (!_feedNewDismissed && _newMembers.length) {
            const feedList   = document.getElementById("feed-list");
            if (feedList && !document.getElementById("feed-new-inline")) {
              const postCards = feedList.querySelectorAll(".post-card");
              if (postCards.length >= 8) {
                const temp = document.createElement("div");
                temp.innerHTML = buildFeedNewCard();
                postCards[7].insertAdjacentElement("afterend", temp.firstElementChild);
              }
            }
          }

          // Update explore section
          loadExploreNewMembers();
        } catch (e) {
          console.error("New members error:", e);
        }
      }

      function buildFeedNewCard() {
        if (!_newMembers.length) return "";
        const pills = _newMembers.map(u => {
          const initial = (u.name || "?").charAt(0).toUpperCase();
          const color   = stringToColor(u.name || "");
          const avBg    = u.picture ? "transparent" : color;
          const avInner = u.picture
            ? `<img src="${escHtml(u.picture)}" alt="${initial}" loading="lazy" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block"/>`
            : initial;
          return `<div class="feed-new-pill" onclick="viewProfile(${u.id})">
            <span class="feed-new-badge">NEW</span>
            <div class="sug-av" style="background:${avBg}">${avInner}</div>
            <div class="feed-new-pill-name" title="${escHtml(u.name)}">${escHtml(u.name)}</div>
            <div class="feed-new-pill-joined">${_joinedAgo(u.createdAt)}</div>
            <button class="feed-new-pill-btn" onclick="event.stopPropagation();feedNewFollow(${u.id},this)">Welcome</button>
          </div>`;
        }).join("");

        return `<div class="feed-new-card" id="feed-new-inline">
          <div class="feed-new-header">
            <span class="feed-new-title">🆕 New to Circle</span>
            <span class="feed-new-dismiss" onclick="dismissFeedNew()">✕ Got it</span>
          </div>
          <p class="feed-new-tagline">Say hello to people who just joined!</p>
          <div class="feed-new-scroll">${pills}</div>
        </div>`;
      }

      function dismissFeedNew() {
        _feedNewDismissed = true;
        const el = document.getElementById("feed-new-inline");
        if (el) {
          el.style.cssText += ";transition:opacity .25s,max-height .3s;opacity:0;max-height:0;overflow:hidden;margin:0;padding:0;border:none";
          setTimeout(() => el.remove(), 320);
        }
      }

      async function feedNewFollow(userId, btn) {
        if (!currentUser) { showToast("Log in to follow."); goTo("login"); return; }
        btn.disabled = true;
        try {
          await api("POST", "/api/follow/" + userId);
          btn.textContent = "Following!";
          btn.classList.add("following");
          showToast("Welcome them to Circle! 🎉");
          const pill = btn.closest(".feed-new-pill");
          if (pill) {
            pill.style.cssText += ";transition:opacity .3s,transform .3s;opacity:0;transform:scale(.85)";
            setTimeout(() => {
              pill.remove();
              _newMembers = _newMembers.filter(u => u.id !== userId);
              if (!document.querySelectorAll(".feed-new-pill").length) dismissFeedNew();
            }, 300);
          }
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
            const res = await api("GET", "/api/users/new-members?limit=10");
            members   = (res.data || []).filter(u => u.id !== currentUser?.id);
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
              <button class="explore-person-follow" onclick="event.stopPropagation();exploreNewFollow(${u.id},this)" style="background:var(--green);border-color:var(--green)">Welcome</button>
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
          btn.textContent = "Following!";
          btn.style.opacity = "0.7";
          showToast("Welcome them to Circle! 🎉");
          _newMembers = _newMembers.filter(u => u.id !== userId);
        } catch (e) {
          showToast("Error: " + e.message);
          btn.disabled = false;
        }
      }
      /* ═══════════════════ END NEW MEMBERS ════════════════════ */

