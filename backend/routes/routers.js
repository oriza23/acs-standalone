const express = require('express');
const pool = require('../../database');
const requireRole = require('../middleware/requireRole');
const {
  ALL_SERVER, JENIS_SERVER, MAX_SERVER_NAME, validServerName,
} = require('../router_servers');

const router = express.Router();
const requireAdmin = requireRole('admin');

async function ensureTable() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS routers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nama_router VARCHAR(100) NOT NULL,
      ip_address VARCHAR(50) NOT NULL,
      secret VARCHAR(100) NOT NULL,
      deskripsi TEXT,
      status VARCHAR(20) DEFAULT 'Aktif',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
  );
}

function readText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function readId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function readRouterBody(body) {
  return {
    namaRouter: readText(body?.nama_router).slice(0, 100),
    ipAddress: readText(body?.ip_address).slice(0, 50),
    secret: readText(body?.secret).slice(0, 100),
    deskripsi: readText(body?.deskripsi),
  };
}

router.get('/', async (req, res) => {
  try {
    await ensureTable();
    const [rows] = await pool.execute(
      'SELECT id, nama_router, ip_address, secret, deskripsi, status, created_at FROM routers ORDER BY id DESC',
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Gagal mengambil data router',
      error: error.message,
    });
  }
});

// Daftar server semua router (sumber dropdown Server di Buat VC dan registrasi
// PPPoE). Filter opsional: ?jenis=hotspot|pppoe.
router.get('/servers', async (req, res) => {
  const jenis = readText(req.query?.jenis);
  if (jenis && !JENIS_SERVER.includes(jenis)) {
    return res.status(400).json({
      success: false,
      message: 'Jenis server harus hotspot atau pppoe',
    });
  }

  try {
    const [rows] = await pool.execute(
      `SELECT s.id, s.router_id, r.nama_router, s.jenis, s.nama
       FROM router_servers s
       JOIN routers r ON r.id = s.router_id
       ${jenis ? 'WHERE s.jenis = ?' : ''}
       ORDER BY r.nama_router ASC, s.jenis ASC, s.nama ASC`,
      jenis ? [jenis] : [],
    );
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Gagal mengambil data server',
      error: error.message,
    });
  }
});

router.post('/:id/servers', requireAdmin, async (req, res) => {
  const id = readId(req.params.id);
  const jenis = readText(req.body?.jenis);
  const nama = readText(req.body?.nama);

  if (!id || !JENIS_SERVER.includes(jenis)) {
    return res.status(400).json({
      success: false,
      message: 'Router dan jenis server (hotspot atau pppoe) wajib dipilih',
    });
  }
  if (!validServerName(nama)) {
    return res.status(400).json({
      success: false,
      message: `Nama server wajib diisi, maksimal ${MAX_SERVER_NAME} karakter, dan tidak boleh "${ALL_SERVER}"`,
    });
  }

  try {
    const [routerRows] = await pool.execute('SELECT id FROM routers WHERE id = ? LIMIT 1', [id]);
    if (routerRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Router tidak ditemukan',
      });
    }

    const [result] = await pool.execute(
      'INSERT INTO router_servers (router_id, jenis, nama) VALUES (?, ?, ?)',
      [id, jenis, nama],
    );
    return res.json({
      success: true,
      message: 'Server berhasil disimpan',
      id: result.insertId,
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        success: false,
        message: 'Server dengan nama itu sudah ada di router ini',
      });
    }
    return res.status(500).json({
      success: false,
      message: 'Gagal menyimpan server',
      error: error.message,
    });
  }
});

router.delete('/servers/:serverId', requireAdmin, async (req, res) => {
  const serverId = readId(req.params.serverId);
  if (!serverId) {
    return res.status(400).json({
      success: false,
      message: 'Server tidak valid',
    });
  }

  try {
    const [result] = await pool.execute('DELETE FROM router_servers WHERE id = ?', [serverId]);
    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Server tidak ditemukan',
      });
    }
    return res.json({
      success: true,
      message: 'Server berhasil dihapus',
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Gagal menghapus server',
      error: error.message,
    });
  }
});

router.post('/', requireAdmin, async (req, res) => {
  const { namaRouter, ipAddress, secret, deskripsi } = readRouterBody(req.body);

  if (!namaRouter || !ipAddress || !secret) {
    return res.status(400).json({
      success: false,
      message: 'Nama router, IP address, dan secret wajib diisi',
    });
  }

  try {
    const [result] = await pool.execute(
      'INSERT INTO routers (nama_router, ip_address, secret, deskripsi) VALUES (?, ?, ?, ?)',
      [namaRouter, ipAddress, secret, deskripsi],
    );

    return res.json({
      success: true,
      message: 'Router berhasil disimpan',
      id: result.insertId,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Gagal menyimpan router',
      error: error.message,
    });
  }
});

router.put('/:id', requireAdmin, async (req, res) => {
  const id = readId(req.params.id);
  const { namaRouter, ipAddress, secret, deskripsi } = readRouterBody(req.body);

  if (!id || !namaRouter || !ipAddress || !secret) {
    return res.status(400).json({
      success: false,
      message: 'Data router belum lengkap atau tidak valid',
    });
  }

  try {
    const [result] = await pool.execute(
      'UPDATE routers SET nama_router = ?, ip_address = ?, secret = ?, deskripsi = ? WHERE id = ?',
      [namaRouter, ipAddress, secret, deskripsi, id],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Router tidak ditemukan',
      });
    }

    return res.json({
      success: true,
      message: 'Router berhasil diperbarui',
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Gagal memperbarui router',
      error: error.message,
    });
  }
});

router.delete('/:id', requireAdmin, async (req, res) => {
  const id = readId(req.params.id);

  if (!id) {
    return res.status(400).json({
      success: false,
      message: 'Router tidak valid',
    });
  }

  try {
    // Server milik router ikut dihapus agar tidak jadi data yatim.
    await pool.execute('DELETE FROM router_servers WHERE router_id = ?', [id]);
    const [result] = await pool.execute(
      'DELETE FROM routers WHERE id = ?',
      [id],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Router tidak ditemukan',
      });
    }

    return res.json({
      success: true,
      message: 'Router berhasil dihapus',
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Gagal menghapus router',
      error: error.message,
    });
  }
});

module.exports = router;
