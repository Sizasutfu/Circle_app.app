// ============================================================
//  middleware/cors.js
// ============================================================

function cors(req, res, next) {
  res.setHeader('Access-Control-Allow-Origin',  process.env.FRONTEND_URL || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-User-Id, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
}

module.exports = { cors };