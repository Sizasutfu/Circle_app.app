// ============================================================
//  controllers/postController.js
//  Handles all request/response logic for post routes.
//  Compression is handled by middleware/compress.js which
//  runs before this controller — files are already saved to
//  disk and their filenames are in req.compressedFiles.
// ============================================================

const PostModel             = require('../models/PostModel');
const UserModel             = require('../models/userModel');
const NotificationModel     = require('../models/notificationModel');
const FollowModel           = require('../models/followModel');
const TopicPreferenceModel  = require('../models/TopicPreferenceModel');
const NegativeSignalModel   = require('../models/NegativeSignalModel');
const { getPostsPage }      = require('../feed/feedPipeline');
const { db }                = require('../config/db');
const { sendOk, sendError } = require('../middleware/response');

// GET /api/posts?userId=<id>&feed=global|following&page=<n>&limit=<n>&media=video
async function getPosts(req, res) {
  const profileUserId = req.query.userId ? parseInt(req.query.userId) : null;
  const feedMode      = req.query.feed === 'following' ? 'following' : 'global';
  const page          = Math.max(1, parseInt(req.query.page)  || 1);
  const limit         = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));

  try {
    if (profileUserId) {
      // Profile pages are chronological — no scoring needed
      const result  = await PostModel.getProfilePosts(profileUserId, page, limit);
      const posts   = result.posts   ?? result ?? [];
      const hasMore = result.hasMore ?? (posts.length === limit);
      return sendOk(res, 200, 'Posts fetched.', { posts, hasMore, page, limit });
    }

    const viewerUserId = req.actorId || (req.headers['x-user-id'] ? parseInt(req.headers['x-user-id']) : null);
    const mediaFilter  = req.query.media === 'video' ? 'video' : null;

    // New feed pipeline (replaces PostModel.getPostsPage)
    const result = await getPostsPage(viewerUserId, feedMode, page, limit, mediaFilter);
    return sendOk(res, 200, 'Posts fetched.', result);
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

  const imageFilename = req.compressedFiles?.image?.filename || null;
  const videoFilename = req.compressedFiles?.video?.filename || null;

  // Save only the relative path in the DB — never a hardcoded host/IP.
  const imagePath = imageFilename ? `/uploads/${imageFilename}` : null;
  const videoPath = videoFilename ? `/uploads/${videoFilename}` : null;

  // Build the full URL for the response using the current request's host
  const baseUrl  = `${req.protocol}://${req.get('host')}`;
  const imageUrl = imagePath ? `${baseUrl}${imagePath}` : null;
  const videoUrl = videoPath ? `${baseUrl}${videoPath}` : null;

  if (!text && !imagePath && !videoPath)
    return sendError(res, 400, 'A post must have text, an image, or a video.');

  try {
    const user = await UserModel.findById(userId);
    if (!user) return sendError(res, 404, 'User not found.');

    const postId = await PostModel.createPost(userId, text, imagePath, videoPath);

    // ── Extract and save hashtags ──────────────────────────────
    await PostModel.savePostTopics(postId, text);

    // ── Notify all followers about the new post ────────────────
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

        // ── Bump topic affinity ────────────────────────────────
        const topics = await TopicPreferenceModel.getPostTopics(postId);
        await TopicPreferenceModel.recordEngagement(userId, topics, 'like');
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
  const postId             = parseInt(req.params.id);
  const userId             = req.actorId;
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

    // ── Bump topic affinity ──────────────────────────────────
    const topics = await TopicPreferenceModel.getPostTopics(postId);
    await TopicPreferenceModel.recordEngagement(userId, topics, 'comment');

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
  const origId  = parseInt(req.params.id);
  const userId  = req.actorId;
  const { text } = req.body;
  const isQuote = text && text.trim().length > 0;

  try {
    const original = await PostModel.findById(origId);
    if (!original) return sendError(res, 404, 'Original post not found.');

    const user = await UserModel.findById(userId);
    if (!user) return sendError(res, 404, 'User not found.');

    // Only block duplicates for simple reposts — quote posts can be made multiple times
    if (!isQuote) {
      const dup = await PostModel.getExistingRepost(userId, origId);
      if (dup) return sendError(res, 409, 'Already reposted.');
    }

    const repostId  = await PostModel.createRepost(userId, text, origId);
    const origEmbed = await PostModel.getOriginalPostEmbed(origId);

    await NotificationModel.createNotification(original.user_id, userId, 'repost', origId);

    // ── Bump topic affinity ──────────────────────────────────
    const topics = await TopicPreferenceModel.getPostTopics(origId);
    await TopicPreferenceModel.recordEngagement(userId, topics, 'repost');

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

// DELETE /api/posts/:id/repost
async function unrepost(req, res) {
  const origId = parseInt(req.params.id);
  const userId = req.actorId;

  try {
    const existing = await PostModel.getExistingRepost(userId, origId);
    if (!existing) return sendError(res, 404, 'No simple repost found to remove.');

    await PostModel.deleteRepost(userId, origId);
    return sendOk(res, 200, 'Repost removed.');
  } catch (err) {
    console.error('unrepost error:', err);
    return sendError(res, 500, 'Server error.');
  }
}

// POST /api/posts/:id/view
// Body: { fingerprint?: string, dwellMs?: number }
// Auth is optional — logged-in users identified by actorId,
// guests by a client-generated fingerprint or IP fallback.
// dwellMs: milliseconds the post was visible in the viewport.
//   If provided and below SHORT_VIEW_THRESHOLD, a short_view
//   negative signal is also recorded for the authenticated user.
async function recordView(req, res) {
  const postId = parseInt(req.params.id);
  if (isNaN(postId)) return sendError(res, 400, 'Invalid post ID.');

  const userId   = req.actorId;
  const viewerId = userId || req.body.fingerprint || req.ip;
  const dwellMs  = req.body.dwellMs != null ? Number(req.body.dwellMs) : null;

  try {
    await PostModel.recordView(postId, viewerId);

    // Record dwell time and emit short_view signal if below threshold
    if (userId && dwellMs !== null) {
      await NegativeSignalModel.recordDwellView(userId, postId, dwellMs);
    }

    const total = await PostModel.getViewCount(postId);
    return sendOk(res, 200, 'View recorded.', { views: total });
  } catch (err) {
    console.error('recordView error:', err);
    return sendError(res, 500, 'Server error.');
  }
}

// POST /api/posts/:id/skip
// Called by the client when the user scrolls past a post without
// any meaningful pause (client decides threshold, e.g. < 1 second
// in viewport). Requires authentication — guest skips are ignored.
async function recordSkip(req, res) {
  const postId = parseInt(req.params.id);
  if (isNaN(postId)) return sendError(res, 400, 'Invalid post ID.');

  const userId = req.actorId;
  if (!userId) return sendOk(res, 200, 'Skip ignored (guest).');

  try {
    await NegativeSignalModel.recordSkip(userId, postId);
    return sendOk(res, 200, 'Skip recorded.');
  } catch (err) {
    console.error('recordSkip error:', err);
    return sendError(res, 500, 'Server error.');
  }
}

// GET /api/topics?limit=<n>
async function getTopics(req, res) {
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
  try {
    const topics = await PostModel.getTopics(limit);
    return sendOk(res, 200, 'Topics fetched.', topics);
  } catch (err) {
    console.error('getTopics error:', err);
    return sendError(res, 500, 'Server error.');
  }
}

// GET /api/topics/:topic/posts?page=<n>&limit=<n>
async function getPostsByTopic(req, res) {
  const topic = req.params.topic?.toLowerCase();
  if (!topic) return sendError(res, 400, 'Topic is required.');
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
  try {
    const result = await PostModel.getPostsByTopic(topic, page, limit);
    return sendOk(res, 200, 'Posts fetched.', result);
  } catch (err) {
    console.error('getPostsByTopic error:', err);
    return sendError(res, 500, 'Server error.');
  }
}

module.exports = {
  getPosts,
  getPostById,
  createPost,
  deletePost,
  toggleLike,
  addComment,
  repost,
  unrepost,
  recordView,
  recordSkip,
  getTopics,
  getPostsByTopic,
};
