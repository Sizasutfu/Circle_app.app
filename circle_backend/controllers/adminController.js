// ============================================================
//  controllers/adminController.js
//  Handles all admin API requests.
//  No SQL lives here — all queries go through AdminModel.
// ============================================================

const bcrypt     = require('bcrypt');
const AdminModel = require('../models/AdminModel');
const { sendOk, sendError } = require('../middleware/response');

// ── AUTH ───────────────────────────────────────────────────

// POST /api/admin/login
async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password)
    return sendError(res, 400, 'Email and password are required.');

  try {
    const admin = await AdminModel.findAdminByEmail(email);
    if (!admin)
      return sendError(res, 404, 'No admin account with that email.');

    const match = await bcrypt.compare(password, admin.password);
    if (!match)
      return sendError(res, 401, 'Wrong password.');

    const token = await AdminModel.createSession(admin.id);

    return sendOk(res, 200, 'Admin login successful.', {
      token,
      admin: { id: admin.id, name: admin.name, email: admin.email },
    });
  } catch (err) {
    console.error('admin login error:', err);
    return sendError(res, 500, 'Server error.');
  }
}

// POST /api/admin/logout
async function logout(req, res) {
  const token = req.headers['authorization']?.slice(7);
  try {
    if (token) await AdminModel.deleteSession(token);
    return sendOk(res, 200, 'Logged out.');
  } catch (err) {
    return sendError(res, 500, 'Server error.');
  }
}

// ── DASHBOARD ──────────────────────────────────────────────

// GET /api/admin/stats
async function getStats(req, res) {
  try {
    const stats = await AdminModel.getStats();
    return sendOk(res, 200, 'Stats fetched.', stats);
  } catch (err) {
    console.error('getStats error:', err);
    return sendError(res, 500, 'Server error.');
  }
}

// GET /api/admin/charts
async function getCharts(req, res) {
  try {
    const [userGrowth, postsPerDay] = await Promise.all([
      AdminModel.getUserGrowth(),
      AdminModel.getPostsPerDay(),
    ]);
    return sendOk(res, 200, 'Chart data fetched.', { userGrowth, postsPerDay });
  } catch (err) {
    console.error('getCharts error:', err);
    return sendError(res, 500, 'Server error.');
  }
}

// ── USERS ─────────────────────────────────────────────────

// GET /api/admin/users?search=&page=
async function getUsers(req, res) {
  const search = (req.query.search || '').trim();
  const page   = Math.max(1, parseInt(req.query.page) || 1);
  try {
    const result = await AdminModel.getAllUsers(search, page);
    return sendOk(res, 200, 'Users fetched.', result);
  } catch (err) {
    console.error('admin getUsers error:', err);
    return sendError(res, 500, 'Server error.');
  }
}

// PUT /api/admin/users/:id/suspend
async function suspendUser(req, res) {
  const userId = parseInt(req.params.id);
  try {
    await AdminModel.suspendUser(userId);
    return sendOk(res, 200, 'User suspended.');
  } catch (err) {
    console.error('suspendUser error:', err);
    return sendError(res, 500, 'Server error.');
  }
}

// PUT /api/admin/users/:id/unsuspend
async function unsuspendUser(req, res) {
  const userId = parseInt(req.params.id);
  try {
    await AdminModel.unsuspendUser(userId);
    return sendOk(res, 200, 'User unsuspended.');
  } catch (err) {
    console.error('unsuspendUser error:', err);
    return sendError(res, 500, 'Server error.');
  }
}

// DELETE /api/admin/users/:id
async function deleteUser(req, res) {
  const userId = parseInt(req.params.id);
  try {
    await AdminModel.deleteUser(userId);
    return sendOk(res, 200, 'User deleted.');
  } catch (err) {
    console.error('admin deleteUser error:', err);
    return sendError(res, 500, 'Server error.');
  }
}

// ── POSTS ─────────────────────────────────────────────────

// GET /api/admin/posts?search=&page=
async function getPosts(req, res) {
  const search = (req.query.search || '').trim();
  const page   = Math.max(1, parseInt(req.query.page) || 1);
  try {
    const result = await AdminModel.getAllPosts(search, page);
    return sendOk(res, 200, 'Posts fetched.', result);
  } catch (err) {
    console.error('admin getPosts error:', err);
    return sendError(res, 500, 'Server error.');
  }
}

// DELETE /api/admin/posts/:id
async function deletePost(req, res) {
  const postId = parseInt(req.params.id);
  try {
    await AdminModel.adminDeletePost(postId);
    return sendOk(res, 200, 'Post deleted.');
  } catch (err) {
    console.error('admin deletePost error:', err);
    return sendError(res, 500, 'Server error.');
  }
}

// ── REPORTS ───────────────────────────────────────────────

// GET /api/admin/reports?status=pending&page=
async function getReports(req, res) {
  const status = req.query.status || 'pending';
  const page   = Math.max(1, parseInt(req.query.page) || 1);
  try {
    const result = await AdminModel.getReports(status, page);
    return sendOk(res, 200, 'Reports fetched.', result);
  } catch (err) {
    console.error('getReports error:', err);
    return sendError(res, 500, 'Server error.');
  }
}

// POST /api/admin/reports  — called from the MAIN app by logged-in users
async function createReport(req, res) {
  const { postId, reason } = req.body;
  const reporterId = req.actorId;  // set by requireAuth middleware
  if (!postId || !reason)
    return sendError(res, 400, 'Post ID and reason are required.');
  if (reason.trim().length < 5)
    return sendError(res, 400, 'Please provide a more detailed reason (min 5 characters).');
  try {
    const id = await AdminModel.createReport(postId, reporterId, reason.trim());
    return sendOk(res, 201, 'Report submitted. Thank you for keeping Circle safe.', { id });
  } catch (err) {
    console.error('createReport error:', err);
    return sendError(res, 500, 'Server error.');
  }
}

// PUT /api/admin/reports/:id/resolve
async function resolveReport(req, res) {
  const reportId = parseInt(req.params.id);
  try {
    await AdminModel.resolveReport(reportId);
    return sendOk(res, 200, 'Report resolved.');
  } catch (err) {
    return sendError(res, 500, 'Server error.');
  }
}

// PUT /api/admin/reports/:id/ignore
async function ignoreReport(req, res) {
  const reportId = parseInt(req.params.id);
  try {
    await AdminModel.ignoreReport(reportId);
    return sendOk(res, 200, 'Report ignored.');
  } catch (err) {
    return sendError(res, 500, 'Server error.');
  }
}

// ── SETTINGS ──────────────────────────────────────────────

// PUT /api/admin/settings/password
// req.adminId is set by requireAdmin middleware — no need to re-fetch by email
async function updatePassword(req, res) {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword)
    return sendError(res, 400, 'Both current and new password are required.');
  if (newPassword.length < 8)
    return sendError(res, 400, 'New password must be at least 8 characters.');

  try {
    const { db } = require('../config/db');

    // Fetch the full admin row (need the hashed password to compare)
    const [[admin]] = await db.query(
      "SELECT * FROM users WHERE id=? AND role='admin'",
      [req.adminId]
    );
    if (!admin) return sendError(res, 404, 'Admin account not found.');

    const match = await bcrypt.compare(currentPassword, admin.password);
    if (!match) return sendError(res, 401, 'Current password is incorrect.');

    const hash = await bcrypt.hash(newPassword, 10);
    await AdminModel.updateAdminPassword(req.adminId, hash);

    return sendOk(res, 200, 'Password updated successfully.');
  } catch (err) {
    console.error('updatePassword error:', err);
    return sendError(res, 500, 'Server error.');
  }
}

module.exports = {
  login, logout,
  getStats, getCharts,
  getUsers, suspendUser, unsuspendUser, deleteUser,
  getPosts, deletePost,
  getReports, createReport, resolveReport, ignoreReport,
  updatePassword,
};
