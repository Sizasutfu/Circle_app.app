// ============================================================
//  routes/followRoutes.js
//  Defines API endpoints for the follow system.
//  Route handlers are in controllers/followController.js.
// ============================================================

const router            = require('express').Router();
const followController  = require('../controllers/followController');
const { requireAuth }   = require('../middleware/auth');

// Follow / unfollow — require auth
router.post(  '/follow/:targetId',   requireAuth, followController.follow);
router.delete('/unfollow/:targetId', requireAuth, followController.unfollow);

// Follower / following lists — public
router.get('/followers/:userId',  followController.getFollowers);
router.get('/following/:userId',  followController.getFollowing);

module.exports = router;
