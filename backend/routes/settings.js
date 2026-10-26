const express = require('express');
const pool = require('../../database');
const systemTime = require('../system_time');
const requireRole = require('../middleware/requireRole');

const router = express.Router();
const requireAdmin = requireRole('admin');

const TIMEZONE_KEY = 'timezone';
const DEFAULT_TIMEZONE = 'Asia/Makassar';
const TIMEZONES = ['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura'];

// Terapkan zona waktu ke proses Node (berlaku langsung, tanpa restart).
function applyTimezone(timezone) {
  if (TIMEZONES.includes(timezone)) {
    process.env.TZ = timezone;
  }
}

async function readTimezone() {
  const [rows] = await pool.execute(
    'SELECT `value` FROM settings WHERE key_name = ? LIMIT 1',
    [TIMEZONE_KEY],
  );
  const saved = rows[0]?.value;
  return TIMEZONES.includes(saved) ? saved : DEFAULT_TIMEZONE;
}

async function ensureTable() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS settings (
      key_name VARCHAR(100) PRIMARY KEY,
      \`value\` VARCHAR(255) NOT NULL
    )`,
  );
}

// Dipanggil saat server start agar zona waktu tersimpan langsung dipakai.
router.loadTimezone = async () => {
  const timezone = await readTimezone();
  applyTimezone(timezone);
  return timezone;
};

router.ensureTable = ensureTable;

router.get('/timezone', async (req, res) => {
  try {
    res.json({
      success: true,
      timezone: await readTimezone(),
      options: TIMEZONES,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Gagal mengambil pengaturan zona waktu',
      error: error.message,
    });
  }
});

// Waktu server saat ini (epoch ms) + zona waktu aktif, untuk jam realtime di sidebar.
router.get('/server-time', async (req, res) => {
  try {
    res.json({
      success: true,
      now: Date.now(),
      timezone: await readTimezone(),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Gagal mengambil waktu server',
      error: error.message,
    });
  }
});

// Status sinkronisasi waktu: Web, OS, Database, dan FreeRADIUS.
router.get('/time-status', async (req, res) => {
  try {
    res.json({ success: true, ...(await systemTime.getStatus(await readTimezone())) });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Gagal membaca status waktu',
      error: error.message,
    });
  }
});

router.post('/timezone', requireAdmin, async (req, res) => {
  const timezone = typeof req.body?.timezone === 'string' ? req.body.timezone.trim() : '';
  if (!TIMEZONES.includes(timezone)) {
    return res.status(400).json({
      success: false,
      message: 'Zona waktu tidak valid',
    });
  }

  try {
    await pool.execute(
      'INSERT INTO settings (key_name, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
      [TIMEZONE_KEY, timezone],
    );
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Gagal menyimpan pengaturan zona waktu',
      error: error.message,
    });
  }

  try {
    const steps = await systemTime.applyEverywhere(timezone);
    return res.json({
      success: true,
      message: 'Zona waktu berhasil diterapkan ke Web, OS, Database, dan FreeRADIUS',
      timezone,
      steps,
      status: await systemTime.getStatus(timezone),
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: `Pengaturan tersimpan, tetapi gagal diterapkan ke sistem: ${error.message}`,
      error: error.message,
      steps: error.steps || [],
    });
  }
});

module.exports = router;
