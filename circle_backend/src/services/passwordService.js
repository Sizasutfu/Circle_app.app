const bcrypt = require("bcrypt");
const UserModel = require("../models/userModel");
const { sendPasswordResetEmail } = require("./emailService");
const { generateResetToken, getTokenExpiry } = require("../utils/tokenUtil");

const SALT_ROUNDS = 10;

async function initiatePasswordReset(email) {
  const user = await UserModel.findByEmail(email);

  // Early return — do not reveal whether the email exists
  if (!user) return;

  const token = generateResetToken();
  const expires = getTokenExpiry(1);

  await UserModel.saveResetToken(user.id, token, expires);

  await sendPasswordResetEmail({
    to: email,
    name: user.name,
    token,
  });
}

async function confirmPasswordReset(token, newPassword) {
  const user = await UserModel.findByValidResetToken(token);

  if (!user) {
    const error = new Error("Reset link is invalid or has expired.");
    error.statusCode = 400;
    throw error;
  }

  const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await UserModel.updatePasswordAndClearToken(user.id, hashedPassword);
}

module.exports = { initiatePasswordReset, confirmPasswordReset };