const passwordService = require("../services/passwordService");
const { ok, err } = require("../utils/response");

async function requestPasswordReset(req, res) {
  const { email } = req.body;

  if (!email) {
    return err(res, 400, "Email is required.");
  }

  try {
    await passwordService.initiatePasswordReset(email);
    return ok(res, 200, "A reset link has been sent.");
  } catch (e) {
    console.error("[requestPasswordReset]", e);
    return err(res, 500, "Failed to send reset email. Please try again.");
  }
}

async function confirmResetPassword(req, res) {
  const { token, password } = req.body;

  if (!token || !password) {
    return err(res, 400, "Token and password are required.");
  }

  if (password.length < 6) {
    return err(res, 400, "Password must be at least 6 characters.");
  }

  try {
    await passwordService.confirmPasswordReset(token, password);
    return ok(res, 200, "Password updated successfully.");
  } catch (e) {
    console.error("[confirmResetPassword]", e);
    const statusCode = e.statusCode || 500;
    const message = e.statusCode ? e.message : "Server error.";
    return err(res, statusCode, message);
  }
}

module.exports = { requestPasswordReset, confirmResetPassword };