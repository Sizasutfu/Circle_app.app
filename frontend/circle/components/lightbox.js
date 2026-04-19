// ── Lightbox Component ──────────────────────────────────────────────────────
// openLightbox, closeLightbox, zoom/pan, keyboard nav, swipe.

      /* ═══════════════════════════════════════════
         LIGHTBOX — image viewer
      ═══════════════════════════════════════════ */

      /* ── State ── */
      let _lbImages = [],
        _lbIndex = 0,
        _lbScale = 1,
        _lbOrigin = null;
      let _lbDragStartX = 0,
        _lbDragStartY = 0,
        _lbTranslateX = 0,
        _lbTranslateY = 0;
      let _lbPinchStartDist = 0,
        _lbPointers = new Map();
      let _lbSwipeStartX = 0,
        _lbSwiping = false,
        _lbAnimating = false;
      let _lbIsVideo = false; // true when lightbox is showing a video
      let _lbMeta = []; // [{name, picture, userId}] parallel to _lbImages
      let _lbPostId = null; // post id for the current lightbox item (for like/comment/repost)

      /* ── Render profile chip ── */
      function _lbRenderProfile(idx) {
        const meta = _lbMeta[idx] || {};
        const chip = document.getElementById("lb-profile");
        const av = document.getElementById("lb-profile-av");
        const nm = document.getElementById("lb-profile-name");
        if (!meta.name) {
          chip.style.display = "none";
        } else {
          nm.textContent = meta.name;
          // Parse to number so strict equality works in viewProfile/renderProfile
          const uid = meta.userId ? parseInt(meta.userId, 10) : null;
          chip.onclick = function () {
            closeLightbox();
            // Wait for the lightbox fade-out (180ms) before navigating
            if (uid)
              setTimeout(function () {
                viewProfile(uid);
              }, 200);
          };
          if (meta.picture) {
            av.innerHTML =
              '<img src="' +
              meta.picture +
              '" alt="' +
              escHtml(meta.name.charAt(0)) +
              '" loading="lazy" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block"/>';
            av.style.background = "transparent";
          } else {
            av.innerHTML = escHtml(meta.name.charAt(0).toUpperCase());
            av.style.background = stringToColor(meta.name);
          }
          chip.style.display = "flex";
          chip.style.animation = "none";
          chip.offsetHeight;
          chip.style.animation =
            "lbFadeSlideDown 0.3s cubic-bezier(0.34,1.4,0.64,1) both";
        }

        // ── Caption ──
        const captionEl = document.getElementById("lb-caption");
        if (captionEl) {
          const cap = meta.caption || "";
          if (cap) {
            captionEl.textContent = cap;
            captionEl.style.display = "block";
          } else {
            captionEl.style.display = "none";
          }
        }

        // ── Action buttons (like / comment / repost) ──
        _lbPostId = meta.postId || null;
        _lbUpdateActions();
      }

      /* ── Update lightbox action counts and liked state ── */
      function _lbUpdateActions() {
        const actionsEl = document.getElementById("lb-actions");
        if (!actionsEl) return;
        if (!_lbPostId) {
          actionsEl.style.display = "none";
          return;
        }
        actionsEl.style.display = "flex";

        const post = PostCache.getPost(_lbPostId) || posts.find(p => p.id === _lbPostId);
        if (!post) return;

        const liked = currentUser && Array.isArray(post.likes) && post.likes.includes(currentUser.id);
        const likeBtn = document.getElementById("lb-like-btn");
        const likeIcon = document.getElementById("lb-like-icon");
        const likeCount = document.getElementById("lb-like-count");
        const reposted = currentUser && Array.isArray(post.reposts) && post.reposts.includes(currentUser.id);
        const repostBtn = document.getElementById("lb-repost-btn");

        if (likeBtn) {
          if (liked) {
            likeBtn.classList.add("lb-liked");
            likeBtn.style.background = "rgba(255,95,122,0.35)";
            likeBtn.style.borderColor = "rgba(255,95,122,0.5)";
            likeIcon.setAttribute("fill", "#ff5f7a");
            likeIcon.setAttribute("stroke", "#ff5f7a");
          } else {
            likeBtn.classList.remove("lb-liked");
            likeBtn.style.background = "rgba(255,255,255,0.1)";
            likeBtn.style.borderColor = "rgba(255,255,255,0.15)";
            likeIcon.setAttribute("fill", "none");
            likeIcon.setAttribute("stroke", "currentColor");
          }
        }
        if (likeCount) likeCount.textContent = Array.isArray(post.likes) ? post.likes.length : 0;

        const commentCount = document.getElementById("lb-comment-count");
        if (commentCount) commentCount.textContent = Array.isArray(post.comments) ? post.comments.length : 0;

        const repostCount = document.getElementById("lb-repost-count");
        if (repostCount) repostCount.textContent = Array.isArray(post.reposts) ? post.reposts.length : 0;

        if (repostBtn) {
          if (reposted) {
            repostBtn.style.background = "rgba(34,212,143,0.3)";
            repostBtn.style.color = "#22d48f";
          } else {
            repostBtn.style.background = "rgba(255,255,255,0.1)";
            repostBtn.style.color = "#fff";
          }
        }
      }

      /* ── Lightbox like toggle ── */
      async function lbToggleLike() {
        if (!currentUser) { showToast("Log in to like."); closeLightbox(); goTo("login"); return; }
        if (!_lbPostId) return;
        // Re-use the existing toggleLike machinery if available
        const cardLikeBtn = document.querySelector(`.act-btn[data-post-id="${_lbPostId}"].like-btn`);
        if (cardLikeBtn) {
          cardLikeBtn.click();
          setTimeout(_lbUpdateActions, 300);
          return;
        }
        // Fallback: call API directly
        const post = PostCache.getPost(_lbPostId) || posts.find(p => p.id === _lbPostId);
        if (!post) return;
        const alreadyLiked = Array.isArray(post.likes) && post.likes.includes(currentUser.id);
        try {
          await api("POST", `/api/posts/${_lbPostId}/like`);
          PostCache.patchPost(_lbPostId, p => {
            if (!Array.isArray(p.likes)) p.likes = [];
            if (alreadyLiked) p.likes = p.likes.filter(id => id !== currentUser.id);
            else p.likes.push(currentUser.id);
          });
          const cached = PostCache.getPost(_lbPostId);
          if (cached) {
            const idx = posts.findIndex(p => p.id === _lbPostId);
            if (idx >= 0) posts[idx] = cached;
          }
          _lbUpdateActions();
        } catch (e) { showToast("Error: " + e.message); }
      }

      /* ── Lightbox open comment section ── */
      function lbOpenComments() {
        if (!_lbPostId) return;
        closeLightbox();
        setTimeout(() => {
          // Open the post detail view which shows comments
          const post = PostCache.getPost(_lbPostId) || posts.find(p => p.id === _lbPostId);
          if (post) openPostDetail(_lbPostId);
        }, 200);
      }

      /* ── Lightbox open repost modal ── */
      function lbOpenRepost() {
        if (!_lbPostId) return;
        const post = PostCache.getPost(_lbPostId) || posts.find(p => p.id === _lbPostId);
        if (!post) return;
        closeLightbox();
        setTimeout(() => openRepostModal(post), 200);
      }

      /* ── Open (image) ── */
      function openLightbox(imgEl, allImgsInContext) {
        const images = allImgsInContext || [imgEl.src];
        const idx = images.indexOf(imgEl.src);
        _lbImages = images;
        _lbIsVideo = false; // image mode
        _lbIndex = idx >= 0 ? idx : 0;
        _lbScale = 1;
        _lbTranslateX = 0;
        _lbTranslateY = 0;
        _lbOrigin = imgEl.getBoundingClientRect();

        // Build meta array from data-lb-* attributes on every .lb-thumb in the DOM
        const _allThumbs = document.querySelectorAll(".lb-thumb");
        _lbMeta = images.map(function (src) {
          var found = null;
          _allThumbs.forEach(function (el) {
            if (el.src === src && el.dataset.lbName) found = el;
          });
          if (found)
            return {
              name: found.dataset.lbName,
              picture: found.dataset.lbPicture || null,
              userId: found.dataset.lbUserId || null,
              postId: found.dataset.lbPostId ? parseInt(found.dataset.lbPostId, 10) : null,
              caption: found.dataset.lbCaption || null,
            };
          // fallback: read from the clicked element itself
          if (imgEl.src === src && imgEl.dataset.lbName)
            return {
              name: imgEl.dataset.lbName,
              picture: imgEl.dataset.lbPicture || null,
              userId: imgEl.dataset.lbUserId || null,
              postId: imgEl.dataset.lbPostId ? parseInt(imgEl.dataset.lbPostId, 10) : null,
              caption: imgEl.dataset.lbCaption || null,
            };
          return {};
        });

        const lb = document.getElementById("lightbox");
        const lbImg = document.getElementById("lb-img");
        const lbVid = document.getElementById("lb-video");
        lbVid.style.display = "none";
        lbVid.pause && lbVid.pause();
        lbVid.src = "";
        lbImg.style.display = "";
        lb.style.display = "flex";

        /* hero entry animation from thumbnail position */
        const ox = _lbOrigin.left + _lbOrigin.width / 2 - window.innerWidth / 2;
        const oy =
          _lbOrigin.top + _lbOrigin.height / 2 - window.innerHeight / 2;
        const sx = _lbOrigin.width / window.innerWidth;
        const sy = _lbOrigin.height / window.innerHeight;
        lbImg.style.transition = "none";
        lbImg.style.transform = `translate(${ox}px,${oy}px) scale(${sx},${sy})`;
        lbImg.style.opacity = "0";
        lbImg.src = _lbImages[_lbIndex];
        lbImg.onload = () => {
          requestAnimationFrame(() => {
            lbImg.style.transition =
              "transform 0.38s cubic-bezier(0.34,1.2,0.64,1), opacity 0.22s ease";
            lbImg.style.transform = "translate(0,0) scale(1)";
            lbImg.style.opacity = "1";
          });
        };
        if (lbImg.complete) lbImg.onload();

        document.getElementById("lb-counter").textContent =
          `${_lbIndex + 1} / ${_lbImages.length}`;
        document.getElementById("lb-counter").style.display =
          _lbImages.length > 1 ? "flex" : "none";
        document.getElementById("lb-prev").style.display =
          _lbImages.length > 1 && _lbIndex > 0 ? "flex" : "none";
        document.getElementById("lb-next").style.display =
          _lbImages.length > 1 && _lbIndex < _lbImages.length - 1
            ? "flex"
            : "none";
        _lbRenderProfile(_lbIndex);

        lb.style.opacity = "0";
        lb.style.transition = "opacity 0.18s ease";
        requestAnimationFrame(() => {
          lb.style.opacity = "1";
        });
        document.body.style.overflow = "hidden";
        // auto-hide hint
        const hint = document.getElementById("lb-hint");
        if (hint) {
          hint.style.opacity = "1";
          clearTimeout(hint._t);
          hint._t = setTimeout(() => (hint.style.opacity = "0"), 3000);
        }
      }

      /* ── Open (video) — called from post-video-wrap click ── */
      function openVideoLightbox(wrapEl, allVideoWraps) {
        const videoSrc = wrapEl.dataset.lbVideo;
        if (!videoSrc) return;
        _lbIsVideo = true;

        // Build list from all video wraps in context (enables swipe between videos)
        const wraps = allVideoWraps && allVideoWraps.length ? allVideoWraps : [wrapEl];
        _lbImages = wraps.map(w => w.dataset.lbVideo);
        _lbMeta = wraps.map(w => ({
          name: w.dataset.lbName || null,
          picture: w.dataset.lbPicture || null,
          userId: w.dataset.lbUserId || null,
          postId: w.dataset.lbPostId ? parseInt(w.dataset.lbPostId, 10) : null,
          caption: w.dataset.lbCaption || null,
        }));
        _lbIndex = Math.max(0, _lbImages.indexOf(videoSrc));
        _lbScale = 1;
        _lbTranslateX = 0;
        _lbTranslateY = 0;

        const lb = document.getElementById("lightbox");
        const lbImg = document.getElementById("lb-img");
        const lbVid = document.getElementById("lb-video");

        // Hide image, show video
        lbImg.style.display = "none";
        lbImg.src = "";
        lbVid.style.display = "block";
        lbVid.src = _lbImages[_lbIndex];
        lbVid.style.opacity = "0";
        lbVid.style.transition = "opacity 0.22s ease";

        lb.style.display = "flex";
        lb.style.opacity = "0";
        lb.style.transition = "opacity 0.18s ease";
        requestAnimationFrame(() => {
          lb.style.opacity = "1";
          lbVid.style.opacity = "1";
          lbVid.play().catch(() => {});
        });

        // Show nav controls only when there are multiple videos
        const counter = document.getElementById("lb-counter");
        const prevBtn = document.getElementById("lb-prev");
        const nextBtn = document.getElementById("lb-next");
        if (_lbImages.length > 1) {
          counter.textContent = `${_lbIndex + 1} / ${_lbImages.length}`;
          counter.style.display = "block";
          prevBtn.style.display = _lbIndex > 0 ? "flex" : "none";
          nextBtn.style.display = _lbIndex < _lbImages.length - 1 ? "flex" : "none";
        } else {
          counter.style.display = "none";
          prevBtn.style.display = "none";
          nextBtn.style.display = "none";
        }
        document.getElementById("lb-hint").style.opacity = "0";

        _lbRenderProfile(_lbIndex);
        document.body.style.overflow = "hidden";
      }

      /* ── Navigate to a different video in the lightbox ── */
      function lbGoToVideo(newIdx) {
        if (_lbAnimating || newIdx < 0 || newIdx >= _lbImages.length) return;
        _lbAnimating = true;
        const lbVid = document.getElementById("lb-video");
        lbVid.pause();
        lbVid.style.transition = "opacity 0.18s ease, transform 0.2s ease";
        const dir = newIdx > _lbIndex ? 1 : -1;
        lbVid.style.opacity = "0";
        lbVid.style.transform = `translateX(${-dir * 60}px)`;
        setTimeout(() => {
          _lbIndex = newIdx;
          lbVid.src = _lbImages[_lbIndex];
          lbVid.style.transition = "none";
          lbVid.style.transform = `translateX(${dir * 60}px)`;
          requestAnimationFrame(() => {
            lbVid.style.transition = "opacity 0.22s ease, transform 0.28s cubic-bezier(0.34,1.2,0.64,1)";
            lbVid.style.opacity = "1";
            lbVid.style.transform = "translateX(0)";
            lbVid.play().catch(() => {});
            setTimeout(() => { _lbAnimating = false; }, 300);
          });
        }, 200);
        const counter = document.getElementById("lb-counter");
        counter.textContent = `${_lbIndex + 1} / ${_lbImages.length}`;
        document.getElementById("lb-prev").style.display = _lbIndex > 0 ? "flex" : "none";
        document.getElementById("lb-next").style.display = _lbIndex < _lbImages.length - 1 ? "flex" : "none";
        _lbRenderProfile(_lbIndex);
      }

      function closeLightbox() {
        const lb = document.getElementById("lightbox");
        lb.style.transition = "opacity 0.18s ease";
        lb.style.opacity = "0";
        setTimeout(() => {
          lb.style.display = "none";
          lb.style.opacity = "";
          document.body.style.overflow = "";
          _lbScale = 1;
          _lbTranslateX = 0;
          _lbTranslateY = 0;
          _lbPostId = null;
          const lbImg = document.getElementById("lb-img");
          lbImg.style.transform = "";
          lbImg.style.transition = "";
          lbImg.style.display = "";
          // Stop & reset video
          const lbVid = document.getElementById("lb-video");
          lbVid.pause();
          lbVid.src = "";
          lbVid.style.display = "none";
          _lbIsVideo = false;
          // Hide caption & actions
          const captionEl = document.getElementById("lb-caption");
          if (captionEl) captionEl.style.display = "none";
          const actionsEl = document.getElementById("lb-actions");
          if (actionsEl) actionsEl.style.display = "none";
        }, 180);
      }

      function lbGoTo(newIdx) {
        if (_lbAnimating || newIdx < 0 || newIdx >= _lbImages.length) return;
        _lbAnimating = true;
        const dir = newIdx > _lbIndex ? 1 : -1;
        const lbImg = document.getElementById("lb-img");
        _lbIndex = newIdx;
        _lbScale = 1;
        _lbTranslateX = 0;
        _lbTranslateY = 0;
        lbImg.style.transition =
          "transform 0.28s cubic-bezier(0.4,0,0.2,1), opacity 0.22s ease";
        lbImg.style.transform = `translateX(${-dir * 60}px) scale(0.88)`;
        lbImg.style.opacity = "0.2";
        setTimeout(() => {
          lbImg.src = _lbImages[_lbIndex];
          lbImg.style.transition = "none";
          lbImg.style.transform = `translateX(${dir * 60}px) scale(0.88)`;
          lbImg.style.opacity = "0.2";
          requestAnimationFrame(() => {
            lbImg.style.transition =
              "transform 0.3s cubic-bezier(0.34,1.2,0.64,1), opacity 0.22s ease";
            lbImg.style.transform = "translateX(0) scale(1)";
            lbImg.style.opacity = "1";
            setTimeout(() => {
              _lbAnimating = false;
            }, 320);
          });
        }, 200);
        document.getElementById("lb-counter").textContent =
          `${_lbIndex + 1} / ${_lbImages.length}`;
        document.getElementById("lb-prev").style.display =
          _lbIndex > 0 ? "flex" : "none";
        document.getElementById("lb-next").style.display =
          _lbIndex < _lbImages.length - 1 ? "flex" : "none";
        _lbRenderProfile(_lbIndex);
      }

      function lbDownload() {
        const src = _lbImages[_lbIndex];
        const a = document.createElement("a");
        a.href = src;
        a.download = _lbIsVideo ? "video.mp4" : "image.jpg";
        a.target = "_blank";
        a.click();
      }

      function lbShare() {
        const src = _lbImages[_lbIndex];
        if (navigator.share) {
          navigator.share({ url: src }).catch(() => {});
        } else {
          navigator.clipboard
            .writeText(src)
            .then(() => showToast(_lbIsVideo ? "Video URL copied!" : "Image URL copied!"));
        }
      }

      /* ── Touch / Pointer events for zoom & swipe ── */
      function lbPointerDown(e) {
        _lbPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (_lbPointers.size === 1) {
          _lbSwipeStartX = e.clientX;
          _lbDragStartX = e.clientX - _lbTranslateX;
          _lbDragStartY = e.clientY - _lbTranslateY;
          _lbSwiping = _lbIsVideo ? true : _lbScale <= 1;
        } else if (_lbPointers.size === 2) {
          _lbSwiping = false;
          const pts = [..._lbPointers.values()];
          _lbPinchStartDist = Math.hypot(
            pts[1].x - pts[0].x,
            pts[1].y - pts[0].y,
          );
        }
      }

      function lbPointerMove(e) {
        if (_lbIsVideo) return;
        _lbPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const lbImg = document.getElementById("lb-img");
        if (_lbPointers.size === 2) {
          const pts = [..._lbPointers.values()];
          const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
          const newScale = Math.min(
            5,
            Math.max(1, _lbScale * (dist / _lbPinchStartDist)),
          );
          _lbPinchStartDist = dist;
          _lbScale = newScale;
          lbImg.style.transition = "none";
          lbImg.style.transform = `translate(${_lbTranslateX}px, ${_lbTranslateY}px) scale(${_lbScale})`;
        } else if (_lbPointers.size === 1 && _lbScale > 1) {
          _lbTranslateX = e.clientX - _lbDragStartX;
          _lbTranslateY = e.clientY - _lbDragStartY;
          lbImg.style.transition = "none";
          lbImg.style.transform = `translate(${_lbTranslateX}px, ${_lbTranslateY}px) scale(${_lbScale})`;
        }
      }

      function lbPointerUp(e) {
        const startX = _lbSwipeStartX;
        _lbPointers.delete(e.pointerId);
        if (_lbPointers.size === 0 && _lbSwiping) {
          const dx = e.clientX - startX;
          if (Math.abs(dx) > 55) {
            if (_lbIsVideo) {
              lbGoToVideo(_lbIndex + (dx < 0 ? 1 : -1));
            } else if (_lbScale <= 1) {
              lbGoTo(_lbIndex + (dx < 0 ? 1 : -1));
            }
          }
          _lbSwiping = false;
        }
      }

      /* ── Wheel zoom ── */
      function lbWheel(e) {
        if (_lbIsVideo) return;
        e.preventDefault();
        const lbImg = document.getElementById("lb-img");
        _lbScale = Math.min(
          5,
          Math.max(1, _lbScale * (e.deltaY < 0 ? 1.12 : 0.9)),
        );
        if (_lbScale <= 1) {
          _lbTranslateX = 0;
          _lbTranslateY = 0;
        }
        lbImg.style.transition = "transform 0.12s ease";
        lbImg.style.transform = `translate(${_lbTranslateX}px, ${_lbTranslateY}px) scale(${_lbScale})`;
      }

      /* ── Double tap/click to reset zoom ── */
      function lbDblClick() {
        if (_lbIsVideo) return;
        const lbImg = document.getElementById("lb-img");
        _lbScale = _lbScale > 1 ? 1 : 2.2;
        _lbTranslateX = 0;
        _lbTranslateY = 0;
        lbImg.style.transition = "transform 0.3s cubic-bezier(0.34,1.2,0.64,1)";
        lbImg.style.transform = _lbScale > 1 ? `scale(${_lbScale})` : "none";
      }

      /* ── Keyboard ── */
      document.addEventListener("keydown", (e) => {
        const lb = document.getElementById("lightbox");
        if (lb.style.display !== "flex") return;
        if (e.key === "Escape") closeLightbox();
        if (_lbIsVideo) {
          if (e.key === "ArrowRight") lbGoToVideo(_lbIndex + 1);
          if (e.key === "ArrowLeft") lbGoToVideo(_lbIndex - 1);
          return;
        }
        if (e.key === "ArrowRight") lbGoTo(_lbIndex + 1);
        if (e.key === "ArrowLeft") lbGoTo(_lbIndex - 1);
      });

      /* ── Collect all images from feed for gallery context ── */
      function collectFeedImages() {
        return [...document.querySelectorAll(".post-img, .repost-embed-img")]
          .map((i) => i.src)
          .filter(Boolean);
      }

      function collectFeedVideos() {
        return [...document.querySelectorAll(".post-video-wrap[data-lb-video]")];
      }

