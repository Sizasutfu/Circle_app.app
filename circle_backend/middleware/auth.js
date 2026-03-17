// ============================================================
//  middleware/auth.js
//  Authentication middleware.
//
//  requireAuth — reads the X-User-Id header sent by the
//  frontend on every request, attaches req.actorId, and
//  rejects unauthenticated callers with 401.
//
//  Note: swap this for JWT verification when you add tokens.
//  Just change where actorId comes from — all controllers
//  already use req.actorId so nothing else needs to change.
// ============================================================

const { sendError } = require('./response');

function requireAuth(req, res, next) {
  const userId = parseInt(req.headers['x-user-id']);
  if (!userId) {
    return sendError(res, 401, 'You must be logged in to do that.');
  }
  req.actorId = userId;
  next();
}

module.exports = { requireAuth };
