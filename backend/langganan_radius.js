const { ALL_SERVER } = require('./router_servers');

// Akun RADIUS untuk pelanggan di Data Langganan.
//
// Aturan login yang ditulis ke RADIUS mengikuti pilihan di data langganan:
//   - Router tertentu  -> NAS-IP-Address == IP router itu (menu Router)
//   - ALL ROUTER       -> tanpa batas router
//   - Server tertentu  -> Called-Station-Id == nama server (MikroTik mengirim
//                         Service Name PPPoE / nama server Hotspot di atribut ini)
//   - ALL SERVER       -> tanpa batas server
//   - Status Non Aktif atau Isolir -> Auth-Type := Reject (login ditolak)
const ALL_ROUTER = 'ALL ROUTER';
const MAX_RADIUS_USERNAME = 64;
const RADIUS_KATEGORI = ['PPP', 'Hotspot'];

class RadiusSyncError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'RadiusSyncError';
    this.statusCode = statusCode;
  }
}

// Hanya kategori PPP dan Hotspot yang login lewat RADIUS dan punya password.
function usesRadius(customer) {
  return RADIUS_KATEGORI.includes(customer.ktg)
    && Boolean(customer.username)
    && Boolean(customer.password);
}

// Menghapus seluruh baris RADIUS milik username (akun langganan dimiliki penuh
// oleh data langganan, jadi semua barisnya boleh diganti).
async function removeAccount(db, username) {
  if (!username) {
    return;
  }
  await db.execute('DELETE FROM radcheck WHERE username = ?', [username]);
  await db.execute('DELETE FROM radusergroup WHERE username = ?', [username]);
}

// Username RADIUS harus unik di seluruh sistem: tidak boleh bentrok dengan
// langganan lain, voucher Hotspot, atau akun dari halaman PPPoE Pelanggan.
async function assertUsernameFree(db, username, ownId = null) {
  if (username.length > MAX_RADIUS_USERNAME) {
    throw new RadiusSyncError(`Username maksimal ${MAX_RADIUS_USERNAME} karakter agar bisa dipakai di RADIUS`);
  }
  const [others] = await db.execute(
    'SELECT id FROM langganan_pelanggan WHERE username = ? AND id <> ? LIMIT 1',
    [username, ownId ?? 0],
  );
  if (others.length > 0) {
    throw new RadiusSyncError('Username sudah dipakai langganan lain', 409);
  }
  const [used] = await db.execute(
    'SELECT username FROM radcheck WHERE username = ? LIMIT 1',
    [username],
  );
  if (used.length > 0) {
    throw new RadiusSyncError(
      'Username sudah ada di RADIUS (voucher Hotspot atau akun PPPoE Pelanggan). Gunakan username lain atau hapus akun itu dulu',
      409,
    );
  }
}

// Baris radcheck + radusergroup yang seharusnya ada untuk pelanggan ini.
async function buildAccountRows(db, customer) {
  let nasIp = '';
  if (!customer.router) {
    throw new RadiusSyncError('Router wajib dipilih');
  }
  if (customer.router !== ALL_ROUTER) {
    const [routerRows] = await db.execute(
      'SELECT ip_address FROM routers WHERE BINARY nama_router = ? LIMIT 1',
      [customer.router],
    );
    nasIp = routerRows[0]?.ip_address || '';
    if (!nasIp) {
      throw new RadiusSyncError(`Router "${customer.router}" tidak ditemukan atau belum punya IP address`);
    }
  }

  let groupName = '';
  if (customer.profil_id) {
    const [profileRows] = await db.execute(
      'SELECT group_name FROM langganan_profiles WHERE id = ? LIMIT 1',
      [customer.profil_id],
    );
    groupName = (profileRows[0]?.group_name || '').trim();
  }

  const radcheck = [['Cleartext-Password', ':=', customer.password]];
  if (nasIp) {
    radcheck.push(['NAS-IP-Address', '==', nasIp]);
  }
  if (customer.server && customer.server !== ALL_SERVER) {
    radcheck.push(['Called-Station-Id', '==', customer.server]);
  }
  if (customer.status !== 'Aktif') {
    radcheck.push(['Auth-Type', ':=', 'Reject']);
  }
  return { radcheck, groupName };
}

// Menimpa akun RADIUS pelanggan sesuai data langganan terbaru. Dipanggil di
// dalam transaksi yang sama dengan penyimpanan data langganan.
async function writeAccount(db, customer) {
  await removeAccount(db, customer.username);
  if (!usesRadius(customer)) {
    return;
  }

  const { radcheck, groupName } = await buildAccountRows(db, customer);
  for (const [attribute, op, value] of radcheck) {
    await db.execute(
      'INSERT INTO radcheck (username, attribute, op, value) VALUES (?, ?, ?, ?)',
      [customer.username, attribute, op, value],
    );
  }
  if (groupName) {
    await db.execute(
      'INSERT INTO radusergroup (username, groupname, priority) VALUES (?, ?, 1)',
      [customer.username, groupName],
    );
  }
}

// Profil langganan berubah nama grup RADIUS-nya: perbarui grup semua pelanggan
// yang sudah punya akun. groupName kosong berarti grup dicabut.
async function syncProfileGroup(db, profilId, groupName) {
  await db.execute(
    `DELETE ug FROM radusergroup ug
     INNER JOIN langganan_pelanggan c ON c.username = ug.username
     WHERE c.profil_id = ? AND c.ktg IN ('PPP', 'Hotspot')`,
    [profilId],
  );
  if (!groupName) {
    return;
  }
  await db.execute(
    `INSERT INTO radusergroup (username, groupname, priority)
     SELECT DISTINCT c.username, ?, 1 FROM langganan_pelanggan c
     WHERE c.profil_id = ? AND c.ktg IN ('PPP', 'Hotspot')
       AND EXISTS (
         SELECT 1 FROM radcheck r
         WHERE r.username = c.username AND r.attribute = 'Cleartext-Password'
       )`,
    [groupName, profilId],
  );
}

module.exports = {
  ALL_ROUTER,
  MAX_RADIUS_USERNAME,
  RadiusSyncError,
  usesRadius,
  removeAccount,
  assertUsernameFree,
  buildAccountRows,
  writeAccount,
  syncProfileGroup,
};
