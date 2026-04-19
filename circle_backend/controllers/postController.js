// ============================================================
//  controllers/postController.js
//  Handles all request/response logic for post routes.
//  Compression is handled by middleware/compress.js which
//  runs before this controller — files are already saved to
//  disk and their filenames are in req.compressedFiles.
// ============================================================

const PostModel         = require('../models/PostModel');
const UserModel         = require('../models/userModel');
const NotificationModel = require('../models/notificationModel212');
const FollowModel       = require('../models/followModel');
const { db }            = require('../config/db');
const { sendOk, sendError } = require('../middleware/response');

// GET /api/posts?userId=<id>&feed=global|following&page=<n>
async function getPosts(req, res) {
  const profileUserId = req.query.userId ? parseInt(req.query.userId) : null;
  const feedMode      = req.query.feed === 'following' ? 'following' : 'global';
  const page          = Math.max(1, parseInt(req.query.page) || 1);

  try {
    if (profileUserId) {
      const result = await PostModel.getProfilePosts(profileUserId, page);
      return sendOk(res, 200, 'Posts fetched.', { ...result, page });
    }

    const viewerUserId = req.actorId || null;
    const result = await PostModel.getPostsPage(viewerUserId, feedMode, page);
    return sendOk(res, 200, 'Posts fetched.', { ...result, page });
  } catch (err) {
    console.error('getPosts error:', err);
    return sendError(res, 500, 'Server error.');
  }
}

// GET /api/posts/:id
async function getPostById(req, res) {
  const postId = parseInt(req.params.id);
  if (isNaN(postId)) return sendError(res, 400, 'Invalid post ID.');

  try {
    const [rows] = await db.query(
      `SELECT
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
       FROM posts p
       JOIN users u ON u.id = p.user_id
       WHERE p.id = ?`,
      [postId]
    );

    if (!rows.length) return sendError(res, 404, 'Post not found.');

    const [post] = await PostModel.hydratePosts(rows);
    return sendOk(res, 200, 'Post fetched.', post);
  } catch (err) {
    console.error('getPostById error:', err);
    return sendError(res, 500, 'Server error.');
  }
}

// POST /api/posts  (multipart/form-data)
// compressUploads middleware runs first — compressed files are
// already on disk. req.compressedFiles holds their filenames.
async function createPost(req, res) {
  const userId = req.actorId;
  const text   = req.body.text || '';

  // Pull filenames set by compress middleware
  const imageFilename = req.compressedFiles?.image?.filename || null;
  const videoFilename = req.compressedFiles?.video?.filename || null;

  // Build public URLs from the compressed filenames
  const baseUrl  = `${req.protocol}://${req.get('host')}`;
  const imageUrl = imageFilename ? `${baseUrl}/uploads/${imageFilename}` : null;
  const videoUrl = videoFilename ? `${baseUrl}/uploads/${videoFilename}` : null;

  if (!text && !imageUrl && !videoUrl)
    return sendError(res, 400, 'A post must have text, an image, or a video.');

  try {
    const user = await UserModel.findById(userId);
    if (!user) return sendError(res, 404, 'User not found.');

    const postId = await PostModel.createPost(userId, text, imageUrl, videoUrl);

    // ── Notify all followers about the new post ──────────────
    const followerIds = await FollowModel.getFollowerIds(userId);
    await Promise.all(
      followerIds.map(fId =>
        NotificationModel.createNotification(fId, userId, 'new_post', postId)
      )
    );

    return sendOk(res, 201, 'Posted.', {
      id:            postId,
      userId,
      author:        user.name,
      authorPicture: user.picture || null,
      text,
      image:         imageUrl,
      video:         videoUrl,
      likes: [], reposts: [], comments: [],
      isRepost:      false,
      createdAt:     new Date(),
    });
  } catch (err) {
    console.error('createPost error:', err);
    return sendError(res, 500, 'Server error.');
  }
}

// DELETE /api/posts/:id
async function deletePost(req, res) {
  const postId = parseInt(req.params.id);

  try {
    const post = await PostModel.findById(postId);
    if (!post)                        return sendError(res, 404, 'Post not found.');
    if (post.user_id !== req.actorId) return sendError(res, 403, 'Not your post.');

    await PostModel.deletePost(postId);
    return sendOk(res, 200, 'Post deleted.');
  } catch (err) {
    console.error('deletePost error:', err);
    return sendError(res, 500, 'Server error.');
  }
}

// POST /api/posts/:id/like  (toggles like/unlike)
async function toggleLike(req, res) {
  const postId = parseInt(req.params.id);
  const userId = req.actorId;

  try {
    const existing = await PostModel.getLike(userId, postId);

    if (existing) {
      await PostModel.removeLike(userId, postId);
      const total = await PostModel.getLikeCount(postId);
      return sendOk(res, 200, 'Unliked.', { likes: total, liked: false });
    } else {
      await PostModel.addLike(userId, postId);
      const total = await PostModel.getLikeCount(postId);

      const post = await PostModel.findById(postId);
      if (post) {
        await NotificationModel.createNotification(post.user_id, userId, 'like', postId);
      }

      return sendOk(res, 200, 'Liked.', { likes: total, liked: true });
    }
  } catch (err) {
    console.error('toggleLike error:', err);
    return sendError(res, 500, 'Server error.');
  }
}

// POST /api/posts/:id/comment
async function addComment(req, res) {
  const postId      = parseInt(req.params.id);
  const userId      = req.actorId;
  const { text, parentId } = req.body;

  if (!text) return sendError(res, 400, 'Comment text is required.');

  const parentIdInt = parentId ? parseInt(parentId) : null;
  if (parentId && (isNaN(parentIdInt) || parentIdInt < 1)) {
    return sendError(res, 400, 'Invalid parentId.');
  }

  try {
    const post = await PostModel.findById(postId);
    if (!post) return sendError(res, 404, 'Post not found.');

    const user = await UserModel.findById(userId);
    if (!user) return sendError(res, 404, 'User not found.');

    const commentId = await PostModel.addComment(postId, userId, text, parentIdInt);

    await NotificationModel.createNotification(post.user_id, userId, 'comment', postId);

    return sendOk(res, 201, 'Comment added.', {
      id:            commentId,
      userId,
      parentId:      parentIdInt,
      author:        user.name,
      authorPicture: user.picture || null,
      text,
      createdAt:     new Date(),
      replies:       parentIdInt ? undefined : [],
    });
  } catch (err) {
    console.error('addComment error:', err);
    return sendError(res, 500, 'Server error.');
  }
}

// POST /api/posts/:id/repost
async function repost(req, res) {
  const origId = parseInt(req.params.id);
  const userId = req.actorId;
  const { text } = req.body;

  try {
    const original = await PostModel.findById(origId);
    if (!original) return sendError(res, 404, 'Original post not found.');

    const user = await UserModel.findById(userId);
    if (!user) return sendError(res, 404, 'User not found.');

    const dup = await PostModel.getExistingRepost(userId, origId);
    if (dup) return sendError(res, 409, 'Already reposted.');

    const repostId  = await PostModel.createRepost(userId, text, origId);
    const origEmbed = await PostModel.getOriginalPostEmbed(origId);

    await NotificationModel.createNotification(original.user_id, userId, 'repost', origId);

    return sendOk(res, 201, 'Reposted.', {
      id:             repostId,
      userId,
      author:         user.name,
      authorPicture:  user.picture || null,
      text:           text || '',
      image:          null,
      video:          null,
      isRepost:       true,
      originalPostId: origId,
      originalPost:   origEmbed,
      likes: [], reposts: [], comments: [],
      createdAt:      new Date(),
    });
  } catch (err) {
    console.error('repost error:', err);
    return sendError(res, 500, 'Server error.');
  }
}

// POST /api/posts/:id/view
// Called by the frontend when a post enters the viewport.
// Auth is optional — logged-in users are identified by userId,
// guests by a client-generated fingerprint passed in the body.
async function recordView(req, res) {
  const postId = parseInt(req.params.id);
  if (isNaN(postId)) return sendError(res, 400, 'Invalid post ID.');

  // Prefer authenticated user id; fall back to anonymous fingerprint
  const viewerId = req.actorId || req.body.fingerprint || req.ip;

  try {
    await PostModel.recordView(postId, viewerId);
    const total = await PostModel.getViewCount(postId);
    return sendOk(res, 200, 'View recorded.', { views: total });
  } catch (err) {
    console.error('recordView error:', err);
    return sendError(res, 500, 'Server error.');
  }
}

module.exports = { getPosts, getPostById, createPost, deletePost, toggleLike, addComment, repost, recordView };