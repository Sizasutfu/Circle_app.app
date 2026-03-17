// ============================================================
//  controllers/postController.js
//  Handles all request/response logic for post routes.
// ============================================================

const PostModel         = require('../models/PostModel');
const UserModel         = require('../models/UserModel');
const NotificationModel = require('../models/NotificationModel');
const { sendOk, sendError } = require('../middleware/response');

// GET /api/posts?userId=<id>&feed=global|following&page=<n>
async function getPosts(req, res) {
  const viewerUserId = parseInt(req.query.userId) || null;
  const feedMode     = req.query.feed === 'following' ? 'following' : 'global';
  const page         = Math.max(1, parseInt(req.query.page) || 1);

  try {
    const result = await PostModel.getPostsPage(viewerUserId, feedMode, page);
    return sendOk(res, 200, 'Posts fetched.', { ...result, page });
  } catch (err) {
    console.error('getPosts error:', err);
    return sendError(res, 500, 'Server error.');
  }
}

// POST /api/posts
async function createPost(req, res) {
  const userId      = req.actorId;
  const { text, image } = req.body;

  if (!text && !image)
    return sendError(res, 400, 'A post must have text or an image.');

  try {
    const user = await UserModel.findById(userId);
    if (!user) return sendError(res, 404, 'User not found.');

    const postId = await PostModel.createPost(userId, text, image);

    return sendOk(res, 201, 'Posted.', {
      id: postId, userId,
      author:    user.name,
      text:      text  || '',
      image:     image || null,
      likes: [], reposts: [], comments: [],
      isRepost:  false,
      createdAt: new Date(),
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
    if (!post)               return sendError(res, 404, 'Post not found.');
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
      // Already liked → unlike
      await PostModel.removeLike(userId, postId);
      const total = await PostModel.getLikeCount(postId);
      return sendOk(res, 200, 'Unliked.', { likes: total, liked: false });
    } else {
      // Not liked → like + notify post owner
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
  const postId = parseInt(req.params.id);
  const userId = req.actorId;
  const { text } = req.body;

  if (!text) return sendError(res, 400, 'Comment text is required.');

  try {
    const post = await PostModel.findById(postId);
    if (!post) return sendError(res, 404, 'Post not found.');

    const user = await UserModel.findById(userId);
    if (!user) return sendError(res, 404, 'User not found.');

    const commentId = await PostModel.addComment(postId, userId, text);

    await NotificationModel.createNotification(post.user_id, userId, 'comment', postId);

    return sendOk(res, 201, 'Comment added.', {
      id:            commentId,
      userId,
      author:        user.name,
      authorPicture: user.picture || null,
      text,
      createdAt:     new Date(),
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

    const repostId   = await PostModel.createRepost(userId, text, origId);
    const origEmbed  = await PostModel.getOriginalPostEmbed(origId);

    await NotificationModel.createNotification(original.user_id, userId, 'repost', origId);

    return sendOk(res, 201, 'Reposted.', {
      id:             repostId,
      userId,
      author:         user.name,
      text:           text || '',
      image:          null,
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

module.exports = { getPosts, createPost, deletePost, toggleLike, addComment, repost };
