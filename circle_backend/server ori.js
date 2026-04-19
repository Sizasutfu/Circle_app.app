
//  server.js  –  Circle API entry point


require('dotenv').config();

//console.log('EMAIL_USER:', process.env.EMAIL_USER, '| EMAIL_PASS:', process.env.EMAIL_PASS); 

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
const searchRoutes           = require('./routes/searchRoutes');
const recommendationRoutes   = require('./routes/recommendationRoutes');
const dmRoutes           = require('./routes/dm')
const exploreRoutes      = require('./routes/exploreRoutes')     

// authRoutes is optional (Google OAuth) — only load if the file exists
let authRoutes = null;
try { authRoutes = require('./routes/authRoutes'); } catch (_) {
  console.log('ℹ️  authRoutes not found — Google OAuth disabled.');
}

// ── App ───────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 5000;

app.use(cors);
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({limit: '100mb', extended: true}));

// Health check
app.get('/', (req, res) => res.json({
  message: 'Circle API running',
  version: '4.0.0',
}));

// ── Mount routes ──────────────────────────────────────────
// ⚠️  ORDER MATTERS:
//    /api/admin must come BEFORE /api (catch-all)
//    or admin routes will never be reached
app.use('/api/admin',         adminRoutes);          // admin panel
app.use('/api/users',         userRoutes);           // register / login / profile
app.use('/api/posts',         postRoutes);           // feed / create / delete
app.use('/api/notifications', notificationRoutes);   // notifications
app.use('/api/search',          searchRoutes);         // search posts & people
app.use('/api/recommendations',  recommendationRoutes);  // suggested users
if (authRoutes) app.use('/api/auth', authRoutes);    // Google OAuth (optional)
app.use('/api',               followRoutes);         // follow/unfollow — LAST
app.use('/api/dm', dmRoutes);
app.use('/api/explore', exploreRoutes);

// 404
app.use((req, res) => sendError(res, 404, `Route '${req.originalUrl}' not found.`));

// ── Start ─────────────────────────────────────────────────
async function start() {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`Circle API running on http://localhost:${PORT}`);
     console.log(`     circle frontend: open frontend/circle_app.html in browser`)
    console.log(`     Admin panel: open admin/index.html in your browser`);
   
  });
}

start();
