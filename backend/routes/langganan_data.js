const express = require('express');
const pool = require('../../database');
const { serverAllowed, ALL_SERVER } = require('../router_servers');
const {
  ALL_ROUTER,
  RadiusSyncError,
  usesRadius,
  removeAccount,
  assertUsernameFree,
  writeAccount,
} = require('../langganan_radius');
const { isExpired, disconnectInBackground } = require('../langganan_isolir');

const EXPIRED_MESSAGE = 'Tgl Isolir sudah lewat, status Aktif akan langsung diisolir. Perpanjang Tgl Isolir atau ubah status';

const router = express.Router();
const STATUS = ['Aktif', 'Non Aktif', 'Isolir'];

function readText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function readStatus(value) {
  const status = readText(value) || 'Aktif';
  return STATUS.includes(status) ? status : null;
}

function readProfileId(value) {
  if (value === '' || value == null) {
    return null;
  }
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function readDate(value) {
  const text = readText(value);
  if (!text) {
    return null;
  }
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
}

function readDateTime(value) {
  const text = readText(value).replace('T', ' ');
  if (!text) {
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/.test(text)) {
    return null;
  }
  if (text.length === 10) {
    return `${text} 00:00:00`;
  }
  if (text.length === 16) {
    return `${text}:00`;
  }
  return text;
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatDate(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  const text = String(value);
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
}

function formatDateTime(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
  }
  return readDateTime(String(value));
}

function readCustomer(body) {
  return {
    nolayanan: readText(body?.nolayanan),
    pelanggan: readText(body?.pelanggan),
    ktg: readText(body?.ktg) || 'PPP',
    media_tipe: readText(body?.media_tipe),
    profil_id: readProfileId(body?.profil_id),
    jns_tagihan: readText(body?.jns_tagihan) || 'PRABAYAR',
    siklus: readText(body?.siklus) || 'BULAN',
    tgl_aktif: readDate(body?.tgl_aktif),
    tgl_isolir: readDateTime(body?.tgl_isolir),
    username: readText(body?.username),
    password: readText(body?.password),
    ip_address: readText(body?.ip_address),
    mac_address: readText(body?.mac_address),
    router: readText(body?.router),
    server: readText(body?.server),
    acs: readText(body?.acs),
    addr_list: readText(body?.addr_list),
    wilayah: readText(body?.wilayah),
    alamat_pasang: readText(body?.alamat_pasang),
    tgl_pasang: readDate(body?.tgl_pasang),
    mitra: readText(body?.mitra),
    kode_unik: readText(body?.kode_unik),
    note: readText(body?.note),
    status: readStatus(body?.status),
  };
}

const PPN_RATE = 0.11;
const MAX_ITEMS = 100;
const KOORDINAT_PATTERN = /^-?\d{1,2}(\.\d+)?\s*,\s*-?\d{1,3}(\.\d+)?$/;

function readMoney(value) {
  if (value === '' || value == null) {
    return 0;
  }
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 9999999999999.99) {
    return null;
  }
  return Math.round(amount * 100) / 100;
}

function readFlag(value) {
  return value === true || value === 1 || value === '1' || value === 'true' || value === 'ya';
}

// Item invoice: null berarti ada item yang tidak valid.
function readItems(value) {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value) || value.length > MAX_ITEMS) {
    return null;
  }
  const items = [];
  for (const raw of value) {
    const deskripsi = readText(raw?.deskripsi);
    const qty = Number(raw?.qty);
    const harga = readMoney(raw?.harga);
    if (!deskripsi || deskripsi.length > 200 || !Number.isFinite(qty) || qty <= 0 || qty > 9999 || harga == null) {
      return null;
    }
    items.push({
      deskripsi,
      qty: Math.round(qty * 100) / 100,
      ditagihkan: readFlag(raw?.ditagihkan),
      harga,
    });
  }
  return items;
}

// Total dihitung ulang di server, nilai total dari klien tidak dipercaya.
function calcTotals(items, ppn) {
  const subTotal = Math.round(
    items.reduce((sum, item) => sum + (item.ditagihkan ? item.qty * item.harga : 0), 0) * 100,
  ) / 100;
  const ppnNominal = ppn ? Math.round(subTotal * PPN_RATE) : 0;
  return { subTotal, ppnNominal, total: subTotal + ppnNominal };
}

// Field tambahan dari halaman "Tambah Langganan PPPoE".
function readExtras(body) {
  const extras = {
    id_pelanggan: readText(body?.id_pelanggan),
    phone: readText(body?.phone),
    koordinat: readText(body?.koordinat),
    tgl_invoice_perdana: readDate(body?.tgl_invoice_perdana),
    jatuh_tempo: readDate(body?.jatuh_tempo),
    harga_prorata: readMoney(body?.harga_prorata),
    komisi_reseller: readMoney(body?.komisi_reseller),
    ppn: readFlag(body?.ppn),
    kirim_wa: readFlag(body?.kirim_wa),
  };
  const items = readItems(body?.items);

  let error = '';
  if (extras.id_pelanggan.length > 20 || extras.phone.length > 20) {
    error = 'ID pelanggan atau phone terlalu panjang';
  } else if (extras.koordinat && (extras.koordinat.length > 60 || !KOORDINAT_PATTERN.test(extras.koordinat))) {
    error = 'Titik kordinat tidak valid, gunakan format "latitude, longitude"';
  } else if (extras.harga_prorata == null || extras.komisi_reseller == null) {
    error = 'Harga prorata atau komisi reseller tidak valid';
  } else if (items == null) {
    error = 'Item invoice tidak valid';
  }
  return { extras, items: items || [], error };
}

function customerIsValid(customer) {
  return Boolean(customer.pelanggan && customer.username && customer.status);
}

function mapCustomer(row) {
  return {
    id: row.id,
    nolayanan: row.nolayanan || '',
    pelanggan: row.pelanggan || '',
    ktg: row.ktg || '',
    media_tipe: row.media_tipe || '',
    profil_id: row.profil_id,
    nama_profil: row.nama_profil || '',
    harga_profil: row.harga_profil == null ? null : Number(row.harga_profil),
    jns_tagihan: row.jns_tagihan || '',
    siklus: row.siklus || '',
    tgl_aktif: formatDate(row.tgl_aktif),
    tgl_isolir: formatDateTime(row.tgl_isolir),
    username: row.username || '',
    password: row.password || '',
    ip_address: row.ip_address || '',
    mac_address: row.mac_address || '',
    router: row.router || '',
    server: row.server || '',
    acs: row.acs || '',
    addr_list: row.addr_list || '',
    wilayah: row.wilayah || '',
    alamat_pasang: row.alamat_pasang || '',
    tgl_pasang: formatDate(row.tgl_pasang),
    mitra: row.mitra || '',
    kode_unik: row.kode_unik || '',
    note: row.note || '',
    status: row.status || 'Aktif',
    id_pelanggan: row.id_pelanggan || '',
    phone: row.phone || '',
    koordinat: row.koordinat || '',
    tgl_invoice_perdana: formatDate(row.tgl_invoice_perdana),
    jatuh_tempo: formatDate(row.jatuh_tempo),
    harga_prorata: Number(row.harga_prorata) || 0,
    komisi_reseller: Number(row.komisi_reseller) || 0,
    ppn: Boolean(row.ppn),
    kirim_wa: Boolean(row.kirim_wa),
    sub_total: Number(row.sub_total) || 0,
    ppn_nominal: Number(row.ppn_nominal) || 0,
    total: Number(row.total) || 0,
    jumlah_item: Number(row.jumlah_item) || 0,
  };
}

const SELECT_CUSTOMERS = `SELECT c.id, c.nolayanan, c.pelanggan, c.ktg, c.media_tipe, c.profil_id,
  p.nama_profile AS nama_profil, p.harga AS harga_profil,
  c.jns_tagihan, c.siklus, c.tgl_aktif, c.tgl_isolir, c.username, c.password,
  c.ip_address, c.mac_address, c.router, c.server, c.acs, c.addr_list, c.wilayah,
  c.alamat_pasang, c.tgl_pasang, c.mitra, c.kode_unik, c.note, c.status,
  c.id_pelanggan, c.phone, c.koordinat, c.tgl_invoice_perdana, c.jatuh_tempo,
  c.harga_prorata, c.komisi_reseller, c.ppn, c.kirim_wa, c.sub_total, c.ppn_nominal, c.total,
  (SELECT COUNT(*) FROM langganan_invoice_items i WHERE i.langganan_id = c.id) AS jumlah_item
 FROM langganan_pelanggan c
 LEFT JOIN langganan_profiles p ON p.id = c.profil_id`;

async function ensureTable() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS langganan_pelanggan (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nolayanan VARCHAR(50),
      pelanggan VARCHAR(150) NOT NULL,
      ktg VARCHAR(20) DEFAULT 'PPP',
      media_tipe VARCHAR(50),
      profil_id INT NULL,
      jns_tagihan VARCHAR(30) DEFAULT 'PRABAYAR',
      siklus VARCHAR(20) DEFAULT 'BULAN',
      tgl_aktif DATE NULL,
      tgl_isolir DATETIME NULL,
      username VARCHAR(100) NOT NULL,
      password VARCHAR(100),
      ip_address VARCHAR(50),
      mac_address VARCHAR(50),
      router VARCHAR(100),
      server VARCHAR(100),
      acs VARCHAR(100),
      addr_list VARCHAR(100),
      wilayah VARCHAR(100),
      alamat_pasang TEXT,
      tgl_pasang DATE NULL,
      mitra VARCHAR(100),
      kode_unik VARCHAR(50),
      note TEXT,
      status ENUM('Aktif', 'Non Aktif', 'Isolir') DEFAULT 'Aktif',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_langganan_pelanggan_profil
        FOREIGN KEY (profil_id) REFERENCES langganan_profiles(id)
        ON DELETE SET NULL
    )`,
  );
  // Index untuk JOIN radacct.username -> langganan_pelanggan.username (halaman Langganan Online).
  await pool.query(
    'ALTER TABLE langganan_pelanggan ADD INDEX IF NOT EXISTS idx_langganan_username (username)',
  );
  // Kolom tambahan untuk halaman "Tambah Langganan PPPoE".
  await pool.query(
    `ALTER TABLE langganan_pelanggan
      ADD COLUMN IF NOT EXISTS id_pelanggan VARCHAR(20) NULL,
      ADD COLUMN IF NOT EXISTS phone VARCHAR(20) NULL,
      ADD COLUMN IF NOT EXISTS koordinat VARCHAR(60) NULL,
      ADD COLUMN IF NOT EXISTS tgl_invoice_perdana DATE NULL,
      ADD COLUMN IF NOT EXISTS jatuh_tempo DATE NULL,
      ADD COLUMN IF NOT EXISTS harga_prorata DECIMAL(15,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS komisi_reseller DECIMAL(15,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS ppn TINYINT(1) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS kirim_wa TINYINT(1) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS sub_total DECIMAL(15,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS ppn_nominal DECIMAL(15,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS total DECIMAL(15,2) NOT NULL DEFAULT 0`,
  );
  // Data lama menyimpan "ALL" untuk semua router/server. Disamakan dengan pilihan
  // ALL ROUTER / ALL SERVER agar tidak terbaca sebagai nama server bernama "ALL".
  await pool.execute(
    'UPDATE langganan_pelanggan SET server = ? WHERE UPPER(TRIM(server)) = ? AND server <> ?',
    [ALL_SERVER, 'ALL', ALL_SERVER],
  );
  await pool.execute(
    'UPDATE langganan_pelanggan SET router = ? WHERE UPPER(TRIM(router)) = ? AND router <> ?',
    [ALL_ROUTER, 'ALL', ALL_ROUTER],
  );
  await pool.query(
    `CREATE TABLE IF NOT EXISTS langganan_invoice_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      langganan_id INT NOT NULL,
      deskripsi VARCHAR(200) NOT NULL,
      qty DECIMAL(10,2) NOT NULL DEFAULT 1,
      ditagihkan TINYINT(1) NOT NULL DEFAULT 1,
      harga DECIMAL(15,2) NOT NULL DEFAULT 0,
      total DECIMAL(15,2) NOT NULL DEFAULT 0,
      CONSTRAINT fk_invoice_items_langganan
        FOREIGN KEY (langganan_id) REFERENCES langganan_pelanggan(id)
        ON DELETE CASCADE
    )`,
  );
}

router.ensureTable = ensureTable;

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(`${SELECT_CUSTOMERS} ORDER BY c.id DESC`);
    res.json(rows.map(mapCustomer));
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Gagal mengambil data langganan',
      error: error.message,
    });
  }
});

router.get('/:id/items', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({
      success: false,
      message: 'Data langganan tidak valid',
    });
  }

  try {
    const [rows] = await pool.execute(
      `SELECT id, deskripsi, qty, ditagihkan, harga, total
       FROM langganan_invoice_items
       WHERE langganan_id = ?
       ORDER BY id ASC`,
      [id],
    );
    return res.json(rows.map((row) => ({
      id: row.id,
      deskripsi: row.deskripsi,
      qty: Number(row.qty) || 0,
      ditagihkan: Boolean(row.ditagihkan),
      harga: Number(row.harga) || 0,
      total: Number(row.total) || 0,
    })));
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Gagal mengambil item invoice',
      error: error.message,
    });
  }
});

function sqlValues(customer) {
  return [
    customer.nolayanan,
    customer.pelanggan,
    customer.ktg,
    customer.media_tipe,
    customer.profil_id,
    customer.jns_tagihan,
    customer.siklus,
    customer.tgl_aktif,
    customer.tgl_isolir,
    customer.username,
    customer.password,
    customer.ip_address,
    customer.mac_address,
    customer.router,
    customer.server,
    customer.acs,
    customer.addr_list,
    customer.wilayah,
    customer.alamat_pasang,
    customer.tgl_pasang,
    customer.mitra,
    customer.kode_unik,
    customer.note,
    customer.status,
  ];
}

// Server harus ALL SERVER atau server yang diinput di menu Router untuk router
// terpilih. Kategori Hotspot memakai server Hotspot, kategori lain server PPPoE.
// Mengembalikan teks error, atau '' bila valid.
async function checkServer(customer) {
  if (!customer.server) {
    return 'Server wajib dipilih';
  }
  const allowed = await serverAllowed(pool, {
    jenis: customer.ktg === 'Hotspot' ? 'hotspot' : 'pppoe',
    routerName: customer.router,
    server: customer.server,
  });
  return allowed ? '' : 'Server tidak ditemukan di router yang dipilih';
}

const KODE_UNIK_MIN = 10;
const KODE_UNIK_MAX = 999;
const KODE_UNIK_MAX_TRIES = 200;
const INSERT_LOCK = 'langganan_pelanggan_insert';

async function generateKodeUnik(conn) {
  for (let attempt = 0; attempt < KODE_UNIK_MAX_TRIES; attempt += 1) {
    const kode = String(Math.floor(Math.random() * (KODE_UNIK_MAX - KODE_UNIK_MIN + 1)) + KODE_UNIK_MIN);
    const [rows] = await conn.execute(
      `SELECT kode_unik FROM langganan_pelanggan
       WHERE kode_unik = ? AND status IN ('Aktif', 'Isolir') LIMIT 1`,
      [kode],
    );
    if (rows.length === 0) {
      return kode;
    }
  }
  return null;
}

router.post('/', async (req, res) => {
  const customer = readCustomer(req.body);
  if (!customerIsValid(customer)) {
    return res.status(400).json({
      success: false,
      message: 'Nama pelanggan, username, dan status wajib diisi',
    });
  }
  if (customer.nolayanan && !/^\d+$/.test(customer.nolayanan)) {
    return res.status(400).json({
      success: false,
      message: 'No Layanan hanya boleh berisi angka!',
    });
  }

  try {
    const serverError = await checkServer(customer);
    if (serverError) {
      return res.status(400).json({ success: false, message: serverError });
    }
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Gagal memeriksa server',
      error: error.message,
    });
  }

  const { extras, items, error: extrasError } = readExtras(req.body);
  if (extrasError) {
    return res.status(400).json({ success: false, message: extrasError });
  }
  const totals = calcTotals(items, extras.ppn);

  // Kode unik boleh diisi manual (10-999); bila kosong dibuat otomatis oleh backend.
  const requestedKode = customer.kode_unik;
  if (requestedKode) {
    const kodeNumber = Number(requestedKode);
    if (!/^\d+$/.test(requestedKode) || kodeNumber < KODE_UNIK_MIN || kodeNumber > KODE_UNIK_MAX) {
      return res.status(400).json({
        success: false,
        message: `Kode unik harus berupa angka ${KODE_UNIK_MIN}-${KODE_UNIK_MAX}`,
      });
    }
  }
  // ACS belum diinput dari form.
  customer.acs = '';
  customer.kode_unik = '';
  customer.mitra = customer.mitra.slice(0, 100);

  let conn;
  let locked = false;
  let inTransaction = false;
  try {
    conn = await pool.getConnection();
    // Serialisasi proses simpan agar pengecekan unik tidak bentrok antar request bersamaan.
    const [[lockRow]] = await conn.query('SELECT GET_LOCK(?, 10) AS got', [INSERT_LOCK]);
    locked = Number(lockRow.got) === 1;
    if (!locked) {
      return res.status(503).json({
        success: false,
        message: 'Server sedang sibuk, silakan coba lagi',
      });
    }

    if (customer.nolayanan) {
      const [existing] = await conn.execute(
        'SELECT nolayanan FROM langganan_pelanggan WHERE nolayanan = ? LIMIT 1',
        [customer.nolayanan],
      );
      if (existing.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'No Layanan sudah terdaftar!',
        });
      }
    }

    let kodeUnik;
    if (requestedKode) {
      const [used] = await conn.execute(
        `SELECT kode_unik FROM langganan_pelanggan
         WHERE kode_unik = ? AND status IN ('Aktif', 'Isolir') LIMIT 1`,
        [requestedKode],
      );
      if (used.length > 0) {
        return res.status(409).json({
          success: false,
          message: 'Kode unik sudah dipakai langganan lain',
        });
      }
      kodeUnik = String(Number(requestedKode));
    } else {
      kodeUnik = await generateKodeUnik(conn);
    }
    if (!kodeUnik) {
      return res.status(409).json({
        success: false,
        message: 'Kode unik habis, tidak ada angka tersedia',
      });
    }
    customer.kode_unik = kodeUnik;

    if (usesRadius(customer)) {
      await assertUsernameFree(conn, customer.username);
      if (customer.status === 'Aktif' && await isExpired(conn, customer.tgl_isolir)) {
        return res.status(400).json({ success: false, message: EXPIRED_MESSAGE });
      }
    }

    // Data langganan, item invoice, dan akun RADIUS disimpan bersamaan, gagal salah satu = batal semua.
    await conn.beginTransaction();
    inTransaction = true;

    const columns = [
      'nolayanan', 'pelanggan', 'ktg', 'media_tipe', 'profil_id', 'jns_tagihan', 'siklus', 'tgl_aktif',
      'tgl_isolir', 'username', 'password', 'ip_address', 'mac_address', 'router', 'server', 'acs',
      'addr_list', 'wilayah', 'alamat_pasang', 'tgl_pasang', 'mitra', 'kode_unik', 'note', 'status',
      'id_pelanggan', 'phone', 'koordinat', 'tgl_invoice_perdana', 'jatuh_tempo', 'harga_prorata',
      'komisi_reseller', 'ppn', 'kirim_wa', 'sub_total', 'ppn_nominal', 'total',
    ];
    const values = [
      ...sqlValues(customer),
      extras.id_pelanggan || null,
      extras.phone || null,
      extras.koordinat || null,
      extras.tgl_invoice_perdana,
      extras.jatuh_tempo,
      extras.harga_prorata,
      extras.komisi_reseller,
      extras.ppn ? 1 : 0,
      extras.kirim_wa ? 1 : 0,
      totals.subTotal,
      totals.ppnNominal,
      totals.total,
    ];
    const [result] = await conn.execute(
      `INSERT INTO langganan_pelanggan (${columns.join(', ')})
       VALUES (${columns.map(() => '?').join(', ')})`,
      values,
    );

    for (const item of items) {
      await conn.execute(
        `INSERT INTO langganan_invoice_items (langganan_id, deskripsi, qty, ditagihkan, harga, total)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          result.insertId,
          item.deskripsi,
          item.qty,
          item.ditagihkan ? 1 : 0,
          item.harga,
          item.ditagihkan ? Math.round(item.qty * item.harga * 100) / 100 : 0,
        ],
      );
    }
    await writeAccount(conn, customer);
    await conn.commit();
    inTransaction = false;
    if (usesRadius(customer) && customer.status !== 'Aktif') {
      disconnectInBackground(customer.username);
    }

    return res.json({
      success: true,
      message: 'Data langganan berhasil disimpan',
      id: result.insertId,
      kode_unik: kodeUnik,
      sub_total: totals.subTotal,
      ppn_nominal: totals.ppnNominal,
      total: totals.total,
    });
  } catch (error) {
    if (inTransaction) {
      await conn.rollback().catch(() => {});
    }
    if (error instanceof RadiusSyncError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    if (error.code === 'ER_NO_REFERENCED_ROW_2') {
      return res.status(400).json({
        success: false,
        message: 'Profil langganan tidak ditemukan',
      });
    }
    return res.status(500).json({
      success: false,
      message: 'Gagal menyimpan data langganan',
      error: error.message,
    });
  } finally {
    if (conn) {
      if (locked) {
        await conn.query('SELECT RELEASE_LOCK(?)', [INSERT_LOCK]).catch(() => {});
      }
      conn.release();
    }
  }
});

router.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const customer = readCustomer(req.body);
  if (!Number.isInteger(id) || id < 1 || !customerIsValid(customer)) {
    return res.status(400).json({
      success: false,
      message: 'Data langganan belum lengkap atau tidak valid',
    });
  }

  let conn;
  let inTransaction = false;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    inTransaction = true;

    const [current] = await conn.execute(
      'SELECT server, router, username FROM langganan_pelanggan WHERE id = ? LIMIT 1 FOR UPDATE',
      [id],
    );
    if (current.length === 0) {
      await conn.rollback();
      inTransaction = false;
      return res.status(404).json({
        success: false,
        message: 'Data langganan tidak ditemukan',
      });
    }

    // Server diperiksa hanya bila diubah, supaya data lama (server lama yang
    // tidak ada di menu Router) tetap bisa diedit tanpa mengganti server.
    if ((current[0].server || '') !== customer.server || (current[0].router || '') !== customer.router) {
      const serverError = await checkServer(customer);
      if (serverError) {
        await conn.rollback();
        inTransaction = false;
        return res.status(400).json({ success: false, message: serverError });
      }
    }

    const oldUsername = current[0].username || '';
    if (usesRadius(customer) && oldUsername !== customer.username) {
      await assertUsernameFree(conn, customer.username, id);
    }
    if (usesRadius(customer) && customer.status === 'Aktif' && await isExpired(conn, customer.tgl_isolir)) {
      await conn.rollback();
      inTransaction = false;
      return res.status(400).json({ success: false, message: EXPIRED_MESSAGE });
    }

    await conn.execute(
      `UPDATE langganan_pelanggan
       SET nolayanan = ?, pelanggan = ?, ktg = ?, media_tipe = ?, profil_id = ?, jns_tagihan = ?,
           siklus = ?, tgl_aktif = ?, tgl_isolir = ?, username = ?, password = ?, ip_address = ?,
           mac_address = ?, router = ?, server = ?, addr_list = ?, wilayah = ?,
           alamat_pasang = ?, tgl_pasang = ?, note = ?, status = ?
       WHERE id = ?`,
      [...sqlValues(customer).filter((_, index) => ![15, 20, 21].includes(index)), id],
    );

    // Username lama dibersihkan dari RADIUS, lalu akun ditulis ulang sesuai data terbaru
    // (password, grup profil, batas router/server, dan status).
    if (oldUsername && oldUsername !== customer.username) {
      await removeAccount(conn, oldUsername);
    }
    await writeAccount(conn, customer);
    await conn.commit();
    inTransaction = false;
    // Status bukan Aktif atau username berganti: sesi yang masih berjalan diputus.
    if (oldUsername && oldUsername !== customer.username) {
      disconnectInBackground(oldUsername);
    }
    if (usesRadius(customer) && customer.status !== 'Aktif') {
      disconnectInBackground(customer.username);
    }

    return res.json({
      success: true,
      message: 'Data langganan berhasil diperbarui',
    });
  } catch (error) {
    if (inTransaction) {
      await conn.rollback().catch(() => {});
    }
    if (error instanceof RadiusSyncError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    if (error.code === 'ER_NO_REFERENCED_ROW_2') {
      return res.status(400).json({
        success: false,
        message: 'Profil langganan tidak ditemukan',
      });
    }
    return res.status(500).json({
      success: false,
      message: 'Gagal memperbarui data langganan',
      error: error.message,
    });
  } finally {
    if (conn) {
      conn.release();
    }
  }
});

router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({
      success: false,
      message: 'Data langganan tidak valid',
    });
  }

  let conn;
  let inTransaction = false;
  let removedUsername = '';
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    inTransaction = true;

    const [current] = await conn.execute(
      'SELECT username FROM langganan_pelanggan WHERE id = ? LIMIT 1 FOR UPDATE',
      [id],
    );
    if (current.length === 0) {
      await conn.rollback();
      inTransaction = false;
      return res.status(404).json({
        success: false,
        message: 'Data langganan tidak ditemukan',
      });
    }

    await conn.execute('DELETE FROM langganan_pelanggan WHERE id = ?', [id]);

    // Akun RADIUS ikut dihapus supaya pelanggan yang dihapus tidak bisa login lagi,
    // kecuali username yang sama masih dipakai langganan lain.
    const username = current[0].username || '';
    if (username) {
      const [shared] = await conn.execute(
        'SELECT id FROM langganan_pelanggan WHERE username = ? LIMIT 1',
        [username],
      );
      if (shared.length === 0) {
        await removeAccount(conn, username);
        removedUsername = username;
      }
    }
    await conn.commit();
    inTransaction = false;
    if (removedUsername) {
      disconnectInBackground(removedUsername);
    }

    return res.json({
      success: true,
      message: 'Data langganan berhasil dihapus',
    });
  } catch (error) {
    if (inTransaction) {
      await conn.rollback().catch(() => {});
    }
    return res.status(500).json({
      success: false,
      message: 'Gagal menghapus data langganan',
      error: error.message,
    });
  } finally {
    if (conn) {
      conn.release();
    }
  }
});

module.exports = router;
