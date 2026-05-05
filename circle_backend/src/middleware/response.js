// ============================================================
//  middleware/response.js
//  Shared response helpers used by every controller.
//  Centralising these means the JSON shape is always
//  consistent and easy to change in one place.
// ============================================================

const sendOk = (res, status, message, data = null) =>
  res.status(status).json({
    success: true,
    message,
    ...(data !== null && { data }),
  });

const sendError = (res, status, message) =>
  res.status(status).json({
    success: false,
    message,
  });

module.exports = { sendOk, sendError };
