// ============================================================
//  controllers/phoneAuthController.js
//  Handles phone-based OTP login and registration.
//
//  IMPORTANT: The DB stores phone as "dialCode|digits" e.g. "+268|76123456"
//  (written by userController/extractExtras). The frontend sends E.164
//  e.g. "+26876123456". parsePhone() bridges the two formats.
//
//  Flow A — Login with phone:
//    POST /api/auth/phone/send-otp   { phone }  (phone = E.164)
//    POST /api/auth/phone/verify-otp { phone, code }
//
//  Flow B — Register with phone:
//    POST /api/auth/phone/register/send-otp   { phone, name }
//    POST /api/auth/phone/register/verify-otp { phone, code, name, email? }
// ============================================================

const phoneService = require('../services/phoneService');
const UserModel    = require('../models/userModel');
const { db }       = require('../config/db');
const { sendOk, sendError } = require('../middleware/response');

// ─── Helpers ───────────────────────────────────────────────────────────────────

const KNOWN_DIAL_CODES = new Set([
  '+1','+7','+20','+27','+30','+31','+32','+33','+34','+36','+39','+40','+41',
  '+43','+44','+45','+46','+47','+48','+49','+51','+52','+53','+54','+55','+56',
  '+57','+58','+60','+61','+62','+63','+64','+65','+66','+81','+82','+84','+86',
  '+90','+91','+92','+93','+94','+95','+98','+212','+213','+216','+218','+220',
  '+221','+222','+223','+224','+225','+226','+227','+228','+229','+230','+231',
  '+232','+233','+234','+235','+236','+237','+238','+239','+240','+241','+242',
  '+243','+244','+245','+246','+247','+248','+249','+250','+251','+252','+253',
  '+254','+255','+256','+257','+258','+260','+261','+262','+263','+264','+265',
  '+266','+267','+268','+269','+297','+298','+299','+350','+351','+352','+353',
  '+354','+355','+356','+357','+358','+359','+370','+371','+372','+373','+374',
  '+375','+376','+377','+378','+380','+381','+382','+385','+386','+387','+389',
  '+420','+421','+423','+500','+501','+502','+503','+504','+505','+506','+507',
  '+508','+509','+590','+591','+592','+593','+595','+597','+598','+670','+672',
  '+673','+674','+675','+676','+677','+678','+679','+680','+681','+682','+683',
  '+685','+686','+687','+688','+689','+690','+691','+692','+850','+852','+853',
  '+855','+856','+880','+886','+960','+961','+962','+963','+964','+965','+966',
  '+967','+968','+970','+971','+972','+973','+974','+975','+976','+977','+992',
  '+993','+994','+995','+996','+998','+1268','+1284','+1340','+1345','+1441',
  '+1473','+1649','+1664','+1671','+1684','+1758','+1767','+1784','+1787','+1809',
  '+1868','+1869','+1876',
]);

/**
 * "+26876123456" → "+268|76123456"  (matches DB storage format from userController)
 * Tries longest dial code first to avoid ambiguity (e.g. +1 vs +1268).
 */
function e164ToStored(e164) {
  for (const len of [4, 3, 2, 1]) {
    const prefix = e164.slice(0, len + 1); // +1 for the "+"
    if (KNOWN_DIAL_CODES.has(prefix)) {
      return prefix + '|' + e164.slice(prefix.length);
    }
  }
  return e164.slice(0, 4) + '|' + e164.slice(4); // fallback: assume 3-digit code
}

/**
 * "+268|76123456" → "+26876123456"  (E.164 for sending SMS)
 */
function storedToE164(stored) {
  return stored ? stored.replace('|', '') : null;
}

/**
 * Parse the raw E.164 phone from the frontend into both formats.
 * Returns null if the phone is not a valid E.164 string.
 */
function parsePhone(raw) {
  const e164 = String(raw || '').replace(/[^\d+]/g, '');
  if (!/^\+\d{7,15}$/.test(e164)) return null;
  return { e164, stored: e164ToStored(e164) };
}

// ─── Flow A: Login ─────────────────────────────────────────────────────────────

/**
 * POST /api/auth/phone/send-otp
 * Body: { phone }  — phone must be E.164, e.g. "+26876123456"
 */
async function sendLoginOtp(req, res) {
  const parsed = parsePhone(req.body.phone);
  if (!parsed) return sendError(res, 400, 'Invalid phone number. Use international format e.g. +26876123456');

  // Extract local digits — the part after the dial code (e.g. "76115582")
  const localDigits = parsed.stored.split('|')[1];

  try {
    console.log('[sendLoginOtp] querying with:', { stored: parsed.stored, e164: parsed.e164, localDigits });
    const [rows] = await db.query(
      'SELECT id, phone FROM users WHERE phone = ? OR phone = ? OR phone = ?',
      [parsed.stored, parsed.e164, localDigits]
    );
    console.log('[sendLoginOtp] rows found:', rows);
    if (!rows.length) {
      return sendError(res, 404, 'No account found with that phone number.');
    }

    // Send OTP using E.164 (what Africa's Talking expects)
    await phoneService.sendOtp(parsed.stored, parsed.e164, localDigits);
    return sendOk(res, 200, 'OTP sent. Check your messages.');
  } catch (e) {
    console.error('[sendLoginOtp]', e);
    return sendError(res, 500, 'Failed to send OTP. Please try again.');
  }
}

/**
 * POST /api/auth/phone/verify-otp
 * Body: { phone, code }
 */
async function verifyLoginOtp(req, res) {
  const { code } = req.body;
  const parsed = parsePhone(req.body.phone);
  if (!parsed) return sendError(res, 400, 'Invalid phone number.');
  if (!/^\d{6}$/.test(code)) return sendError(res, 400, 'OTP must be 6 digits.');

  const localDigits = parsed.stored.split('|')[1];

  try {
    const user = await phoneService.verifyOtpForLogin(parsed.stored, parsed.e164, localDigits, code);
    return sendOk(res, 200, 'Login successful.', user);
  } catch (e) {
    console.error('[verifyLoginOtp]', e);
    const status  = e.statusCode || 500;
    const message = e.statusCode ? e.message : 'Server error.';
    return sendError(res, status, message);
  }
}

// ─── Flow B: Registration ──────────────────────────────────────────────────────

/**
 * POST /api/auth/phone/register/send-otp
 * Body: { phone, name }
 */
async function sendRegisterOtp(req, res) {
  const { name } = req.body;
  const parsed = parsePhone(req.body.phone);
  if (!name || !parsed) return sendError(res, 400, 'Name and a valid phone number are required.');

  try {
    const [rows] = await db.query(
      'SELECT id FROM users WHERE phone = ? OR phone = ?',
      [parsed.stored, parsed.e164]
    );
    if (rows.length) return sendError(res, 409, 'Phone number already registered.');

    await phoneService.sendOtpForRegistration(parsed.stored, parsed.e164);
    return sendOk(res, 200, 'OTP sent. Check your messages.');
  } catch (e) {
    console.error('[sendRegisterOtp]', e);
    return sendError(res, 500, 'Failed to send OTP. Please try again.');
  }
}

/**
 * POST /api/auth/phone/register/verify-otp
 * Body: { phone, code, name, email? }
 */
async function verifyRegisterOtp(req, res) {
  const { code, name, email } = req.body;
  const parsed = parsePhone(req.body.phone);
  if (!parsed || !code || !name) return sendError(res, 400, 'Phone, code, and name are required.');
  if (!/^\d{6}$/.test(code)) return sendError(res, 400, 'OTP must be 6 digits.');

  try {
    await phoneService.verifyOtpForRegistration(parsed.stored, code);

    if (email && await UserModel.emailExists(email)) {
      return sendError(res, 409, 'Email already registered.');
    }

    // Store phone in the same "dialCode|digits" format as userController
    const [result] = await db.query(
      'INSERT INTO users (name, email, phone) VALUES (?, ?, ?)',
      [name.trim(), email || null, parsed.stored]
    );

    return sendOk(res, 201, 'Account created successfully.', {
      id: result.insertId, name: name.trim(),
      email: email || null, phone: parsed.stored,
      picture: null, createdAt: new Date(),
    });
  } catch (e) {
    console.error('[verifyRegisterOtp]', e);
    const status  = e.statusCode || 500;
    const message = e.statusCode ? e.message : 'Server error.';
    return sendError(res, status, message);
  }
}

module.exports = { sendLoginOtp, verifyLoginOtp, sendRegisterOtp, verifyRegisterOtp };