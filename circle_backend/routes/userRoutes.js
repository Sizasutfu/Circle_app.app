// ============================================================
//  routes/userRoutes.js
//  Defines API endpoints for user operations.
//  Route handlers are in controllers/userController.js.
// ============================================================

const router           = require('express').Router();
const userController   = require('../controllers/userController');
const { requireAuth }  = require('../middleware/auth');

// Public routes — no auth required
router.post('/register',        userController.register);
router.post('/login',           userController.login);
router.get( '/:id/profile',     userController.getProfile);

// Protected routes — must send X-User-Id header
router.put('/:id/picture', requireAuth, userController.updatePicture);
router.put('/:id',         requireAuth, userController.updateProfile);

module.exports = router;
