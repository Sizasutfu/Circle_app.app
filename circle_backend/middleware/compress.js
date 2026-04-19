// ============================================================
//  middleware/compress.js
//  Runs after multer. Compresses images with Sharp and videos
//  with FFmpeg, then saves the result to /uploads on disk.
//
//  Install dependencies:
//    npm install sharp fluent-ffmpeg ffmpeg-static
//
//  On Windows, ffmpeg-static bundles the FFmpeg binary
//  automatically — no manual install needed.
// ============================================================

const sharp   = require('sharp');
const ffmpeg  = require('fluent-ffmpeg');
const ffmpegP = require('ffmpeg-static');      // auto-bundled binary
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const os      = require('os');

ffmpeg.setFfmpegPath(ffmpegP);

// ── Where to save final compressed files ──────────────────
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ── Where to write temp video files before compression ────
const TMP_DIR = os.tmpdir();

// ─────────────────────────────────────────────────────────
//  Image compression
//  Input  : Buffer (from multer memoryStorage)
//  Output : .webp file saved to UPLOAD_DIR
//  Result : { filename, savedBytes }
// ─────────────────────────────────────────────────────────
async function compressImage(buffer) {
  const filename   = crypto.randomBytes(16).toString('hex') + '.webp';
  const outputPath = path.join(UPLOAD_DIR, filename);

  await sharp(buffer)
    .rotate()                                   // auto-rotate from EXIF
    .resize({ width: 1280, withoutEnlargement: true })
    .webp({ quality: 82 })                      // near-lossless, ~30% smaller than JPEG
    .toFile(outputPath);

  const { size } = fs.statSync(outputPath);
  return { filename, savedBytes: buffer.length - size };
}

// ─────────────────────────────────────────────────────────
//  Video compression
//  Input  : Buffer (from multer memoryStorage)
//  Output : .mp4 file saved to UPLOAD_DIR
//  Result : { filename, savedBytes }
// ─────────────────────────────────────────────────────────
function compressVideo(buffer) {
  return new Promise((resolve, reject) => {
    // Write buffer to a temp file — FFmpeg needs a file path
    const tmpName = crypto.randomBytes(16).toString('hex') + '.tmp';
    const tmpPath = path.join(TMP_DIR, tmpName);
    fs.writeFileSync(tmpPath, buffer);

    const filename   = crypto.randomBytes(16).toString('hex') + '.mp4';
    const outputPath = path.join(UPLOAD_DIR, filename);

    ffmpeg(tmpPath)
      .videoCodec('libx264')          // H.264 — widest device support
      .audioCodec('aac')
      .addOption('-crf', '26')        // quality 0–51: 18=best, 28=smallest, 26=sweet spot
      .addOption('-preset', 'fast')   // encoding speed vs compression tradeoff
      .addOption('-movflags', '+faststart') // moves metadata to front for streaming
      .size('1280x?')                 // cap width, preserve aspect ratio
      .output(outputPath)
      .on('end', () => {
        fs.unlinkSync(tmpPath);       // clean up temp file
        const { size } = fs.statSync(outputPath);
        resolve({ filename, savedBytes: buffer.length - size });
      })
      .on('error', (err) => {
        try { fs.unlinkSync(tmpPath); } catch (_) {}
        reject(err);
      })
      .run();
  });
}

// ─────────────────────────────────────────────────────────
//  Express middleware
//  Attach this after upload.fields([...]) in your route.
//  It adds req.compressedFiles = { image?, video? } with
//  { filename, savedBytes } for each compressed file.
// ─────────────────────────────────────────────────────────
async function compressUploads(req, _res, next) {
  try {
    req.compressedFiles = {};

    const imageFile = req.files?.image?.[0];
    const videoFile = req.files?.video?.[0];

    if (imageFile) {
      const result = await compressImage(imageFile.buffer);
      req.compressedFiles.image = result;
      console.log(
        `[compress] image saved — reduced by ${(result.savedBytes / 1024).toFixed(0)} KB`
      );
    }

    if (videoFile) {
      const result = await compressVideo(videoFile.buffer);
      req.compressedFiles.video = result;
      console.log(
        `[compress] video saved — reduced by ${(result.savedBytes / 1024 / 1024).toFixed(1)} MB`
      );
    }

    next();
  } catch (err) {
    console.error('[compress] error:', err.message);
    next(err); // pass to Express error handler
  }
}

module.exports = { compressUploads, compressImage, compressVideo };
