// ── Messages View ───────────────────────────────────────────────────────────
// Thin wiring layer — delegates to modules/dm.js (DM object).

      /* DM UI helpers */
      function dmFilterInbox() {
        DM.filterInbox();
      }
      function dmSendMessage() {
        DM.sendMessage();
      }
      function dmAutoResize(el) {
        el.style.height = "auto";
        el.style.height = Math.min(el.scrollHeight, 120) + "px";
      }
      function dmSendOnEnter(e) {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          DM.sendMessage();
        }
      }
      function dmBackToInbox() {
        document.getElementById("dm-inbox").classList.remove("hidden-mobile");
        document.getElementById("dm-chat").classList.remove("visible-mobile");
      }

      /* New DM modal */
      let _dmSearchDebounce = null;
      function openNewDMModal() {
        if (!currentUser) { goTo("login"); return; }
        document.getElementById("dm-new-modal").classList.add("open");
        document.getElementById("dm-new-search").value = "";
        document.getElementById("dm-new-results").innerHTML =
          '<div class="dm-new-empty">Search for someone to message</div>';
        setTimeout(() => document.getElementById("dm-new-search").focus(), 80);
      }
      function closeNewDMModal() {
        document.getElementById("dm-new-modal").classList.remove("open");
      }
      function dmSearchPeople() {
        const q   = document.getElementById("dm-new-search").value.trim();
        const res = document.getElementById("dm-new-results");
        if (!q) {
          res.innerHTML = '<div class="dm-new-empty">Search for someone to message</div>';
          return;
        }
        clearTimeout(_dmSearchDebounce);
        res.innerHTML = '<div class="dm-new-empty">Searching…</div>';
        _dmSearchDebounce = setTimeout(async () => {
          try {
            const data  = await api("GET", `/api/users?search=${encodeURIComponent(q)}&limit=8`);
            let users   = Array.isArray(data.data) ? data.data : (Array.isArray(data) ? data : []);
            users       = users.filter(u => u.id !== currentUser.id).slice(0, 8);
            if (!users.length) { res.innerHTML = '<div class="dm-new-empty">No users found</div>'; return; }
            res.innerHTML = users.map(u => {
              const initial = (u.name || "?").charAt(0).toUpperCase();
              const color   = stringToColor(u.name || "");
              const avHtml  = u.picture
                ? `<div class="av sm" style="background:transparent;overflow:hidden;flex-shrink:0"><img src="${u.picture}" loading="lazy" style="width:100%;height:100%;object-fit:cover;border-radius:50%" alt="${initial}"/></div>`
                : `<div class="av sm" style="background:${color};flex-shrink:0">${initial}</div>`;
              return `<div class="dm-new-result" data-user="${escHtml(JSON.stringify(u))}" onclick="dmPickUser(this)">
                ${avHtml}
                <div class="dm-new-result-info">
                  <div class="dm-new-result-name">${escHtml(u.name || "")}</div>
                  <div class="dm-new-result-email">${escHtml(u.email || "")}</div>
                </div>
              </div>`;
            }).join("");
          } catch (e) {
            res.innerHTML = '<div class="dm-new-empty">Search failed — try again</div>';
          }
        }, 300);
      }
      function dmPickUser(el) {
        try {
          const u = JSON.parse(el.dataset.user);
          closeNewDMModal();
          DM.startConvWithUser(u);
        } catch (e) { console.error("dmPickUser error:", e); }
      }

