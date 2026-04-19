// ── Settings View ───────────────────────────────────────────────────────────
// populateSettings, saveProfile, avatar upload, danger zone.

      /* SETTINGS */
      function populateSettings() {
        if (!currentUser) {
          goTo("login");
          return;
        }
        document.getElementById("settings-name").value = currentUser.name || "";
        document.getElementById("settings-email").value = currentUser.email || "";
        document.getElementById("settings-bio").value = currentUser.bio || "";
        document.getElementById("settings-password").value = "";
        const sav = document.getElementById("settings-av");
        if (sav) {
          const pic = currentUser.picture || null,
            initial = currentUser.name.charAt(0).toUpperCase(),
            color = stringToColor(currentUser.name);
          if (pic) {
            sav.style.background = "transparent";
            sav.innerHTML = `<img src="${pic}" alt="${initial}" loading="lazy" style="width:100%;height:100%;border-radius:inherit;object-fit:cover;display:block"/>`;
          } else {
            sav.innerHTML = initial;
            sav.style.background = color;
          }
        }
        const p = JSON.parse(
          localStorage.getItem("circle_notif_prefs") || "{}",
        );
        ["likes", "comments", "reposts", "push", "new_post", "profile_pic", "mention", "milestone"].forEach((k) => {
          const el = document.getElementById("notif-" + k);
          if (el && p[k] !== undefined) el.checked = p[k];
        });
        ["account", "activity"].forEach((k) => {
          const el = document.getElementById("priv-" + k);
          if (el && p[k] !== undefined) el.checked = p[k];
        });
      }

      async function saveProfile() {
        if (!currentUser) return;
        const name = document.getElementById("settings-name").value.trim();
        const email = document.getElementById("settings-email").value.trim();
        const bio = document.getElementById("settings-bio").value.trim();
        const password = document.getElementById("settings-password").value;
        if (!name || !email) {
          showToast("Name and email are required.");
          return;
        }
        const prefs = {
          likes: document.getElementById("notif-likes").checked,
          comments: document.getElementById("notif-comments").checked,
          reposts: document.getElementById("notif-reposts").checked,
          push: document.getElementById("notif-push").checked,
          new_post: document.getElementById("notif-new_post").checked,
          profile_pic: document.getElementById("notif-profile_pic").checked,
          mention: document.getElementById("notif-mention").checked,
          milestone: document.getElementById("notif-milestone").checked,
          account: document.getElementById("priv-account").checked,
          activity: document.getElementById("priv-activity").checked,
        };
        localStorage.setItem("circle_notif_prefs", JSON.stringify(prefs));
        try {
          const res = await api("PUT", `/api/users/${currentUser.id}`, {
            name,
            email,
            bio: bio || undefined,
            password: password || undefined,
          });
          const updatedUser = {
            ...res.data,
            bio: bio || res.data.bio || "",
            picture: currentUser.picture || res.data.picture || null,
          };
          localStorage.setItem("circle_user", JSON.stringify(updatedUser));
          setCurrentUser(updatedUser);
          showToast("Profile updated! ✅");
          setTimeout(() => goTo("profile"), 600);
        } catch (e) {
          showToast("Error: " + e.message);
        }
      }

      /* FEED TABS */
