const { spawn } = require('child_process');
const pool = require('../database');
const { INSERT_REJECT_SQL } = require('./hotspot_quota');

const SWEEP_INTERVAL_MS = 60 * 1000;
const COA_PORT = 3799;
const RADIUS_KATEGORI_SQL = "('PPP', 'Hotspot')";

function isIpv4(value) {
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(String(value || ''))) {
    return false;
  }
  return String(value).split('.').every((octet) => Number(octet) <= 255);
}

// Mengirim Disconnect-Request (CoA/DAE) lewat radclient tanpa shell: secret dan
// atribut dikirim sebagai argumen/stdin, bukan disusun jadi string perintah.
function runRadclient({ ip, secret, attributes }) {
  return new Promise((resolve, reject) => {
    const child = spawn('radclient', ['-t', '3', '-r', '1', `${ip}:${COA_PORT}`, 'disconnect', secret]);
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0 && /Disconnect-ACK/i.test(output)) {
        resolve();
        return;
      }
      reject(new Error(code === 0 ? 'Router menolak permintaan putus (Disconnect-NAK)' : 'Router tidak membalas permintaan putus'));
    });
    child.stdin.end(`${attributes.join('\n')}\n`);
  });
}

function quote(value) {
  return `"${String(value).replace(/["\\\n\r]/g, '')}"`;
}

// Memutus sesi aktif milik username di router tempat sesi itu berjalan (diambil
// dari radacct), memakai secret router tersebut. Mengembalikan jumlah sesi
// yang berhasil diputus dan yang gagal.
async function disconnectUser(db, username, { run = runRadclient } = {}) {
  const result = { diputus: 0, gagal: 0 };
  if (!username) {
    return result;
  }
  const [sessions] = await db.execute(
    `SELECT nasipaddress, framedipaddress, acctsessionid
     FROM radacct WHERE username = ? AND acctstoptime IS NULL`,
    [username],
  );

  for (const session of sessions) {
    const [routers] = await db.execute(
      'SELECT secret FROM routers WHERE ip_address = ? LIMIT 1',
      [session.nasipaddress],
    );
    const secret = routers[0]?.secret || '';
    if (!isIpv4(session.nasipaddress) || !secret) {
      result.gagal += 1;
      continue;
    }
    const attributes = [`User-Name = ${quote(username)}`];
    if (session.acctsessionid) {
      attributes.push(`Acct-Session-Id = ${quote(session.acctsessionid)}`);
    }
    if (isIpv4(session.framedipaddress)) {
      attributes.push(`Framed-IP-Address = ${session.framedipaddress}`);
    }
    try {
      await run({ ip: session.nasipaddress, secret, attributes });
      result.diputus += 1;
    } catch (error) {
      result.gagal += 1;
      console.error(`Gagal memutus sesi ${username} di ${session.nasipaddress}:`, error.message);
    }
  }
  return result;
}

// Dipanggil setelah transaksi selesai; kegagalan memutus sesi tidak boleh
// membatalkan penyimpanan data, jadi hanya dicatat.
function disconnectInBackground(username, db = pool) {
  disconnectUser(db, username).catch((error) => {
    console.error(`Gagal memutus sesi ${username}:`, error.message);
  });
}

// True bila tanggal isolir sudah lewat menurut jam database.
async function isExpired(db, tglIsolir) {
  if (!tglIsolir) {
    return false;
  }
  const [[row]] = await db.query('SELECT (? <= NOW()) AS expired', [tglIsolir]);
  return Number(row.expired) === 1;
}

// Pelanggan PPP/Hotspot yang masa aktifnya habis (tgl_isolir lewat) berstatus
// Aktif diubah menjadi Isolir, login berikutnya ditolak, dan sesi yang sedang
// berjalan diputus sehingga tidak ada internet sama sekali.
async function isolateExpiredCustomers(db = pool, { run } = {}) {
  const [due] = await db.query(
    `SELECT id, username FROM langganan_pelanggan
     WHERE status = 'Aktif' AND tgl_isolir IS NOT NULL AND tgl_isolir <= NOW()
       AND ktg IN ${RADIUS_KATEGORI_SQL}`,
  );
  const isolated = [];

  for (const customer of due) {
    const conn = await db.getConnection();
    let changed = false;
    try {
      await conn.beginTransaction();
      const [updated] = await conn.execute(
        "UPDATE langganan_pelanggan SET status = 'Isolir' WHERE id = ? AND status = 'Aktif'",
        [customer.id],
      );
      changed = updated.affectedRows > 0;
      if (changed && customer.username) {
        await conn.execute(INSERT_REJECT_SQL, [customer.username, customer.username]);
      }
      await conn.commit();
    } catch (error) {
      await conn.rollback().catch(() => {});
      console.error(`Gagal mengisolir langganan #${customer.id}:`, error.message);
      changed = false;
    } finally {
      conn.release();
    }
    if (changed) {
      isolated.push(customer.username);
      await disconnectUser(db, customer.username, run ? { run } : undefined);
    }
  }
  return isolated;
}

function startIsolirEnforcement(db = pool) {
  let running = false;

  const tick = async () => {
    if (running) {
      return;
    }
    running = true;
    try {
      const isolated = await isolateExpiredCustomers(db);
      if (isolated.length > 0) {
        console.log(`Langganan diisolir karena masa aktif habis: ${isolated.join(', ')}`);
      }
    } catch (error) {
      console.error('Gagal memeriksa masa aktif langganan:', error.message);
    } finally {
      running = false;
    }
  };

  tick();
  const timer = setInterval(tick, SWEEP_INTERVAL_MS);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }
  return timer;
}

module.exports = {
  disconnectUser,
  disconnectInBackground,
  isExpired,
  isolateExpiredCustomers,
  startIsolirEnforcement,
};
