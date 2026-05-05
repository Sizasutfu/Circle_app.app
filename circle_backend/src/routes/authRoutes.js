const express = require('express');
const router = express.Router();

// Controllers
const {
  login,
  logout,
  getStats,
  getCharts,
  getUsers,
  suspendUser,
  unsuspendUser,
  deleteUser,
  getPosts,
  deletePost,
  getReports,
  createReport,
  resolveReport,
  ignoreReport,
  updatePassword
} = require('../controllers/adminController');

// Middleware
const { requireAdmin } = require('../middleware/adminAuth'); // you should have this
const { requireAuth }  = require('../middleware/auth');      // for normal users

// ============================================================
// AUTH
// ============================================================

router.post('/login', login);
router.post('/logout', requireAdmin, logout);

// ============================================================
// DASHBOARD
// ============================================================

router.get('/stats', requireAdmin, getStats);
router.get('/charts', requireAdmin, getCharts);

// ============================================================
// USERS MANAGEMENT
// ============================================================

router.get('/users', requireAdmin, getUsers);
router.put('/users/:id/suspend', requireAdmin, suspendUser);
router.put('/users/:id/unsuspend', requireAdmin, unsuspendUser);
router.delete('/users/:id', requireAdmin, deleteUser);

// ============================================================
// POSTS MANAGEMENT
// ============================================================

router.get('/posts', requireAdmin, getPosts);
router.delete('/posts/:id', requireAdmin, deletePost);

// ============================================================
// REPORTS
// ============================================================

// From main app users
router.post('/reports', requireAuth, createReport);

// Admin actions
router.get('/reports', requireAdmin, getReports);
router.put('/reports/:id/resolve', requireAdmin, resolveReport);
router.put('/reports/:id/ignore', requireAdmin, ignoreReport);

// ============================================================
// SETTINGS
// ============================================================

router.put('/settings/password', requireAdmin, updatePassword);

module.exports = router;