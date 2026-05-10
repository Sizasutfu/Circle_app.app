// ============================================================
//  services/phoneService.js
//  Sends OTP via Africa's Talking and verifies codes.
//
//  Phone numbers exist in two forms:
//    stored  = "+268|76123456"  (how the DB keeps them, from userController)
//    e164    = "+26876123456"   (what Africa's Talking needs for SMS)
//
//  Every function receives both so it can query the DB with `stored`
//  and send SMS with `e164`.
// ============================================================

const AfricasTalking = require('africastalking');
const { db }         = require('../config/db');
const crypto         = require('crypto');

const at = AfricasTalking({
  apiKey:   process.env.AT_API_KEY,
  username: process.env.AT_USERNAME, // 'sandbox' for testing
});

const sms = at.SMS;

function generateOtp() {
  return String(crypto.randomInt(100000, 999999));
}

// ─── Login OTP (user already exists in users table) ───────────────────────────

async function sendOtp(storedPhone, e164Phone, localDigits) {
  const code    = generateOtp();
  const expires = new Date(Date.now() + 10 * 60 * 1000);

  // Update whichever format is in the DB (stored, E.164, or local digits only)
  await db.query(
    'UPDATE users SET otp_code = ?, otp_expires = ? WHERE phone = ? OR phone = ? OR phone = ?',
    [code, expires, storedPhone, e164Phone, localDigits]
  );

  await sms.send({
    to:      [e164Phone],
    message: `Your Circle verification code is ${code}. It expires in 10 minutes. Do not share it.`,
  });

  console.log(`[SANDBOX] Login OTP for ${e164Phone} → ${code}`);
  return { sent: true };
}

async function verifyOtpForLogin(storedPhone, e164Phone, localDigits, code) {
  const [rows] = await db.query(
    `SELECT id, name, email, picture, bio, created_at AS createdAt
     FROM users
     WHERE (phone = ? OR phone = ? OR phone = ?)
       AND otp_code = ?
       AND otp_expires > NOW()`,
    [storedPhone, e164Phone, localDigits, code]
  );

  if (!rows.length) {
    const err = new Error('Invalid or expired OTP.');
    err.statusCode = 401;
    throw err;
  }

  // Clear OTP — one-time use
  await db.query(
    'UPDATE users SET otp_code = NULL, otp_expires = NULL WHERE id = ?',
    [rows[0].id]
  );

  return rows[0];
}

// ─── Registration OTP (phone not yet in users table) ──────────────────────────

async function sendOtpForRegistration(storedPhone, e164Phone) {
  const code    = generateOtp();
  const expires = new Date(Date.now() + 10 * 60 * 1000);

  await db.query(
    `INSERT INTO pending_otps (phone, otp_code, otp_expires)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE otp_code = VALUES(otp_code), otp_expires = VALUES(otp_expires)`,
    [storedPhone, code, expires]
  );

  await sms.send({
    to:      [e164Phone],
    message: `Your Circle verification code is ${code}. It expires in 10 minutes. Do not share it.`,
  });

  console.log(`[SANDBOX] Register OTP for ${e164Phone} → ${code}`);
  return { sent: true };
}

async function verifyOtpForRegistration(storedPhone, code) {
  const [rows] = await db.query(
    'SELECT phone FROM pending_otps WHERE phone = ? AND otp_code = ? AND otp_expires > NOW()',
    [storedPhone, code]
  );

  if (!rows.length) {
    const err = new Error('Invalid or expired OTP.');
    err.statusCode = 401;
    throw err;
  }

  await db.query('DELETE FROM pending_otps WHERE phone = ?', [storedPhone]);
  return true;
}

module.exports = {
  sendOtp,
  sendOtpForRegistration,
  verifyOtpForLogin,
  verifyOtpForRegistration,
};