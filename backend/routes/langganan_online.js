const express = require('express');
const pool = require('../../database');

const router = express.Router();

const MAX_PAGE_LIMIT = 500;

function readPaging(query, defaultLimit = 10) {
  const limit = Math.min(Math.max(parseInt(query?.limit, 10) || defaultLimit, 1), MAX_PAGE_LIMIT);
  const page = Math.max(parseInt(query?.page, 10) || 1, 1);
  return { limit, page };
}

function readSearch(value) {
  return typeof value === 'string' ? value.trim().slice(0, 100) : '';
}

// Escape wildcard LIKE agar pencarian bersifat harfiah.
function likePattern(value) {
  return `%${value.replace(/[\\%_]/g, '\\$&')}%`;
}

// ---- User online Langganan (PPPoE) -----------------------------------------
// Hanya sesi aktif radacct (acctstoptime IS NULL) milik username yang terdaftar
// di langganan_pelanggan. Lookup memakai index langganan_pelanggan.username;
// sesi voucher hotspot tidak akan ikut karena tidak ada di tabel tersebut.
const FROM_SQL = `FROM radacct a
  INNER JOIN langganan_pelanggan c ON c.username = a.username
  LEFT JOIN langganan_profiles p ON p.id = c.profil_id`;

const SEARCH_COLUMNS = [
  'a.username', 'c.pelanggan', 'c.nolayanan', 'p.nama_profile',
  'a.framedipaddress', 'a.callingstationid',
];

router.get('/', async (req, res) => {
  try {
    const { limit, page: requestedPage } = readPaging(req.query);
    const where = ['a.acctstoptime IS NULL'];
    const params = [];

    const term = readSearch(req.query.q);
    if (term) {
      where.push(`(${SEARCH_COLUMNS.map((column) => `${column} LIKE ?`).join(' OR ')})`);
      SEARCH_COLUMNS.forEach(() => params.push(likePattern(term)));
    }
    const whereSql = `WHERE ${where.join(' AND ')}`;

    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total ${FROM_SQL} ${whereSql}`,
      params,
    );
    const total = Number(countRows[0]?.total) || 0;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const page = Math.min(requestedPage, totalPages);
    const offset = (page - 1) * limit;

    const [rows] = await pool.query(
      `SELECT
         a.radacctid AS id,
         a.username,
         c.pelanggan,
         c.nolayanan,
         p.nama_profile AS profil,
         a.framedipaddress AS ip_address,
         a.callingstationid AS mac_addr,
         COALESCE(a.acctsessiontime, 0) AS uptime,
         a.acctstarttime AS login_time
       ${FROM_SQL}
       ${whereSql}
       ORDER BY a.acctstarttime DESC, a.radacctid DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    res.json({
      data: rows.map((row) => ({
        id: row.id,
        username: row.username,
        pelanggan: row.pelanggan || '',
        nolayanan: row.nolayanan || '',
        profil: row.profil || '',
        ip_address: row.ip_address || '',
        mac_addr: row.mac_addr || '',
        uptime: Number(row.uptime) || 0,
        login_time: row.login_time,
      })),
      total,
      page,
      limit,
      total_pages: totalPages,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Gagal mengambil data langganan online',
      error: error.message,
    });
  }
});

module.exports = router;
