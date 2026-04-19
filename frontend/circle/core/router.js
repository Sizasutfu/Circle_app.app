// ── Router ──────────────────────────────────────────────────────────────────
// goTo(view) — activates the named view, highlights nav, triggers on-enter hooks.
// Depends on: store, feed, profile, dm, notif, search, explore, settings modules.

      /*NAV */
      function goTo(view) {
        document
          .querySelectorAll(".view")
          .forEach((v) => v.classList.remove("active"));
        document.getElementById("view-" + view).classList.add("active");
        document
          .querySelectorAll(".nav-item")
          .forEach((n) => n.classList.remove("active"));
        const sn = document.getElementById("snav-" + view);
        if (sn) sn.classList.add("active");
        document
          .querySelectorAll(".mnav-item")
          .forEach((n) => n.classList.remove("active"));
        const mn = document.getElementById("mnav-" + view);
        if (mn) mn.classList.add("active");
        if (view === "messages") {
          if (!currentUser) {
            goTo("login");
            return;
          }
          DM.init(); // reload inbox from backend
          DM.clearDMBadge(); // clear notification badge on open
        }
        if (view === "feed") loadPosts();
        if (view === "profile") renderProfile();
        if (view === "feed" && currentUser && !_suggestionsLoaded)
          loadSuggestions();
        if (view === "feed" && currentUser && !_newMembersLoaded)
          loadNewMembers();
        if (view === "feed") loadTrending();
        if (view === "feed" && !currentUser) {
          const sw = document.getElementById("suggestions-widget");
          if (sw) sw.style.display = "none";
          // Show feed tabs for guests too (Following tab will redirect to login)
          const ft = document.getElementById("feed-tabs");
          if (ft) ft.style.display = "flex";
          // Hide the Following tab label hint for guests
          const ftFollowing = document.getElementById("ftab-following");
          if (ftFollowing) ftFollowing.style.opacity = "0.5";
        }
        if (view === "settings") populateSettings();
        if (view === "explore") loadExplore();
        if (view === "search") {
          searchTab = "posts";
          document.getElementById("search-input").value = "";
          renderSearchHint();
          var stSection = document.getElementById("search-trending-section");
          if (stSection) stSection.style.display = "block";
          loadTrending();
        }
        window.scrollTo(0, 0);
      }
