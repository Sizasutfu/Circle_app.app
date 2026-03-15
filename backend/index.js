// ============================================================
//  Circle – Social Media App  |  Backend REST API
//  Feed algorithm: scored ranking by recency + engagement
// ============================================================

const express = require('express');
const mysql   = require('mysql2/promise');
const bcrypt  = require('bcrypt');

const app  = express();
const PORT = 5000;

// ── Middleware ─────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── Database pool ──────────────────────────────────────────
const db = mysql.createPool({
  host:     process.env.DB_HOST     || 'localhost',
  user:     process.env.DB_USER     || 'root',
  password: process.env.DB_PASSWORD || '706130027464516',
  database: process.env.DB_NAME     || 'circle_db',
  waitForConnections: true,
  connectionLimit:    10,
  queueLimit:         0,
});

(async () => {
  try {
    const conn = await db.getConnection();
    console.log('✅  Connected to MySQL database: circle_db');
    conn.release();
  } catch (e) {
    console.error('❌  MySQL connection failed:', e.message);
  }
})();

// ── Helpers ────────────────────────────────────────────────
const ok  = (res, status, message, data = null) =>
  res.status(status).json({ success: true, message, ...(data !== null && { data }) });
const err = (res, status, message) =>
  res.status(status).json({ success: false, message });



// ============================================================
//  NOTIFICATION HELPER
// ============================================================
//  Inserts a notification row.  Silently skips if the actor
//  is the same person as the recipient (no self-notifications).
//
//  type: 'like' | 'comment' | 'repost'
// ============================================================
async function createNotification(recipientId, actorId, type, postId) {
  if (recipientId === actorId) return;   // never notify yourself
  try {
    // Avoid duplicate notifications (e.g. rapid double-like)
    const [dup] = await db.query(
      `SELECT id FROM notifications
       WHERE recipient_id=? AND actor_id=? AND type=? AND post_id=?`,
      [recipientId, actorId, type, postId]
    );
    if (dup.length > 0) return;

    await db.query(
      `INSERT INTO notifications (recipient_id, actor_id, type, post_id)
       VALUES (?, ?, ?, ?)`,
      [recipientId, actorId, type, postId]
    );
  } catch (e) {
    console.error('createNotification error:', e.message);
  }
}

// ============================================================
//  FEED ALGORITHM
// ============================================================
//
//  Score formula (higher = shown first):
//
//    score = recencyScore
//          + (likes    × WEIGHT_LIKE)
//          + (comments × WEIGHT_COMMENT)
//          + (reposts  × WEIGHT_REPOST)
//          + (isOwnPost  ? BOOST_OWN    : 0)
//          + (isRepost   ? BOOST_REPOST : 0)
//
//  recencyScore uses a time-decay so that a fresh post with
//  zero engagement still outranks a 3-day-old post with 1 like:
//
//    recencyScore = RECENCY_SCALE / (hoursOld + RECENCY_SHIFT)
//
//  Tuning constants — adjust these to change feed behaviour:
// ============================================================

const WEIGHT_LIKE     = 3;    // each like  adds this many score points
const WEIGHT_COMMENT  = 5;    // comments are worth more (signals deeper interest)
const WEIGHT_REPOST   = 4;    // reposts signal strong endorsement
const BOOST_OWN       = 10;   // slight boost so users always see their own posts
const BOOST_REPOST    = 1;    // small bump for reposts (they recycle old content)
const RECENCY_SCALE   = 200;  // controls how strongly recency dominates
const RECENCY_SHIFT   = 2;    // prevents division by zero; smooths very new posts

function computeScore(post, viewerUserId) {
  const hoursOld    = (Date.now() - new Date(post.createdAt).getTime()) / 3_600_000;
  const recency     = RECENCY_SCALE / (hoursOld + RECENCY_SHIFT);
  const likeScore   = (post.likes?.length    || 0) * WEIGHT_LIKE;
  const commentScore= (post.comments?.length || 0) * WEIGHT_COMMENT;
  const repostScore = (post.reposts?.length  || 0) * WEIGHT_REPOST;
  const ownBoost    = post.userId === viewerUserId ? BOOST_OWN : 0;
  const repostBoost = post.isRepost ? BOOST_REPOST : 0;

  return recency + likeScore + commentScore + repostScore + ownBoost + repostBoost;
}


// ============================================================
//  USERS
// ============================================================

// POST /api/users/register
app.post('/api/users/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password)
    return err(res, 400, 'Name, email, and password are required.');

  try {
    const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length > 0)
      return err(res, 409, 'A user with that email already exists.');

    const hash = await bcrypt.hash(password, 10);
    const [result] = await db.query(
      'INSERT INTO users (name, email, password) VALUES (?, ?, ?)',
      [name, email, hash]
    );

    return ok(res, 201, 'User registered successfully.', {
      id: result.insertId, name, email, picture: null, createdAt: new Date(),
    });
  } catch (e) {
    console.error('Register error:', e);
    return err(res, 500, 'Server error. Please try again.');
  }
});

// POST /api/users/login
app.post('/api/users/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return err(res, 400, 'Email and password are required.');

  try {
    const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
    if (rows.length === 0)
      return err(res, 404, 'No account found with that email.');

    const user = rows[0];
    if (!await bcrypt.compare(password, user.password))
      return err(res, 401, 'Incorrect password.');

    const { password: _, ...safeUser } = user;
    return ok(res, 200, 'Login successful.', safeUser);
  } catch (e) {
    console.error('Login error:', e);
    return err(res, 500, 'Server error. Please try again.');
  }
});

// PUT /api/users/:id/picture
app.put('/api/users/:id/picture', async (req, res) => {
  const userId = parseInt(req.params.id);
  const { picture } = req.body;

  if (!userId) return err(res, 400, 'userId is required.');
  if (picture && picture.length > 7_000_000)
    return err(res, 413, 'Image is too large. Please use an image under 5 MB.');

  try {
    const [rows] = await db.query('SELECT id FROM users WHERE id = ?', [userId]);
    if (rows.length === 0) return err(res, 404, 'User not found.');

    await db.query('UPDATE users SET picture = ? WHERE id = ?', [picture || null, userId]);
    return ok(res, 200, 'Profile picture updated.', { picture: picture || null });
  } catch (e) {
    console.error('Picture update error:', e);
    return err(res, 500, 'Server error. Please try again.');
  }
});

// PUT /api/users/:id  –  update name / email / password
app.put('/api/users/:id', async (req, res) => {
  const userId = parseInt(req.params.id);
  const { name, email, password } = req.body;

  if (!name || !email)
    return err(res, 400, 'Name and email are required.');

  try {
    const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
    if (rows.length === 0) return err(res, 404, 'User not found.');

    const [conflict] = await db.query(
      'SELECT id FROM users WHERE email = ? AND id != ?', [email, userId]
    );
    if (conflict.length > 0) return err(res, 409, 'Email already in use.');

    if (password && password.length >= 6) {
      const hash = await bcrypt.hash(password, 10);
      await db.query('UPDATE users SET name=?, email=?, password=? WHERE id=?', [name, email, hash, userId]);
    } else {
      await db.query('UPDATE users SET name=?, email=? WHERE id=?', [name, email, userId]);
    }

    const [updated] = await db.query(
      'SELECT id, name, email, picture, created_at AS createdAt FROM users WHERE id=?', [userId]
    );
    return ok(res, 200, 'Profile updated.', updated[0]);
  } catch (e) {
    console.error('Update user error:', e);
    return err(res, 500, 'Server error. Please try again.');
  }
});


// ============================================================
//  POSTS
// ============================================================

// ── Shared helper: attach likes, reposts, comments, originalPost ──
async function hydratePosts(posts) {
  if (!posts.length) return posts;

  const postIds = posts.map(p => p.id);

  // Batch-fetch likes for all posts in one query
  const [allLikes] = await db.query(
    `SELECT user_id, post_id FROM likes WHERE post_id IN (${postIds.map(() => '?').join(',')})`,
    postIds
  );

  // Batch-fetch reposts
  const [allReposts] = await db.query(
    `SELECT user_id, original_post_id FROM reposts WHERE original_post_id IN (${postIds.map(() => '?').join(',')})`,
    postIds
  );

  // Batch-fetch comments
  const [allComments] = await db.query(
    `SELECT c.id, c.post_id, c.user_id AS userId, u.name AS author,
            u.picture AS authorPicture, c.text, c.created_at AS createdAt
     FROM comments c
     JOIN users u ON u.id = c.user_id
     WHERE c.post_id IN (${postIds.map(() => '?').join(',')})
     ORDER BY c.created_at ASC`,
    postIds
  );

  // Index by post_id
  const likesMap    = {};
  const repostsMap  = {};
  const commentsMap = {};
  postIds.forEach(id => { likesMap[id] = []; repostsMap[id] = []; commentsMap[id] = []; });

  allLikes.forEach(l   => likesMap[l.post_id]?.push(l.user_id));
  allReposts.forEach(r => repostsMap[r.original_post_id]?.push(r.user_id));
  allComments.forEach(c => commentsMap[c.post_id]?.push(c));

  // Collect originalPostIds that need embedding
  const originalIds = [...new Set(
    posts.filter(p => p.isRepost && p.originalPostId).map(p => p.originalPostId)
  )];

  let origMap = {};
  if (originalIds.length) {
    const [origRows] = await db.query(
      `SELECT p.id, u.name AS author, u.picture AS authorPicture, p.text, p.image
       FROM posts p JOIN users u ON u.id = p.user_id
       WHERE p.id IN (${originalIds.map(() => '?').join(',')})`,
      originalIds
    );
    origRows.forEach(o => { origMap[o.id] = o; });
  }

  // Attach everything to each post
  posts.forEach(post => {
    post.likes        = likesMap[post.id]    || [];
    post.reposts      = repostsMap[post.id]  || [];
    post.comments     = commentsMap[post.id] || [];
    if (post.isRepost && post.originalPostId)
      post.originalPost = origMap[post.originalPostId] || null;
  });

  return posts;
}

// ─────────────────────────────────────────────────────────────
// GET /api/posts?userId=<id>
//
//  Returns posts ranked by the Circle feed algorithm.
//  Pass ?userId=<id> so the algorithm can personalise scoring
//  (own-post boost, etc.).  Works without it too (guest feed).
// ─────────────────────────────────────────────────────────────
app.get('/api/posts', async (req, res) => {

  const viewerUserId = parseInt(req.query.userId) || null;

  const page = parseInt(req.query.page) || 1;
  const limit = 20;
  const offset = (page - 1) * limit;

  try {

    const [rawPosts] = await db.query(`
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
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `,[limit, offset]);

    const posts = await hydratePosts(rawPosts);

    posts.forEach(p => {
      p._score = computeScore(p, viewerUserId);
    });

    posts.sort((a,b)=> b._score - a._score);

    posts.forEach(p => delete p._score);

    return ok(res,200,'Posts fetched successfully.',posts);

  } catch (e) {
    console.error('Get posts error:', e);
    return err(res,500,'Server error.');
  }

});

// POST /api/posts
app.post('/api/posts', async (req, res) => {
  const { userId, text, image } = req.body;
  if (!userId)         return err(res, 400, 'userId is required.');
  if (!text && !image) return err(res, 400, 'A post must have text or an image.');

  try {
    const [userRows] = await db.query('SELECT id, name FROM users WHERE id = ?', [userId]);
    if (userRows.length === 0) return err(res, 404, 'User not found.');

    const [result] = await db.query(
      'INSERT INTO posts (user_id, text, image) VALUES (?, ?, ?)',
      [userId, text || null, image || null]
    );

    return ok(res, 201, 'Post created.', {
      id: result.insertId, userId,
      author: userRows[0].name,
      text: text || '', image: image || null,
      likes: [], reposts: [], comments: [],
      isRepost: false, createdAt: new Date(),
    });
  } catch (e) {
    console.error('Create post error:', e);
    return err(res, 500, 'Server error.');
  }
});

// DELETE /api/posts/:id
app.delete('/api/posts/:id', async (req, res) => {
  const postId = parseInt(req.params.id);
  try {
    const [rows] = await db.query('SELECT id FROM posts WHERE id = ?', [postId]);
    if (rows.length === 0) return err(res, 404, 'Post not found.');
    await db.query('DELETE FROM posts WHERE id = ?', [postId]);
    return ok(res, 200, 'Post deleted successfully.');
  } catch (e) {
    console.error('Delete post error:', e);
    return err(res, 500, 'Server error.');
  }
});


// ============================================================
//  COMMENTS
// ============================================================
app.post('/api/posts/:id/comment', async (req, res) => {
  const postId = parseInt(req.params.id);
  const { userId, text } = req.body;
  if (!userId || !text) return err(res, 400, 'userId and text are required.');

  try {
    const [postRows] = await db.query('SELECT id FROM posts WHERE id = ?', [postId]);
    if (postRows.length === 0) return err(res, 404, 'Post not found.');

    const [userRows] = await db.query('SELECT id, name, picture FROM users WHERE id = ?', [userId]);
    if (userRows.length === 0) return err(res, 404, 'User not found.');

    const [result] = await db.query(
      'INSERT INTO comments (post_id, user_id, text) VALUES (?, ?, ?)',
      [postId, userId, text]
    );

    // Notify the post owner
    const [[postOwner]] = await db.query('SELECT user_id FROM posts WHERE id=?', [postId]);
    if (postOwner) await createNotification(postOwner.user_id, userId, 'comment', postId);
    return ok(res, 201, 'Comment added.', {
      id: result.insertId, userId,
      author: userRows[0].name,
      authorPicture: userRows[0].picture || null,
      text, createdAt: new Date(),
    });
  } catch (e) {
    console.error('Comment error:', e);
    return err(res, 500, 'Server error.');
  }
});


// ============================================================
//  LIKES
// ============================================================
app.post('/api/posts/:id/like', async (req, res) => {
  const postId = parseInt(req.params.id);
  const { userId } = req.body;
  if (!userId) return err(res, 400, 'userId is required.');

  try {
    const [existing] = await db.query(
      'SELECT id FROM likes WHERE user_id = ? AND post_id = ?', [userId, postId]
    );
    if (existing.length > 0) {
      await db.query('DELETE FROM likes WHERE user_id = ? AND post_id = ?', [userId, postId]);
      const [[{ total }]] = await db.query('SELECT COUNT(*) AS total FROM likes WHERE post_id = ?', [postId]);
      return ok(res, 200, 'Post unliked.', { likes: total });
    } else {
      await db.query('INSERT INTO likes (user_id, post_id) VALUES (?, ?)', [userId, postId]);
      const [[{ total }]] = await db.query('SELECT COUNT(*) AS total FROM likes WHERE post_id = ?', [postId]);
      // Notify the post owner
      const [[postOwner]] = await db.query('SELECT user_id FROM posts WHERE id=?', [postId]);
      if (postOwner) await createNotification(postOwner.user_id, userId, 'like', postId);
      return ok(res, 200, 'Post liked.', { likes: total });
    }
  } catch (e) {
    console.error('Like error:', e);
    return err(res, 500, 'Server error.');
  }
});


// ============================================================
//  REPOSTS
// ============================================================
app.post('/api/posts/:id/repost', async (req, res) => {
  const originalPostId = parseInt(req.params.id);
  const { userId, text } = req.body;
  if (!userId) return err(res, 400, 'userId is required.');

  try {
    const [origRows] = await db.query('SELECT * FROM posts WHERE id = ?', [originalPostId]);
    if (origRows.length === 0) return err(res, 404, 'Original post not found.');

    const [userRows] = await db.query('SELECT id, name FROM users WHERE id = ?', [userId]);
    if (userRows.length === 0) return err(res, 404, 'User not found.');

    const [already] = await db.query(
      'SELECT id FROM reposts WHERE user_id = ? AND original_post_id = ?', [userId, originalPostId]
    );
    if (already.length > 0) return err(res, 409, 'You already reposted this post.');

    const [postResult] = await db.query(
      'INSERT INTO posts (user_id, text, is_repost, original_post_id) VALUES (?, ?, 1, ?)',
      [userId, text || null, originalPostId]
    );
    await db.query(
      'INSERT INTO reposts (user_id, original_post_id, repost_post_id) VALUES (?, ?, ?)',
      [userId, originalPostId, postResult.insertId]
    );

    const [origInfo] = await db.query(`
      SELECT p.id, u.name AS author, u.picture AS authorPicture, p.text, p.image
      FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = ?
    `, [originalPostId]);

    // Notify the original post owner
    const [[origOwner]] = await db.query('SELECT user_id FROM posts WHERE id=?', [originalPostId]);
    if (origOwner) await createNotification(origOwner.user_id, userId, 'repost', originalPostId);
    return ok(res, 201, 'Reposted successfully.', {
      id: postResult.insertId, userId,
      author: userRows[0].name,
      text: text || '', image: null,
      isRepost: true, originalPostId,
      originalPost: origInfo[0] || null,
      likes: [], reposts: [], comments: [],
      createdAt: new Date(),
    });
  } catch (e) {
    console.error('Repost error:', e);
    return err(res, 500, 'Server error.');
  }
});



// ============================================================
//  NOTIFICATIONS
// ============================================================

// GET /api/notifications/:userId
//   Returns the 30 most recent notifications for a user,
//   with actor name + picture and a snippet of the post text.
app.get('/api/notifications/:userId', async (req, res) => {
  const userId = parseInt(req.params.userId);
  if (!userId) return err(res, 400, 'userId is required.');

  try {
    const [rows] = await db.query(`
      SELECT
        n.id,
        n.type,
        n.is_read   AS isRead,
        n.created_at AS createdAt,
        n.post_id   AS postId,
        actor.id    AS actorId,
        actor.name  AS actorName,
        actor.picture AS actorPicture,
        LEFT(p.text, 80) AS postSnippet
      FROM notifications n
      JOIN users actor ON actor.id = n.actor_id
      LEFT JOIN posts p ON p.id = n.post_id
      WHERE n.recipient_id = ?
      ORDER BY n.created_at DESC
      LIMIT 30
    `, [userId]);

    return ok(res, 200, 'Notifications fetched.', rows);
  } catch (e) {
    console.error('Fetch notifications error:', e);
    return err(res, 500, 'Server error.');
  }
});

// GET /api/notifications/:userId/unread-count
app.get('/api/notifications/:userId/unread-count', async (req, res) => {
  const userId = parseInt(req.params.userId);
  try {
    const [[{ count }]] = await db.query(
      'SELECT COUNT(*) AS count FROM notifications WHERE recipient_id=? AND is_read=0',
      [userId]
    );
    return ok(res, 200, 'Unread count.', { count });
  } catch (e) {
    return err(res, 500, 'Server error.');
  }
});

// PUT /api/notifications/:userId/read-all
//   Marks every notification for this user as read.
app.put('/api/notifications/:userId/read-all', async (req, res) => {
  const userId = parseInt(req.params.userId);
  try {
    await db.query(
      'UPDATE notifications SET is_read=1 WHERE recipient_id=?', [userId]
    );
    return ok(res, 200, 'All notifications marked as read.');
  } catch (e) {
    return err(res, 500, 'Server error.');
  }
});

// PUT /api/notifications/:id/read
//   Marks a single notification as read.
app.put('/api/notifications/:id/read', async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    await db.query('UPDATE notifications SET is_read=1 WHERE id=?', [id]);
    return ok(res, 200, 'Notification marked as read.');
  } catch (e) {
    return err(res, 500, 'Server error.');
  }
});


// ============================================================
//  SEARCH
// ============================================================
//
//  GET /api/search?q=<term>&type=posts|people
//
//  Posts  – searches post text + author name, returns top 20
//           with aggregated like/comment/repost counts.
//  People – searches user name + email, returns top 20
//           with their post count.
// ============================================================
app.get('/api/search', async (req, res) => {
  const q    = (req.query.q    || '').trim();
  const type = (req.query.type || 'posts');

  if (!q || q.length < 2)
    return err(res, 400, 'Search query must be at least 2 characters.');

  const like = `%${q}%`;   // SQL LIKE pattern

  try {
    if (type === 'people') {
      // ── Search users ──────────────────────────────────────
      const [users] = await db.query(`
        SELECT
          u.id,
          u.name,
          u.email,
          u.picture,
          COUNT(p.id) AS postCount
        FROM users u
        LEFT JOIN posts p ON p.user_id = u.id AND p.is_repost = 0
        WHERE u.name LIKE ? OR u.email LIKE ?
        GROUP BY u.id
        ORDER BY postCount DESC, u.name ASC
        LIMIT 20
      `, [like, like]);

      return ok(res, 200, `Found ${users.length} people.`, users);

    } else {
      // ── Search posts ──────────────────────────────────────
      const [posts] = await db.query(`
        SELECT
          p.id,
          p.user_id          AS userId,
          u.name             AS author,
          u.picture          AS authorPicture,
          p.text,
          p.image,
          p.is_repost        AS isRepost,
          p.created_at       AS createdAt,
          (SELECT COUNT(*) FROM likes    WHERE post_id = p.id)              AS likeCount,
          (SELECT COUNT(*) FROM comments WHERE post_id = p.id)              AS commentCount,
          (SELECT COUNT(*) FROM reposts  WHERE original_post_id = p.id)     AS repostCount
        FROM posts p
        JOIN users u ON u.id = p.user_id
        WHERE p.text LIKE ? OR u.name LIKE ?
        ORDER BY likeCount DESC, p.created_at DESC
        LIMIT 20
      `, [like, like]);

      return ok(res, 200, `Found ${posts.length} posts.`, posts);
    }

  } catch (e) {
    console.error('Search error:', e);
    return err(res, 500, 'Server error.');
  }
});

// ============================================================
//  HEALTH CHECK & 404
// ============================================================
app.get('/', (req, res) => {
  res.json({
    message:   '🔵 Circle API is running.',
    database:  'MySQL (circle_db)',
    algorithm: {
      weights: { like: WEIGHT_LIKE, comment: WEIGHT_COMMENT, repost: WEIGHT_REPOST },
      boosts:  { ownPost: BOOST_OWN, repost: BOOST_REPOST },
      recency: { scale: RECENCY_SCALE, shift: RECENCY_SHIFT },
    },
  });
});

app.use((req, res) => {
  err(res, 404, `Route '${req.originalUrl}' not found.`);
});

app.listen(PORT, () => {
  console.log(`✅  Circle API running on http://localhost:${PORT}`);
});
