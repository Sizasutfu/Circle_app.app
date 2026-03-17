// ============================================================
//  routes/searchRoutes.js
//  Defines API endpoints for search.
//  Route handlers are in controllers/searchController.js.
// ============================================================

const router            = require('express').Router();
const searchController  = require('../controllers/searchController');

// GET /api/search?q=<term>&type=posts|people
router.get('/', searchController.search);

module.exports = router;
