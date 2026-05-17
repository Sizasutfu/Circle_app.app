//  server.js  –  Circle API entry point

require('dotenv').config();

const https         = require('https');
const fs            = require('fs');
const path          = require('path');
const { connectDB } = require('./src/config/db');
const app           = require('./src/app');

const PORT = process.env.PORT || 5000;

// mkcert certs live in src/ alongside app.js
const sslOptions = {
  key:  fs.readFileSync(path.join(__dirname, 'src/sizabeats+3-key.pem')),
  cert: fs.readFileSync(path.join(__dirname, 'src/sizabeats+3.pem')),
};

async function start() {
  await connectDB();
  https.createServer(sslOptions, app).listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Circle API running on https://sizabeats:${PORT}`);
    console.log(`✅ phone (same WiFi): https://192.168.10.203:${PORT}`);
  });
}

start();