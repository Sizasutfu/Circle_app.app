const { db } = require("../config/db");

const UserModel = {
  // ─── Lookup ────────────────────────────────────────────────────────────────

  async findByEmail(email) {
    const [rows] = await db.query(
      "SELECT id, name, email, password FROM users WHERE email = ?",
      [email]
    );
    return rows[0] || null;
  },

  async findById(id) {
    const [rows] = await db.query(
      "SELECT id, name, email, bio, picture, created_at AS createdAt FROM users WHERE id = ?",
      [id]
    );
    return rows[0] || null;
  },

  async emailExists(email) {
    const [rows] = await db.query("SELECT id FROM users WHERE email = ?", [email]);
    return rows.length > 0;
  },

  async emailTakenByOther(email, excludeId) {
    const [rows] = await db.query(
      "SELECT id FROM users WHERE email = ? AND id != ?",
      [email, excludeId]
    );
    return rows.length > 0;
  },

  // ─── Create ────────────────────────────────────────────────────────────────

  async createUser(name, email, hashedPassword) {
    const [result] = await db.query(
      "INSERT INTO users (name, email, password) VALUES (?, ?, ?)",
      [name, email, hashedPassword]
    );
    return result.insertId;
  },

  // ─── Update ────────────────────────────────────────────────────────────────

  async updateUser(id, name, email, bio = null) {
    await db.query(
      "UPDATE users SET name = ?, email = ?, bio = ? WHERE id = ?",
      [name, email, bio, id]
    );
  },

  async updateUserWithPassword(id, name, email, hashedPassword, bio = null) {
    await db.query(
      "UPDATE users SET name = ?, email = ?, password = ?, bio = ? WHERE id = ?",
      [name, email, hashedPassword, bio, id]
    );
  },

  async updatePicture(id, picture) {
    await db.query("UPDATE users SET picture = ? WHERE id = ?", [picture, id]);
  },

  // ─── Profile ───────────────────────────────────────────────────────────────

  async getProfile(targetId, viewerId = null) {
    const [rows] = await db.query(
      "SELECT id, name, email, bio, picture FROM users WHERE id = ?",
      [targetId]
    );
    if (!rows.length) return null;

    const [[{ postCount }]] = await db.query(
      "SELECT COUNT(*) AS postCount FROM posts WHERE user_id = ? AND is_repost = 0",
      [targetId]
    );
    const [[{ followerCount }]] = await db.query(
      "SELECT COUNT(*) AS followerCount FROM follows WHERE following_id = ?",
      [targetId]
    );
    const [[{ followingCount }]] = await db.query(
      "SELECT COUNT(*) AS followingCount FROM follows WHERE follower_id = ?",
      [targetId]
    );

    let isFollowing = false;
    if (viewerId && viewerId !== targetId) {
      const [f] = await db.query(
        "SELECT id FROM follows WHERE follower_id = ? AND following_id = ?",
        [viewerId, targetId]
      );
      isFollowing = f.length > 0;
    }

    return { ...rows[0], postCount, followerCount, followingCount, isFollowing };
  },

  // ─── Search ────────────────────────────────────────────────────────────────

  async searchUsers(query, excludeId, limit = 10) {
    const like = `%${query}%`;
    const [rows] = await db.query(
      `SELECT id, name, email, picture
       FROM users
       WHERE (name LIKE ? OR email LIKE ?)
         AND id != ?
       ORDER BY name ASC
       LIMIT ?`,
      [like, like, excludeId, limit]
    );
    return rows;
  },

  // ─── Password Reset ────────────────────────────────────────────────────────

  async saveResetToken(userId, token, expires) {
    await db.query(
      "UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?",
      [token, expires, userId]
    );
  },

  async findByValidResetToken(token) {
    const [rows] = await db.query(
      "SELECT id FROM users WHERE reset_token = ? AND reset_token_expires > NOW()",
      [token]
    );
    return rows[0] || null;
  },

  async updatePasswordAndClearToken(userId, hashedPassword) {
    await db.query(
      "UPDATE users SET password = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?",
      [hashedPassword, userId]
    );
  },

  
};

// ============================================================
//  ADD THIS FUNCTION to models/userModel.js
//  Then add 'getNewMembers' to the module.exports at the bottom.
// ============================================================

// ── New members (joined in last 7 days) ───────────────────
// Excludes the viewer and users they already follow.
async function getNewMembers(viewerId, limit = 10) {
  let query, params;

  if (viewerId) {
    query = `
      SELECT
        u.id,
        u.name,
        u.picture,
        u.created_at AS createdAt
      FROM users u
      WHERE u.created_at >= NOW() - INTERVAL 7 DAY
        AND u.id != ?
        AND u.id NOT IN (
          SELECT following_id FROM follows WHERE follower_id = ?
        )
      ORDER BY u.created_at DESC
      LIMIT ?
    `;
    params = [viewerId, viewerId, limit];
  } else {
    query = `
      SELECT
        u.id,
        u.name,
        u.picture,
        u.created_at AS createdAt
      FROM users u
      WHERE u.created_at >= NOW() - INTERVAL 7 DAY
      ORDER BY u.created_at DESC
      LIMIT ?
    `;
    params = [limit];
  }

  const [rows] = await db.query(query, params);
  return rows;
}


//module.exports = ;
module.exports = {...UserModel, getNewMembers };