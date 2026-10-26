const fs = require('fs');
const { execFile } = require('child_process');
const pool = require('../database');

const ZONEINFO_DIR = '/usr/share/zoneinfo/';
const LOCALTIME_PATH = '/etc/localtime';
const TIMEZONE_FILE = '/etc/timezone';
const DB_SERVICE = 'mariadb';
const RADIUS_SERVICE = 'freeradius';

// Zona waktu Indonesia yang diizinkan beserta singkatannya (tanpa DST).
const ZONES = {
  'Asia/Jakarta': { abbr: 'WIB', offset: 420 },
  'Asia/Makassar': { abbr: 'WITA', offset: 480 },
  'Asia/Jayapura': { abbr: 'WIT', offset: 540 },
};

// Proses anak tidak boleh mewarisi TZ milik Node, agar yang terbaca adalah zona waktu OS yang sebenarnya.
function childEnv() {
  const env = { ...process.env };
  delete env.TZ;
  return env;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 60000, env: childEnv() }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error((stderr || error.message).trim()));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatLocal(date) {
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function abbrFromOffset(offsetMinutes) {
  const match = Object.values(ZONES).find((zone) => zone.offset === offsetMinutes);
  return match ? match.abbr : `UTC${offsetMinutes >= 0 ? '+' : '-'}${Math.abs(offsetMinutes) / 60}`;
}

function readOsTimezone() {
  try {
    const target = fs.realpathSync(LOCALTIME_PATH);
    return target.startsWith(ZONEINFO_DIR) ? target.slice(ZONEINFO_DIR.length) : target;
  } catch {
    return '';
  }
}

// Ganti zona waktu OS: timedatectl, lalu fallback manual (mis. di LXC/Proxmox).
async function setOsTimezone(timezone) {
  try {
    await run('timedatectl', ['set-timezone', timezone]);
  } catch {
    const zoneFile = `${ZONEINFO_DIR}${timezone}`;
    if (!fs.existsSync(zoneFile)) {
      throw new Error(`File zona waktu tidak ditemukan: ${zoneFile}`);
    }
    try {
      fs.unlinkSync(LOCALTIME_PATH);
    } catch {
      // abaikan jika belum ada
    }
    fs.symlinkSync(zoneFile, LOCALTIME_PATH);
  }
  if (readOsTimezone() !== timezone) {
    throw new Error('Zona waktu OS gagal diubah');
  }
  // Debian membaca /etc/timezone; timedatectl di container tidak selalu memperbaruinya.
  try {
    fs.writeFileSync(TIMEZONE_FILE, `${timezone}\n`);
  } catch {
    // tidak kritis
  }
}

async function readDatabaseTime() {
  const [rows] = await pool.query(
    "SELECT DATE_FORMAT(NOW(), '%d/%m/%Y %H:%i:%s') AS waktu, @@system_time_zone AS zona, @@global.time_zone AS mode",
  );
  return { time: rows[0].waktu, abbr: rows[0].zona, mode: rows[0].mode };
}

async function waitForDatabase() {
  let lastError;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (error) {
      lastError = error;
      await sleep(500);
    }
  }
  throw new Error(`Database tidak kembali aktif: ${lastError?.message || 'timeout'}`);
}

async function serviceActive(name) {
  try {
    return (await run('systemctl', ['is-active', name])) === 'active';
  } catch {
    return false;
  }
}

async function getStatus(targetTimezone) {
  const target = ZONES[targetTimezone];
  const now = new Date();
  const web = { time: formatLocal(now), abbr: abbrFromOffset(-now.getTimezoneOffset()) };

  let os = { timezone: readOsTimezone(), time: '', abbr: '' };
  try {
    const [time, abbr] = (await run('date', ['+%d/%m/%Y %H:%M:%S|%Z'])).split('|');
    os = { ...os, time, abbr };
  } catch {
    // biarkan kosong
  }

  let database = { time: '', abbr: '', mode: '' };
  try {
    database = await readDatabaseTime();
  } catch {
    // biarkan kosong
  }

  const radiusActive = await serviceActive(RADIUS_SERVICE);
  const synced = Boolean(target)
    && os.timezone === targetTimezone
    && web.abbr === target.abbr
    && os.abbr === target.abbr
    && database.abbr === target.abbr;

  return {
    target: targetTimezone,
    synced,
    web,
    os,
    database,
    radius: { active: radiusActive },
  };
}

let applying = false;

// Terapkan zona waktu ke Web (Node), OS, MariaDB, dan FreeRADIUS.
async function applyEverywhere(timezone) {
  const target = ZONES[timezone];
  if (!target) {
    throw new Error('Zona waktu tidak valid');
  }
  if (applying) {
    const error = new Error('Penerapan zona waktu sedang berjalan, coba lagi sebentar');
    error.status = 409;
    throw error;
  }

  applying = true;
  const steps = [];
  try {
    process.env.TZ = timezone;
    steps.push('web');

    let changed = false;
    if (readOsTimezone() !== timezone) {
      await setOsTimezone(timezone);
      changed = true;
      steps.push('os');
    }

    let dbAbbr = '';
    try {
      dbAbbr = (await readDatabaseTime()).abbr;
    } catch {
      dbAbbr = '';
    }
    if (changed || dbAbbr !== target.abbr) {
      await run('systemctl', ['restart', DB_SERVICE]);
      await waitForDatabase();
      changed = true;
      steps.push('database');
    }

    if (changed) {
      await run('systemctl', ['restart', RADIUS_SERVICE]);
      steps.push('radius');
    }
    return steps;
  } catch (error) {
    error.steps = steps;
    throw error;
  } finally {
    applying = false;
  }
}

module.exports = {
  ZONES,
  applyEverywhere,
  getStatus,
  readOsTimezone,
};
