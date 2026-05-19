//  app.js  –  Circle API application logic

const path               = require('path');
const express            = require('express');
const webpush            = require('web-push');
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
const linkPreviewRoutes     = require('./routes/linkpreviewRoutes'); // lightweight OG tag scraper for link previews

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

// ── Error handling middleware ─────────────────────────────
// Explicitly serve sw.js and manifest.json from the frontend root
// (required so they're scoped to '/' and not blocked by the static middleware)
app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Service-Worker-Allowed', '/');
  res.sendFile(path.join(__dirname, '../../circle_frontend/frontend/sw.js'));
});

app.get('/manifest.json', (req, res) => {
  res.setHeader('Content-Type', 'application/manifest+json');
  res.sendFile(path.join(__dirname, '../../circle_frontend/frontend/manifest.json'));
});

app.get('/icon.png', (req, res) => {
  res.setHeader('Content-Type', 'image/png'); 
  res.sendFile(path.join(__dirname, '../../circle_frontend/frontend/icon.png'));
});

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
app.use('/api/link-preview',    linkPreviewRoutes);
// ── SPA fallback — serves index.html for all non-API routes ──
// This allows the frontend router to handle routes like /home, /profile, etc.
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, '../../circle_frontend/frontend/index.html'));
});

// ── Start cron LAST — after all requires are fully resolved ──
// Placing this after module.exports would be too late; placing
// it before routes caused a circular-dependency ReferenceError.
// Bottom of the file (before module.exports) is the safe spot.
const { startGroupCron } = require('./models/GroupModel');
startGroupCron();
console.log('Group auto-creation cron started.');

module.exports = app;