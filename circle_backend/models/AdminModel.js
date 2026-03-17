// ============================================================
//  models/AdminModel.js
//  All database queries used exclusively by admin routes.
// ============================================================

const { db } = require('../config/db');
const crypto = require('crypto');

// ── Auth ───────────────────────────────────────────────────

async function findAdminByEmail(email) {
  const [rows] = await db.query(
    "SELECT * FROM users WHERE email=? AND role='admin'", [email]
  );
  return rows[0] || null;
}

async function createSession(adminId) {
  const token     = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000); // 8 hours
  await db.query(
    'INSERT INTO admin_sessions (admin_id, token, expires_at) VALUES (?,?,?)',
    [adminId, token, expiresAt]
  );
  return token;
}

async function deleteSession(token) {
  await db.query('DELETE FROM admin_sessions WHERE token=?', [token]);
}

// ── Dashboard stats ────────────────────────────────────────

async function getStats() {
  const [[{ totalUsers }]]    = await db.query('SELECT COUNT(*) AS totalUsers    FROM users   WHERE role="user"');
  const [[{ totalPosts }]]    = await db.query('SELECT COUNT(*) AS totalPosts    FROM posts   WHERE is_repost=0');
  const [[{ totalReposts }]]  = await db.query('SELECT COUNT(*) AS totalReposts  FROM posts   WHERE is_repost=1');
  const [[{ totalComments }]] = await db.query('SELECT COUNT(*) AS totalComments FROM comments');
  const [[{ newUsersToday }]] = await db.query(
    "SELECT COUNT(*) AS newUsersToday FROM users WHERE DATE(created_at)=CURDATE() AND role='user'"
  );
  const [[{ pendingReports }]] = await db.query(
    "SELECT COUNT(*) AS pendingReports FROM reports WHERE status='pending'"
  );
  return { totalUsers, totalPosts, totalReposts, totalComments, newUsersToday, pendingReports };
}

// ── User growth chart (last 30 days) ──────────────────────
async function getUserGrowth() {
  const [rows] = await db.query(`
    SELECT DATE(created_at) AS date, COUNT(*) AS count
    FROM users
    WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) AND role='user'
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `);
  return rows;
}

// ── Posts per day chart (last 30 days) ─────────────────────
async function getPostsPerDay() {
  const [rows] = await db.query(`
    SELECT DATE(created_at) AS date, COUNT(*) AS count
    FROM posts
    WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) AND is_repost=0
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `);
  return rows;
}

// ── Users ─────────────────────────────────────────────────

async function getAllUsers(search = '', page = 1, limit = 20) {
  const offset = (page - 1) * limit;
  const like   = `%${search}%`;
  const [rows] = await db.query(`
    SELECT id, name, email, picture, role, suspended, created_at AS joinDate,
           (SELECT COUNT(*) FROM posts   WHERE user_id=users.id AND is_repost=0) AS postCount,
           (SELECT COUNT(*) FROM follows WHERE following_id=users.id)            AS followerCount
    FROM users
    WHERE (name LIKE ? OR email LIKE ?) AND role='user'
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `, [like, like, limit, offset]);

  const [[{ total }]] = await db.query(
    "SELECT COUNT(*) AS total FROM users WHERE (name LIKE ? OR email LIKE ?) AND role='user'",
    [like, like]
  );
  return { users: rows, total };
}

async function suspendUser(userId) {
  await db.query('UPDATE users SET suspended=1 WHERE id=?', [userId]);
}

async function unsuspendUser(userId) {
  await db.query('UPDATE users SET suspended=0 WHERE id=?', [userId]);
}

async function deleteUser(userId) {
  await db.query('DELETE FROM users WHERE id=? AND role="user"', [userId]);
}

// ── Posts ─────────────────────────────────────────────────

async function getAllPosts(search = '', page = 1, limit = 20) {
  const offset = (page - 1) * limit;
  const like   = `%${search}%`;
  const [rows] = await db.query(`
    SELECT p.id, p.text, p.image, p.is_repost AS isRepost, p.created_at AS createdAt,
           u.id AS userId, u.name AS author, u.email AS authorEmail,
           (SELECT COUNT(*) FROM likes    WHERE post_id=p.id)           AS likeCount,
           (SELECT COUNT(*) FROM comments WHERE post_id=p.id)           AS commentCount,
           (SELECT COUNT(*) FROM reposts  WHERE original_post_id=p.id)  AS repostCount
    FROM posts p
    JOIN users u ON u.id=p.user_id
    WHERE (p.text LIKE ? OR u.name LIKE ?) AND p.is_repost=0
    ORDER BY p.created_at DESC
    LIMIT ? OFFSET ?
  `, [like, like, limit, offset]);

  const [[{ total }]] = await db.query(
    'SELECT COUNT(*) AS total FROM posts p JOIN users u ON u.id=p.user_id WHERE (p.text LIKE ? OR u.name LIKE ?) AND p.is_repost=0',
    [like, like]
  );
  return { posts: rows, total };
}

async function adminDeletePost(postId) {
  await db.query('DELETE FROM posts WHERE id=?', [postId]);
}

// ── Reports ───────────────────────────────────────────────

async function getReports(status = 'pending', page = 1, limit = 20) {
  const offset = (page - 1) * limit;
  const [rows] = await db.query(`
    SELECT r.id, r.reason, r.status, r.created_at AS reportedAt,
           p.id AS postId, p.text AS postText, p.image AS postImage,
           author.id AS authorId, author.name AS authorName,
           reporter.id AS reporterId, reporter.name AS reporterName
    FROM reports r
    JOIN posts p         ON p.id = r.post_id
    JOIN users author    ON author.id = p.user_id
    JOIN users reporter  ON reporter.id = r.reporter_id
    WHERE r.status = ?
    ORDER BY r.created_at DESC
    LIMIT ? OFFSET ?
  `, [status, limit, offset]);

  const [[{ total }]] = await db.query(
    'SELECT COUNT(*) AS total FROM reports WHERE status=?', [status]
  );
  return { reports: rows, total };
}

async function createReport(postId, reporterId, reason) {
  const [r] = await db.query(
    'INSERT INTO reports (post_id, reporter_id, reason) VALUES (?,?,?)',
    [postId, reporterId, reason]
  );
  return r.insertId;
}

async function resolveReport(reportId) {
  await db.query("UPDATE reports SET status='resolved' WHERE id=?", [reportId]);
}

async function ignoreReport(reportId) {
  await db.query("UPDATE reports SET status='ignored' WHERE id=?", [reportId]);
}

// ── Settings ──────────────────────────────────────────────

async function updateAdminPassword(adminId, hashedPassword) {
  await db.query('UPDATE users SET password=? WHERE id=?', [hashedPassword, adminId]);
}

module.exports = {
  findAdminByEmail, createSession, deleteSession,
  getStats, getUserGrowth, getPostsPerDay,
  getAllUsers, suspendUser, unsuspendUser, deleteUser,
  getAllPosts, adminDeletePost,
  getReports, createReport, resolveReport, ignoreReport,
  updateAdminPassword,
};
