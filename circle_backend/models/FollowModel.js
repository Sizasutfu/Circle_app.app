// ============================================================
//  models/FollowModel.js
//  All database queries related to the follow system.
// ============================================================

const { db } = require('../config/db');

async function getFollow(followerId, followingId) {
  const [rows] = await db.query(
    'SELECT id FROM follows WHERE follower_id=? AND following_id=?',
    [followerId, followingId]
  );
  return rows[0] || null;
}

async function addFollow(followerId, followingId) {
  await db.query(
    'INSERT INTO follows (follower_id, following_id) VALUES (?,?)',
    [followerId, followingId]
  );
}

async function removeFollow(followerId, followingId) {
  await db.query(
    'DELETE FROM follows WHERE follower_id=? AND following_id=?',
    [followerId, followingId]
  );
}

async function getFollowerCount(userId) {
  const [[{ count }]] = await db.query(
    'SELECT COUNT(*) AS count FROM follows WHERE following_id=?',
    [userId]
  );
  return count;
}

// Returns list of users who follow userId, tagged with isFollowing for viewer
async function getFollowers(userId, viewerId) {
  const [rows] = await db.query(
    `SELECT u.id, u.name, u.picture,
            (SELECT COUNT(*) FROM posts WHERE user_id=u.id AND is_repost=0) AS postCount
     FROM follows f
     JOIN users u ON u.id = f.follower_id
     WHERE f.following_id=?
     ORDER BY f.created_at DESC`,
    [userId]
  );
  return tagFollowStatus(rows, viewerId);
}

// Returns list of users that userId follows, tagged with isFollowing for viewer
async function getFollowing(userId, viewerId) {
  const [rows] = await db.query(
    `SELECT u.id, u.name, u.picture,
            (SELECT COUNT(*) FROM posts WHERE user_id=u.id AND is_repost=0) AS postCount
     FROM follows f
     JOIN users u ON u.id = f.following_id
     WHERE f.follower_id=?
     ORDER BY f.created_at DESC`,
    [userId]
  );
  return tagFollowStatus(rows, viewerId);
}

// Adds isFollowing:true/false to each user based on whether viewerId follows them
async function tagFollowStatus(users, viewerId) {
  if (!viewerId || !users.length) return users;
  const [fRows] = await db.query(
    'SELECT following_id FROM follows WHERE follower_id=?',
    [viewerId]
  );
  const followingSet = new Set(fRows.map(r => r.following_id));
  return users.map(u => ({ ...u, isFollowing: followingSet.has(u.id) }));
}

// Used by search to tag follow status on people results
async function getFollowingSet(viewerId) {
  if (!viewerId) return new Set();
  const [rows] = await db.query(
    'SELECT following_id FROM follows WHERE follower_id=?',
    [viewerId]
  );
  return new Set(rows.map(r => r.following_id));
}

// ── Returns a plain array of user IDs who follow the given userId ──
// Used for fan-out notifications (new_post, profile_pic).
async function getFollowerIds(userId) {
  const [rows] = await db.query(
    'SELECT follower_id FROM follows WHERE following_id = ?',
    [userId]
  );
  return rows.map(r => r.follower_id);
}

module.exports = {
  getFollow,
  addFollow,
  removeFollow,
  getFollowerCount,
  getFollowers,
  getFollowing,
  getFollowingSet,
  getFollowerIds,
};
