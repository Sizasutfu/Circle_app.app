//  app.js  –  Circle API application logic



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

// Health check
app.get('/', (req, res) => res.json({
  message: 'Circle API running',
  version: '4.0.0',
}));

// ── Mount routes ──────────────────────────────────────────
app.use('/api/admin',           adminRoutes);
app.use('/api/users',           userRoutes);
app.use('/api/posts',           postRoutes);
app.use('/api/notifications',   notificationRoutes);
app.use('/api/search',          searchRoutes);
app.use('/api/recommendations', recommendationRoutes);
if (authRoutes) app.use('/api/auth', authRoutes);
app.use('/api',                 followRoutes);
app.use('/api/dm',              dmRoutes);
app.use('/api/explore',         exploreRoutes);
app.use('/api/topics',          topicRoutes);
app.use('/api/push',            pushRoutes);

// 404
app.use((req, res) => sendError(res, 404, `Route '${req.originalUrl}' not found.`));

module.exports = app;
