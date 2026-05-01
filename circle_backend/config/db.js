// ============================================================
//  config/db.js
//  Creates and exports the shared MySQL connection pool.
//  All models import this — only one pool exists in the app.
// ============================================================

const mysql = require('mysql2/promise');

const db = mysql.createPool({
  host:               process.env.DB_HOST     || 'localhost',
  user:               process.env.DB_USER     || 'root',
  password:           process.env.DB_PASSWORD || '',        
  database:           process.env.DB_NAME     || 'circle_db',
  waitForConnections: true,
  connectionLimit:    10,
  queueLimit:         0,
 //timezone: "Z",
});

// Test the connection once at startup so we know immediately if MySQL is down
async function connectDB() {
  try {
    const conn = await db.getConnection();
    console.log('Successfully connected to MySQL –', process.env.DB_NAME || 'circle_db');
    conn.release();
  } catch (err) {
    console.error('❌  MySQL connection failed:', err.message);
    process.exit(1); // crash fast — nothing works without the DB
  }
}

module.exports = { db, connectDB };
