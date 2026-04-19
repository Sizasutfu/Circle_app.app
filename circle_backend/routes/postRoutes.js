// ============================================================
//  routes/postRoutes.js
//  Defines API endpoints for post, like, comment, repost.
//  Route handlers are in controllers/postController.js.
// ============================================================

const router                    = require('express').Router();
const postController            = require('../controllers/postController');
const { requireAuth }           = require('../middleware/auth');
const upload                    = require('../middleware/upload');
const { compressUploads }       = require('../middleware/compress');

// Feed — public (viewerId optional for personalisation)
router.get('/', postController.getPosts);

// Post CRUD
// Flow: requireAuth → multer (RAM) → compressUploads (compress + save to disk) → controller
router.post('/', requireAuth, upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'video', maxCount: 1 },
]), compressUploads, postController.createPost);

router.get('/:id',             postController.getPostById);
router.delete('/:id', requireAuth, postController.deletePost);

// Interactions — all require auth
router.post('/:id/like',    requireAuth, postController.toggleLike);
router.post('/:id/comment', requireAuth, postController.addComment);
router.post('/:id/repost',  requireAuth, postController.repost);

// View count — auth optional (guests tracked by fingerprint)
router.post('/:id/view', postController.recordView);

module.exports = router;