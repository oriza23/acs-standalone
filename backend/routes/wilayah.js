const express = require('express');
const pool = require('../../database');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, nama_wilayah FROM data_wilayah ORDER BY nama_wilayah ASC',
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Gagal mengambil data wilayah',
      error: error.message,
    });
  }
});

// Menambah wilayah baru dan mengembalikan id baris yang baru dibuat.
router.post('/', async (req, res) => {
  const nama = typeof req.body?.nama_wilayah === 'string' ? req.body.nama_wilayah.trim() : '';
  if (!nama || nama.length > 100) {
    return res.status(400).json({
      success: false,
      message: 'Nama wilayah wajib diisi (maksimal 100 karakter)',
    });
  }

  try {
    const [result] = await pool.execute(
      'INSERT INTO data_wilayah (nama_wilayah) VALUES (?)',
      [nama],
    );
    return res.status(201).json({
      success: true,
      id: result.insertId,
      nama_wilayah: nama,
      message: 'Wilayah berhasil ditambahkan',
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        success: false,
        message: 'Wilayah sudah terdaftar',
      });
    }
    return res.status(500).json({
      success: false,
      message: 'Gagal menyimpan wilayah',
      error: error.message,
    });
  }
});

module.exports = router;
