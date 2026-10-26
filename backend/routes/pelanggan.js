const express = require('express');
const pool = require('../../database');

const router = express.Router();

const INSERT_LOCK = 'data_pelanggan_insert';
const STATUSES = ['Aktif', 'Tidak Aktif'];
const NEXT_ID_TRIES = 20;

function readText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

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

function mapRow(row) {
  return {
    id: row.id,
    user_id: row.user_id,
    nama_pelanggan: row.nama_pelanggan,
    phone: row.phone || '',
    identitas: row.identitas || '',
    npwp: row.npwp || '',
    alamat: row.alamat || '',
    saldo: row.saldo == null ? 0 : Number(row.saldo),
    mitra: row.mitra || 'SYSTEM',
    status: row.status || 'Aktif',
    last_login: row.last_login,
    created_at: row.created_at,
  };
}

async function ensureTable() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS data_pelanggan (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(20) UNIQUE NOT NULL,
      nama_pelanggan VARCHAR(100) NOT NULL,
      phone VARCHAR(20),
      identitas VARCHAR(50),
      npwp VARCHAR(50),
      alamat TEXT,
      saldo DECIMAL(15,2) DEFAULT 0,
      mitra VARCHAR(50) DEFAULT 'SYSTEM',
      last_login DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
  );
  await pool.query(
    "ALTER TABLE data_pelanggan ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'Aktif'",
  );
}

router.ensureTable = ensureTable;

function randomUserId() {
  return Math.floor(1000000 + Math.random() * 9000000).toString();
}

async function readNextUserId() {
  for (let attempt = 0; attempt < NEXT_ID_TRIES; attempt += 1) {
    const userId = randomUserId();
    const [rows] = await pool.query(
      'SELECT id FROM data_pelanggan WHERE user_id = ? LIMIT 1',
      [userId],
    );
    if (rows.length === 0) {
      return userId;
    }
  }
  return null;
}

router.get('/next-id', async (req, res) => {
  try {
    const userId = await readNextUserId();
    if (!userId) {
      return res.status(503).json({
        success: false,
        message: 'User ID unik sedang tidak tersedia, coba lagi',
      });
    }
    res.json({ user_id: userId });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Gagal mengambil User ID berikutnya',
      error: error.message,
    });
  }
});

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, user_id, nama_pelanggan, phone, identitas, npwp, alamat, saldo, mitra, status, last_login, created_at
       FROM data_pelanggan
       ORDER BY id DESC`,
    );
    res.json(rows.map(mapRow));
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Gagal mengambil data pelanggan',
      error: error.message,
    });
  }
});

router.post('/', async (req, res) => {
  const userId = readText(req.body?.user_id);
  const nama = readText(req.body?.nama_pelanggan);
  const phone = readText(req.body?.phone);
  const identitas = readText(req.body?.identitas);
  const npwp = readText(req.body?.npwp);
  const alamat = readText(req.body?.alamat);
  const saldo = readMoney(req.body?.saldo);
  const mitra = readText(req.body?.mitra) || 'SYSTEM';

  if (!/^\d{7}$/.test(userId)) {
    return res.status(400).json({
      success: false,
      message: 'User ID harus tepat 7 digit angka',
    });
  }
  if (!nama || !phone) {
    return res.status(400).json({
      success: false,
      message: 'Nama pelanggan dan phone wajib diisi',
    });
  }
  if (nama.length > 100 || phone.length > 20 || identitas.length > 50 || npwp.length > 50 || mitra.length > 50) {
    return res.status(400).json({
      success: false,
      message: 'Ada isian yang melebihi panjang yang diizinkan',
    });
  }
  if (saldo == null) {
    return res.status(400).json({
      success: false,
      message: 'Saldo awal tidak valid',
    });
  }

  let conn;
  let locked = false;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [[lockRow]] = await conn.query('SELECT GET_LOCK(?, 10) AS got', [INSERT_LOCK]);
    locked = Number(lockRow.got) === 1;
    if (!locked) {
      await conn.rollback();
      return res.status(503).json({
        success: false,
        message: 'Server sedang sibuk, silakan coba lagi',
      });
    }

    const [result] = await conn.execute(
      `INSERT INTO data_pelanggan
        (user_id, nama_pelanggan, phone, identitas, npwp, alamat, saldo, mitra)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, nama, phone, identitas || null, npwp || null, alamat || null, saldo, mitra],
    );
    await conn.commit();

    return res.json({
      success: true,
      message: 'Data pelanggan berhasil disimpan',
      id: result.insertId,
      user_id: userId,
    });
  } catch (error) {
    if (conn) {
      await conn.rollback().catch(() => {});
    }
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        success: false,
        message: 'User ID bentrok, silakan simpan ulang',
      });
    }
    return res.status(500).json({
      success: false,
      message: 'Gagal menyimpan data pelanggan',
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

function readIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(
    value
      .map((item) => Number(item))
      .filter((id) => Number.isInteger(id) && id > 0),
  )].slice(0, 500);
}

router.put('/bulk-status', async (req, res) => {
  const ids = readIds(req.body?.ids);
  const status = readText(req.body?.status);
  if (ids.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Pilih minimal satu pelanggan',
    });
  }
  if (!STATUSES.includes(status)) {
    return res.status(400).json({
      success: false,
      message: 'Status tidak valid',
    });
  }

  try {
    const placeholders = ids.map(() => '?').join(', ');
    const [result] = await pool.query(
      `UPDATE data_pelanggan SET status = ? WHERE id IN (${placeholders})`,
      [status, ...ids],
    );
    return res.json({
      success: true,
      message: 'Status pelanggan berhasil diperbarui',
      updated: result.affectedRows,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Gagal memperbarui status pelanggan',
      error: error.message,
    });
  }
});

router.delete('/bulk-delete', async (req, res) => {
  const ids = readIds(req.body?.ids);
  if (ids.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Pilih minimal satu pelanggan',
    });
  }

  try {
    const placeholders = ids.map(() => '?').join(', ');
    const [result] = await pool.query(
      `DELETE FROM data_pelanggan WHERE id IN (${placeholders})`,
      ids,
    );
    return res.json({
      success: true,
      message: 'Pelanggan berhasil dihapus',
      deleted: result.affectedRows,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Gagal menghapus pelanggan',
      error: error.message,
    });
  }
});

module.exports = router;
