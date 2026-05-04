// ============================================================
//  controllers/followController.js
//  Handles all request/response logic for follow routes.
// ============================================================

const FollowModel       = require('../models/followModel');
const UserModel         = require('../models/userModel');
const NotificationModel = require('../models/notificationModel_v3');
const { sendOk, sendError } = require('../middleware/response');

// POST /api/follow/:targetId
async function follow(req, res) {
  const followerId  = req.actorId;
  const followingId = parseInt(req.params.targetId);

  if (followerId === followingId)
    return sendError(res, 400, 'You cannot follow yourself.');

  try {
    const target = await UserModel.findById(followingId);
    if (!target) return sendError(res, 404, 'User not found.');

    const existing = await FollowModel.getFollow(followerId, followingId);
    if (existing)  return sendError(res, 409, 'Already following this user.');

    await FollowModel.addFollow(followerId, followingId);

    const followerCount = await FollowModel.getFollowerCount(followingId);

    await NotificationModel.createNotification(followingId, followerId, 'follow', null);

    return sendOk(res, 201, `You are now following ${target.name}.`, { followerCount });
  } catch (err) {
    console.error('follow error:', err);
    return sendError(res, 500, 'Server error.');
  }
}

// DELETE /api/unfollow/:targetId
async function unfollow(req, res) {
  const followerId  = req.actorId;
  const followingId = parseInt(req.params.targetId);

  try {
    const existing = await FollowModel.getFollow(followerId, followingId);
    if (!existing) return sendError(res, 404, 'You are not following this user.');

    await FollowModel.removeFollow(followerId, followingId);

    const followerCount = await FollowModel.getFollowerCount(followingId);

    return sendOk(res, 200, 'Unfollowed.', { followerCount });
  } catch (err) {
    console.error('unfollow error:', err);
    return sendError(res, 500, 'Server error.');
  }
}

// GET /api/followers/:userId
async function getFollowers(req, res) {
  const userId   = parseInt(req.params.userId);
  const viewerId = parseInt(req.headers['x-user-id']) || null;

  try {
    const followers = await FollowModel.getFollowers(userId, viewerId);
    return sendOk(res, 200, `${followers.length} followers.`, followers);
  } catch (err) {
    console.error('getFollowers error:', err);
    return sendError(res, 500, 'Server error.');
  }
}

// GET /api/following/:userId
async function getFollowing(req, res) {
  const userId   = parseInt(req.params.userId);
  const viewerId = parseInt(req.headers['x-user-id']) || null;

  try {
    const following = await FollowModel.getFollowing(userId, viewerId);
    return sendOk(res, 200, `Following ${following.length} users.`, following);
  } catch (err) {
    console.error('getFollowing error:', err);
    return sendError(res, 500, 'Server error.');
  }
}

module.exports = { follow, unfollow, getFollowers, getFollowing };
