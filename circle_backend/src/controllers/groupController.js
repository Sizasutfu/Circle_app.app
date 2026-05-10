// ============================================================
//  controllers/groupController.js
//  Routes for Circle's auto-created topic groups.
//
//  GET    /api/groups                       → trending groups (Explore)
//  GET    /api/groups/mine                  → groups the user has joined
//  GET    /api/groups/:groupId              → single group details
//  GET    /api/groups/topic/:topic          → group by topic slug
//  POST   /api/groups/:groupId/join         → join a group (opt-in)
//  DELETE /api/groups/:groupId/join         → leave a group
//  GET    /api/groups/:groupId/feed         → group post feed
// ============================================================

const GroupModel            = require('../models/GroupModel');
const { sendOk, sendError } = require('../middleware/response');

// ── GET /api/groups?page=<n>&limit=<n> ──────────────────
// Trending groups for the Explore section.
// Authenticated users get an isMember flag on each group.
async function getTrendingGroups(req, res) {
  const userId = req.actorId ?? null;
  const page   = Math.max(1, parseInt(req.query.page) || 1);
  const limit  = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
  const offset = (page - 1) * limit;

  try {
    const result = await GroupModel.getTrendingGroups({ limit, offset, userId });
    return sendOk(res, 200, 'Groups fetched.', { ...result, page, limit });
  } catch (err) {
    console.error('getTrendingGroups error:', err);
    return sendError(res, 500, 'Server error.');
  }
}

// ── GET /api/groups/mine ─────────────────────────────────
// Returns all groups the authenticated user has joined.
async function getMyGroups(req, res) {
  const userId = req.actorId;
  if (!userId) return sendError(res, 401, 'Authentication required.');

  try {
    const groups = await GroupModel.getUserGroups(userId);
    return sendOk(res, 200, 'Your groups fetched.', groups);
  } catch (err) {
    console.error('getMyGroups error:', err);
    return sendError(res, 500, 'Server error.');
  }
}

// ── GET /api/groups/:groupId ─────────────────────────────
// Single group details by numeric ID.
async function getGroup(req, res) {
  const userId  = req.actorId ?? null;
  const groupId = parseInt(req.params.groupId);
  if (!groupId || isNaN(groupId)) return sendError(res, 400, 'Invalid group ID.');

  try {
    const group = await GroupModel.getGroupById(groupId, userId);
    if (!group) return sendError(res, 404, 'Group not found.');
    return sendOk(res, 200, 'Group fetched.', group);
  } catch (err) {
    console.error('getGroup error:', err);
    return sendError(res, 500, 'Server error.');
  }
}

// ── GET /api/groups/topic/:topic ─────────────────────────
// Single group details by topic slug (e.g. "football").
async function getGroupByTopic(req, res) {
  const userId = req.actorId ?? null;
  const topic  = req.params.topic?.toLowerCase().trim();
  if (!topic) return sendError(res, 400, 'Topic is required.');

  try {
    const group = await GroupModel.getGroupByTopic(topic, userId);
    if (!group) return sendError(res, 404, 'Group not found for that topic.');
    return sendOk(res, 200, 'Group fetched.', group);
  } catch (err) {
    console.error('getGroupByTopic error:', err);
    return sendError(res, 500, 'Server error.');
  }
}

// ── POST /api/groups/:groupId/join ───────────────────────
// Explicitly join a group. Users are NEVER auto-added.
async function joinGroup(req, res) {
  const userId  = req.actorId;
  if (!userId) return sendError(res, 401, 'Authentication required.');

  const groupId = parseInt(req.params.groupId);
  if (!groupId || isNaN(groupId)) return sendError(res, 400, 'Invalid group ID.');

  try {
    // Verify the group exists
    const group = await GroupModel.getGroupById(groupId, userId);
    if (!group) return sendError(res, 404, 'Group not found.');

    const joined = await GroupModel.joinGroup(userId, groupId);
    const msg    = joined ? `Joined ${group.displayName}.` : `Already a member of ${group.displayName}.`;
    return sendOk(res, 200, msg, { groupId, isMember: true });
  } catch (err) {
    console.error('joinGroup error:', err);
    return sendError(res, 500, 'Server error.');
  }
}

// ── DELETE /api/groups/:groupId/join ─────────────────────
// Leave a group.
async function leaveGroup(req, res) {
  const userId  = req.actorId;
  if (!userId) return sendError(res, 401, 'Authentication required.');

  const groupId = parseInt(req.params.groupId);
  if (!groupId || isNaN(groupId)) return sendError(res, 400, 'Invalid group ID.');

  try {
    const group = await GroupModel.getGroupById(groupId);
    if (!group) return sendError(res, 404, 'Group not found.');

    await GroupModel.leaveGroup(userId, groupId);
    return sendOk(res, 200, `Left ${group.displayName}.`, { groupId, isMember: false });
  } catch (err) {
    console.error('leaveGroup error:', err);
    return sendError(res, 500, 'Server error.');
  }
}

// ── GET /api/groups/:groupId/feed?page=<n>&limit=<n> ────
// Posts from group members tagged with the group's topic.
async function getGroupFeed(req, res) {
  const userId  = req.actorId ?? null;
  const groupId = parseInt(req.params.groupId);
  if (!groupId || isNaN(groupId)) return sendError(res, 400, 'Invalid group ID.');

  const page  = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));

  try {
    const result = await GroupModel.getGroupFeed(groupId, { page, limit, userId });
    return sendOk(res, 200, 'Group feed fetched.', result);
  } catch (err) {
    console.error('getGroupFeed error:', err);
    return sendError(res, 500, 'Server error.');
  }
}

module.exports = {
  getTrendingGroups,
  getMyGroups,
  getGroup,
  getGroupByTopic,
  joinGroup,
  leaveGroup,
  getGroupFeed,
};
