const pool = require('../database');

// Server = nama server di MikroTik. MikroTik mengirimnya ke RADIUS sebagai
// Called-Station-Id: nama server Hotspot (IP > Hotspot > Servers > Name) atau
// Service Name PPPoE (PPP > PPPoE Servers > Service Name).
const ALL_SERVER = 'ALL SERVER';
const JENIS_SERVER = ['hotspot', 'pppoe'];
const MAX_SERVER_NAME = 100;

async function ensureTable() {
  // utf8mb4_bin: nama server dibedakan huruf besar kecil, sama seperti RADIUS.
  await pool.query(
    `CREATE TABLE IF NOT EXISTS router_servers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      router_id INT NOT NULL,
      jenis VARCHAR(10) NOT NULL,
      nama VARCHAR(${MAX_SERVER_NAME}) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_router_jenis_nama (router_id, jenis, nama)
    )`,
  );
}

// Nama server valid: tidak kosong, maksimal 100 karakter, tanpa karakter kontrol,
// dan bukan kata cadangan ALL SERVER.
function validServerName(name) {
  return typeof name === 'string'
    && name.length > 0
    && name.length <= MAX_SERVER_NAME
    // eslint-disable-next-line no-control-regex
    && !/[\u0000-\u001f\u007f]/.test(name)
    && name.toUpperCase() !== ALL_SERVER;
}

// true bila server adalah ALL SERVER atau terdaftar untuk jenis tersebut.
// Router spesifik membatasi pencarian ke server milik router itu; ALL ROUTER
// (atau kosong) memeriksa server di semua router.
async function serverAllowed(db, { jenis, routerName, server }) {
  if (server === ALL_SERVER) {
    return true;
  }
  if (!JENIS_SERVER.includes(jenis) || !server) {
    return false;
  }

  const params = [jenis, server];
  let routerFilter = '';
  if (routerName && routerName !== 'ALL ROUTER') {
    routerFilter = 'AND BINARY r.nama_router = ?';
    params.push(routerName);
  }
  const [rows] = await db.execute(
    `SELECT s.id FROM router_servers s
     JOIN routers r ON r.id = s.router_id
     WHERE s.jenis = ? AND s.nama = ? ${routerFilter} LIMIT 1`,
    params,
  );
  return rows.length > 0;
}

module.exports = {
  ALL_SERVER,
  JENIS_SERVER,
  MAX_SERVER_NAME,
  ensureTable,
  validServerName,
  serverAllowed,
};
