// ============================================================
//  routes/groups.js
//  Mount this file in app.js:
//    const groupRoutes = require('./routes/groups');
//    app.use('/api/groups', authenticate, groupRoutes);
//
//  Note: authenticate middleware sets req.actorId for
//  logged-in users; endpoints that allow guests handle
//  req.actorId === null gracefully.
// ============================================================

const express        = require('express');
const router         = express.Router();
const groupCtrl      = require('../controllers/groupController');
const { requireAuth } = require('../middleware/auth');

// Explore / discover
router.get('/',                  groupCtrl.getTrendingGroups);   // GET  /api/groups
router.get('/mine',  requireAuth,groupCtrl.getMyGroups);         // GET  /api/groups/mine
router.get('/topic/:topic',      groupCtrl.getGroupByTopic);     // GET  /api/groups/topic/:topic
router.get('/:groupId',          groupCtrl.getGroup);            // GET  /api/groups/:groupId

// Membership (auth required — enforced inside controller)
router.post('/:groupId/join',  requireAuth,  groupCtrl.joinGroup);           // POST   /api/groups/:groupId/join
router.delete('/:groupId/join', requireAuth, groupCtrl.leaveGroup);          // DELETE /api/groups/:groupId/join

// Feed
router.get('/:groupId/feed',     groupCtrl.getGroupFeed);        // GET  /api/groups/:groupId/feed

module.exports = router;

// ── app.js / server.js bootstrap additions ───────────────
//
//   const { startGroupCron } = require('./models/GroupModel');
//   startGroupCron();   // registers the hourly cron + runs once on startup
//
//   const groupRoutes = require('./routes/groups');
//   app.use('/api/groups', groupRoutes);
