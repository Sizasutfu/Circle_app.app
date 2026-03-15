// ============================================================
//  Circle – Social Media App  |  Backend REST API
//  Now connected to MySQL via the 'mysql2' package.
// ============================================================

// 1. IMPORTS
const express = require('express');
const mysql   = require('mysql2/promise'); // mysql2 with Promise support
const bcrypt  = require('bcrypt');         // for hashing & checking passwords

// 2. APP SETUP
const app  = express();
const PORT = 5000;

// 3. MIDDLEWARE
app.use(express.json());

// Allow requests from your React / HTML frontend (CORS)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ============================================================
//  4. DATABASE CONNECTION POOL
//  A pool keeps several connections open so the app can handle
//  multiple requests at once without waiting.
//  Update the values below to match your MySQL setup.
// ============================================================
const db = mysql.createPool({
  host:     process.env.DB_HOST     || 'localhost',
  user:     process.env.DB_USER     || 'root',        // ← your MySQL username
  password: process.env.DB_PASSWORD || '76211582',            // ← your MySQL password
  database: process.env.DB_NAME     || 'circle_app',
  waitForConnections: true,
  connectionLimit:    10,
  queueLimit:         0,
});

// Test the connection when the server starts
(async () => {
  try {
    const conn = await db.getConnection();
    console.log('Connected to MySQL database: circle_app database');
    conn.release();
  } catch (err) {
    console.error('MySQL connection failed:', err.message);
    console.error('    Make sure MySQL is running and your credentials are correct.');
  }
})();

// ============================================================
//  HELPER
// ============================================================
const sendResponse = (res, status, success, message, data = null) => {
  const body = { success, message };
  if (data !== null) body.data = data;
  return res.status(status).json(body);
};

// ============================================================
//  SECTION A – USER ROUTES
// ============================================================

// ------------------------------------------------------------------
// POST /api/users/register
// ------------------------------------------------------------------
app.post('/api/users/register', async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password)
    return sendResponse(res, 400, false, 'Name, email, and password are required.');

  try {
    // Check if email already exists
    const [existing] = await db.query(
      'SELECT id FROM users WHERE email = ?', [email]
    );
    if (existing.length > 0)
      return sendResponse(res, 409, false, 'A user with that email already exists.');

    // Hash the password before storing (never store plain text!)
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert the new user
    const [result] = await db.query(
      'INSERT INTO users (name, email, password) VALUES (?, ?, ?)',
      [name, email, hashedPassword]
    );

    // Return the new user (without the password)
    return sendResponse(res, 201, true, 'User registered successfully.', {
      id:    result.insertId,
      name,
      email,
      createdAt: new Date(),
    });

  } catch (err) {
    console.error('Register error:', err);
    return sendResponse(res, 500, false, 'Server error. Please try again.');
  }
});

// ------------------------------------------------------------------
// POST /api/users/login
// ------------------------------------------------------------------
app.post('/api/users/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password)
    return sendResponse(res, 400, false, 'Email and password are required.');

  try {
    // Find the user by email
    const [rows] = await db.query(
      'SELECT * FROM users WHERE email = ?', [email]
    );
    if (rows.length === 0)
      return sendResponse(res, 404, false, 'No account found with that email.');

    const user = rows[0];

    // Compare the submitted password against the stored hash
    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch)
      return sendResponse(res, 401, false, 'Incorrect password.');

    // Return the user without the password field
    const { password: _, ...safeUser } = user;
    return sendResponse(res, 200, true, 'Login successful.', safeUser);

  } catch (err) {
    console.error('Login error:', err);
    return sendResponse(res, 500, false, 'Server error. Please try again.');
  }
});

// ============================================================
//  SECTION B – POST ROUTES
// ============================================================

// ------------------------------------------------------------------
// GET /api/posts  –  returns all posts with like/comment counts
//                    and the full comment + like lists embedded.
// ------------------------------------------------------------------
app.get('/api/posts', async (req, res) => {
  try {
    // Get all posts joined with author name, sorted newest first
    const [posts] = await db.query(`
      SELECT
        p.id,
        p.user_id        AS userId,
        u.name           AS author,
        p.text,
        p.image,
        p.is_repost      AS isRepost,
        p.original_post_id AS originalPostId,
        p.created_at     AS createdAt
      FROM posts p
      JOIN users u ON u.id = p.user_id
      ORDER BY p.created_at DESC
    `);

    // For each post, attach its likes (array of userIds) and comments
    for (const post of posts) {
      // Likes – just the array of user IDs (matches frontend expectation)
      const [likes] = await db.query(
        'SELECT user_id FROM likes WHERE post_id = ?', [post.id]
      );
      post.likes = likes.map(l => l.user_id);

      // Reposts count
      const [reposts] = await db.query(
        'SELECT user_id FROM reposts WHERE original_post_id = ?', [post.id]
      );
      post.reposts = reposts.map(r => r.user_id);

      // Comments – include author name
      const [comments] = await db.query(`
        SELECT c.id, c.user_id AS userId, u.name AS author, c.text, c.created_at AS createdAt
        FROM comments c
        JOIN users u ON u.id = c.user_id
        WHERE c.post_id = ?
        ORDER BY c.created_at ASC
      `, [post.id]);
      post.comments = comments;

      // If this is a repost, embed the original post's data
      if (post.isRepost && post.originalPostId) {
        const [origRows] = await db.query(`
          SELECT p.id, u.name AS author, p.text, p.image
          FROM posts p JOIN users u ON u.id = p.user_id
          WHERE p.id = ?
        `, [post.originalPostId]);
        post.originalPost = origRows[0] || null;
      }
    }

    return sendResponse(res, 200, true, 'Posts fetched successfully.', posts);

  } catch (err) {
    console.error('Get posts error:', err);
    return sendResponse(res, 500, false, 'Server error.');
  }
});

// ------------------------------------------------------------------
// POST /api/posts  –  create a new post
// ------------------------------------------------------------------
app.post('/api/posts', async (req, res) => {
  const { userId, text, image } = req.body;

  if (!userId)
    return sendResponse(res, 400, false, 'userId is required.');
  if (!text && !image)
    return sendResponse(res, 400, false, 'A post must have text or an image.');

  try {
    // Verify the user exists
    const [userRows] = await db.query('SELECT id, name FROM users WHERE id = ?', [userId]);
    if (userRows.length === 0)
      return sendResponse(res, 404, false, 'User not found.');

    const [result] = await db.query(
      'INSERT INTO posts (user_id, text, image) VALUES (?, ?, ?)',
      [userId, text || null, image || null]
    );

    return sendResponse(res, 201, true, 'Post created successfully.', {
      id:        result.insertId,
      userId,
      author:    userRows[0].name,
      text:      text || '',
      image:     image || null,
      likes:     [],
      reposts:   [],
      comments:  [],
      isRepost:  false,
      createdAt: new Date(),
    });

  } catch (err) {
    console.error('Create post error:', err);
    return sendResponse(res, 500, false, 'Server error.');
  }
});

// ------------------------------------------------------------------
// DELETE /api/posts/:id
// ------------------------------------------------------------------
app.delete('/api/posts/:id', async (req, res) => {
  const postId = parseInt(req.params.id);

  try {
    const [rows] = await db.query('SELECT * FROM posts WHERE id = ?', [postId]);
    if (rows.length === 0)
      return sendResponse(res, 404, false, 'Post not found.');

    // CASCADE in schema will auto-delete related likes, comments, reposts
    await db.query('DELETE FROM posts WHERE id = ?', [postId]);

    return sendResponse(res, 200, true, 'Post deleted successfully.');

  } catch (err) {
    console.error('Delete post error:', err);
    return sendResponse(res, 500, false, 'Server error.');
  }
});

// ============================================================
//  SECTION C – COMMENT ROUTES
// ============================================================

// ------------------------------------------------------------------
// POST /api/posts/:id/comment
// ------------------------------------------------------------------
app.post('/api/posts/:id/comment', async (req, res) => {
  const postId = parseInt(req.params.id);
  const { userId, text } = req.body;

  if (!userId || !text)
    return sendResponse(res, 400, false, 'userId and text are required.');

  try {
    // Verify post and user exist
    const [postRows] = await db.query('SELECT id FROM posts WHERE id = ?', [postId]);
    if (postRows.length === 0)
      return sendResponse(res, 404, false, 'Post not found.');

    const [userRows] = await db.query('SELECT id, name FROM users WHERE id = ?', [userId]);
    if (userRows.length === 0)
      return sendResponse(res, 404, false, 'User not found.');

    const [result] = await db.query(
      'INSERT INTO comments (post_id, user_id, text) VALUES (?, ?, ?)',
      [postId, userId, text]
    );

    return sendResponse(res, 201, true, 'Comment added successfully.', {
      id:        result.insertId,
      userId,
      author:    userRows[0].name,
      text,
      createdAt: new Date(),
    });

  } catch (err) {
    console.error('Comment error:', err);
    return sendResponse(res, 500, false, 'Server error.');
  }
});

// ============================================================
//  SECTION D – LIKE ROUTES
// ============================================================

// ------------------------------------------------------------------
// POST /api/posts/:id/like  –  toggle like/unlike
// ------------------------------------------------------------------
app.post('/api/posts/:id/like', async (req, res) => {
  const postId = parseInt(req.params.id);
  const { userId } = req.body;

  if (!userId)
    return sendResponse(res, 400, false, 'userId is required.');

  try {
    // Check if the user already liked this post
    const [existing] = await db.query(
      'SELECT id FROM likes WHERE user_id = ? AND post_id = ?',
      [userId, postId]
    );

    if (existing.length > 0) {
      // Already liked → unlike it
      await db.query('DELETE FROM likes WHERE user_id = ? AND post_id = ?', [userId, postId]);
      const [[{ total }]] = await db.query('SELECT COUNT(*) AS total FROM likes WHERE post_id = ?', [postId]);
      return sendResponse(res, 200, true, 'Post unliked.', { likes: total });
    } else {
      // Not liked yet → like it
      await db.query('INSERT INTO likes (user_id, post_id) VALUES (?, ?)', [userId, postId]);
      const [[{ total }]] = await db.query('SELECT COUNT(*) AS total FROM likes WHERE post_id = ?', [postId]);
      return sendResponse(res, 200, true, 'Post liked.', { likes: total });
    }

  } catch (err) {
    console.error('Like error:', err);
    return sendResponse(res, 500, false, 'Server error.');
  }
});

// ============================================================
//  SECTION E – REPOST ROUTES
// ============================================================

// ------------------------------------------------------------------
// POST /api/posts/:id/repost  –  repost an existing post
// ------------------------------------------------------------------
app.post('/api/posts/:id/repost', async (req, res) => {
  const originalPostId = parseInt(req.params.id);
  const { userId, text } = req.body;  // text = optional quote comment

  if (!userId)
    return sendResponse(res, 400, false, 'userId is required.');

  try {
    // Verify original post exists
    const [origRows] = await db.query('SELECT * FROM posts WHERE id = ?', [originalPostId]);
    if (origRows.length === 0)
      return sendResponse(res, 404, false, 'Original post not found.');

    // Verify user exists
    const [userRows] = await db.query('SELECT id, name FROM users WHERE id = ?', [userId]);
    if (userRows.length === 0)
      return sendResponse(res, 404, false, 'User not found.');

    // Check if already reposted
    const [already] = await db.query(
      'SELECT id FROM reposts WHERE user_id = ? AND original_post_id = ?',
      [userId, originalPostId]
    );
    if (already.length > 0)
      return sendResponse(res, 409, false, 'You already reposted this post.');

    // Create the new repost row in posts
    const [postResult] = await db.query(
      'INSERT INTO posts (user_id, text, is_repost, original_post_id) VALUES (?, ?, 1, ?)',
      [userId, text || null, originalPostId]
    );

    // Record it in the reposts table
    await db.query(
      'INSERT INTO reposts (user_id, original_post_id, repost_post_id) VALUES (?, ?, ?)',
      [userId, originalPostId, postResult.insertId]
    );

    // Fetch original post info for the embed
    const [origInfo] = await db.query(`
      SELECT p.id, u.name AS author, p.text, p.image
      FROM posts p JOIN users u ON u.id = p.user_id
      WHERE p.id = ?
    `, [originalPostId]);

    return sendResponse(res, 201, true, 'Reposted successfully.', {
      id:             postResult.insertId,
      userId,
      author:         userRows[0].name,
      text:           text || '',
      image:          null,
      isRepost:       true,
      originalPostId,
      originalPost:   origInfo[0] || null,
      likes:          [],
      reposts:        [],
      comments:       [],
      createdAt:      new Date(),
    });

  } catch (err) {
    console.error('Repost error:', err);
    return sendResponse(res, 500, false, 'Server error.');
  }
});

// ============================================================
//  SECTION F – HEALTH CHECK
// ============================================================
app.get('/', (req, res) => {
  res.json({
    message: '🔵 Circle API is running.',
    database: 'MySQL (circle_app)',
    endpoints: {
      users:    ['POST /api/users/register', 'POST /api/users/login'],
      posts:    ['GET /api/posts', 'POST /api/posts', 'DELETE /api/posts/:id'],
      comments: ['POST /api/posts/:id/comment'],
      likes:    ['POST /api/posts/:id/like'],
      reposts:  ['POST /api/posts/:id/repost'],
    },
  });
});

// ============================================================
//  SECTION G – 404 HANDLER
// ============================================================
app.use((req, res) => {
  sendResponse(res, 404, false, `Route '${req.originalUrl}' not found.`);
});

// ============================================================
//  SECTION H – START SERVER
// ============================================================
app.listen(PORT, () => {
  console.log(`✅  Circle API running on http://localhost:${PORT}`);
});