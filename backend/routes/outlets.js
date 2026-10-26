const express = require('express');
const pool = require('../../database');

const router = express.Router();

function formatDateColumn(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const pad = (part) => String(part).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  return String(value).slice(0, 10);
}

async function ensureTglGabungColumn() {
  await pool.query('ALTER TABLE outlets ADD COLUMN IF NOT EXISTS tgl_gabung DATE');
}

router.ensureTglGabungColumn = ensureTglGabungColumn;

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT o.id, o.nama_outlet, o.pemilik, o.phone, o.mitra, o.alamat, o.status, o.tgl_gabung, o.created_at,
        (SELECT COUNT(*) FROM hotspot_vouchers v WHERE v.outlet = o.nama_outlet) AS stok_vc
       FROM outlets o
       ORDER BY o.id DESC`,
    );

    res.json(rows.map((row) => ({
      ...row,
      tgl_gabung: formatDateColumn(row.tgl_gabung),
    })));
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Gagal mengambil data outlet',
      error: error.message,
    });
  }
});

router.post('/', async (req, res) => {
  const namaOutlet = String(req.body.nama_outlet || '').trim();
  const pemilik = String(req.body.pemilik || '').trim();
  const phone = String(req.body.phone || '').trim();
  const alamat = String(req.body.alamat || '').trim();
  const tglGabung = String(req.body.tgl_gabung || '').trim();

  if (!namaOutlet) {
    return res.status(400).json({ success: false, message: 'Nama outlet wajib diisi' });
  }

  try {
    await pool.execute(
      'INSERT INTO outlets (nama_outlet, pemilik, phone, alamat, tgl_gabung) VALUES (?, ?, ?, ?, ?)',
      [namaOutlet, pemilik, phone, alamat, tglGabung || null],
    );
    return res.json({ success: true, message: 'Outlet berhasil disimpan' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, message: 'Nama outlet sudah terdaftar' });
    }
    return res.status(500).json({
      success: false,
      message: 'Gagal menyimpan outlet',
      error: error.message,
    });
  }
});

function readOutletIds(body) {
  if (!Array.isArray(body?.ids) || body.ids.length === 0) {
    return [];
  }
  return [...new Set(
    body.ids
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id > 0),
  )];
}

router.post('/delete-massal', async (req, res) => {
  const ids = readOutletIds(req.body);
  if (ids.length === 0) {
    return res.status(400).json({ success: false, message: 'Pilih minimal satu outlet' });
  }

  try {
    await pool.query('DELETE FROM outlets WHERE id IN (?)', [ids]);
    return res.json({ success: true, message: 'Outlet terpilih berhasil dihapus' });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Gagal menghapus outlet',
      error: error.message,
    });
  }
});

router.post('/set-status-massal', async (req, res) => {
  const ids = readOutletIds(req.body);
  const status = req.body?.status === 'Aktif' || req.body?.status === 'Tidak Aktif'
    ? req.body.status
    : '';

  if (ids.length === 0) {
    return res.status(400).json({ success: false, message: 'Pilih minimal satu outlet' });
  }
  if (!status) {
    return res.status(400).json({ success: false, message: 'Status outlet tidak valid' });
  }

  try {
    await pool.query('UPDATE outlets SET status = ? WHERE id IN (?)', [status, ids]);
    return res.json({ success: true, message: 'Status outlet berhasil diperbarui' });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Gagal memperbarui status outlet',
      error: error.message,
    });
  }
});

module.exports = router;
