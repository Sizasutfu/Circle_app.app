// ============================================================
//  middleware/upload.js
//  Multer config — uses memoryStorage so files land in RAM
//  first, then the compress middleware saves them to disk
//  after compression. This avoids writing raw originals.
// ============================================================

const multer = require('multer');

function fileFilter(_req, file, cb) {
  const allowed = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'video/mp4',
    'video/webm',
    'video/quicktime',
  ];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`File type '${file.mimetype}' is not allowed.`), false);
  }
}

const upload = multer({
  storage: multer.memoryStorage(), // hold in RAM — compress middleware saves to disk
  fileFilter,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB ceiling (pre-compression)
});

module.exports = upload;
