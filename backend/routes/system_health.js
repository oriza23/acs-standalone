const { exec } = require('child_process');
const express = require('express');
const pool = require('../../database');

const router = express.Router();

const CHECK_TIMEOUT_MS = 3000;
const RADIUS_SERVICE = 'freeradius';

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function checkDatabase() {
  const started = Date.now();
  try {
    await withTimeout(pool.query('SELECT 1'), CHECK_TIMEOUT_MS);
    return { status: 'Online', latency_ms: Date.now() - started };
  } catch (error) {
    return { status: 'Offline', detail: error.code || error.message || 'error' };
  }
}

// `systemctl is-active` keluar dengan kode non-zero saat layanan tidak aktif,
// sehingga exec menghasilkan error; stdout tetap berisi state-nya (inactive/failed/dll).
function checkRadius() {
  return new Promise((resolve) => {
    exec(
      `systemctl is-active ${RADIUS_SERVICE}`,
      { timeout: CHECK_TIMEOUT_MS },
      (error, stdout, stderr) => {
        const state = String(stdout || '').trim() || String(stderr || '').trim() || (error ? error.message : 'unknown');
        resolve({
          status: state === 'active' ? 'Online' : 'Offline',
          detail: state,
        });
      },
    );
  });
}

router.get('/health', async (req, res) => {
  const [database, radius] = await Promise.all([checkDatabase(), checkRadius()]);

  res.json({
    success: true,
    checked_at: new Date().toISOString(),
    // Endpoint ini merespons, berarti Web Backend online.
    web: { status: 'Online' },
    database,
    radius,
  });
});

module.exports = router;
