// ── Direct Messages + E2E Encryption ──────────────────────────────────────
// E2E: ECDH key exchange + AES-GCM per-message encryption.
// DM: inbox, conversations, send, polling, badge.

      /* ═══════════════════════════════════════════════════════════════
         E2E ENCRYPTION  —  ECDH key exchange + AES-GCM per-message
         ═══════════════════════════════════════════════════════════════
         How it works:
           1. On first login each device generates a persistent ECDH key-pair
              (P-256). The PUBLIC key is uploaded to the server so other users
              can fetch it.  The PRIVATE key never leaves localStorage.
           2. When Alice opens a conversation with Bob she fetches Bob's public
              key, derives a shared AES-GCM secret via ECDH, and caches it.
           3. Every outgoing message body is encrypted:
                ciphertext  = AES-GCM-encrypt(sharedKey, plaintext)
                wire format = "e2e:" + base64(iv + ciphertext)
           4. On receipt the same derivation gives the same shared key and the
              message is decrypted before display.
           5. The server only ever stores/sees the "e2e:…" blob — plaintext
              never touches the server.
         ═══════════════════════════════════════════════════════════════ */
      const E2E = (() => {
        const STORE_KEY = "circle_e2e_keypair";   // localStorage key
        let _myKeyPair  = null;                    // CryptoKeyPair (this device)
        let _sharedKeys = {};                      // { userId: CryptoKey }

        // ── Helpers ─────────────────────────────────────────────
        function _b64(buf) {
          return btoa(String.fromCharCode(...new Uint8Array(buf)));
        }
        function _unb64(b64) {
          return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        }

        // ── Generate or load this device's ECDH key-pair ────────
        async function ensureMyKeys() {
          if (_myKeyPair) return _myKeyPair;
          const stored = localStorage.getItem(STORE_KEY);
          if (stored) {
            try {
              const { pub, priv } = JSON.parse(stored);
              const publicKey  = await crypto.subtle.importKey(
                "spki", _unb64(pub),
                { name: "ECDH", namedCurve: "P-256" }, true, []
              );
              const privateKey = await crypto.subtle.importKey(
                "pkcs8", _unb64(priv),
                { name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey"]
              );
              _myKeyPair = { publicKey, privateKey };
              return _myKeyPair;
            } catch (e) { /* corrupt — regenerate */ }
          }
          _myKeyPair = await crypto.subtle.generateKey(
            { name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey"]
          );
          // Persist to localStorage
          const pub  = _b64(await crypto.subtle.exportKey("spki",  _myKeyPair.publicKey));
          const priv = _b64(await crypto.subtle.exportKey("pkcs8", _myKeyPair.privateKey));
          localStorage.setItem(STORE_KEY, JSON.stringify({ pub, priv }));
          return _myKeyPair;
        }

        // ── Upload our public key to server ─────────────────────
        // PUT /api/users/:id/publickey  { publicKey: "<b64 spki>" }
        async function publishMyPublicKey() {
          if (!currentUser) return;
          try {
            const kp  = await ensureMyKeys();
            const pub = _b64(await crypto.subtle.exportKey("spki", kp.publicKey));
            await api("PUT", `/api/users/${currentUser.id}/publickey`, { publicKey: pub });
          } catch (e) { /* server may not support yet — silently ignore */ }
        }

        // ── Fetch a peer's public key from server ───────────────
        // GET /api/users/:id/publickey  → { publicKey: "<b64 spki>" }
        async function _fetchPeerKey(userId) {
          try {
            const res = await api("GET", `/api/users/${userId}/publickey`);
            const b64 = res.data?.publicKey || res.publicKey;
            if (!b64) return null;
            return await crypto.subtle.importKey(
              "spki", _unb64(b64),
              { name: "ECDH", namedCurve: "P-256" }, true, []
            );
          } catch (e) { return null; }
        }

        // ── Derive (or return cached) shared AES-GCM key ────────
        async function _sharedKey(peerUserId) {
          if (_sharedKeys[peerUserId]) return _sharedKeys[peerUserId];
          const kp       = await ensureMyKeys();
          const peerPub  = await _fetchPeerKey(peerUserId);
          if (!peerPub) return null;
          const key = await crypto.subtle.deriveKey(
            { name: "ECDH", public: peerPub },
            kp.privateKey,
            { name: "AES-GCM", length: 256 },
            false, ["encrypt", "decrypt"]
          );
          _sharedKeys[peerUserId] = key;
          return key;
        }

        // ── Encrypt plaintext → "e2e:<b64(iv+ct)>" ──────────────
        async function encrypt(peerUserId, plaintext) {
          const key = await _sharedKey(peerUserId);
          if (!key) return plaintext;                  // fall back to plaintext
          const iv  = crypto.getRandomValues(new Uint8Array(12));
          const ct  = await crypto.subtle.encrypt(
            { name: "AES-GCM", iv },
            key,
            new TextEncoder().encode(plaintext)
          );
          const blob = new Uint8Array(12 + ct.byteLength);
          blob.set(iv, 0);
          blob.set(new Uint8Array(ct), 12);
          return "e2e:" + _b64(blob.buffer);
        }

        // ── Decrypt "e2e:…" → plaintext ─────────────────────────
        async function decrypt(peerUserId, body) {
          if (!body || !body.startsWith("e2e:")) return body;
          try {
            const key  = await _sharedKey(peerUserId);
            if (!key) return "[🔒 Encrypted — open conversation to decrypt]";
            const blob = _unb64(body.slice(4));
            const iv   = blob.slice(0, 12);
            const ct   = blob.slice(12);
            const pt   = await crypto.subtle.decrypt(
              { name: "AES-GCM", iv }, key, ct
            );
            return new TextDecoder().decode(pt);
          } catch (e) {
            return "[🔒 Encrypted message]";
          }
        }

        // ── Clear cached shared keys (e.g. on logout) ───────────
        function clearCache() { _sharedKeys = {}; _myKeyPair = null; }

        // ── Check if E2E is active for a peer ────────────────────
        async function isEnabled(peerUserId) {
          const key = await _sharedKey(peerUserId);
          return !!key;
        }

        return { ensureMyKeys, publishMyPublicKey, encrypt, decrypt, clearCache, isEnabled };
      })();

      /* ═══════════════════════════════════════════════════════════════
         DIRECT MESSAGES  —  localStorage-backed private messaging
         ═══════════════════════════════════════════════════════════════ */
      const DM = (() => {
        // State
        let _inbox        = [];   // rows from GET /api/dm/inbox
        let _activeConvId = null;
        let _activeOther  = null;
        let _messages     = [];
        let _inboxFilter  = "";
        let _polling      = null;
        let _sending      = false;

        // ── Time helpers ────────────────────────────────────────
        function _fmtTime(ts) {
          return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        }
        function _fmtDate(ts) {
          const d = new Date(ts), now = new Date();
          if (d.toDateString() === now.toDateString()) return "Today";
          const y = new Date(now); y.setDate(now.getDate() - 1);
          if (d.toDateString() === y.toDateString()) return "Yesterday";
          return d.toLocaleDateString([], { month: "short", day: "numeric" });
        }
        function _fmtPreviewTime(ts) {
          if (!ts) return "";
          const d = new Date(ts), now = new Date();
          return d.toDateString() === now.toDateString()
            ? _fmtTime(ts)
            : d.toLocaleDateString([], { month: "short", day: "numeric" });
        }

        // ── Load inbox from backend ─────────────────────────────
        // GET /api/dm/inbox
        let _prevInboxSnapshot = {}; // convId -> last_message_at, to detect new messages
        async function _loadInbox() {
          if (!currentUser) return;
          try {
            const res = await api("GET", "/api/dm/inbox");
            const newInbox = Array.isArray(res.data) ? res.data : [];

            // Detect new incoming messages and update badge + play tone
            if (Object.keys(_prevInboxSnapshot).length > 0) {
              let newCount = 0;
              let toneTriggered = false;
              for (const conv of newInbox) {
                const prev = _prevInboxSnapshot[conv.id];
                const isActiveConv = conv.id === _activeConvId;
                const isFromOther = conv.last_sender_id !== currentUser.id;
                const isNewer = !prev || conv.last_message_at !== prev.last_message_at;
                if (!isActiveConv && isFromOther && isNewer && conv.last_message_at) {
                  newCount++;
                  if (!toneTriggered) { _msgTone.play(); toneTriggered = true; }
                }
              }
              if (newCount > 0) _refreshBadge(newCount);
            }

            // Update snapshot
            _prevInboxSnapshot = {};
            for (const conv of newInbox) {
              _prevInboxSnapshot[conv.id] = { last_message_at: conv.last_message_at };
            }

            _inbox = newInbox;
            renderInbox();
          } catch (e) { _inbox = []; }
        }

        // ── Message tone ────────────────────────────────────────
        const _msgTone = (function() {
          const audio = new Audio("message tone.wav");
          return {
            play() {
              try {
                audio.currentTime = 0;
                audio.play().catch(() => {});
              } catch (_) {}
            }
          };
        })();

        // ── Polling ─────────────────────────────────────────────
        function _startPolling() {
          _stopPolling();
          _polling = setInterval(async () => {
            if (!currentUser) return;
            await _loadInbox();
            if (_activeConvId) await _fetchMessages(_activeConvId, false);
          }, 4000);
        }
        function _stopPolling() {
          if (_polling) { clearInterval(_polling); _polling = null; }
        }

        // ── Render inbox list ───────────────────────────────────
        function renderInbox() {
          const list = document.getElementById("dm-conv-list");
          if (!currentUser) {
            list.innerHTML = '<div class="dm-conv-empty"><svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" width="36" height="36"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg><p>Log in to use messages</p></div>';
            return;
          }
          const q = _inboxFilter.toLowerCase();
          const convs = _inbox.filter(c => !q || (c.other_name || "").toLowerCase().includes(q));
          if (!convs.length) {
            list.innerHTML = '<div class="dm-conv-empty"><svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" width="36" height="36"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg><p>No conversations yet.<br/>Start one!</p></div>';
            return;
          }

          // Render synchronously first; then async-decrypt e2e previews
          const renderConv = (conv, plainPreview) => {
            const unread  = conv.unread_count || 0;
            const preview = plainPreview !== undefined
              ? plainPreview
              : (conv.last_message
                ? (conv.last_sender_id === currentUser.id ? "You: " : "") + conv.last_message
                : "No messages yet");
            const timeStr = _fmtPreviewTime(conv.last_message_at);
            const initial = (conv.other_name || "?").charAt(0).toUpperCase();
            const color   = stringToColor(conv.other_name || "");
            const avHtml  = conv.other_picture
              ? `<div class="av sm" style="background:transparent;overflow:hidden;flex-shrink:0"><img src="${conv.other_picture}" loading="lazy" style="width:100%;height:100%;object-fit:cover;border-radius:50%" alt="${initial}"/></div>`
              : `<div class="av sm" style="background:${color};flex-shrink:0">${initial}</div>`;
            return `<div class="dm-conv-item${unread ? " unread" : ""}${conv.id === _activeConvId ? " active" : ""}" id="dm-conv-${conv.id}" onclick="DM.openConv(${conv.id})">
              ${avHtml}
              <div class="dm-conv-info">
                <div class="dm-conv-name">${escHtml(conv.other_name || "")}</div>
                <div class="dm-conv-preview">${escHtml((preview || "").slice(0, 60))}</div>
              </div>
              <div class="dm-conv-meta">
                ${timeStr ? `<div class="dm-conv-time">${timeStr}</div>` : ""}
                ${unread ? `<div class="dm-unread-dot"></div>` : ""}
              </div>
            </div>`;
          };

          list.innerHTML = convs.map(conv => renderConv(conv)).join("");

          // Async: decrypt e2e last_message previews
          convs.forEach(async conv => {
            if (conv.last_message && conv.last_message.startsWith("e2e:") && conv.other_id) {
              const plain = await E2E.decrypt(conv.other_id, conv.last_message);
              const sender = conv.last_sender_id === currentUser.id ? "You: " : "";
              const el = document.getElementById(`dm-conv-${conv.id}`);
              if (el) {
                const previewEl = el.querySelector(".dm-conv-preview");
                if (previewEl) previewEl.textContent = ("🔒 " + sender + plain).slice(0, 60);
              }
            }
          });

          _refreshBadge();
        }

        // ── Open a conversation ─────────────────────────────────
        async function openConv(cid) {
          if (!currentUser) { goTo("login"); return; }
          _activeConvId = cid;
          const row = _inbox.find(c => c.id == cid);
          _activeOther = row
            ? { name: row.other_name, picture: row.other_picture, id: row.other_id }
            : { name: "…", picture: null, id: null };

          document.getElementById("dm-inbox").classList.add("hidden-mobile");
          document.getElementById("dm-chat").classList.add("visible-mobile");

          const avEl = document.getElementById("dm-chat-av");
          if (_activeOther.picture) {
            avEl.style.background = "transparent";
            avEl.innerHTML = `<img src="${_activeOther.picture}" loading="lazy" style="width:100%;height:100%;object-fit:cover;border-radius:50%" alt="${_activeOther.name.charAt(0)}"/>`;
          } else {
            avEl.innerHTML = _activeOther.name.charAt(0).toUpperCase();
            avEl.style.background = stringToColor(_activeOther.name);
          }
          document.getElementById("dm-chat-name").textContent = _activeOther.name;
          document.getElementById("dm-chat-empty").style.display  = "none";
          document.getElementById("dm-chat-active").style.display = "flex";
          document.getElementById("dm-messages").innerHTML =
            `<div style="text-align:center;padding:40px 16px;color:var(--txt3);font-size:13.5px">Loading…</div>`;

          // Show/update E2E badge in header
          let e2eBadge = document.getElementById("dm-e2e-badge");
          if (!e2eBadge) {
            e2eBadge = document.createElement("span");
            e2eBadge.id = "dm-e2e-badge";
            e2eBadge.style.cssText = "display:none;align-items:center;gap:4px;font-size:11px;font-weight:700;color:var(--green);background:var(--green-bg);border:1px solid var(--green);border-radius:20px;padding:2px 9px;cursor:default;";
            e2eBadge.title = "Messages in this conversation are end-to-end encrypted";
            e2eBadge.innerHTML = "🔒 End-to-end encrypted";
            const nameEl = document.getElementById("dm-chat-name");
            if (nameEl && nameEl.parentNode) nameEl.parentNode.appendChild(e2eBadge);
          }

          // Check if E2E is available for this peer
          if (_activeOther.id) {
            E2E.isEnabled(_activeOther.id).then(enabled => {
              e2eBadge.style.display = enabled ? "inline-flex" : "none";
            });
          }

          await _fetchMessages(cid, true);
          _startPolling();
        }

        // ── Fetch messages ──────────────────────────────────────
        // GET /api/dm/conversations/:id/messages
        async function _fetchMessages(cid, markRead) {
          try {
            const res  = await api("GET", `/api/dm/conversations/${cid}/messages`);
            const msgs = Array.isArray(res.data) ? res.data : [];

            // Determine peer user id for decryption
            const otherUserId = _inbox.find(c => c.id == cid)?.other_id;

            // Decrypt each message (skip if already has _plain or no e2e prefix)
            const decrypted = await Promise.all(msgs.map(async m => {
              if (m._plain) return m;                            // already decoded
              if (m.body && m.body.startsWith("e2e:") && otherUserId) {
                return { ...m, _plain: await E2E.decrypt(otherUserId, m.body) };
              }
              return { ...m, _plain: m.body };
            }));

            if (decrypted.length !== _messages.length || markRead) {
              // Play tone only for new incoming messages (not on initial load or own sent messages)
              if (!markRead && decrypted.length > _messages.length) {
                const newMsgs = decrypted.slice(_messages.length);
                const hasIncoming = newMsgs.some(m => m.sender_id !== currentUser.id);
                if (hasIncoming) _msgTone.play();
              }
              _messages = decrypted;
              _renderMessages(decrypted);
            }
            if (markRead) {
              const row = _inbox.find(c => c.id == cid);
              if (row) row.unread_count = 0;
              renderInbox();
            }
          } catch (e) {
            if (markRead)
              document.getElementById("dm-messages").innerHTML =
                `<div style="text-align:center;padding:40px 16px;color:var(--rose);font-size:13.5px">Failed to load messages.</div>`;
          }
        }

        // ── Render message bubbles ──────────────────────────────
        // Backend fields: sender_id, body, created_at
        function _renderMessages(msgs) {
          const el = document.getElementById("dm-messages");
          if (!msgs.length) {
            el.innerHTML = `<div style="text-align:center;padding:40px 16px;color:var(--txt3);font-size:13.5px">Send a message to start the conversation ✨</div>`;
            return;
          }
          let lastDate = "";
          el.innerHTML = msgs.map(msg => {
            const mine    = msg.sender_id === currentUser.id;
            const dateStr = _fmtDate(msg.created_at);
            let divider   = "";
            if (dateStr !== lastDate) { lastDate = dateStr; divider = `<div class="dm-date-divider">${dateStr}</div>`; }
            // Use decrypted _plain if available, otherwise fall back to raw body
            const displayText = msg._plain !== undefined ? msg._plain : msg.body;
            const isE2E = msg.body && msg.body.startsWith("e2e:");
            return `${divider}<div class="dm-msg ${mine ? "mine" : "theirs"}">
              <div class="dm-bubble">
                ${escHtml(displayText || "").replace(/\n/g, "<br>")}
                <span class="dm-bubble-time">${_fmtTime(msg.created_at)}${isE2E ? ' <span title="End-to-end encrypted" style="opacity:0.7">🔒</span>' : ''}</span>
              </div>
            </div>`;
          }).join("");
          el.scrollTop = el.scrollHeight;
        }

        // ── Send a message ──────────────────────────────────────
        // POST /api/dm/conversations/:id/messages  { body }
        async function sendMessage() {
          if (!currentUser || !_activeConvId || _sending) return;
          const input = document.getElementById("dm-compose-input");
          const text  = input.value.trim();
          if (!text) return;
          _sending = true;

          // Optimistic bubble shows plaintext immediately
          const tempId  = "tmp_" + Date.now();
          const tempMsg = { id: tempId, sender_id: currentUser.id, body: text, created_at: new Date().toISOString(), _plain: text };
          _messages = [..._messages, tempMsg];
          _renderMessages(_messages);
          input.value = "";
          input.style.height = "";

          try {
            // Encrypt before sending to server
            const otherUserId = _inbox.find(c => c.id == _activeConvId)?.other_id;
            const wireBody    = otherUserId
              ? await E2E.encrypt(otherUserId, text)
              : text;

            const res   = await api("POST", `/api/dm/conversations/${_activeConvId}/messages`, { body: wireBody });
            const saved = res.data || res;
            _messages   = _messages.filter(m => m.id !== tempId);
            // Store plaintext on the saved message so we don't re-decrypt our own
            if (saved && saved.id) { saved._plain = text; _messages.push(saved); }
            _renderMessages(_messages);
            await _loadInbox();
          } catch (e) {
            showToast("Failed to send: " + e.message);
            _messages = _messages.filter(m => m.id !== tempId);
            _renderMessages(_messages);
          } finally {
            _sending = false;
          }
        }

        // ── Badge ───────────────────────────────────────────────
        // Local unread counter — only cleared when user opens the messages view
        let _localUnread = 0;

        function _refreshBadge(delta) {
          if (delta) _localUnread = Math.max(0, _localUnread + delta);
          const count = _localUnread;
          const badge = document.getElementById("snav-dm-badge");
          if (badge) { badge.textContent = count > 9 ? "9+" : count; badge.classList.toggle("show", count > 0); }
          const mbadge = document.getElementById("mnav-dm-badge");
          if (mbadge) { mbadge.textContent = count > 9 ? "9+" : count; mbadge.classList.toggle("show", count > 0); }
          const tbadge = document.getElementById("topbar-dm-badge");
          if (tbadge) { tbadge.textContent = count > 9 ? "9+" : count; tbadge.classList.toggle("show", count > 0); }
        }

        function clearDMBadge() {
          _localUnread = 0;
          _refreshBadge();
        }

        function filterInbox() {
          _inboxFilter = document.getElementById("dm-inbox-search").value;
          renderInbox();
        }
        function updateDMBadge() { _refreshBadge(); }

        // ── Start conversation from profile / picker ────────────
        // POST /api/dm/conversations  { recipientId }
        async function startConvWithUser(user) {
          if (!currentUser) { goTo("login"); return; }
          try {
            const res  = await api("POST", "/api/dm/conversations", { recipientId: user.id });
            const conv = res.data || res;
            if (!conv || !conv.id) throw new Error("Invalid response.");
            if (!_inbox.find(c => c.id === conv.id)) {
              _inbox.unshift({
                id: conv.id, other_id: user.id,
                other_name: user.name, other_picture: user.picture || null,
                last_message: null, last_sender_id: null,
                last_message_at: null, unread_count: 0,
                created_at: conv.created_at || new Date().toISOString(),
              });
            }
            goTo("messages");
            setTimeout(() => openConv(conv.id), 60);
          } catch (e) {
            showToast("Could not open conversation: " + e.message);
          }
        }

        return {
          init: _loadInbox,
          renderInbox,
          openConv,
          sendMessage,
          filterInbox,
          updateDMBadge,
          clearDMBadge,
          startConvWithUser,
          getActiveConvId: () => _activeConvId,
          _tonePlay: () => _msgTone.play(),
        };
      })();
