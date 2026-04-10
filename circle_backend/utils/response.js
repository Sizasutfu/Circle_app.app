function ok(res, statusCode = 200, message, data = {}) {
  return res.status(statusCode).json({ success: true, message, ...data });
}

function err(res, statusCode = 500, message) {
  return res.status(statusCode).json({ success: false, message });
}

module.exports = { ok, err };