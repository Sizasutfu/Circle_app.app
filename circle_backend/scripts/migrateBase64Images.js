// ============================================================
//  scripts/migrateBase64Media.js
//
//  One-time migration: finds all posts where `image` or
//  `video` is a base64 data URI, compresses them, saves to
//  /uploads, and updates the DB row.
//
//  Usage:
//    node -r dotenv/config scripts/migrateBase64Media.js
//
//  Options (env vars):
//    DRY_RUN=1   — scan and report without writing anything
//    BATCH=50    — rows processed per DB query (default 50)
//    IMAGES=0    — skip image migration
//    VIDEOS=0    — skip video migration
//
//  Dependencies (already in your project):
//    sharp            — image compression
//    fluent-ffmpeg    — video compression
//    ffmpeg-static    — bundled ffmpeg binary
//    mysql2           — DB (uses your existing ../config/db)
//
//  Safe to re-run — rows already starting with /uploads/
//  are skipped automatically.
// ============================================================

'use strict';

const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');
const os     = require('os');
const sharp  = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegP = require('ffmpeg-static');

ffmpeg.setFfmpegPath(ffmpegP);

const { db } = require('../config/db');

// ── Where compressed files land ───────────────────────────
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const DRY_RUN      = process.env.DRY_RUN  === '1';
const SKIP_IMAGES  = process.env.IMAGES   === '0';
const SKIP_VIDEOS  = process.env.VIDEOS   === '0';
const BATCH_SIZE   = parseInt(process.env.BATCH || '50', 10);

// ─────────────────────────────────────────────────────────
//  Parse a data URI into { mime, buffer }
// ─────────────────────────────────────────────────────────
function parseDataUri(dataUri) {
  const match = dataUri.match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) return null;
  return {
    mime:   match[1],
    buffer: Buffer.from(match[2].replace(/\s/g, ''), 'base64'),
  };
}

// ─────────────────────────────────────────────────────────
//  Image: Buffer → .webp saved to UPLOAD_DIR
// ─────────────────────────────────────────────────────────
async function compressImage(buffer) {
  const filename   = crypto.randomBytes(16).toString('hex') + '.webp';
  const outputPath = path.join(UPLOAD_DIR, filename);

  await sharp(buffer)
    .rotate()
    .resize({ width: 1280, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(outputPath);

  const { size } = fs.statSync(outputPath);
  return { filename, outputPath, size };
}

// ─────────────────────────────────────────────────────────
//  Video: Buffer → .mp4 saved to UPLOAD_DIR
// ─────────────────────────────────────────────────────────
function compressVideo(buffer) {
  return new Promise((resolve, reject) => {
    // FFmpeg needs a file path — write buffer to a temp file first
    const tmpName = crypto.randomBytes(16).toString('hex') + '.tmp';
    const tmpPath = path.join(os.tmpdir(), tmpName);
    fs.writeFileSync(tmpPath, buffer);

    const filename   = crypto.randomBytes(16).toString('hex') + '.mp4';
    const outputPath = path.join(UPLOAD_DIR, filename);

    ffmpeg(tmpPath)
      .videoCodec('libx264')
      .audioCodec('aac')
      .addOption('-crf', '26')
      .addOption('-preset', 'fast')
      .addOption('-movflags', '+faststart')
      .size('1280x?')
      .output(outputPath)
      .on('end', () => {
        try { fs.unlinkSync(tmpPath); } catch (_) {}
        const { size } = fs.statSync(outputPath);
        resolve({ filename, outputPath, size });
      })
      .on('error', (err) => {
        try { fs.unlinkSync(tmpPath); } catch (_) {}
        reject(err);
      })
      .run();
  });
}

// ─────────────────────────────────────────────────────────
//  Migrate one column (image or video) across all posts
// ─────────────────────────────────────────────────────────
async function migrateColumn(column, compressFn, mimePrefix) {
  console.log(`\n── Migrating "${column}" column ──────────────────────`);

  let offset      = 0;
  let totalFound  = 0;
  let totalFixed  = 0;
  let totalFailed = 0;
  let savedBytes  = 0;

  while (true) {
    const [rows] = await db.query(
      `SELECT id, ${column}
       FROM posts
       WHERE ${column} IS NOT NULL
         AND ${column} LIKE 'data:%'
       ORDER BY id ASC
       LIMIT ? OFFSET ?`,
      [BATCH_SIZE, offset]
    );

    if (!rows.length) break;
    totalFound += rows.length;
    offset     += rows.length;

    for (const row of rows) {
      const label = `post #${row.id}`;
      const raw   = row[column];

      const parsed = parseDataUri(raw);
      if (!parsed) {
        console.warn(`  ⚠️  ${label} — unrecognised data URI, skipping.`);
        totalFailed++;
        continue;
      }

      if (!parsed.mime.startsWith(mimePrefix)) {
        console.warn(`  ⚠️  ${label} — MIME "${parsed.mime}" unexpected for ${column}, skipping.`);
        totalFailed++;
        continue;
      }

      const originalBytes = parsed.buffer.length;

      if (DRY_RUN) {
        console.log(
          `  📦  ${label} — ${parsed.mime}, ~${(originalBytes / 1024 / 1024).toFixed(2)} MB (would compress)`
        );
        totalFixed++;
        continue;
      }

      // Compress
      let result;
      try {
        result = await compressFn(parsed.buffer);
      } catch (err) {
        console.error(`  ❌  ${label} — compression failed: ${err.message}`);
        totalFailed++;
        continue;
      }

      const relativePath = `/uploads/${result.filename}`;
      const reduction    = originalBytes - result.size;
      savedBytes        += reduction;

      // Update DB
      try {
        await db.query(`UPDATE posts SET ${column} = ? WHERE id = ?`, [relativePath, row.id]);
      } catch (err) {
        try { fs.unlinkSync(result.outputPath); } catch (_) {}
        console.error(`  ❌  ${label} — DB update failed: ${err.message}`);
        totalFailed++;
        continue;
      }

      const emoji = mimePrefix === 'image/' ? '🖼️ ' : '🎥';
      console.log(
        `  ${emoji}  ${label} → ${relativePath}  ` +
        `(${(originalBytes / 1024 / 1024).toFixed(2)} MB → ` +
        `${(result.size / 1024 / 1024).toFixed(2)} MB, ` +
        `saved ${(reduction / 1024 / 1024).toFixed(2)} MB)`
      );
      totalFixed++;
    }
  }

  // Column summary
  console.log(`\n  Found   : ${totalFound}`);
  console.log(`  Fixed   : ${totalFixed}`);
  console.log(`  Failed  : ${totalFailed}`);
  if (!DRY_RUN && savedBytes > 0)
    console.log(`  Saved   : ${(savedBytes / 1024 / 1024).toFixed(2)} MB`);

  return { totalFound, totalFixed, totalFailed, savedBytes };
}

// ─────────────────────────────────────────────────────────
//  Main
// ─────────────────────────────────────────────────────────
async function migrate() {
  console.log('\n🚀  Base64 media migration starting…');
  if (DRY_RUN) console.log('   [DRY RUN — nothing will be written or changed]\n');

  const results = { images: null, videos: null };

  if (!SKIP_IMAGES) {
    results.images = await migrateColumn('image', compressImage, 'image/');
  } else {
    console.log('\n⏭️   Skipping image column (IMAGES=0)');
  }

  if (!SKIP_VIDEOS) {
    // Videos can be large — warn the user they may take a while
    console.log('\n⚠️   Video compression is CPU-intensive.');
    console.log('    Large base64 videos will take time — this is normal.\n');
    results.videos = await migrateColumn('video', compressVideo, 'video/');
  } else {
    console.log('\n⏭️   Skipping video column (VIDEOS=0)');
  }

  // ── Grand totals ─────────────────────────────────────────
  const totalFound  = (results.images?.totalFound  || 0) + (results.videos?.totalFound  || 0);
  const totalFixed  = (results.images?.totalFixed  || 0) + (results.videos?.totalFixed  || 0);
  const totalFailed = (results.images?.totalFailed || 0) + (results.videos?.totalFailed || 0);
  const savedBytes  = (results.images?.savedBytes  || 0) + (results.videos?.savedBytes  || 0);

  console.log('\n══════════════════════════════════════');
  console.log('  MIGRATION COMPLETE');
  console.log('──────────────────────────────────────');
  console.log(`  Total found    : ${totalFound}`);
  console.log(`  Total migrated : ${totalFixed}`);
  console.log(`  Total failed   : ${totalFailed}`);
  if (!DRY_RUN && savedBytes > 0)
    console.log(`  Total saved    : ${(savedBytes / 1024 / 1024).toFixed(2)} MB`);
  console.log('══════════════════════════════════════\n');

  if (totalFailed > 0) {
    console.log('⚠️   Some rows failed. Re-run the script to retry them —');
    console.log('    already-migrated rows are always skipped.\n');
  }
}

migrate()
  .catch(err => {
    console.error('\nFatal error:', err);
    process.exit(1);
  })
  .finally(() => {
    db.end?.();
    process.exit(0);
  });