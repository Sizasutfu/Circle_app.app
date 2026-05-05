// ============================================================
//  controllers/recommendationController.js
// ============================================================

const RecommendationModel    = require('../models/recommendationModel');
const { sendOk, sendError }  = require('../middleware/response');

// GET /api/recommendations?userId=ID&limit=10
async function getRecommendations(req, res) {
  const userId = parseInt(req.query.userId);
  const limit  = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 20);

  if (!userId || isNaN(userId))
    return sendError(res, 400, 'userId is required.');

  try {
    const users = await RecommendationModel.getRecommendations(userId, limit);
    return sendOk(res, 200, 'Recommendations fetched.', users);
  } catch (err) {
    console.error('getRecommendations error:', err);
    return sendError(res, 500, 'Server error.');
  }
}

module.exports = { getRecommendations };
