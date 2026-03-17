// ============================================================
//  Circle – Social Media API
//  v4 – pagination, follow system, follow-feed, auth middleware
// ============================================================

const express = require("express");
const mysql = require("mysql2/promise");
const bcrypt = require("bcrypt");

const app = express();
const PORT = 5000;

// ── Middleware ─────────────────────────────────────────────
app.use(express.json({ limit: "10mb" }));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS",
  );
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-User-Id");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ── Database pool ──────────────────────────────────────────
const db = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "706130027464516", // ← set via env var
  database: process.env.DB_NAME || "circle_db",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

(async () => {
  try {
    const conn = await db.getConnection();
    console.log("✅  Connected to MySQL – circle_db");
    conn.release();
  } catch (e) {
    console.error("❌  MySQL connection failed:", e.message);
  }
})();

// ── Response helpers ───────────────────────────────────────
const ok = (res, status, msg, data = null) =>
  res
    .status(status)
    .json({ success: true, message: msg, ...(data !== null && { data }) });
const err = (res, status, msg) =>
  res.status(status).json({ success: false, message: msg });

// ── Auth middleware ────────────────────────────────────────
// Reads X-User-Id header (set by the frontend on every request).
// Protected routes call requireAuth before their handler.
function requireAuth(req, res, next) {
  const userId = parseInt(req.headers["x-user-id"]);
  if (!userId) return err(res, 401, "You must be logged in to do that.");
  req.actorId = userId;
  next();
}

// ============================================================
//  NOTIFICATION HELPER
//  type: 'like' | 'comment' | 'repost' | 'follow'
//  postId is null for 'follow' notifications.
// ============================================================
async function createNotification(recipientId, actorId, type, postId = null) {
  if (recipientId === actorId) return;
  try {
    // Dedup: skip if identical notification already exists
    const [dup] = await db.query(
      `SELECT id FROM notifications
       WHERE recipient_id=? AND actor_id=? AND type=? AND (post_id=? OR (post_id IS NULL AND ?  IS NULL))`,
      [recipientId, actorId, type, postId, postId],
    );
    if (dup.length > 0) return;

    await db.query(
      `INSERT INTO notifications (recipient_id, actor_id, type, post_id) VALUES (?,?,?,?)`,
      [recipientId, actorId, type, postId],
    );
  } catch (e) {
    console.error("createNotification error:", e.message);
  }
}

// ============================================================
//  FEED ALGORITHM
// ============================================================
const WEIGHT_LIKE = 3;
const WEIGHT_COMMENT = 5;
const WEIGHT_REPOST = 4;
const BOOST_OWN = 10;
const BOOST_FOLLOW = 8; // posts from people you follow rank higher
const BOOST_REPOST = 1;
const RECENCY_SCALE = 200;
const RECENCY_SHIFT = 2;

function computeScore(post, viewerUserId, followingIds = []) {
  const hoursOld =
    (Date.now() - new Date(post.createdAt).getTime()) / 3_600_000;
  const recency = RECENCY_SCALE / (hoursOld + RECENCY_SHIFT);
  const likeScore = (post.likes?.length || 0) * WEIGHT_LIKE;
  const commentScore = (post.comments?.length || 0) * WEIGHT_COMMENT;
  const repostScore = (post.reposts?.length || 0) * WEIGHT_REPOST;
  const ownBoost = post.userId === viewerUserId ? BOOST_OWN : 0;
  const followBoost = followingIds.includes(post.userId) ? BOOST_FOLLOW : 0;
  const repostBoost = post.isRepost ? BOOST_REPOST : 0;
  return (
    recency +
    likeScore +
    commentScore +
    repostScore +
    ownBoost +
    followBoost +
    repostBoost
  );
}

// ============================================================
//  HYDRATE HELPER
//  Takes an array of raw post rows and attaches likes,
//  reposts, comments, and originalPost in 4 batch queries
//  (never N×queries).
// ============================================================
async function hydratePosts(posts) {
  if (!posts.length) return posts;

  const ids = posts.map((p) => p.id);
  const ph = ids.map(() => "?").join(","); // placeholder string

  const [[allLikes], [allReposts], [allComments]] = await Promise.all([
    db.query(
      `SELECT user_id, post_id FROM likes    WHERE post_id         IN (${ph})`,
      ids,
    ),
    db.query(
      `SELECT user_id, original_post_id FROM reposts WHERE original_post_id IN (${ph})`,
      ids,
    ),
    db.query(
      `SELECT c.id, c.post_id, c.user_id AS userId,
              u.name AS author, u.picture AS authorPicture,
              c.text, c.created_at AS createdAt
       FROM comments c JOIN users u ON u.id = c.user_id
       WHERE c.post_id IN (${ph}) ORDER BY c.created_at ASC`,
      ids,
    ),
  ]);

  // Build lookup maps
  const lMap = {},
    rMap = {},
    cMap = {};
  ids.forEach((id) => {
    lMap[id] = [];
    rMap[id] = [];
    cMap[id] = [];
  });
  allLikes.forEach((l) => lMap[l.post_id]?.push(l.user_id));
  allReposts.forEach((r) => rMap[r.original_post_id]?.push(r.user_id));
  allComments.forEach((c) => cMap[c.post_id]?.push(c));

  // Embed original posts for reposts (one extra batch query)
  const origIds = [
    ...new Set(
      posts
        .filter((p) => p.isRepost && p.originalPostId)
        .map((p) => p.originalPostId),
    ),
  ];
  let origMap = {};
  if (origIds.length) {
    const oph = origIds.map(() => "?").join(",");
    const [origRows] = await db.query(
      `SELECT p.id, u.name AS author, u.picture AS authorPicture, p.text, p.image
       FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id IN (${oph})`,
      origIds,
    );
    origRows.forEach((o) => {
      origMap[o.id] = o;
    });
  }

  posts.forEach((p) => {
    p.likes = lMap[p.id] || [];
    p.reposts = rMap[p.id] || [];
    p.comments = cMap[p.id] || [];
    if (p.isRepost && p.originalPostId)
      p.originalPost = origMap[p.originalPostId] || null;
  });

  return posts;
}

// ============================================================
//  USERS
// ============================================================

// POST /api/users/register
app.post("/api/users/register", async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password)
    return err(res, 400, "Name, email, and password are required.");
  try {
    const [existing] = await db.query("SELECT id FROM users WHERE email=?", [
      email,
    ]);
    if (existing.length) return err(res, 409, "Email already registered.");
    const hash = await bcrypt.hash(password, 10);
    const [r] = await db.query(
      "INSERT INTO users (name,email,password) VALUES (?,?,?)",
      [name, email, hash],
    );
    return ok(res, 201, "Registered successfully.", {
      id: r.insertId,
      name,
      email,
      picture: null,
      createdAt: new Date(),
    });
  } catch (e) {
    console.error(e);
    return err(res, 500, "Server error.");
  }
});

// POST /api/users/login
app.post("/api/users/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return err(res, 400, "Email and password are required.");
  try {
    const [rows] = await db.query("SELECT * FROM users WHERE email=?", [email]);
    if (!rows.length) return err(res, 404, "No account with that email.");
    const user = rows[0];
    if (!(await bcrypt.compare(password, user.password)))
      return err(res, 401, "Wrong password.");
    const { password: _, ...safe } = user;
    return ok(res, 200, "Login successful.", safe);
  } catch (e) {
    console.error(e);
    return err(res, 500, "Server error.");
  }
});

// GET /api/users/:id/profile  –  stats for profile page
app.get("/api/users/:id/profile", async (req, res) => {
  const userId = parseInt(req.params.id);
  const viewerId = parseInt(req.headers["x-user-id"]) || null;
  try {
    const [rows] = await db.query(
      "SELECT id, name, email, picture FROM users WHERE id=?",
      [userId],
    );
    if (!rows.length) return err(res, 404, "User not found.");

    const [[{ postCount }]] = await db.query(
      `SELECT COUNT(*) AS postCount      FROM posts   WHERE user_id=? AND is_repost=0`,
      [userId],
    );
    const [[{ followerCount }]] = await db.query(
      `SELECT COUNT(*) AS followerCount  FROM follows WHERE following_id=?`,
      [userId],
    );
    const [[{ followingCount }]] = await db.query(
      `SELECT COUNT(*) AS followingCount FROM follows WHERE follower_id=?`,
      [userId],
    );

    // Is the viewer currently following this profile?
    let isFollowing = false;
    if (viewerId && viewerId !== userId) {
      const [f] = await db.query(
        "SELECT id FROM follows WHERE follower_id=? AND following_id=?",
        [viewerId, userId],
      );
      isFollowing = f.length > 0;
    }

    return ok(res, 200, "Profile fetched.", {
      ...rows[0],
      postCount,
      followerCount,
      followingCount,
      isFollowing,
    });
  } catch (e) {
    console.error(e);
    return err(res, 500, "Server error.");
  }
});

// PUT /api/users/:id/picture
app.put("/api/users/:id/picture", requireAuth, async (req, res) => {
  const userId = parseInt(req.params.id);
  if (req.actorId !== userId) return err(res, 403, "Forbidden.");
  const { picture } = req.body;
  if (picture && picture.length > 7_000_000)
    return err(res, 413, "Image too large (max 5 MB).");
  try {
    await db.query("UPDATE users SET picture=? WHERE id=?", [
      picture || null,
      userId,
    ]);
    return ok(res, 200, "Picture updated.", { picture: picture || null });
  } catch (e) {
    console.error(e);
    return err(res, 500, "Server error.");
  }
});

// PUT /api/users/:id  –  update name / email / password
app.put("/api/users/:id", requireAuth, async (req, res) => {
  const userId = parseInt(req.params.id);
  if (req.actorId !== userId) return err(res, 403, "Forbidden.");
  const { name, email, password } = req.body;
  if (!name || !email) return err(res, 400, "Name and email are required.");
  try {
    const [conflict] = await db.query(
      "SELECT id FROM users WHERE email=? AND id!=?",
      [email, userId],
    );
    if (conflict.length) return err(res, 409, "Email already in use.");
    if (password && password.length >= 6) {
      const hash = await bcrypt.hash(password, 10);
      await db.query("UPDATE users SET name=?,email=?,password=? WHERE id=?", [
        name,
        email,
        hash,
        userId,
      ]);
    } else {
      await db.query("UPDATE users SET name=?,email=? WHERE id=?", [
        name,
        email,
        userId,
      ]);
    }
    const [u] = await db.query(
      "SELECT id,name,email,picture,created_at AS createdAt FROM users WHERE id=?",
      [userId],
    );
    return ok(res, 200, "Profile updated.", u[0]);
  } catch (e) {
    console.error(e);
    return err(res, 500, "Server error.");
  }
});

// ============================================================
//  FOLLOWS
// ============================================================

// POST /api/follow/:targetId  –  follow a user
app.post("/api/follow/:targetId", requireAuth, async (req, res) => {
  const followerId = req.actorId;
  const followingId = parseInt(req.params.targetId);

  if (followerId === followingId)
    return err(res, 400, "You cannot follow yourself.");

  try {
    // Target user must exist
    const [target] = await db.query("SELECT id, name FROM users WHERE id=?", [
      followingId,
    ]);
    if (!target.length) return err(res, 404, "User not found.");

    // Already following?
    const [existing] = await db.query(
      "SELECT id FROM follows WHERE follower_id=? AND following_id=?",
      [followerId, followingId],
    );
    if (existing.length) return err(res, 409, "Already following this user.");

    await db.query(
      "INSERT INTO follows (follower_id, following_id) VALUES (?,?)",
      [followerId, followingId],
    );

    // Counts for the response
    const [[{ followerCount }]] = await db.query(
      "SELECT COUNT(*) AS followerCount FROM follows WHERE following_id=?",
      [followingId],
    );

    // Notify the followed user
    await createNotification(followingId, followerId, "follow", null);

    return ok(res, 201, `You are now following ${target[0].name}.`, {
      followerCount,
    });
  } catch (e) {
    console.error(e);
    return err(res, 500, "Server error.");
  }
});

// DELETE /api/unfollow/:targetId  –  unfollow a user
app.delete("/api/unfollow/:targetId", requireAuth, async (req, res) => {
  const followerId = req.actorId;
  const followingId = parseInt(req.params.targetId);

  try {
    const [existing] = await db.query(
      "SELECT id FROM follows WHERE follower_id=? AND following_id=?",
      [followerId, followingId],
    );
    if (!existing.length)
      return err(res, 404, "You are not following this user.");

    await db.query(
      "DELETE FROM follows WHERE follower_id=? AND following_id=?",
      [followerId, followingId],
    );

    const [[{ followerCount }]] = await db.query(
      "SELECT COUNT(*) AS followerCount FROM follows WHERE following_id=?",
      [followingId],
    );

    return ok(res, 200, "Unfollowed.", { followerCount });
  } catch (e) {
    console.error(e);
    return err(res, 500, "Server error.");
  }
});

// GET /api/followers/:userId  –  list of people following this user
app.get("/api/followers/:userId", async (req, res) => {
  const userId = parseInt(req.params.userId);
  const viewerId = parseInt(req.headers["x-user-id"]) || null;
  try {
    const [rows] = await db.query(
      `
      SELECT u.id, u.name, u.picture,
             (SELECT COUNT(*) FROM posts WHERE user_id=u.id AND is_repost=0) AS postCount
      FROM follows f
      JOIN users u ON u.id = f.follower_id
      WHERE f.following_id = ?
      ORDER BY f.created_at DESC
    `,
      [userId],
    );

    // Tag which ones the viewer already follows back
    if (viewerId) {
      const [viewerFollows] = await db.query(
        "SELECT following_id FROM follows WHERE follower_id=?",
        [viewerId],
      );
      const set = new Set(viewerFollows.map((r) => r.following_id));
      rows.forEach((u) => {
        u.isFollowing = set.has(u.id);
      });
    }

    return ok(res, 200, `${rows.length} followers.`, rows);
  } catch (e) {
    console.error(e);
    return err(res, 500, "Server error.");
  }
});

// GET /api/following/:userId  –  list of users this user follows
app.get("/api/following/:userId", async (req, res) => {
  const userId = parseInt(req.params.userId);
  const viewerId = parseInt(req.headers["x-user-id"]) || null;
  try {
    const [rows] = await db.query(
      `
      SELECT u.id, u.name, u.picture,
             (SELECT COUNT(*) FROM posts WHERE user_id=u.id AND is_repost=0) AS postCount
      FROM follows f
      JOIN users u ON u.id = f.following_id
      WHERE f.follower_id = ?
      ORDER BY f.created_at DESC
    `,
      [userId],
    );

    if (viewerId) {
      const [viewerFollows] = await db.query(
        "SELECT following_id FROM follows WHERE follower_id=?",
        [viewerId],
      );
      const set = new Set(viewerFollows.map((r) => r.following_id));
      rows.forEach((u) => {
        u.isFollowing = set.has(u.id);
      });
    }

    return ok(res, 200, `Following ${rows.length} users.`, rows);
  } catch (e) {
    console.error(e);
    return err(res, 500, "Server error.");
  }
});

// ============================================================
//  POSTS
// ============================================================

// GET /api/posts?userId=<id>&feed=global|following&page=<n>
//
//  page   – 1-based page number (default 1)
//  limit  – 15 posts per page (mobile-friendly)
//  feed   – 'following' returns only posts from followed users
//           'global'    returns all posts (default)
//
//  The algorithm scores posts using recency + engagement +
//  a follow-boost so followed users' posts rank higher.
app.get("/api/posts", async (req, res) => {
  const viewerUserId = parseInt(req.query.userId) || null;
  const feedMode = req.query.feed === "following" ? "following" : "global";
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const LIMIT = 15; // posts per page — small enough for mobile
  const OFFSET = (page - 1) * LIMIT;

  try {
    // Fetch IDs of users the viewer follows (needed for scoring + filtering)
    let followingIds = [];
    if (viewerUserId) {
      const [fRows] = await db.query(
        "SELECT following_id FROM follows WHERE follower_id=?",
        [viewerUserId],
      );
      followingIds = fRows.map((r) => r.following_id);
    }

    // Build WHERE clause for following-only feed
    let whereClause = "";
    let whereParams = [];
    if (feedMode === "following" && viewerUserId) {
      if (!followingIds.length) {
        // Following nobody → return empty page immediately
        return ok(res, 200, "Posts fetched.", {
          posts: [],
          hasMore: false,
          page,
        });
      }
      const ph = followingIds.map(() => "?").join(",");
      whereClause = `WHERE p.user_id IN (${ph})`;
      whereParams = followingIds;
    }

    // Fetch one page of raw posts
    const [rawPosts] = await db.query(
      `
      SELECT
        p.id,
        p.user_id          AS userId,
        u.name             AS author,
        u.picture          AS authorPicture,
        p.text,
        p.image,
        p.is_repost        AS isRepost,
        p.original_post_id AS originalPostId,
        p.created_at       AS createdAt
      FROM posts p
      JOIN users u ON u.id = p.user_id
      ${whereClause}
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `,
      [...whereParams, LIMIT + 1, OFFSET],
    );
    // Fetch LIMIT+1 so we know if there's a next page without a COUNT query

    const hasMore = rawPosts.length > LIMIT;
    const pagePosts = rawPosts.slice(0, LIMIT); // trim the extra row

    // Hydrate with engagement data (4 batch queries total, never N×queries)
    const posts = await hydratePosts(pagePosts);

    // Score and sort within this page
    posts.forEach((p) => {
      p._score = computeScore(p, viewerUserId, followingIds);
    });
    posts.sort((a, b) => b._score - a._score);
    posts.forEach((p) => delete p._score);

    return ok(res, 200, "Posts fetched.", { posts, hasMore, page });
  } catch (e) {
    console.error("Get posts error:", e);
    return err(res, 500, "Server error.");
  }
});

// POST /api/posts
app.post("/api/posts", requireAuth, async (req, res) => {
  const { text, image } = req.body;
  const userId = req.actorId;
  if (!text && !image)
    return err(res, 400, "A post must have text or an image.");
  try {
    const [u] = await db.query("SELECT id, name FROM users WHERE id=?", [
      userId,
    ]);
    if (!u.length) return err(res, 404, "User not found.");
    const [r] = await db.query(
      "INSERT INTO posts (user_id, text, image) VALUES (?,?,?)",
      [userId, text || null, image || null],
    );
    return ok(res, 201, "Posted.", {
      id: r.insertId,
      userId,
      author: u[0].name,
      text: text || "",
      image: image || null,
      likes: [],
      reposts: [],
      comments: [],
      isRepost: false,
      createdAt: new Date(),
    });
  } catch (e) {
    console.error(e);
    return err(res, 500, "Server error.");
  }
});

// DELETE /api/posts/:id
app.delete("/api/posts/:id", requireAuth, async (req, res) => {
  const postId = parseInt(req.params.id);
  try {
    const [rows] = await db.query("SELECT user_id FROM posts WHERE id=?", [
      postId,
    ]);
    if (!rows.length) return err(res, 404, "Post not found.");
    if (rows[0].user_id !== req.actorId) return err(res, 403, "Not your post.");
    await db.query("DELETE FROM posts WHERE id=?", [postId]);
    return ok(res, 200, "Post deleted.");
  } catch (e) {
    console.error(e);
    return err(res, 500, "Server error.");
  }
});

// ============================================================
//  COMMENTS
// ============================================================
app.post("/api/posts/:id/comment", requireAuth, async (req, res) => {
  const postId = parseInt(req.params.id);
  const userId = req.actorId;
  const { text } = req.body;
  if (!text) return err(res, 400, "Comment text is required.");
  try {
    const [post] = await db.query("SELECT id, user_id FROM posts WHERE id=?", [
      postId,
    ]);
    if (!post.length) return err(res, 404, "Post not found.");
    const [u] = await db.query(
      "SELECT id, name, picture FROM users WHERE id=?",
      [userId],
    );
    if (!u.length) return err(res, 404, "User not found.");
    const [r] = await db.query(
      "INSERT INTO comments (post_id, user_id, text) VALUES (?,?,?)",
      [postId, userId, text],
    );
    await createNotification(post[0].user_id, userId, "comment", postId);
    return ok(res, 201, "Comment added.", {
      id: r.insertId,
      userId,
      author: u[0].name,
      authorPicture: u[0].picture || null,
      text,
      createdAt: new Date(),
    });
  } catch (e) {
    console.error(e);
    return err(res, 500, "Server error.");
  }
});

// ============================================================
//  LIKES
// ============================================================
app.post("/api/posts/:id/like", requireAuth, async (req, res) => {
  const postId = parseInt(req.params.id);
  const userId = req.actorId;
  try {
    const [existing] = await db.query(
      "SELECT id FROM likes WHERE user_id=? AND post_id=?",
      [userId, postId],
    );
    if (existing.length) {
      await db.query("DELETE FROM likes WHERE user_id=? AND post_id=?", [
        userId,
        postId,
      ]);
      const [[{ total }]] = await db.query(
        "SELECT COUNT(*) AS total FROM likes WHERE post_id=?",
        [postId],
      );
      return ok(res, 200, "Unliked.", { likes: total, liked: false });
    } else {
      await db.query("INSERT INTO likes (user_id, post_id) VALUES (?,?)", [
        userId,
        postId,
      ]);
      const [[{ total }]] = await db.query(
        "SELECT COUNT(*) AS total FROM likes WHERE post_id=?",
        [postId],
      );
      const [[owner]] = await db.query("SELECT user_id FROM posts WHERE id=?", [
        postId,
      ]);
      if (owner)
        await createNotification(owner.user_id, userId, "like", postId);
      return ok(res, 200, "Liked.", { likes: total, liked: true });
    }
  } catch (e) {
    console.error(e);
    return err(res, 500, "Server error.");
  }
});

// ============================================================
//  REPOSTS
// ============================================================
app.post("/api/posts/:id/repost", requireAuth, async (req, res) => {
  const origId = parseInt(req.params.id);
  const userId = req.actorId;
  const { text } = req.body;
  try {
    const [orig] = await db.query("SELECT * FROM posts WHERE id=?", [origId]);
    if (!orig.length) return err(res, 404, "Original post not found.");
    const [u] = await db.query("SELECT id, name FROM users WHERE id=?", [
      userId,
    ]);
    if (!u.length) return err(res, 404, "User not found.");
    const [dup] = await db.query(
      "SELECT id FROM reposts WHERE user_id=? AND original_post_id=?",
      [userId, origId],
    );
    if (dup.length) return err(res, 409, "Already reposted.");

    const [pr] = await db.query(
      "INSERT INTO posts (user_id, text, is_repost, original_post_id) VALUES (?,?,1,?)",
      [userId, text || null, origId],
    );
    await db.query(
      "INSERT INTO reposts (user_id, original_post_id, repost_post_id) VALUES (?,?,?)",
      [userId, origId, pr.insertId],
    );

    const [origInfo] = await db.query(
      `SELECT p.id, u.name AS author, u.picture AS authorPicture, p.text, p.image
       FROM posts p JOIN users u ON u.id=p.user_id WHERE p.id=?`,
      [origId],
    );
    await createNotification(orig[0].user_id, userId, "repost", origId);

    return ok(res, 201, "Reposted.", {
      id: pr.insertId,
      userId,
      author: u[0].name,
      text: text || "",
      image: null,
      isRepost: true,
      originalPostId: origId,
      originalPost: origInfo[0] || null,
      likes: [],
      reposts: [],
      comments: [],
      createdAt: new Date(),
    });
  } catch (e) {
    console.error(e);
    return err(res, 500, "Server error.");
  }
});

// ============================================================
//  NOTIFICATIONS
// ============================================================

// GET /api/notifications/:userId
app.get("/api/notifications/:userId", async (req, res) => {
  const userId = parseInt(req.params.userId);
  try {
    const [rows] = await db.query(
      `
      SELECT n.id, n.type,
             n.is_read    AS isRead,
             n.created_at AS createdAt,
             n.post_id    AS postId,
             a.id         AS actorId,
             a.name       AS actorName,
             a.picture    AS actorPicture,
             LEFT(p.text,80) AS postSnippet
      FROM notifications n
      JOIN users a ON a.id = n.actor_id
      LEFT JOIN posts p ON p.id = n.post_id
      WHERE n.recipient_id=?
      ORDER BY n.created_at DESC
      LIMIT 50
    `,
      [userId],
    );
    return ok(res, 200, "Notifications fetched.", rows);
  } catch (e) {
    console.error(e);
    return err(res, 500, "Server error.");
  }
});

// GET /api/notifications/:userId/unread-count
app.get("/api/notifications/:userId/unread-count", async (req, res) => {
  const userId = parseInt(req.params.userId);
  try {
    const [[{ count }]] = await db.query(
      "SELECT COUNT(*) AS count FROM notifications WHERE recipient_id=? AND is_read=0",
      [userId],
    );
    return ok(res, 200, "Unread count.", { count });
  } catch (e) {
    return err(res, 500, "Server error.");
  }
});

// PUT /api/notifications/:userId/read-all
app.put("/api/notifications/:userId/read-all", async (req, res) => {
  const userId = parseInt(req.params.userId);
  try {
    await db.query("UPDATE notifications SET is_read=1 WHERE recipient_id=?", [
      userId,
    ]);
    return ok(res, 200, "All read.");
  } catch (e) {
    return err(res, 500, "Server error.");
  }
});

// PUT /api/notifications/:id/read
app.put("/api/notifications/:id/read", async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    await db.query("UPDATE notifications SET is_read=1 WHERE id=?", [id]);
    return ok(res, 200, "Marked read.");
  } catch (e) {
    return err(res, 500, "Server error.");
  }
});

// ============================================================
//  SEARCH
// ============================================================
app.get("/api/search", async (req, res) => {
  const q = (req.query.q || "").trim();
  const type = req.query.type === "people" ? "people" : "posts";
  if (q.length < 2)
    return err(res, 400, "Query must be at least 2 characters.");
  const like = `%${q}%`;
  try {
    if (type === "people") {
      const viewerId = parseInt(req.headers["x-user-id"]) || null;
      const [users] = await db.query(
        `
        SELECT u.id, u.name, u.email, u.picture,
               COUNT(p.id) AS postCount
        FROM users u
        LEFT JOIN posts p ON p.user_id=u.id AND p.is_repost=0
        WHERE u.name LIKE ? OR u.email LIKE ?
        GROUP BY u.id ORDER BY postCount DESC, u.name ASC LIMIT 20
      `,
        [like, like],
      );

      // Tag follow status
      if (viewerId) {
        const [fRows] = await db.query(
          "SELECT following_id FROM follows WHERE follower_id=?",
          [viewerId],
        );
        const set = new Set(fRows.map((r) => r.following_id));
        users.forEach((u) => {
          u.isFollowing = set.has(u.id);
        });
      }
      return ok(res, 200, `${users.length} results.`, users);
    } else {
      const [posts] = await db.query(
        `
        SELECT p.id, p.user_id AS userId, u.name AS author, u.picture AS authorPicture,
               p.text, p.image, p.is_repost AS isRepost, p.created_at AS createdAt,
               (SELECT COUNT(*) FROM likes    WHERE post_id=p.id) AS likeCount,
               (SELECT COUNT(*) FROM comments WHERE post_id=p.id) AS commentCount,
               (SELECT COUNT(*) FROM reposts  WHERE original_post_id=p.id) AS repostCount
        FROM posts p JOIN users u ON u.id=p.user_id
        WHERE p.text LIKE ? OR u.name LIKE ?
        ORDER BY likeCount DESC, p.created_at DESC LIMIT 20
      `,
        [like, like],
      );
      return ok(res, 200, `${posts.length} results.`, posts);
    }
  } catch (e) {
    console.error(e);
    return err(res, 500, "Server error.");
  }
});

// ============================================================
//  HEALTH CHECK & 404
// ============================================================
app.get("/", (req, res) => {
  res.json({
    message: "🔵 Circle API v4",
    database: "MySQL – circle_db",
    features: [
      "pagination (15/page)",
      "follow system",
      "follow-feed",
      "auth middleware",
      "notifications",
    ],
  });
});

app.use((req, res) => err(res, 404, `Route '${req.originalUrl}' not found.`));

app.listen(PORT, () =>
  console.log(`✅  Circle API running on http://localhost:${PORT}`),
);
