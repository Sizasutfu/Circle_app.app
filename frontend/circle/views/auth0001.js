// ── Auth Module ─────────────────────────────────────────────────────────────
// login, register, OTP flow, logout, setCurrentUser, password reset.

      /*AUTH  */
      async function registerUser() {
        const name = document.getElementById("reg-name").value.trim();
        const email = document.getElementById("reg-email").value.trim();
        const password = document.getElementById("reg-password").value;
        const dialCode = document.getElementById("reg-dial-code").value;
        const phoneRaw = document.getElementById("reg-phone").value.trim();
        const phone = phoneRaw ? dialCode + phoneRaw.replace(/\D/g, "") : undefined;
        const el = document.getElementById("register-alert");
        el.className = "alert";
        if (!name || !email || !password)
          return showAlert(el, "All fields are required.", "error");
        if (password.length < 6)
          return showAlert(el, "Password must be at least 6 characters.", "error");
        try {
          const res = await api("POST", "/api/users/register", {
            name, email, password,
            phone: phone || undefined,
          });
          setCurrentUser(res.data);
          showAlert(el, "Account created! Welcome 🎉", "success");
          setTimeout(() => goTo("feed"), 900);
        } catch (e) {
          showAlert(el, e.message, "error");
        }
      }

      async function loginUser() {
        const email = document.getElementById("login-email").value.trim();
        const password = document.getElementById("login-password").value;
        const el = document.getElementById("login-alert");
        el.className = "alert";
        if (!email || !password)
          return showAlert(el, "Email and password are required.", "error");
        try {
          const res = await api("POST", "/api/users/login", {
            email,
            password,
          });
          setCurrentUser(res.data);
          showToast("Welcome back, " + res.data.name.split(" ")[0] + "! 👋");
          setTimeout(() => goTo("feed"), 400);
        } catch (e) {
          showAlert(el, e.message, "error");
        }
      }

      /* ── PHONE / OTP AUTH ─────────────────────────────────────────── */
      let _otpTimerInterval = null;

      function switchLoginMethod(method) {
        const isPhone = method === "phone";
        document.getElementById("login-tab-email").classList.toggle("active", !isPhone);
        document.getElementById("login-tab-phone").classList.toggle("active", isPhone);
        document.getElementById("login-email-method").style.display = isPhone ? "none" : "block";
        document.getElementById("login-phone-method").style.display = isPhone ? "block" : "none";
        document.getElementById("login-alert").className = "alert";
        if (isPhone) {
          // Reset to step 1
          phoneLoginBack();
          setTimeout(() => document.getElementById("login-phone-number").focus(), 80);
        }
      }

      function phoneLoginBack() {
        document.getElementById("login-phone-step1").classList.add("active");
        document.getElementById("login-phone-step2").classList.remove("active");
        _clearOtpTimer();
        _clearOtpDigits("login");
      }

      async function phoneLoginSendOtp(isResend = false) {
        const dialCode = document.getElementById("login-dial-code").value;
        const raw = document.getElementById("login-phone-number").value.trim();
        const el = document.getElementById("login-alert");
        el.className = "alert";

        if (!raw) return showAlert(el, "Please enter your phone number.", "error");
        const digits = raw.replace(/\D/g, "");
        if (digits.length < 5) return showAlert(el, "Please enter a valid phone number.", "error");

        const phone = dialCode + digits;
        const btn = document.getElementById("login-send-otp-btn");
        if (btn) { btn.disabled = true; btn.textContent = "Sending…"; }

        try {
          await api("POST", "/api/auth/phone/send-otp", { phone });
          document.getElementById("login-otp-phone-display").textContent = dialCode + " " + raw;
          document.getElementById("login-phone-step1").classList.remove("active");
          document.getElementById("login-phone-step2").classList.add("active");
          _clearOtpDigits("login");
          setTimeout(() => document.querySelector("#login-otp-group .otp-digit").focus(), 80);
          _startOtpTimer("login");
          if (isResend) showToast("New code sent! 📱");
        } catch (e) {
          showAlert(el, e.message || "Failed to send code. Please try again.", "error");
        } finally {
          if (btn) { btn.disabled = false; btn.textContent = "Send Code"; }
        }
      }

      async function phoneLoginVerifyOtp() {
        const dialCode = document.getElementById("login-dial-code").value;
        const raw = document.getElementById("login-phone-number").value.trim().replace(/\D/g, "");
        const phone = dialCode + raw;
        const code = _getOtpValue("login");
        const el = document.getElementById("login-alert");
        el.className = "alert";

        if (code.length < 6) return showAlert(el, "Please enter the full 6-digit code.", "error");

        const btn = document.getElementById("login-verify-otp-btn");
        if (btn) { btn.disabled = true; btn.textContent = "Verifying…"; }

        try {
          const res = await api("POST", "/api/auth/phone/verify-otp", { phone, code });
          _clearOtpTimer();
          setCurrentUser(res.data);
          showToast("Welcome back, " + res.data.name.split(" ")[0] + "! 👋");
          setTimeout(() => goTo("feed"), 400);
        } catch (e) {
          showAlert(el, e.message || "Invalid code. Please try again.", "error");
          _shakeOtpGroup("login");
        } finally {
          if (btn) { btn.disabled = false; btn.textContent = "Verify & Sign In"; }
        }
      }

      // ── OTP input helpers ─────────────────────────────────────────
      function otpInput(el, prefix) {
        el.value = el.value.replace(/\D/g, "").slice(-1);
        el.classList.toggle("filled", !!el.value);
        if (el.value) {
          const next = el.nextElementSibling;
          if (next && next.classList.contains("otp-digit")) next.focus();
          else {
            // All filled — auto-submit
            if (prefix === "login") phoneLoginVerifyOtp();
          }
        }
      }

      function otpKeydown(e, el, prefix) {
        if (e.key === "Backspace" && !el.value) {
          const prev = el.previousElementSibling;
          if (prev && prev.classList.contains("otp-digit")) {
            prev.value = "";
            prev.classList.remove("filled");
            prev.focus();
          }
        }
        if (e.key === "ArrowLeft") { const prev = el.previousElementSibling; if (prev && prev.classList.contains("otp-digit")) prev.focus(); }
        if (e.key === "ArrowRight") { const next = el.nextElementSibling; if (next && next.classList.contains("otp-digit")) next.focus(); }
        if (e.key === "Enter") { if (prefix === "login") phoneLoginVerifyOtp(); }
      }

      function otpPaste(e, prefix) {
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData("text").replace(/\D/g, "").slice(0, 6);
        const digits = document.querySelectorAll(`#${prefix}-otp-group .otp-digit`);
        text.split("").forEach((ch, i) => {
          if (digits[i]) { digits[i].value = ch; digits[i].classList.add("filled"); }
        });
        const lastFilled = Math.min(text.length, 5);
        if (digits[lastFilled]) digits[lastFilled].focus();
        if (text.length === 6) {
          if (prefix === "login") setTimeout(phoneLoginVerifyOtp, 120);
        }
      }

      function _getOtpValue(prefix) {
        return [...document.querySelectorAll(`#${prefix}-otp-group .otp-digit`)]
          .map(d => d.value).join("");
      }

      function _clearOtpDigits(prefix) {
        document.querySelectorAll(`#${prefix}-otp-group .otp-digit`).forEach(d => {
          d.value = "";
          d.classList.remove("filled");
        });
      }

      function _shakeOtpGroup(prefix) {
        const g = document.getElementById(`${prefix}-otp-group`);
        if (!g) return;
        g.style.animation = "none";
        g.offsetHeight; // reflow
        g.style.animation = "otpShake 0.4s ease";
        setTimeout(() => { g.style.animation = ""; _clearOtpDigits(prefix); document.querySelector(`#${prefix}-otp-group .otp-digit`).focus(); }, 420);
      }

      function _startOtpTimer(prefix) {
        _clearOtpTimer();
        let secs = 30;
        const timerEl = document.getElementById(`${prefix}-otp-timer`);
        const resendBtn = document.getElementById(`${prefix}-resend-btn`);
        if (resendBtn) resendBtn.disabled = true;
        const tick = () => {
          if (timerEl) timerEl.textContent = `(${secs}s)`;
          if (secs <= 0) {
            _clearOtpTimer();
            if (resendBtn) { resendBtn.disabled = false; }
            if (timerEl) timerEl.textContent = "";
            return;
          }
          secs--;
          _otpTimerInterval = setTimeout(tick, 1000);
        };
        tick();
      }

      function _clearOtpTimer() {
        if (_otpTimerInterval) { clearTimeout(_otpTimerInterval); _otpTimerInterval = null; }
      }

      function logout() {
        currentUser = null;
        localStorage.removeItem("circle_user");
        // ── Cache: clear all cached data on logout ──────────────────
        PostCache.clear();
        posts = [];
        _trendingLoaded = false;
        _trendingWords = [];
        _activeFilter = null;
        document.getElementById("trending-filter-bar").style.display = "none";
        document.getElementById("sidebar-user-area").style.display = "none";
        document.getElementById("compose-box").style.display = "none";
        document.getElementById("login-nudge").style.display = "flex";
        document.getElementById("feed-tabs").style.display = "none";
        const ta = document.getElementById("topbar-avatar");
        if (ta) {
          ta.style.background = "var(--border2)";
          ta.innerHTML = `<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="16" height="16"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
        }
        stopNotifPolling();
        updateNotifBadge(0);
        E2E.clearCache();
        showToast("Logged out successfully.");
        goTo("feed");
      }

      function setCurrentUser(user) {
        _suggestionsLoaded = false;
        _feedSugDismissed  = false;
        _feedSugUsers      = [];
        _newMembersLoaded  = false;
        _feedNewDismissed  = false;
        _newMembers        = [];
        _trendingLoaded    = false;
        _trendingWords     = [];
        _activeFilter      = null;
        if (
          user &&
          document.getElementById("view-feed").classList.contains("active")
        ) {
          setTimeout(loadSuggestions, 700);
        }
        currentUser = user;
        localStorage.setItem("circle_user", JSON.stringify(user));
        const initial = user.name.charAt(0).toUpperCase(),
          color = stringToColor(user.name);
        const pic = user.picture || null;

        function applyAv(el) {
          if (!el) return;
          if (pic) {
            el.style.background = "transparent";
            el.innerHTML = `<img src="${pic}" alt="${initial}" loading="lazy" style="width:100%;height:100%;border-radius:inherit;object-fit:cover;display:block"/>`;
          } else {
            el.innerHTML = initial;
            el.style.background = color;
          }
        }

        const sa = document.getElementById("sb-avatar");
        applyAv(sa);
        document.getElementById("sb-name").textContent = user.name;
        document.getElementById("sb-email").textContent = user.email;
        document.getElementById("sidebar-user-area").style.display = "block";
        const ca = document.getElementById("compose-av");
        applyAv(ca);
        const ta = document.getElementById("topbar-avatar");
        if (ta) {
          ta.style.display = "grid";
          if (pic) {
            ta.style.background = "transparent";
            ta.innerHTML = `<img src="${pic}" alt="${initial}" loading="lazy" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block"/>`;
          } else {
            ta.innerHTML = initial;
            ta.style.background = color;
          }
        }
        document.getElementById("compose-box").style.display = "block";
        document.getElementById("login-nudge").style.display = "none";
        document.getElementById("feed-tabs").style.display = "flex";
        startNotifPolling();
        loadSuggestions();
        // Generate / load E2E key-pair and publish public key to server
        E2E.publishMyPublicKey().catch(() => {});
      }

      async function sendResetEmail() {
        const email = document.getElementById("reset-email").value.trim();
        const el = document.getElementById("reset-alert");
        el.className = "alert";
        if (!email) return showAlert(el, "Please enter your email.", "error");
        try {
          await api("POST", "/api/users/reset-password", { email });
          showAlert(
            el,
            "If that email exists, a reset link has been sent.",
            "success",
          );
        } catch (e) {
          showAlert(el, e.message, "error");
        }
      }

      async function setNewPassword() {
        const pw = document.getElementById("newpw-password").value;
        const cfm = document.getElementById("newpw-confirm").value;
        const el = document.getElementById("newpw-alert");
        el.className = "alert";

        if (!pw || pw.length < 6)
          return showAlert(
            el,
            "Password must be at least 6 characters.",
            "error",
          );
        if (pw !== cfm)
          return showAlert(el, "Passwords do not match.", "error");

        const token = new URLSearchParams(window.location.search).get("token");
        if (!token)
          return showAlert(el, "Invalid or expired reset link.", "error");

        try {
          await api("POST", "/api/users/reset-password/confirm", {
            token,
            password: pw,
          });
          showAlert(el, "Password updated! Redirecting to login…", "success");
          history.replaceState({}, "", window.location.pathname); // strip ?token from URL
          setTimeout(() => goTo("login"), 1400);
        } catch (e) {
          showAlert(el, e.message, "error");
        }
      }

