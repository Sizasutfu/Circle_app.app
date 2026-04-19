// ── Utility Functions ───────────────────────────────────────────────────────

      function escHtml(s) {
        return String(s)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#039;");
      }
      function formatTime(date) {
        const d = new Date(date),
          now = new Date(),
          diff = Math.floor((now - d) / 1000);
        if (diff < 60) return "just now";
        if (diff < 3600) return Math.floor(diff / 60) + "m ago";
        if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
        return d.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        });
      }
      function showAlert(el, msg, type) {
        el.textContent = msg;
        el.className = "alert " + type;
      }
      let _tt;
      function showToast(msg) {
        const t = document.getElementById("toast");
        t.textContent = msg;
        t.classList.add("show");
        clearTimeout(_tt);
        _tt = setTimeout(() => t.classList.remove("show"), 2800);
      }
      function stringToColor(s) {
        const c = [
          "#7c6bff",
          "#ff5f7a",
          "#22d48f",
          "#f5a623",
          "#00b4d8",
          "#e040fb",
          "#26c6da",
          "#ff7043",
        ];
        let h = 0;
        for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h);
        return c[Math.abs(h) % c.length];
      }



// ── Theme ───────────────────────────────────────────────────────────────────
      /*  THEME */
      function applyTheme(theme) {
        document.documentElement.setAttribute("data-theme", theme);
        localStorage.setItem("circle_theme", theme);
        const isLight = theme === "light";
        const cb = document.getElementById("theme-toggle");
        if (cb) cb.checked = isLight;
        const icon = document.getElementById("theme-icon-top");
        if (icon)
          icon.innerHTML = isLight
            ? '<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>'
            : '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
      }
      function toggleTheme() {
        applyTheme(
          document.documentElement.getAttribute("data-theme") === "dark"
            ? "light"
            : "dark",
        );
      }

