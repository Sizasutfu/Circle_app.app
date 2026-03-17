// ============================================================
//  routes/adminRoutes.js
//  All admin API endpoints.
//  Public: /login only.
//  Everything else requires requireAdmin middleware.
// ============================================================

const router           = require('express').Router();
const adminController  = require('../controllers/adminController');
const { requireAdmin } = require('../middleware/adminAuth');
const { requireAuth }  = require('../middleware/auth');

// ── Public ─────────────────────────────────────────────────
router.post('/login',  adminController.login);

// ── Protected (must send Authorization: Bearer <token>) ────
router.post('/logout', requireAdmin, adminController.logout);

// Dashboard
router.get('/stats',   requireAdmin, adminController.getStats);
router.get('/charts',  requireAdmin, adminController.getCharts);

// Users
router.get('/users',              requireAdmin, adminController.getUsers);
router.put('/users/:id/suspend',  requireAdmin, adminController.suspendUser);
router.put('/users/:id/unsuspend',requireAdmin, adminController.unsuspendUser);
router.delete('/users/:id',       requireAdmin, adminController.deleteUser);

// Posts
router.get('/posts',      requireAdmin, adminController.getPosts);
router.delete('/posts/:id', requireAdmin, adminController.deletePost);

// Reports
router.get('/reports',         requireAdmin, adminController.getReports);
router.post('/reports',        requireAuth,  adminController.createReport);  // normal users submit reports
router.put('/reports/:id/resolve', requireAdmin, adminController.resolveReport);
router.put('/reports/:id/ignore',  requireAdmin, adminController.ignoreReport);

// Settings
router.put('/settings/password', requireAdmin, adminController.updatePassword);

module.exports = router;