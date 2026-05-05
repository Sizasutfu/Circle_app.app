// ============================================================
//  middleware/adminAuth.js
//  Protects all admin API routes.
//
//  Every admin request must include:
//    Authorization: Bearer <token>
//
//  The token is issued on admin login, stored in the
//  admin_sessions table, and expires after 8 hours.
//  If the token is missing, invalid, or expired → 401/403.
// ============================================================

const { db }        = require('../config/db');
const { sendError } = require('./response');

async function requireAdmin(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token      = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;

  if (!token)
    return sendError(res, 401, 'Admin token required.');

  try {
    // Look up the token in admin_sessions
    const [rows] = await db.query(
      `SELECT s.admin_id, s.expires_at, u.role, u.name
       FROM admin_sessions s
       JOIN users u ON u.id = s.admin_id
       WHERE s.token = ?`,
      [token]
    );

    if (!rows.length)
      return sendError(res, 401, 'Invalid or expired admin session.');

    const session = rows[0];

    // Check expiry
    if (new Date() > new Date(session.expires_at))
      return sendError(res, 401, 'Admin session expired. Please log in again.');

    // Double-check role in DB (prevents role-downgrade attacks)
    if (session.role !== 'admin')
      return sendError(res, 403, 'Access denied. Admin role required.');

    // Attach admin info for use in controllers
    req.adminId   = session.admin_id;
    req.adminName = session.name;
    next();

  } catch (err) {
    console.error('requireAdmin error:', err);
    return sendError(res, 500, 'Server error during auth check.');
  }
}

module.exports = { requireAdmin };
