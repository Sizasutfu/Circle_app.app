// ── API Wrapper ─────────────────────────────────────────────────────────────
// Centralised fetch with auth header and error normalisation.
// Depends on: store.js (currentUser), and window.API base URL.

export async function api(method, path, body = null) {
      async function api(method, path, body = null) {
        const opts = {
          method,
          headers: { "Content-Type": "application/json" },
        };
        // Attach auth header so protected routes (follow/unfollow) work
        if (currentUser) opts.headers["X-User-Id"] = currentUser.id;
        if (body) opts.body = JSON.stringify(body);
        const res = await fetch(API + path, opts);
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Something went wrong.");
        return data;
      }
}
