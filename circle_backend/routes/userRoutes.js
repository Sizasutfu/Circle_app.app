// ============================================================
//  routes/userRoutes.js
//  Defines API endpoints for user operations.
//  Route handlers are in controllers/userController.js.
// ============================================================

const router           = require('express').Router();
const userController   = require('../controllers/userController');
const { requireAuth }  = require('../middleware/auth');
const { requestPasswordReset, confirmResetPassword } = require("../controllers/authController");


// Public routes — no auth required
router.post('/register',        userController.register);
router.post('/login',           userController.login);
router.get( '/:id/profile',     userController.getProfile);

// Search users — must be before /:id to avoid route conflict
// GET /api/users?search=alice&limit=8
router.get('/', requireAuth, userController.searchUsers);

// Protected routes — must send X-User-Id header
router.put('/:id/picture', requireAuth, userController.updatePicture);
router.put('/:id',         requireAuth, userController.updateProfile);

router.post("/reset-password",         requestPasswordReset);
router.post("/reset-password/confirm", confirmResetPassword);

module.exports = router;