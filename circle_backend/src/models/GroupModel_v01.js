// ============================================================
//  models/GroupModel.js
//  Database logic for Circle's auto-created topic groups.
//
//  Auto-creation rules
//  ───────────────────
//  A cron job (runGroupCreationCron) checks every hour.
//  Any topic that has ≥ MIN_POSTS_TO_CREATE posts in the
//  last 7 days, and does NOT already have a group row, gets
//  a group created automatically.
//
//  Membership rules
//  ────────────────
//  Users are NEVER auto-added. Every member row is the result
//  of the user explicitly pressing "Join". joinGroup() &
//  leaveGroup() are the only writes to group_members.
// ============================================================

const { db } = require('../config/db');
const cron   = require('node-cron');

// ── Thresholds (tune here) ─────────────────────────────────
const MIN_POSTS_TO_CREATE = 30; // posts in 7 days → auto-create group
const CRON_SCHEDULE       = '0 * * * *'; // every hour on the hour

// ── Auto-creation cron ────────────────────────────────────
/**
 * Checks for topics that have crossed the MIN_POSTS_TO_CREATE
 * threshold in the last 7 days and creates a group for any
 * that don't already have one.
 *
 * Called automatically when startGroupCron() is invoked from
 * your app bootstrap (e.g. app.js / server.js).
 *
 * @returns {Promise<string[]>}  Topics newly promoted to groups
 */
async function runGroupCreationCron() {
  // 1. Find qualifying topics not yet in the `groups` table
  const [rows] = await db.query(
    `SELECT v.topic, v.post_count_7d
     FROM v_topic_post_counts_7d v
     LEFT JOIN \`groups\` g ON g.topic = v.topic
     WHERE v.post_count_7d >= ?
       AND g.id IS NULL`,
    [MIN_POSTS_TO_CREATE]
  );

  if (!rows.length) return [];

  const created = [];

  for (const row of rows) {
    const topic       = row.topic.toLowerCase().trim();
    const displayName = `#${topic}`;
    const description = `Conversations about #${topic} — join to see posts from members on this topic.`;

    await db.query(
      `INSERT IGNORE INTO \`groups\` (topic, display_name, description, post_count)
       VALUES (?, ?, ?, ?)`,
      [topic, displayName, description, row.post_count_7d]
    );

    created.push(topic);
    console.log(`[GroupModel] Auto-created group for topic: #${topic} (${row.post_count_7d} posts / 7d)`);
  }

  // 2. Also refresh post_count on existing groups
  await db.query(
    `UPDATE \`groups\` g
     JOIN v_topic_post_counts_7d v ON v.topic = g.topic
     SET g.post_count = v.post_count_7d`
  );

  return created;
}

/**
 * Register the cron schedule. Call once from app bootstrap.
 *   const { startGroupCron } = require('./models/GroupModel');
 *   startGroupCron();
 */
function startGroupCron() {
  cron.schedule(CRON_SCHEDULE, async () => {
    try {
      const created = await runGroupCreationCron();
      if (created.length) {
        console.log(`[GroupCron] Created ${created.length} new group(s):`, created);
      }
    } catch (err) {
      console.error('[GroupCron] Error during group creation check:', err);
    }
  });

  // Also run once immediately on startup so groups are up-to-date
  runGroupCreationCron().catch(err => {
    console.error('[GroupCron] Startup run failed:', err);
  });

  console.log('[GroupCron] Scheduled —', CRON_SCHEDULE);
}

// ── Fetch a paginated list of groups (Explore) ────────────
/**
 * Returns groups ordered by member_count DESC, post_count DESC.
 * Pass userId to include a `isMember` boolean on each row.
 */
async function getTrendingGroups({ limit = 20, offset = 0, userId = null } = {}) {
  limit  = Math.min(50, Math.max(1, limit));
  offset = Math.max(0, offset);

  if (userId) {
    const [rows] = await db.query(
      `SELECT
         g.id,
         g.topic,
         g.display_name  AS displayName,
         g.description,
         g.cover_image   AS coverImage,
         g.member_count  AS memberCount,
         g.post_count    AS postCount,
         g.created_at    AS createdAt,
         IF(gm.user_id IS NOT NULL, 1, 0) AS isMember
       FROM \`groups\` g
       LEFT JOIN group_members gm
         ON gm.group_id = g.id AND gm.user_id = ?
       ORDER BY g.member_count DESC, g.post_count DESC
       LIMIT ? OFFSET ?`,
      [userId, limit + 1, offset]
    );
    const hasMore = rows.length > limit;
    return { groups: rows.slice(0, limit).map(normalise), hasMore };
  }

  const [rows] = await db.query(
    `SELECT
       id,
       topic,
       display_name  AS displayName,
       description,
       cover_image   AS coverImage,
       member_count  AS memberCount,
       post_count    AS postCount,
       created_at    AS createdAt,
       0             AS isMember
     FROM \`groups\`
     ORDER BY member_count DESC, post_count DESC
     LIMIT ? OFFSET ?`,
    [limit + 1, offset]
  );
  const hasMore = rows.length > limit;
  return { groups: rows.slice(0, limit).map(normalise), hasMore };
}

// ── Get a single group by topic slug ─────────────────────
async function getGroupByTopic(topic, userId = null) {
  topic = topic.toLowerCase().trim();

  if (userId) {
    const [[row]] = await db.query(
      `SELECT
         g.id,
         g.topic,
         g.display_name  AS displayName,
         g.description,
         g.cover_image   AS coverImage,
         g.member_count  AS memberCount,
         g.post_count    AS postCount,
         g.created_at    AS createdAt,
         IF(gm.user_id IS NOT NULL, 1, 0) AS isMember
       FROM \`groups\` g
       LEFT JOIN group_members gm
         ON gm.group_id = g.id AND gm.user_id = ?
       WHERE g.topic = ?`,
      [userId, topic]
    );
    return row ? normalise(row) : null;
  }

  const [[row]] = await db.query(
    `SELECT
       id, topic,
       display_name AS displayName, description,
       cover_image  AS coverImage,
       member_count AS memberCount,
       post_count   AS postCount,
       created_at   AS createdAt,
       0            AS isMember
     FROM \`groups\` WHERE topic = ?`,
    [topic]
  );
  return row ? normalise(row) : null;
}

// ── Get a single group by id ──────────────────────────────
async function getGroupById(groupId, userId = null) {
  const [[row]] = userId
    ? await db.query(
        `SELECT g.id, g.topic, g.display_name AS displayName, g.description,
                g.cover_image AS coverImage, g.member_count AS memberCount,
                g.post_count AS postCount, g.created_at AS createdAt,
                IF(gm.user_id IS NOT NULL, 1, 0) AS isMember
         FROM \`groups\` g
         LEFT JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = ?
         WHERE g.id = ?`,
        [userId, groupId]
      )
    : await db.query(
        `SELECT id, topic, display_name AS displayName, description,
                cover_image AS coverImage, member_count AS memberCount,
                post_count AS postCount, created_at AS createdAt, 0 AS isMember
         FROM \`groups\` WHERE id = ?`,
        [groupId]
      );

  return row ? normalise(row) : null;
}

// ── Join a group (explicit opt-in only) ──────────────────
async function joinGroup(userId, groupId) {
  // INSERT IGNORE silently skips if already a member
  const [result] = await db.query(
    `INSERT IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)`,
    [groupId, userId]
  );

  if (result.affectedRows > 0) {
    // Only increment if the row was actually inserted (not a duplicate)
    await db.query(
      `UPDATE \`groups\` SET member_count = member_count + 1 WHERE id = ?`,
      [groupId]
    );
    return true; // newly joined
  }

  return false; // was already a member
}

// ── Leave a group ─────────────────────────────────────────
async function leaveGroup(userId, groupId) {
  const [result] = await db.query(
    `DELETE FROM group_members WHERE group_id = ? AND user_id = ?`,
    [groupId, userId]
  );

  if (result.affectedRows > 0) {
    // GREATEST(0, ...) guards against going negative from any data inconsistency
    await db.query(
      `UPDATE \`groups\` SET member_count = GREATEST(0, member_count - 1) WHERE id = ?`,
      [groupId]
    );
    return true;
  }

  return false;
}

// ── Check membership ──────────────────────────────────────
async function isMember(userId, groupId) {
  const [[row]] = await db.query(
    `SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ? LIMIT 1`,
    [groupId, userId]
  );
  return !!row;
}

// ── Groups a user has joined ──────────────────────────────
async function getUserGroups(userId) {
  const [rows] = await db.query(
    `SELECT
       g.id, g.topic,
       g.display_name AS displayName,
       g.description,
       g.cover_image  AS coverImage,
       g.member_count AS memberCount,
       g.post_count   AS postCount,
       g.created_at   AS createdAt,
       1              AS isMember,
       gm.joined_at   AS joinedAt
     FROM group_members gm
     JOIN \`groups\` g ON g.id = gm.group_id
     WHERE gm.user_id = ?
     ORDER BY gm.joined_at DESC`,
    [userId]
  );
  return rows.map(normalise);
}

// ── Group feed ────────────────────────────────────────────
// Posts by group members that are tagged with the group's topic,
// ordered newest-first.
// This does NOT include posts from non-members.
async function getGroupFeed(groupId, { page = 1, limit = 20, userId = null } = {}) {
  limit        = Math.min(50, Math.max(1, limit));
  const offset = (Math.max(1, page) - 1) * limit;

  // Resolve topic from group id
  const [[group]] = await db.query(`SELECT topic FROM \`groups\` WHERE id = ?`, [groupId]);
  if (!group) return { posts: [], hasMore: false, page, limit };

  const { topic } = group;

  const [rawPosts] = await db.query(
    `SELECT DISTINCT
       p.id,
       p.user_id          AS userId,
       u.name             AS author,
       u.picture          AS authorPicture,
       p.text,
       p.image,
       p.video,
       p.is_repost        AS isRepost,
       p.original_post_id AS originalPostId,
       p.created_at       AS createdAt
     FROM group_members gm
     JOIN posts      p  ON p.user_id   = gm.user_id
     JOIN post_topics pt ON pt.post_id = p.id AND pt.topic = ?
     JOIN users      u  ON u.id        = p.user_id
     WHERE gm.group_id = ?
     ORDER BY p.created_at DESC
     LIMIT ? OFFSET ?`,
    [topic, groupId, limit + 1, offset]

    
  );

  const hasMore   = rawPosts.length > limit;
  const pagePosts = rawPosts.slice(0, limit);

  // Hydrate with engagement counts using PostModel
  const PostModel = require('./PostModel');
  const hydrated  = await PostModel.hydratePosts(pagePosts);

  return { posts: hydrated, hasMore, page, limit };
}

// ── Internal helpers ──────────────────────────────────────
function normalise(row) {
  return {
    ...row,
    isMember: !!row.isMember, // convert 0/1 → boolean
  };
}

module.exports = {
  // cron
  startGroupCron,
  runGroupCreationCron,
  // queries
  getTrendingGroups,
  getGroupByTopic,
  getGroupById,
  getUserGroups,
  getGroupFeed,
  // membership
  joinGroup,
  leaveGroup,
  isMember,
};
