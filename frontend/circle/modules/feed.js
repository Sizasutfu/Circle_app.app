// ── Feed View ───────────────────────────────────────────────────────────────
// Compose tab (mobile sheet) wiring. Delegates bulk logic to modules/feed.js.

      function openComposeTab() {
        // Remember where we came from
        const active = document.querySelector(".view.active");
        _composePrevView = active ? active.id.replace("view-", "") : "feed";

        // Set avatar
        const av = document.getElementById("compose-tab-av");
        if (av && currentUser) {
          if (currentUser.picture) {
            av.innerHTML = `<img src="${currentUser.picture}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block"/>`;
            av.style.background = "transparent";
          } else {
            av.textContent = (currentUser.name || "?").charAt(0).toUpperCase();
            av.style.background = stringToColor(currentUser.name || "");
          }
        }

        // Reset state
        document.getElementById("compose-tab-text").value = "";
        document.getElementById("compose-tab-char-count").textContent = "";
        removeComposeTabMedia();
        document.getElementById("compose-tab-submit").disabled = false;
        document.getElementById("compose-tab-submit").textContent = "Post";

        goTo("compose");
        setTimeout(() => document.getElementById("compose-tab-text").focus(), 150);
      }

      function closeComposeTab() {
        removeComposeTabMedia();
        goTo(_composePrevView);
      }

      function composeTabInput(el) {
        const len = el.value.length;
        const MAX = 280;
        const counter = document.getElementById("compose-tab-char-count");
        if (len === 0) {
          counter.textContent = "";
          counter.className = "compose-tab-char-count";
        } else {
          counter.textContent = `${len} / ${MAX}`;
          counter.className = "compose-tab-char-count" + (len > MAX ? " over" : len > MAX * 0.85 ? " warn" : "");
        }
      }

      function composeTabPreviewImage(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
          _composeTabPendingImage = e.target.result;
          _composeTabPendingVideo = null;
          const img = document.getElementById("compose-tab-img-preview");
          const vid = document.getElementById("compose-tab-video-preview");
          img.src = e.target.result;
          img.style.display = "block";
          vid.style.display = "none";
          vid.src = "";
          document.getElementById("compose-tab-media-preview").style.display = "block";
        };
        reader.readAsDataURL(file);
      }

      function composeTabPreviewVideo(event) {
        const file = event.target.files[0];
        if (!file) return;
        if (file.size > 50 * 1024 * 1024) { showToast("Video must be under 50 MB."); return; }
        const reader = new FileReader();
        reader.onload = (e) => {
          _composeTabPendingVideo = e.target.result;
          _composeTabPendingImage = null;
          const vid = document.getElementById("compose-tab-video-preview");
          const img = document.getElementById("compose-tab-img-preview");
          vid.src = e.target.result;
          vid.style.display = "block";
          img.style.display = "none";
          img.src = "";
          document.getElementById("compose-tab-media-preview").style.display = "block";
        };
        reader.readAsDataURL(file);
      }

      function removeComposeTabMedia() {
        _composeTabPendingImage = null;
        _composeTabPendingVideo = null;
        const img = document.getElementById("compose-tab-img-preview");
        const vid = document.getElementById("compose-tab-video-preview");
        if (img) { img.src = ""; img.style.display = "none"; }
        if (vid) { vid.pause(); vid.src = ""; vid.style.display = "none"; }
        const wrap = document.getElementById("compose-tab-media-preview");
        if (wrap) wrap.style.display = "none";
        const ii = document.getElementById("compose-tab-img-input");
        const vi = document.getElementById("compose-tab-video-input");
        if (ii) ii.value = "";
        if (vi) vi.value = "";
      }

      async function createPostFromTab() {
        if (!currentUser) return;
        const text = document.getElementById("compose-tab-text").value.trim();
        if (!text && !_composeTabPendingImage && !_composeTabPendingVideo) {
          showToast("Write something or add a photo/video!");
          return;
        }
        const btn = document.getElementById("compose-tab-submit");
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span>';
        try {
          const res = await api("POST", "/api/posts", {
            text,
            image: _composeTabPendingImage || null,
            video: _composeTabPendingVideo || null,
          });
          const newPost = res.data;
          PostCache.putPost(newPost);
          PostCache.invalidateFeed(currentFeedTab);
          posts.unshift(newPost);
          renderFeed();
          showToast("Posted! ✨");
          closeComposeTab();
        } catch (e) {
          showToast("Error: " + e.message);
          btn.disabled = false;
          btn.textContent = "Post";
        }
      }

      function togglePw(fieldId, btn) {
