const crypto = require('crypto');
const express = require('express');
const pool = require('../../database');
const requireRole = require('../middleware/requireRole');
const { ALL_SERVER, serverAllowed } = require('../router_servers');
const { writeGroupReply, GROUP_ATTRIBUTE } = require('../radius_group');

const router = express.Router();
const requireAdmin = requireRole('admin');

const MASA_AKTIF_SATUAN = ['JAM', 'HARI', 'BULAN'];
const MASA_AKTIF_DETIK = {
  JAM: 3600,
  HARI: 86400,
  BULAN: 2592000,
};

function masaAktifKeDetik(jumlah, satuan) {
  return jumlah * MASA_AKTIF_DETIK[satuan];
}

// Batas kumulatif yang dibaca sqlcounter. Jawaban Session-Timeout sebesar sisa
// waktu dibuat modul itu, bukan baris radgroupreply.
async function writeMasaAktif(executor, groupname, totalDetik) {
  const [updated] = await executor.execute(
    "UPDATE radgroupcheck SET op = ':=', value = ? WHERE groupname = ? AND attribute = 'Max-All-Session'",
    [totalDetik, groupname],
  );
  if (updated.affectedRows === 0) {
    await executor.execute(
      "INSERT INTO radgroupcheck (groupname, attribute, op, value) VALUES (?, 'Max-All-Session', ':=', ?)",
      [groupname, totalDetik],
    );
  }
}

function readText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// ---- Server-side pagination helpers ----------------------------------------
const MAX_PAGE_LIMIT = 500;
const MAX_EXPORT_ROWS = 50000;

function readPaging(query, defaultLimit = 10) {
  const limit = Math.min(Math.max(parseInt(query?.limit, 10) || defaultLimit, 1), MAX_PAGE_LIMIT);
  const page = Math.max(parseInt(query?.page, 10) || 1, 1);
  return { limit, page };
}

function readSearch(value) {
  return typeof value === 'string' ? value.trim().slice(0, 100) : '';
}

// Escape karakter wildcard LIKE agar pencarian "50%" atau "a_b" bersifat harfiah.
function likePattern(value) {
  return `%${value.replace(/[\\%_]/g, '\\$&')}%`;
}

// Bangun klausa pencarian "(kolom1 LIKE ? OR kolom2 LIKE ? ...)".
function searchClause(columns, term, where, params) {
  if (!term) {
    return;
  }
  where.push(`(${columns.map((column) => `${column} LIKE ?`).join(' OR ')})`);
  columns.forEach(() => params.push(likePattern(term)));
}

// Hitung total dulu, jepit halaman ke rentang valid, lalu hitung OFFSET.
function resolvePage(total, page, limit) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, totalPages);
  return { page: safePage, totalPages, offset: (safePage - 1) * limit };
}

router.get('/profil', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT *, (harga_jual - komisi_reseller) AS hpp FROM hotspot_profiles ORDER BY id DESC',
    );

    res.json(rows);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Gagal mengambil data profil',
      error: error.message,
    });
  }
});

router.post('/profil', requireAdmin, async (req, res) => {
  const namaProfile = readText(req.body?.nama_profile);
  const mikrotikGroup = readText(req.body?.mikrotik_group);
  const addressList = readText(req.body?.address_list);
  const rateLimit = readText(req.body?.rate_limit);
  const shared = readInteger(req.body?.shared ?? 1);
  const masaAktif = readInteger(req.body?.masa_aktif);
  const masaAktifSatuan = readText(req.body?.masa_aktif_satuan).toUpperCase();
  const hargaJual = readInteger(req.body?.harga_jual);
  const komisiReseller = readInteger(req.body?.komisi_reseller);

  if (!namaProfile || !mikrotikGroup || !Number.isInteger(masaAktif) || masaAktif < 1
    || !MASA_AKTIF_SATUAN.includes(masaAktifSatuan)
    || !Number.isInteger(hargaJual) || hargaJual < 0
    || !Number.isInteger(komisiReseller) || komisiReseller < 0
    || !Number.isInteger(shared) || shared < 1) {
    return res.status(400).json({
      success: false,
      message: 'Data profil belum lengkap atau tidak valid',
    });
  }

  const connection = await pool.getConnection();
  let committed = false;

  try {
    await connection.beginTransaction();
    const [langgananGroup] = await connection.execute(
      'SELECT id FROM langganan_profiles WHERE BINARY group_name = ? LIMIT 1',
      [mikrotikGroup],
    );
    if (langgananGroup.length > 0) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message: 'Group sudah dipakai profil Langganan',
      });
    }
    await connection.execute(
      'INSERT INTO hotspot_profiles (nama_profile, mikrotik_group, address_list, rate_limit, shared, masa_aktif, masa_aktif_satuan, harga_jual, komisi_reseller) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        namaProfile,
        mikrotikGroup,
        addressList,
        rateLimit,
        shared,
        masaAktif,
        masaAktifSatuan,
        hargaJual,
        komisiReseller,
      ],
    );
    await connection.execute('DELETE FROM radgroupreply WHERE groupname = ?', [mikrotikGroup]);
    await connection.commit();
    committed = true;

    const totalDetik = String(masaAktifKeDetik(masaAktif, masaAktifSatuan));
    const radiusInserts = [
      pool.execute(
        "INSERT INTO radgroupreply (groupname, attribute, op, value) VALUES (?, 'Port-Limit', ':=', ?)",
        [mikrotikGroup, String(shared)],
      ),
      // MikroTik memilih Hotspot User Profile dengan nama yang sama persis dengan group ini.
      pool.execute(
        "INSERT INTO radgroupreply (groupname, attribute, op, value) VALUES (?, ?, ':=', ?)",
        [mikrotikGroup, GROUP_ATTRIBUTE, mikrotikGroup],
      ),
    ];

    if (rateLimit) {
      radiusInserts.push(pool.execute(
        "INSERT INTO radgroupreply (groupname, attribute, op, value) VALUES (?, 'Mikrotik-Rate-Limit', ':=', ?)",
        [mikrotikGroup, rateLimit],
      ));
    }

    if (addressList) {
      radiusInserts.push(pool.execute(
        "INSERT INTO radgroupreply (groupname, attribute, op, value) VALUES (?, 'Mikrotik-Address-List', ':=', ?)",
        [mikrotikGroup, addressList],
      ));
    }

    await Promise.all(radiusInserts);
    await writeMasaAktif(pool, mikrotikGroup, totalDetik);

    return res.json({
      success: true,
      message: 'Profil berhasil disimpan',
    });
  } catch (error) {
    if (!committed) {
      await connection.rollback();
    } else {
      await pool.execute('DELETE FROM radgroupreply WHERE groupname = ?', [mikrotikGroup]);
      await pool.execute('DELETE FROM radgroupcheck WHERE groupname = ?', [mikrotikGroup]);
      await pool.execute('DELETE FROM hotspot_profiles WHERE mikrotik_group = ?', [mikrotikGroup]);
    }
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        success: false,
        message: 'Mikrotik group sudah digunakan',
      });
    }
    return res.status(500).json({
      success: false,
      message: 'Gagal menyimpan profil',
      error: error.message,
    });
  } finally {
    connection.release();
  }
});

async function deleteProfileFromBothTables(executor, groupname) {
  await executor.execute('DELETE FROM radgroupreply WHERE groupname = ?', [groupname]);
  await executor.execute('DELETE FROM radgroupcheck WHERE groupname = ?', [groupname]);
  await executor.execute('DELETE FROM hotspot_profiles WHERE mikrotik_group = ?', [groupname]);
}

router.post('/profil/delete-massal', requireAdmin, async (req, res) => {
  const groupnames = Array.isArray(req.body?.groupnames)
    ? [...new Set(
      req.body.groupnames
        .filter((item) => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean),
    )]
    : [];

  if (groupnames.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Pilih minimal satu data',
    });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    for (const groupname of groupnames) {
      await deleteProfileFromBothTables(connection, groupname);
    }
    await connection.commit();

    return res.json({
      success: true,
      message: 'Profil berhasil dihapus',
      jumlah: groupnames.length,
    });
  } catch (error) {
    await connection.rollback();
    return res.status(500).json({
      success: false,
      message: 'Gagal menghapus profil',
      error: error.message,
    });
  } finally {
    connection.release();
  }
});

router.put('/profil/:groupname', requireAdmin, async (req, res) => {
  const groupname = typeof req.params.groupname === 'string' ? req.params.groupname.trim() : '';
  const body = req.body || {};
  const rateLimit = typeof body.rate_limit === 'string' ? body.rate_limit.trim() : '';
  const masaAktif = readInteger(body.masa_aktif);
  const masaAktifSatuan = readText(body.masa_aktif_satuan).toUpperCase();

  if (!groupname
    || !Number.isInteger(masaAktif) || masaAktif < 1
    || !MASA_AKTIF_SATUAN.includes(masaAktifSatuan)) {
    return res.status(400).json({
      success: false,
      message: 'Data profil belum lengkap atau tidak valid',
    });
  }

  const columns = ['masa_aktif = ?', 'masa_aktif_satuan = ?', 'rate_limit = ?'];
  const params = [masaAktif, masaAktifSatuan, rateLimit];

  if (typeof body.nama_profile === 'string') {
    const namaProfile = readText(body.nama_profile);
    if (!namaProfile) {
      return res.status(400).json({
        success: false,
        message: 'Data profil belum lengkap atau tidak valid',
      });
    }
    columns.push('nama_profile = ?');
    params.push(namaProfile);
  }

  const addressList = typeof body.address_list === 'string' ? readText(body.address_list) : null;
  if (addressList !== null) {
    columns.push('address_list = ?');
    params.push(addressList);
  }

  let shared = null;
  if (body.shared !== undefined && body.shared !== null && body.shared !== '') {
    shared = readInteger(body.shared);
    if (!Number.isInteger(shared) || shared < 1) {
      return res.status(400).json({
        success: false,
        message: 'Data profil belum lengkap atau tidak valid',
      });
    }
    columns.push('shared = ?');
    params.push(shared);
  }

  if (body.harga_jual !== undefined && body.harga_jual !== null && body.harga_jual !== '') {
    const hargaJual = readInteger(body.harga_jual);
    if (!Number.isInteger(hargaJual) || hargaJual < 0) {
      return res.status(400).json({
        success: false,
        message: 'Data profil belum lengkap atau tidak valid',
      });
    }
    columns.push('harga_jual = ?');
    params.push(hargaJual);
  }

  if (body.komisi_reseller !== undefined && body.komisi_reseller !== null && body.komisi_reseller !== '') {
    const komisiReseller = readInteger(body.komisi_reseller);
    if (!Number.isInteger(komisiReseller) || komisiReseller < 0) {
      return res.status(400).json({
        success: false,
        message: 'Data profil belum lengkap atau tidak valid',
      });
    }
    columns.push('komisi_reseller = ?');
    params.push(komisiReseller);
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const [profiles] = await connection.execute(
      'SELECT id FROM hotspot_profiles WHERE mikrotik_group = ? LIMIT 1',
      [groupname],
    );

    if (profiles.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: 'Profil tidak ditemukan',
      });
    }

    await connection.execute(
      `UPDATE hotspot_profiles SET ${columns.join(', ')} WHERE mikrotik_group = ?`,
      [...params, groupname],
    );
    await writeMasaAktif(connection, groupname, String(masaAktifKeDetik(masaAktif, masaAktifSatuan)));
    await writeGroupReply(connection, groupname, GROUP_ATTRIBUTE, groupname);
    await writeGroupReply(connection, groupname, 'Mikrotik-Rate-Limit', rateLimit);
    if (addressList !== null) {
      await writeGroupReply(connection, groupname, 'Mikrotik-Address-List', addressList);
    }
    if (shared !== null) {
      await writeGroupReply(connection, groupname, 'Port-Limit', String(shared));
    }
    await connection.commit();

    return res.json({
      success: true,
      message: 'Profil berhasil diperbarui',
    });
  } catch (error) {
    await connection.rollback();
    return res.status(500).json({
      success: false,
      message: 'Gagal memperbarui profil',
      error: error.message,
    });
  } finally {
    connection.release();
  }
});

router.delete('/profil/:groupname', requireAdmin, async (req, res) => {
  const groupname = typeof req.params.groupname === 'string' ? req.params.groupname.trim() : '';

  if (!groupname) {
    return res.status(400).json({
      success: false,
      message: 'Nama profil wajib diisi',
    });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    await deleteProfileFromBothTables(connection, groupname);
    await connection.commit();

    return res.json({
      success: true,
      message: 'Profil berhasil dihapus',
    });
  } catch (error) {
    await connection.rollback();
    return res.status(500).json({
      success: false,
      message: 'Gagal menghapus profil',
      error: error.message,
    });
  } finally {
    connection.release();
  }
});

function readInteger(value) {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return NaN;
}

const CHARSETS = {
  'huruf-kecil': 'abcdefghijklmnopqrstuvwxyz',
  'huruf-besar': 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  'huruf-campuran': 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
  'angka-huruf': 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
};

const JENIS_VOUCHER = ['username=password', 'username+password'];
const MAX_CODE_LENGTH = 32;

function combinationSpace(charsetSize, length) {
  let total = 1n;
  const base = BigInt(charsetSize);
  for (let index = 0; index < length; index += 1) {
    total *= base;
    if (total > 1000000000000000n) {
      return total;
    }
  }
  return total;
}

function countTakenCodes(usernames, prefix, length, charset) {
  const alphabet = new Set(charset);
  let taken = 0n;

  for (const username of usernames) {
    if (typeof username !== 'string' || !username.startsWith(prefix)) {
      continue;
    }
    const body = username.slice(prefix.length);
    if (body.length !== length) {
      continue;
    }
    let matches = true;
    for (const character of body) {
      if (!alphabet.has(character)) {
        matches = false;
        break;
      }
    }
    if (matches) {
      taken += 1n;
    }
  }

  return taken;
}

function resolveCodeLength(usernames, prefix, jumlah, requestedLength, charset) {
  let length = requestedLength;

  while (length <= MAX_CODE_LENGTH) {
    const space = combinationSpace(charset.length, length);
    const taken = countTakenCodes(usernames, prefix, length, charset);
    const remaining = space > taken ? space - taken : 0n;
    if (remaining >= BigInt(jumlah)) {
      return length;
    }
    length += 1;
  }

  const error = new Error('Kombinasi kode tidak cukup');
  error.code = 'CODE_EXHAUSTED';
  throw error;
}

function randomFromCharset(charset, length) {
  let code = '';
  for (let index = 0; index < length; index += 1) {
    code += charset[crypto.randomInt(charset.length)];
  }
  return code;
}

// Batas jumlah voucher per sekali generate (stress test target: 2.000 - 3.000).
const MAX_VOUCHER_QTY = 5000;
// Batas baris per satu query bulk insert (jauh di bawah max_allowed_packet MariaDB).
const BULK_CHUNK_SIZE = 5000;
const GENERATE_LOCK_NAME = 'billing_hotspot_voucher_generate';

// Aturan Auto-Length: semakin besar qty, semakin panjang kode minimal agar
// ruang kombinasi longgar dan tidak terjadi loop tabrakan tanpa akhir.
function minimumLengthForQty(jumlah) {
  if (jumlah > 1000) {
    return 6;
  }
  if (jumlah > 100) {
    return 5;
  }
  return 1;
}

// Generate seluruh voucher di memori. Jika kombinasi unik mentok pada panjang
// tertentu, panjang otomatis ditambah 1 digit lalu batch diulang (panjang
// seragam dalam satu batch). Tidak ada loop tak terbatas: percobaan dibatasi
// dan panjang dibatasi MAX_CODE_LENGTH.
function createVoucherBatch({
  jumlah,
  panjang,
  prefix,
  charset,
  usedUsernames,
  separatePassword,
}) {
  let length = panjang;

  while (length <= MAX_CODE_LENGTH) {
    const reserved = new Set(usedUsernames);
    const vouchers = [];
    const attemptLimit = Math.max(jumlah * 20, 200);
    let attempts = 0;

    while (vouchers.length < jumlah && attempts < attemptLimit) {
      attempts += 1;
      const username = `${prefix}${randomFromCharset(charset, length)}`;
      if (reserved.has(username)) {
        continue;
      }

      let password = username;
      if (separatePassword) {
        password = randomFromCharset(charset, length);
        if (password === username) {
          continue;
        }
      }

      reserved.add(username);
      vouchers.push({ username, password });
    }

    if (vouchers.length >= jumlah) {
      return { vouchers, panjang: length };
    }

    // Mentok: tambah 1 digit otomatis.
    length += 1;
  }

  const error = new Error('Kode unik tidak cukup');
  error.code = 'CODE_EXHAUSTED';
  throw error;
}

async function bulkInsert(connection, sql, rows) {
  for (let offset = 0; offset < rows.length; offset += BULK_CHUNK_SIZE) {
    // query() (bukan execute()) agar placeholder "VALUES ?" menerima array multidimensi.
    await connection.query(sql, [rows.slice(offset, offset + BULK_CHUNK_SIZE)]);
  }
}

// Bulk insert: seluruh voucher masuk ke radcheck, radusergroup, dan
// hotspot_vouchers masing-masing lewat SATU query, dalam satu transaksi.
async function insertVouchersBulk(connection, vouchers, record) {
  const radcheckRows = [];
  const radusergroupRows = [];
  const voucherRows = [];

  for (const voucher of vouchers) {
    radcheckRows.push([voucher.username, 'Cleartext-Password', ':=', voucher.password]);
    if (record.nasIp) {
      radcheckRows.push([voucher.username, 'NAS-IP-Address', '==', record.nasIp]);
    }
    // MikroTik mengirim nama server Hotspot sebagai Called-Station-Id.
    // ALL SERVER tidak membatasi, sehingga voucher bisa login di semua server.
    if (record.server && record.server !== ALL_SERVER) {
      radcheckRows.push([voucher.username, 'Called-Station-Id', '==', record.server]);
    }
    radusergroupRows.push([voucher.username, record.mikrotikGroup, 1]);
    voucherRows.push([
      voucher.username,
      voucher.password,
      record.profile,
      record.router,
      record.server,
      record.mitra,
      record.outlet,
      record.hpp,
      record.komisi,
      record.harga,
      record.admin,
      record.kodeBatch,
    ]);
  }

  await connection.beginTransaction();
  try {
    await bulkInsert(connection, 'INSERT INTO radcheck (username, attribute, op, value) VALUES ?', radcheckRows);
    await bulkInsert(connection, 'INSERT INTO radusergroup (username, groupname, priority) VALUES ?', radusergroupRows);
    await bulkInsert(
      connection,
      'INSERT INTO hotspot_vouchers (username, password, profile, router, server, mitra, outlet, hpp, komisi, harga, admin, kode_batch) VALUES ?',
      voucherRows,
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}

const VOUCHER_DELETE_TABLES = ['hotspot_vouchers', 'radcheck', 'radreply', 'radusergroup', 'radacct'];

function sqlPlaceholders(count) {
  return new Array(count).fill('?').join(', ');
}

// Hapus massal dan hapus satu voucher. Hanya username yang ada di hotspot_vouchers.
// radgroupreply, radgroupcheck, dan akun PPPoE tidak ikut terhapus.
async function deleteHotspotVouchers(usernames) {
  const requested = [...new Set(
    usernames
      .filter((item) => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean),
  )];
  if (requested.length === 0) {
    return { jumlah: 0 };
  }

  const connection = await pool.getConnection();
  let committed = false;

  try {
    await connection.beginTransaction();
    const [ownedRows] = await connection.query(
      `SELECT DISTINCT username FROM hotspot_vouchers WHERE username IN (${sqlPlaceholders(requested.length)})`,
      requested,
    );
    const targets = ownedRows.map((row) => row.username);
    if (targets.length === 0) {
      await connection.rollback();
      return { jumlah: 0 };
    }

    const marks = sqlPlaceholders(targets.length);
    const [postauthRows] = await connection.query(
      'SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
      ['radpostauth'],
    );
    const tables = Number(postauthRows[0]?.total) > 0
      ? [...VOUCHER_DELETE_TABLES, 'radpostauth']
      : VOUCHER_DELETE_TABLES;

    for (const table of tables) {
      await connection.query(
        `DELETE FROM \`${table}\` WHERE username IN (${marks})`,
        targets,
      );
    }
    await connection.commit();
    committed = true;

    for (const table of VOUCHER_DELETE_TABLES) {
      const [left] = await connection.query(
        `SELECT COUNT(*) AS total FROM \`${table}\` WHERE username IN (${marks})`,
        targets,
      );
      if (Number(left[0]?.total) !== 0) {
        const error = new Error(`Penghapusan tidak tuntas, masih ada baris di ${table}`);
        throw error;
      }
    }

    return { jumlah: targets.length };
  } catch (error) {
    if (!committed) {
      try {
        await connection.rollback();
      } catch {
        // Transaksi sudah ditutup.
      }
    }
    throw error;
  } finally {
    connection.release();
  }
}

function formatDurasiDetik(value) {
  const total = Math.max(0, Math.floor(Number(value) || 0));
  const jam = String(Math.floor(total / 3600)).padStart(2, '0');
  const menit = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const detik = String(total % 60).padStart(2, '0');
  return `${jam}:${menit}:${detik}`;
}

function formatKuotaTerpakai(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  const megabyte = value / (1024 * 1024);
  if (megabyte >= 1024) {
    const gigabyte = megabyte / 1024;
    const rounded = gigabyte >= 10 ? Math.round(gigabyte) : Math.round(gigabyte * 10) / 10;
    return `${rounded}GB`;
  }
  return `${Math.round(megabyte)}MB`;
}

function hitungTanggalExpired(tglAktif, durasiMaksimal) {
  const maksimal = Number(durasiMaksimal);
  if (!tglAktif || !Number.isFinite(maksimal) || maksimal <= 0) {
    return null;
  }
  const mulai = tglAktif instanceof Date ? new Date(tglAktif.getTime()) : new Date(tglAktif);
  if (Number.isNaN(mulai.getTime())) {
    return null;
  }
  return new Date(mulai.getTime() + (maksimal * 1000));
}

// Agregasi pemakaian per voucher (tanpa ORDER BY / LIMIT) - dipakai sebagai subquery.
const SOLD_BASE_SQL = `SELECT
    v.id,
    v.username,
    v.password,
    v.profile,
    v.router,
    v.server,
    v.mitra,
    v.outlet,
    v.hpp,
    v.komisi,
    v.harga,
    v.admin,
    v.kode_batch,
    v.created_at,
    COALESCE(SUM(a.acctsessiontime), 0) AS durasi_terpakai,
    COALESCE(SUM(COALESCE(a.acctinputoctets, 0) + COALESCE(a.acctoutputoctets, 0)), 0) AS kuota_terpakai,
    MIN(a.acctstarttime) AS tgl_aktif,
    CAST(MAX(g.value) AS UNSIGNED) AS durasi_maksimal
  FROM hotspot_vouchers v
  LEFT JOIN radacct a ON a.username = v.username
  LEFT JOIN hotspot_profiles hp
    ON hp.nama_profile = v.profile OR hp.mikrotik_group = v.profile
  LEFT JOIN radgroupcheck g
    ON g.groupname = hp.mikrotik_group AND g.attribute = 'Max-All-Session'
  WHERE v.status = 'Yes' OR a.radacctid IS NOT NULL
  GROUP BY
    v.id, v.username, v.password, v.profile, v.router, v.server, v.mitra,
    v.outlet, v.hpp, v.komisi, v.harga, v.admin, v.kode_batch, v.created_at`;

function mapSoldRow(row) {
  const terpakai = Number(row.durasi_terpakai) || 0;
  const maksimal = Number(row.durasi_maksimal);
  const punyaBatas = Number.isFinite(maksimal) && maksimal > 0;
  const statusExpired = punyaBatas && terpakai >= maksimal ? 'EXPIRED' : 'AKTIF';
  const tglExpired = hitungTanggalExpired(row.tgl_aktif, punyaBatas ? maksimal : null);

  return {
    id: row.id,
    username: row.username,
    password: row.password,
    profile: row.profile,
    router: row.router,
    server: row.server,
    mitra: row.mitra,
    outlet: row.outlet,
    hpp: Number(row.hpp) || 0,
    komisi: Number(row.komisi) || 0,
    harga: Number(row.harga) || 0,
    saldo: null,
    admin: row.admin,
    kode_batch: row.kode_batch,
    created_at: row.created_at,
    tgl_aktif: row.tgl_aktif,
    tgl_expired: tglExpired,
    durasi_terpakai: terpakai,
    durasi_maksimal: punyaBatas ? maksimal : null,
    kuota_terpakai: Number(row.kuota_terpakai) || 0,
    durasi: `${formatDurasiDetik(terpakai)} / ${punyaBatas ? formatDurasiDetik(maksimal) : 'UNLIMITED'}`,
    kuota: `${formatKuotaTerpakai(row.kuota_terpakai)} / UNLIMITED`,
    status_expired: statusExpired,
  };
}

// Opsi dropdown filter (distinct) untuk halaman Voucher Terjual.
router.get('/voucher-terjual/opsi', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT DISTINCT v.profile, v.router, v.mitra, v.outlet
       FROM hotspot_vouchers v
       WHERE v.status = 'Yes'
          OR EXISTS (SELECT 1 FROM radacct a WHERE a.username = v.username)`,
    );
    const unik = (key) => [...new Set(rows.map((row) => String(row[key] || '').trim()).filter(Boolean))].sort();
    res.json({
      profile: unik('profile'),
      router: unik('router'),
      mitra: unik('mitra'),
      outlet: unik('outlet'),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Gagal mengambil opsi filter',
      error: error.message,
    });
  }
});

router.get('/voucher-terjual', async (req, res) => {
  try {
    const exportAll = req.query.all === '1';
    const { limit, page: requestedPage } = readPaging(req.query);
    const where = [];
    const params = [];

    searchClause(
      ['s.username', 's.profile', 's.router', 's.server', 's.mitra', 's.outlet', 's.admin', 's.kode_batch'],
      readSearch(req.query.q),
      where,
      params,
    );
    const tanggal = readText(req.query.tanggal);
    if (/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) {
      where.push('DATE(s.tgl_aktif) = ?');
      params.push(tanggal);
    }
    for (const key of ['profile', 'router', 'mitra', 'outlet']) {
      const value = readText(req.query[key]);
      if (value) {
        where.push(`s.${key} = ?`);
        params.push(value);
      }
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const [summaryRows] = await pool.query(
      `SELECT
        COUNT(*) AS jumlah,
        COALESCE(SUM(s.harga), 0) AS total_penjualan,
        COALESCE(SUM(CASE WHEN s.tgl_aktif IS NOT NULL
          AND DATE_FORMAT(s.tgl_aktif, '%Y-%m') = DATE_FORMAT(NOW(), '%Y-%m')
          THEN s.harga ELSE 0 END), 0) AS penjualan_bulan_ini,
        COALESCE(SUM(CASE WHEN s.durasi_maksimal > 0 AND s.tgl_aktif IS NOT NULL
          AND DATE_ADD(s.tgl_aktif, INTERVAL s.durasi_maksimal SECOND) < NOW()
          THEN 1 ELSE 0 END), 0) AS jumlah_expired
      FROM (${SOLD_BASE_SQL}) s ${whereSql}`,
      params,
    );
    const summary = summaryRows[0] || {};
    const total = Number(summary.jumlah) || 0;
    const { page, totalPages, offset } = resolvePage(total, requestedPage, limit);

    const orderSql = 'ORDER BY s.tgl_aktif DESC, s.id DESC';
    const [rows] = exportAll
      ? await pool.query(
        `SELECT s.* FROM (${SOLD_BASE_SQL}) s ${whereSql} ${orderSql} LIMIT ?`,
        [...params, MAX_EXPORT_ROWS],
      )
      : await pool.query(
        `SELECT s.* FROM (${SOLD_BASE_SQL}) s ${whereSql} ${orderSql} LIMIT ? OFFSET ?`,
        [...params, limit, offset],
      );

    res.json({
      data: rows.map(mapSoldRow),
      total,
      page,
      limit,
      total_pages: totalPages,
      summary: {
        jumlah: total,
        total_penjualan: Number(summary.total_penjualan) || 0,
        penjualan_bulan_ini: Number(summary.penjualan_bulan_ini) || 0,
        jumlah_expired: Number(summary.jumlah_expired) || 0,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Gagal mengambil voucher terjual',
      error: error.message,
    });
  }
});

router.get('/voucher', async (req, res) => {
  try {
    const { limit, page: requestedPage } = readPaging(req.query);
    // Stok = voucher yang belum pernah dipakai (belum ada sesi di radacct).
    const where = ['NOT EXISTS (SELECT 1 FROM radacct a WHERE a.username = v.username)'];
    const params = [];
    searchClause(
      ['v.kode_batch', 'v.username', 'v.profile', 'v.router', 'v.server', 'v.mitra', 'v.outlet'],
      readSearch(req.query.q),
      where,
      params,
    );
    const whereSql = `WHERE ${where.join(' AND ')}`;

    const [summaryRows] = await pool.query(
      `SELECT
        COUNT(*) AS total,
        COALESCE(SUM(v.hpp), 0) AS total_hpp,
        COALESCE(SUM(v.komisi), 0) AS total_komisi,
        COALESCE(SUM(v.harga), 0) AS total_harga
      FROM hotspot_vouchers v ${whereSql}`,
      params,
    );
    const summary = summaryRows[0] || {};
    const total = Number(summary.total) || 0;
    const { page, totalPages, offset } = resolvePage(total, requestedPage, limit);

    const [rows] = await pool.query(
      `SELECT v.* FROM hotspot_vouchers v ${whereSql}
       ORDER BY v.created_at DESC, v.id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    res.json({
      data: rows,
      total,
      page,
      limit,
      total_pages: totalPages,
      summary: {
        total_stok: total,
        total_hpp: Number(summary.total_hpp) || 0,
        total_komisi: Number(summary.total_komisi) || 0,
        total_harga: Number(summary.total_harga) || 0,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Gagal mengambil data voucher',
      error: error.message,
    });
  }
});

router.post('/voucher/generate', requireAdmin, async (req, res) => {
  const jumlah = readInteger(req.body?.jumlah);
  const panjangDiminta = readInteger(req.body?.panjang);
  const mikrotikGroup = readText(req.body?.mikrotik_group);
  const prefix = readText(req.body?.prefix);
  const jenisVoucher = readText(req.body?.jenis_voucher);
  const kodeKombinasi = readText(req.body?.kode_kombinasi);
  const routerName = readText(req.body?.router);
  const serverName = readText(req.body?.server);
  const outlet = readText(req.body?.outlet);
  const mitra = readText(req.body?.mitra);
  const admin = readText(req.user?.username);
  if (!admin) {
    return res.status(401).json({
      success: false,
      message: 'Token tidak berisi username',
    });
  }
  const charset = CHARSETS[kodeKombinasi];

  if (!Number.isInteger(jumlah) || jumlah < 1 || jumlah > MAX_VOUCHER_QTY) {
    return res.status(400).json({
      success: false,
      message: `Jumlah voucher harus antara 1 dan ${MAX_VOUCHER_QTY}`,
    });
  }

  if (!Number.isInteger(panjangDiminta) || panjangDiminta < 6 || panjangDiminta > MAX_CODE_LENGTH) {
    return res.status(400).json({
      success: false,
      message: `Panjang karakter harus antara 6 dan ${MAX_CODE_LENGTH}`,
    });
  }

  // Prefix opsional; bila diisi harus 1 sampai 3 huruf atau angka.
  if (prefix && !/^[A-Za-z0-9]{1,3}$/.test(prefix)) {
    return res.status(400).json({
      success: false,
      message: 'Prefix harus 1 sampai 3 huruf atau angka',
    });
  }

  if (!JENIS_VOUCHER.includes(jenisVoucher) || !charset) {
    return res.status(400).json({
      success: false,
      message: 'Jenis voucher dan kode kombinasi wajib dipilih',
    });
  }

  if (!routerName) {
    return res.status(400).json({
      success: false,
      message: 'Router wajib dipilih',
    });
  }

  if (!serverName) {
    return res.status(400).json({
      success: false,
      message: 'Server wajib dipilih',
    });
  }

  if (!outlet) {
    return res.status(400).json({
      success: false,
      message: 'Outlet wajib dipilih',
    });
  }

  if (!mikrotikGroup) {
    return res.status(400).json({
      success: false,
      message: 'Profil wajib dipilih',
    });
  }

  // Router, outlet, dan profil harus ada di tabelnya. BINARY: nama harus persis
  // sama, bukan hanya cocok tanpa membedakan huruf besar kecil.
  try {
    if (routerName !== 'ALL ROUTER') {
      const [routerRows] = await pool.execute(
        'SELECT nama_router FROM routers WHERE BINARY nama_router = ? LIMIT 1',
        [routerName],
      );
      if (routerRows.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Router tidak ditemukan',
        });
      }
    }

    // Server: ALL SERVER, atau server Hotspot yang diinput di menu Router
    // (milik router terpilih; bila ALL ROUTER, milik router mana pun).
    const serverOk = await serverAllowed(pool, {
      jenis: 'hotspot',
      routerName,
      server: serverName,
    });
    if (!serverOk) {
      return res.status(400).json({
        success: false,
        message: 'Server tidak ditemukan di router yang dipilih',
      });
    }

    const [outletRows] = await pool.execute(
      'SELECT nama_outlet FROM outlets WHERE BINARY nama_outlet = ? LIMIT 1',
      [outlet],
    );
    if (outletRows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Outlet tidak ditemukan',
      });
    }

    const [groupRows] = await pool.execute(
      'SELECT mikrotik_group FROM hotspot_profiles WHERE BINARY mikrotik_group = ? LIMIT 1',
      [mikrotikGroup],
    );
    if (groupRows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Profil tidak ditemukan',
      });
    }
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Gagal memeriksa router, outlet, atau profil',
      error: error.message,
    });
  }

  let connection;
  let lockAcquired = false;

  try {
    // Satu koneksi khusus + advisory lock: dua proses generate bersamaan tidak
    // akan menghasilkan username yang sama.
    connection = await pool.getConnection();
    const [lockRows] = await connection.query('SELECT GET_LOCK(?, 30) AS locked', [GENERATE_LOCK_NAME]);
    lockAcquired = Number(lockRows[0]?.locked) === 1;
    if (!lockAcquired) {
      return res.status(503).json({
        success: false,
        message: 'Server sedang memproses pembuatan voucher lain, coba lagi sebentar',
      });
    }

    const [profiles] = await connection.execute(
      'SELECT nama_profile, harga_jual, komisi_reseller, (harga_jual - komisi_reseller) AS hpp FROM hotspot_profiles WHERE mikrotik_group = ? LIMIT 1',
      [mikrotikGroup],
    );

    if (profiles.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Profil tidak ditemukan',
      });
    }

    const profile = profiles[0];
    const record = {
      mikrotikGroup,
      profile: profile.nama_profile || mikrotikGroup,
      router: routerName,
      server: serverName,
      mitra,
      outlet,
      hpp: Number(profile.hpp) || 0,
      komisi: Number(profile.komisi_reseller) || 0,
      harga: Number(profile.harga_jual) || 0,
      admin,
    };

    let nasIp = '';
    if (routerName && routerName !== 'ALL ROUTER') {
      const [routerRows] = await connection.execute(
        'SELECT ip_address FROM routers WHERE nama_router = ? LIMIT 1',
        [routerName],
      );
      nasIp = routerRows[0]?.ip_address || '';
    }
    record.kodeBatch = Math.floor(Date.now() / 1000).toString();
    record.nasIp = nasIp;

    const [existingRows] = await connection.query(
      'SELECT username FROM radcheck UNION SELECT username FROM hotspot_vouchers',
    );
    const usedUsernames = existingRows.map((row) => row.username);

    // Auto-Length berdasarkan qty (qty > 100 => min 5, qty > 1000 => min 6),
    // lalu pastikan ruang kombinasi cukup.
    const panjangAwal = Math.max(panjangDiminta, minimumLengthForQty(jumlah));
    const panjangDipakai = resolveCodeLength(usedUsernames, prefix, jumlah, panjangAwal, charset);

    // Kumpulkan semua voucher di memori, panjang bisa naik otomatis jika mentok.
    const { vouchers, panjang } = createVoucherBatch({
      jumlah,
      panjang: panjangDipakai,
      prefix,
      charset,
      usedUsernames,
      separatePassword: jenisVoucher === 'username+password',
    });

    await insertVouchersBulk(connection, vouchers, record);

    return res.json({
      success: true,
      message: 'Voucher berhasil dibuat',
      jumlah: vouchers.length,
      panjang,
      jenis_voucher: jenisVoucher,
      kode_kombinasi: kodeKombinasi,
      prefix,
      router: routerName,
      server: serverName,
      outlet,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.code === 'CODE_EXHAUSTED'
        ? 'Gagal menghasilkan kode voucher yang unik'
        : 'Gagal membuat voucher',
      error: error.message,
    });
  } finally {
    if (connection) {
      if (lockAcquired) {
        try {
          await connection.query('SELECT RELEASE_LOCK(?)', [GENERATE_LOCK_NAME]);
        } catch (releaseError) {
          // Lock otomatis lepas saat koneksi ditutup.
        }
      }
      connection.release();
    }
  }
});

router.post('/voucher/delete-massal', requireAdmin, async (req, res) => {
  const usernames = Array.isArray(req.body?.usernames)
    ? [...new Set(
      req.body.usernames
        .filter((item) => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean),
    )]
    : [];

  if (usernames.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Pilih minimal satu voucher',
    });
  }

  try {
    const { jumlah } = await deleteHotspotVouchers(usernames);
    if (jumlah === 0) {
      return res.status(404).json({
        success: false,
        message: 'Voucher tidak ditemukan',
      });
    }
    return res.json({
      success: true,
      message: 'Voucher berhasil dihapus',
      jumlah,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message && error.message.startsWith('Penghapusan tidak tuntas')
        ? error.message
        : 'Gagal menghapus voucher',
      error: error.message,
    });
  }
});

router.delete('/voucher/:username', requireAdmin, async (req, res) => {
  const username = typeof req.params.username === 'string' ? req.params.username.trim() : '';

  if (!username) {
    return res.status(400).json({
      success: false,
      message: 'Kode voucher wajib diisi',
    });
  }

  try {
    const { jumlah } = await deleteHotspotVouchers([username]);
    if (jumlah === 0) {
      return res.status(404).json({
        success: false,
        message: 'Voucher tidak ditemukan',
      });
    }

    return res.json({
      success: true,
      message: 'Voucher berhasil dihapus',
      jumlah,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message && error.message.startsWith('Penghapusan tidak tuntas')
        ? error.message
        : 'Gagal menghapus voucher',
      error: error.message,
    });
  }
});

function readNameList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item && item.length <= 64))].slice(0, 200);
}

function readRouterValue(value) {
  if (Array.isArray(value)) {
    return readNameList(value).join(', ');
  }
  return readText(value);
}

function rencanaHotspotRouter(action, usernames, router) {
  return {
    action,
    router: router || '',
    usernames,
    perintah: action === 'kick'
      ? ['/ip/hotspot/active/remove', '/ip/hotspot/cookie/remove']
      : ['/ip/hotspot/cookie/remove'],
    dieksekusi: false,
  };
}

// ---- User online Hotspot ---------------------------------------------------
// Hanya sesi aktif radacct (acctstoptime IS NULL) milik username yang ada di
// tabel hotspot_vouchers. INNER JOIN memakai index radacct.acctstoptime lalu
// lookup UNIQUE hotspot_vouchers.username, sehingga sesi PPPoE tidak ikut.
// Tabel routers diringkas per IP (tabel kecil) agar tidak menggandakan baris.
const ONLINE_ROUTER_EXPR = "COALESCE(NULLIF(v.router, ''), r.nama_router, '')";
const ONLINE_FROM_SQL = `FROM radacct a
  INNER JOIN hotspot_vouchers v ON v.username = a.username
  LEFT JOIN (
    SELECT ip_address, MIN(nama_router) AS nama_router FROM routers GROUP BY ip_address
  ) r ON r.ip_address = a.nasipaddress`;

router.get('/online', async (req, res) => {
  try {
    const { limit, page: requestedPage } = readPaging(req.query);
    const where = ['a.acctstoptime IS NULL'];
    const params = [];
    searchClause(
      [
        'a.username', 'v.profile', ONLINE_ROUTER_EXPR, 'a.nasportid', 'v.server',
        'a.framedipaddress', 'a.callingstationid', 'v.mitra', 'v.outlet',
      ],
      readSearch(req.query.q),
      where,
      params,
    );
    const whereSql = `WHERE ${where.join(' AND ')}`;

    // COUNT tidak membawa kolom/sort apa pun, jadi cukup ringan.
    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total ${ONLINE_FROM_SQL} ${whereSql}`,
      params,
    );
    const total = Number(countRows[0]?.total) || 0;
    const { page, totalPages, offset } = resolvePage(total, requestedPage, limit);

    const [rows] = await pool.query(
      `SELECT
         a.radacctid AS id,
         a.username,
         v.profile,
         COALESCE(a.acctsessiontime, 0) AS uptime,
         COALESCE(a.acctinputoctets, 0) AS upload,
         COALESCE(a.acctoutputoctets, 0) AS download,
         ${ONLINE_ROUTER_EXPR} AS router,
         a.nasportid AS interface,
         v.server,
         a.framedipaddress AS ip_address,
         a.callingstationid AS mac_addr,
         v.mitra,
         v.outlet,
         a.acctstarttime AS last_connected,
         a.acctupdatetime AS last_updated
       ${ONLINE_FROM_SQL}
       ${whereSql}
       ORDER BY a.acctstarttime DESC, a.radacctid DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    res.json({
      data: rows.map((row) => ({
        id: row.id,
        username: row.username,
        profile: row.profile || '',
        uptime: Number(row.uptime) || 0,
        upload: Number(row.upload) || 0,
        download: Number(row.download) || 0,
        router: row.router || '',
        interface: row.interface || '',
        server: row.server || '',
        ip_address: row.ip_address || '',
        mac_addr: row.mac_addr || '',
        mitra: row.mitra || '',
        outlet: row.outlet || '',
        last_connected: row.last_connected,
        last_updated: row.last_updated,
      })),
      total,
      page,
      limit,
      total_pages: totalPages,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Gagal mengambil voucher online',
      error: error.message,
    });
  }
});

router.post('/kick-user', requireAdmin, async (req, res) => {
  const usernames = readNameList(req.body?.usernames);
  const routerName = readRouterValue(req.body?.router);

  if (usernames.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Pilih minimal satu user',
    });
  }

  const rencana = rencanaHotspotRouter('kick', usernames, routerName);
  return res.json({
    success: true,
    message: 'Permintaan kick user diterima',
    usernames: rencana.usernames,
    router: rencana.router,
  });
});

router.post('/hapus-cookie', requireAdmin, async (req, res) => {
  const usernames = readNameList(req.body?.usernames);
  const routerName = readRouterValue(req.body?.router);

  if (usernames.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Pilih minimal satu user',
    });
  }

  const rencana = rencanaHotspotRouter('cookie', usernames, routerName);
  return res.json({
    success: true,
    message: 'Permintaan hapus cookie diterima',
    usernames: rencana.usernames,
    router: rencana.router,
  });
});

router.post('/sync-online', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT COUNT(*) AS total FROM radacct a
       INNER JOIN hotspot_vouchers v ON v.username = a.username
       WHERE a.acctstoptime IS NULL`,
    );
    return res.json({
      success: true,
      message: 'Data online berhasil disegarkan',
      total: Number(rows[0]?.total) || 0,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Gagal menyegarkan data online',
      error: error.message,
    });
  }
});

module.exports = router;
