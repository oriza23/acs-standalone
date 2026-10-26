const pool = require('../database');

const SWEEP_INTERVAL_MS = 60 * 1000;

// Batas diambil dari masa aktif profil, bukan dari label EXPIRED di antarmuka.
// Voucher yang jumlah acctsessiontime-nya sudah mencapai batas itu ditandai
// Auth-Type := Reject, sehingga Access-Request berikutnya ditolak FreeRADIUS.
const EXPIRED_VOUCHER_SQL = `SELECT DISTINCT v.username
  FROM hotspot_vouchers v
  INNER JOIN hotspot_profiles hp
    ON hp.nama_profile = v.profile OR hp.mikrotik_group = v.profile
  INNER JOIN (
    SELECT username, SUM(acctsessiontime) AS used
    FROM radacct
    GROUP BY username
  ) a ON a.username = v.username
  WHERE a.used >= (
    hp.masa_aktif * CASE hp.masa_aktif_satuan
      WHEN 'JAM' THEN 3600
      WHEN 'HARI' THEN 86400
      WHEN 'BULAN' THEN 2592000
    END
  )`;

const INSERT_REJECT_SQL = `INSERT INTO radcheck (username, attribute, op, value)
  SELECT ?, 'Auth-Type', ':=', 'Reject' FROM DUAL
  WHERE NOT EXISTS (
    SELECT 1 FROM radcheck
    WHERE username = ? AND attribute = 'Auth-Type' AND value = 'Reject'
  )`;

async function rejectExpiredVouchers(db = pool) {
  const [rows] = await db.query(EXPIRED_VOUCHER_SQL);
  const rejected = [];
  const seen = new Set();

  for (const row of rows) {
    const username = typeof row.username === 'string' ? row.username : '';
    if (!username || seen.has(username)) {
      continue;
    }
    seen.add(username);
    await db.execute(INSERT_REJECT_SQL, [username, username]);
    rejected.push(username);
  }

  return rejected;
}

// Pengaman aplikasi bila rlm_sqlcounter belum dipasang. Ini menolak login
// berikutnya setelah catatan akuntansi mencapai batas. Sesi yang sedang
// berjalan tidak diputus di sini; sisa waktu di tengah sesi tetap membutuhkan
// sqlcounter (lihat deploy/freeradius/README.md).
function startExpiredVoucherEnforcement(db = pool) {
  let running = false;

  const run = async () => {
    if (running) {
      return;
    }
    running = true;
    try {
      await rejectExpiredVouchers(db);
    } catch (error) {
      console.error('Gagal menandai voucher yang durasinya habis:', error.message);
    } finally {
      running = false;
    }
  };

  run();
  const timer = setInterval(run, SWEEP_INTERVAL_MS);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }
  return timer;
}

module.exports = {
  EXPIRED_VOUCHER_SQL,
  INSERT_REJECT_SQL,
  rejectExpiredVouchers,
  startExpiredVoucherEnforcement,
};
