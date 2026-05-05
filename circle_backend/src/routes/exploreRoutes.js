// ============================================================
//  routes/exploreRoutes.js
// ============================================================

const router            = require('express').Router();
const exploreController = require('../controllers/exploreController');

// GET /api/explore/trending
router.get('/trending', exploreController.getTrending);

module.exports = router;
