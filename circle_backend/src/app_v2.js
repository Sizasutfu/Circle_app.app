//  app.js  –  Circle API application logic

const path               = require('path');
const express            = require('express');
const webpush            = require('web-push');
const rateLimit          = require('express-rate-limit');
const { cors }           = require('./middleware/cors');
const { sendError }      = require('./middleware/response');

// ── VAPID setup ───────────────────────────────────────────
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_MAILTO || 'mailto:admin@circle.app',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
  global.webpush = webpush;
  console.log('🔔 Web push (VAPID) configured.');
} else {
  console.warn('⚠️  VAPID keys not set — push notifications disabled.');
}

// ── Rate limiters ─────────────────────────────────────────

// General API limiter — applies to all /api routes
// 200 requests per 15 minutes per IP. Covers normal browsing
// without blocking legitimate heavy users.
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  standardHeaders: true,    // Return RateLimit-* headers so clients can adapt
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down and try again shortly.' },
});

// Auth limiter — brute-force protection on login/register/phone.
// 20 attempts per 15 minutes per IP. Generous enough for legitimate flows
// (forgot password → OTP → login) while still blocking automated attacks.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please wait 15 minutes and try again.' },
});

// Search limiter — search queries can be expensive on the DB
// 60 searches per minute per IP (1/sec on average).
const searchLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many search requests. Please slow down.' },
});

// Upload / media limiter — creating posts with media is heavy
// 30 uploads per 10 minutes per IP.
const uploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many uploads. Please wait a moment before posting again.' },
});

// ── Routes ────────────────────────────────────────────────
const adminRoutes          = require('./routes/adminRoutes');
const userRoutes           = require('./routes/userRoutes');
const postRoutes           = require('./routes/postRoutes');
const followRoutes         = require('./routes/followRoutes');
const notificationRoutes   = require('./routes/notificationRoutes');
const searchRoutes         = require('./routes/searchRoutes');
const recommendationRoutes = require('./routes/recommendationRoutes');
const dmRoutes             = require('./routes/dm');
const exploreRoutes        = require('./routes/exploreRoutes');
const topicRoutes          = require('./routes/topicRoutes');
const pushRoutes           = require('./routes/pushRoutes');
const groupRoutes          = require('./routes/groupsRoutes');
const phoneAuthRoutes      = require('./routes/phoneAuthRoutes');

// authRoutes is optional (Google OAuth) — only load if the file exists
let authRoutes = null;
try { authRoutes = require('./routes/authRoutes'); } catch (_) {
  console.log('ℹ️  authRoutes not found — Google OAuth disabled.');
}

// ── App ───────────────────────────────────────────────────
const app = express();

app.use(cors);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Serve uploaded images and videos as static files
app.use('/uploads', express.static('uploads'));

// Serve Circle frontend static files (JS, CSS, images, etc.)
app.use(express.static(path.join(__dirname, '../../circle_frontend/frontend')));

// ── Apply rate limiters ───────────────────────────────────

// General limiter on everything under /api
app.use('/api', generalLimiter);

// Tighter limiters on specific sensitive routes (these override
// the general one for their paths because they're mounted first
// and express-rate-limit counts windows independently per limiter)
app.use('/api/auth',       authLimiter);
app.use('/api/auth/phone', authLimiter);
app.use('/api/search',     searchLimiter);
// Upload limiter scoped to write methods only — GET reads fall through to generalLimiter
app.post('/api/posts',     uploadLimiter);
app.put('/api/posts',      uploadLimiter);

// ── Mount API routes ──────────────────────────────────────
app.use('/api/admin',           adminRoutes);
app.use('/api/users',           userRoutes);
app.use('/api/posts',           postRoutes);
app.use('/api/notifications',   notificationRoutes);
app.use('/api/search',          searchRoutes);
app.use('/api/recommendations', recommendationRoutes);
app.use('/api/auth/phone',      phoneAuthRoutes);
if (authRoutes) app.use('/api/auth', authRoutes);
app.use('/api',                 followRoutes);
app.use('/api/dm',              dmRoutes);
app.use('/api/explore',         exploreRoutes);
app.use('/api/topics',          topicRoutes);
app.use('/api/push',            pushRoutes);
app.use('/api/groups',          groupRoutes);

// ── SPA fallback — serves index.html for all non-API routes ──
// This allows the frontend router to handle routes like /home, /profile, etc.
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, '../../circle_frontend/frontend/index.html'));
});

// ── Start cron LAST — after all requires are fully resolved ──
const { startGroupCron } = require('./models/GroupModel');
startGroupCron();
console.log('👥 Group auto-creation cron started.');

module.exports = app;