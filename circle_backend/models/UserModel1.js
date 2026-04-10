// ============================================================
//  models/UserModel.js
//  All database queries related to users.
// ============================================================

const { db } = require('../config/db');

async function findByEmail(email) {
  const [rows] = await db.query('SELECT * FROM users WHERE email=?', [email]);
  return rows[0] || null;
}

async function findById(id) {
  const [rows] = await db.query(
    'SELECT id, name, email, picture, created_at AS createdAt FROM users WHERE id=?',
    [id]
  );
  return rows[0] || null;
}

async function emailExists(email) {
  const [rows] = await db.query('SELECT id FROM users WHERE email=?', [email]);
  return rows.length > 0;
}

async function createUser(name, email, hashedPassword) {
  const [result] = await db.query(
    'INSERT INTO users (name, email, password) VALUES (?, ?, ?)',
    [name, email, hashedPassword]
  );
  return result.insertId;
}

async function updateUser(id, name, email) {
  await db.query('UPDATE users SET name=?, email=? WHERE id=?', [name, email, id]);
}

async function updateUserWithPassword(id, name, email, hashedPassword) {
  await db.query(
    'UPDATE users SET name=?, email=?, password=? WHERE id=?',
    [name, email, hashedPassword, id]
  );
}

async function updatePicture(id, picture) {
  await db.query('UPDATE users SET picture=? WHERE id=?', [picture, id]);
}

// Returns profile stats + isFollowing flag for the viewer
async function getProfile(targetId, viewerId = null) {
  const [rows] = await db.query(
    'SELECT id, name, email, picture FROM users WHERE id=?',
    [targetId]
  );
  if (!rows.length) return null;

  const [[{ postCount }]]      = await db.query(
    'SELECT COUNT(*) AS postCount      FROM posts   WHERE user_id=? AND is_repost=0', [targetId]
  );
  const [[{ followerCount }]]  = await db.query(
    'SELECT COUNT(*) AS followerCount  FROM follows WHERE following_id=?', [targetId]
  );
  const [[{ followingCount }]] = await db.query(
    'SELECT COUNT(*) AS followingCount FROM follows WHERE follower_id=?',  [targetId]
  );

  let isFollowing = false;
  if (viewerId && viewerId !== targetId) {
    const [f] = await db.query(
      'SELECT id FROM follows WHERE follower_id=? AND following_id=?',
      [viewerId, targetId]
    );
    isFollowing = f.length > 0;
  }

  return { ...rows[0], postCount, followerCount, followingCount, isFollowing };
}

async function emailTakenByOther(email, excludeId) {
  const [rows] = await db.query(
    'SELECT id FROM users WHERE email=? AND id!=?',
    [email, excludeId]
  );
  return rows.length > 0;
}

module.exports = {
  findByEmail,
  findById,
  emailExists,
  createUser,
  updateUser,
  updateUserWithPassword,
  updatePicture,
  getProfile,
  emailTakenByOther,
};
