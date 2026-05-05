//  server.js  –  Circle API entry point

require('dotenv').config();

const { connectDB } = require('./src/config/db');
const app           = require('./src/app');

const PORT = process.env.PORT || 5000;

async function start() {
  await connectDB();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Circle API running on http://localhost:${PORT}`);
    console.log(`     Circle frontend: open frontend/circle_app.html in browser`);
    console.log(`     Admin panel:     open admin/index.html in your browser`);
  });
}

start();
