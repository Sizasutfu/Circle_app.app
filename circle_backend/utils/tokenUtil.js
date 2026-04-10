const crypto = require("crypto");

function generateResetToken() {
  return crypto.randomBytes(32).toString("hex");
}

function getTokenExpiry(hoursFromNow = 1) {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
}

module.exports = { generateResetToken, getTokenExpiry };