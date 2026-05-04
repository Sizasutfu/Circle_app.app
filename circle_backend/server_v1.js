//  server.js  –  Circle API entry point

require('dotenv').config();

const express            = require('express');
const { connectDB }      = require('./config/db');
const { cors }           = require('./middleware/cors');
const { sendError }      = require('./middleware/response');

// ── Routes ────────────────────────────────────────────────
const adminRoutes        = require('./routes/adminRoutes');
const userRoutes         = require('./routes/userRoutes');
const postRoutes         = require('./routes/postRoutes');
const followRoutes       = require('./routes/followRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const searchRoutes       = require('./routes/searchRoutes');
const recommendationRoutes = require('./routes/recommendationRoutes');
const dmRoutes           = require('./routes/dm');
const exploreRoutes      = require('./routes/exploreRoutes');
const topicRoutes        = require('./routes/topicRoutes');

// authRoutes is optional (Google OAuth) — only load if the file exists
let authRoutes = null;
try { authRoutes = require('./routes/authRoutes'); } catch (_) {
  console.log('ℹ️  authRoutes not found — Google OAuth disabled.');
}

// ── App ───────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 5000;

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
app.use('/api/admin',         adminRoutes);
app.use('/api/users',         userRoutes);
app.use('/api/posts',         postRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/search',        searchRoutes);
app.use('/api/recommendations', recommendationRoutes);
if (authRoutes) app.use('/api/auth', authRoutes);
app.use('/api',               followRoutes);
app.use('/api/dm',            dmRoutes);
app.use('/api/explore',       exploreRoutes);
app.use('/api/topics',        topicRoutes);

// 404
app.use((req, res) => sendError(res, 404, `Route '${req.originalUrl}' not found.`));

// ── Start ─────────────────────────────────────────────────
async function start() {
  await connectDB();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Circle API running on http://localhost:${PORT}`);
    console.log(`     circle frontend: open frontend/circle_app.html in browser`);
    console.log(`     Admin panel: open admin/index.html in your browser`);
  });
}

start();