// ============================================================
//  routes/phoneAuthRoutes.js
//  Mount this in your main app:
//    const phoneAuthRoutes = require('./routes/phoneAuthRoutes');
//    app.use('/api/auth/phone', phoneAuthRoutes);
// ============================================================

const router = require('express').Router();
const {
  sendLoginOtp,
  verifyLoginOtp,
  sendRegisterOtp,
  verifyRegisterOtp,
} = require('../controllers/phoneAuthController');

// ── Login with existing phone number ───────────────────────
// Step 1: send OTP
router.post('/send-otp', sendLoginOtp);

// Step 2: verify OTP → returns user object (same as email login)
router.post('/verify-otp', verifyLoginOtp);

// ── Register a new account via phone ───────────────────────
// Step 1: send OTP (validates phone not already taken)
router.post('/register/send-otp', sendRegisterOtp);

// Step 2: verify OTP → creates account → returns user object
router.post('/register/verify-otp', verifyRegisterOtp);

module.exports = router;