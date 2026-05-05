// ============================================================
//  routes/recommendationRoutes.js
// ============================================================

const router = require('express').Router();
const recommendationController = require('../controllers/recommendationController');

// GET /api/recommendations?userId=ID
router.get('/', recommendationController.getRecommendations);

module.exports = router;
