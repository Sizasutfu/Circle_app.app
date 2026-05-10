const passwordService = require("../services/passwordService");
const { sendOk, sendError } = require("../middleware/response");

async function requestPasswordReset(req, res) {
  const { email } = req.body;

  if (!email) {
    return sendError(res, 400, "Email is required.");
  }

  try {
    await passwordService.initiatePasswordReset(email);
    return sendOk(res, 200, "A reset link has been sent.");
  } catch (e) {
    console.error("[requestPasswordReset]", e);
    return sendError(res, 500, "Failed to send reset email. Please try again.");
  }
}

async function confirmResetPassword(req, res) {
  const { token, password } = req.body;

  if (!token || !password) {
    return sendError(res, 400, "Token and password are required.");
  }

  if (password.length < 6) {
    return sendError(res, 400, "Password must be at least 6 characters.");
  }

  try {
    await passwordService.confirmPasswordReset(token, password);
    return sendOk(res, 200, "Password updated successfully.");
  } catch (e) {
    console.error("[confirmResetPassword]", e);
    const statusCode = e.statusCode || 500;
    const message = e.statusCode ? e.message : "Server error.";
    return sendError(res, statusCode, message);
  }
}

module.exports = { requestPasswordReset, confirmResetPassword };