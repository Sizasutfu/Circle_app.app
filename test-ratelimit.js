// test-ratelimit.js
// Run with: node test-ratelimit.js
// Make sure your server is running first: node server.js (or however you start it)

const BASE_URL = 'http://localhost:5000'; // change port if yours is different

// ── Helpers ───────────────────────────────────────────────────────────────────

function color(code, text) {
  return `\x1b[${code}m${text}\x1b[0m`;
}
const green  = t => color(32, t);
const red    = t => color(31, t);
const yellow = t => color(33, t);
const cyan   = t => color(36, t);
const bold   = t => color(1,  t);

async function hit(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${path}`, opts);
  return res;
}

// Fire `count` requests as fast as possible, return a summary
async function flood(label, method, path, count, body) {
  console.log(cyan(`\n── ${label} ──`));
  console.log(`   ${method} ${path}  ×${count}`);

  let ok = 0, limited = 0, other = 0;
  const statuses = [];

  for (let i = 1; i <= count; i++) {
    const res = await hit(method, path, body);
    statuses.push(res.status);
    if (res.status === 429) limited++;
    else if (res.status < 500) ok++;
    else other++;

    // Print a dot every 10 requests so you can see progress
    if (i % 10 === 0) process.stdout.write('.');
  }
  console.log(); // newline after dots

  const firstBlock = statuses.indexOf(429) + 1; // 0-indexed → 1-indexed
  console.log(`   ${green(`✓ allowed:`)}  ${ok}`);
  console.log(`   ${red(`✗ blocked:`)}  ${limited}`);
  if (other) console.log(`   ${yellow(`? other:`)}   ${other}`);
  if (firstBlock > 0) {
    console.log(`   ${bold('First 429 on request #' + firstBlock)}`);
  } else {
    console.log(`   ${yellow('⚠ No 429 received — limiter may not be active on this route')}`);
  }

  // Show the rate-limit headers from the last response (re-fetch once for headers)
  const probe = await hit(method, path, body);
  const limit     = probe.headers.get('ratelimit-limit');
  const remaining = probe.headers.get('ratelimit-remaining');
  const reset     = probe.headers.get('ratelimit-reset');
  if (limit) {
    console.log(`   Headers → limit=${limit} remaining=${remaining} reset=${reset}s`);
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

async function runAll() {
  console.log(bold('\n🔥 Circle Rate Limit Test Suite'));
  console.log(`   Target: ${BASE_URL}\n`);

  // 1. Auth limiter — should block after 10 requests in 15 min
  //    We send 15 requests; expect ~10 ok then 5 blocked
  await flood(
    'Auth limiter  (max 10 / 15 min)',
    'POST',
    '/api/auth/login',
    15,
    { email: 'test@test.com', password: 'wrongpassword' }
  );

  // Small pause so we're clearly in a fresh batch for the next test
  await new Promise(r => setTimeout(r, 1000));

  // 2. Search limiter — should block after 60 requests in 1 min
  //    We send 70; expect ~60 ok then 10 blocked
  await flood(
    'Search limiter  (max 60 / 1 min)',
    'GET',
    '/api/search?q=test&type=posts',
    70,
  );

  await new Promise(r => setTimeout(r, 1000));

  // 3. General API limiter — 200 / 15 min
  //    We send 210; expect ~200 ok then 10 blocked
  //    (uses a lightweight endpoint so it's fast)
  await flood(
    'General limiter  (max 200 / 15 min)',
    'GET',
    '/api/explore',
    210,
  );

  await new Promise(r => setTimeout(r, 1000));

  // 4. Upload/post limiter — 30 / 10 min
  //    We send 35; expect ~30 ok then 5 blocked
  //    (will get 401 Unauthorized but that still counts as a valid hit)
  await flood(
    'Upload limiter  (max 30 / 10 min)',
    'POST',
    '/api/posts',
    35,
    { content: 'spam test post' }
  );

  console.log(bold('\n✅ Done. Check results above.\n'));
  console.log('Tips:');
  console.log('  • If you see no 429s, make sure the server is running and limiters are mounted before routes.');
  console.log('  • If ALL requests are blocked immediately, you may be behind a proxy — add app.set("trust proxy", 1).');
  console.log('  • Wait 15 minutes (or restart the server) to reset the in-memory windows.\n');
}

runAll().catch(err => {
  console.error(red('\nFailed to connect:'), err.message);
  console.error('Is your server running? Check the BASE_URL at the top of this file.\n');
  process.exit(1);
});
