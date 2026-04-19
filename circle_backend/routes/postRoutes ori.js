// ============================================================
//  routes/postRoutes.js
//  Defines API endpoints for post, like, comment, repost.
//  Route handlers are in controllers/postController.js.
// ============================================================

const router          = require('express').Router();
const postController  = require('../controllers/postController');
const { requireAuth } = require('../middleware/auth');

// Feed — public (viewerId optional for personalisation)
router.get('/', postController.getPosts);

// Post CRUD
router.post('/',    requireAuth, postController.createPost);
router.get('/:id',              postController.getPostById);

router.delete('/:id', requireAuth, postController.deletePost);

// Interactions — all require auth
router.post('/:id/like',    requireAuth, postController.toggleLike);
router.post('/:id/comment', requireAuth, postController.addComment);
router.post('/:id/repost',  requireAuth, postController.repost);

module.exports = router;
