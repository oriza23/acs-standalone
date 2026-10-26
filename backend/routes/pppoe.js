const express = require('express');
const { exec } = require('child_process');
const { promisify } = require('util');
const pool = require('../../database');
const { MAX_GROUP_NAME, writeProfileReply } = require('../radius_group');

const execAsync = promisify(exec);

const router = express.Router();

// Profil PPPoE lama (group RADIUS). Aturan limit sama dengan profil Langganan dan Hotspot:
//   - group wajib dan harus sama persis dengan nama PPP Profile di MikroTik
//     (dikirim sebagai Mikrotik-Group);
//   - limit kecepatan opsional: bila diisi dikirim sebagai Mikrotik-Rate-Limit,
//     bila kosong baris limit dihapus dan MikroTik memakai limit profilnya sendiri.
// Group milik profil Hotspot/Langganan dikelola di halamannya masing-masing.
const MANAGED_GROUP_SQL = `(
  EXISTS (SELECT 1 FROM langganan_profiles p WHERE p.group_name COLLATE utf8mb4_unicode_ci = g.groupname COLLATE utf8mb4_unicode_ci)
  OR EXISTS (SELECT 1 FROM hotspot_profiles h WHERE h.mikrotik_group COLLATE utf8mb4_unicode_ci = g.groupname COLLATE utf8mb4_unicode_ci)
)`;

function readGroupname(value) {
  return typeof value === 'string' ? value.trim() : '';
}

async function groupIsManaged(executor, groupname) {
  const [rows] = await executor.execute(
    `SELECT 1 FROM (SELECT ? AS groupname) g WHERE ${MANAGED_GROUP_SQL}`,
    [groupname],
  );
  return rows.length > 0;
}

async function groupExists(executor, groupname) {
  const [rows] = await executor.execute(
    "SELECT 1 FROM radgroupreply WHERE groupname = ? AND attribute IN ('Mikrotik-Group', 'Mikrotik-Rate-Limit') LIMIT 1",
    [groupname],
  );
  return rows.length > 0;
}

const MANAGED_MESSAGE = 'Group ini dikelola di halaman Profil Hotspot atau Profil Langganan';

router.get('/profil', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT g.groupname, r.value AS rate_limit
       FROM (
         SELECT DISTINCT groupname FROM radgroupreply
         WHERE attribute IN ('Mikrotik-Group', 'Mikrotik-Rate-Limit')
       ) g
       LEFT JOIN radgroupreply r
         ON r.groupname = g.groupname AND r.attribute = 'Mikrotik-Rate-Limit'
       WHERE NOT ${MANAGED_GROUP_SQL}
       ORDER BY g.groupname`,
    );

    res.json(rows.map((row) => ({ groupname: row.groupname, rate_limit: row.rate_limit || '' })));
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Gagal mengambil data profil',
      error: error.message,
    });
  }
});

router.post('/profil', async (req, res) => {
  const groupname = readGroupname(req.body?.groupname);
  const rateLimit = typeof req.body?.rate_limit === 'string' ? req.body.rate_limit.trim() : '';

  if (!groupname || groupname.length > MAX_GROUP_NAME || rateLimit.length > 253) {
    return res.status(400).json({
      success: false,
      message: 'Nama profil wajib diisi (maksimal 64 karakter)',
    });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    if (await groupIsManaged(connection, groupname)) {
      await connection.rollback();
      return res.status(409).json({ success: false, message: MANAGED_MESSAGE });
    }
    if (await groupExists(connection, groupname)) {
      await connection.rollback();
      return res.status(409).json({ success: false, message: 'Profil sudah ada' });
    }
    await writeProfileReply(connection, groupname, rateLimit);
    await connection.commit();

    return res.json({
      success: true,
      message: 'Profil berhasil disimpan',
    });
  } catch (error) {
    await connection.rollback().catch(() => {});
    return res.status(500).json({
      success: false,
      message: 'Gagal menyimpan profil',
      error: error.message,
    });
  } finally {
    connection.release();
  }
});

router.put('/profil/:groupname', async (req, res) => {
  const groupname = readGroupname(req.params.groupname);
  const rateLimit = typeof req.body?.rate_limit === 'string' ? req.body.rate_limit.trim() : '';

  if (!groupname || rateLimit.length > 253) {
    return res.status(400).json({
      success: false,
      message: 'Nama profil wajib diisi',
    });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    if (await groupIsManaged(connection, groupname)) {
      await connection.rollback();
      return res.status(409).json({ success: false, message: MANAGED_MESSAGE });
    }
    if (!(await groupExists(connection, groupname))) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: 'Profil tidak ditemukan',
      });
    }
    await writeProfileReply(connection, groupname, rateLimit);
    await connection.commit();

    return res.json({
      success: true,
      message: 'Profil berhasil diperbarui',
    });
  } catch (error) {
    await connection.rollback().catch(() => {});
    return res.status(500).json({
      success: false,
      message: 'Gagal memperbarui profil',
      error: error.message,
    });
  } finally {
    connection.release();
  }
});

router.delete('/profil/:groupname', async (req, res) => {
  const groupname = readGroupname(req.params.groupname);

  if (!groupname) {
    return res.status(400).json({
      success: false,
      message: 'Nama profil wajib diisi',
    });
  }

  try {
    if (await groupIsManaged(pool, groupname)) {
      return res.status(409).json({ success: false, message: MANAGED_MESSAGE });
    }
    await pool.execute('DELETE FROM radgroupreply WHERE groupname = ?', [groupname]);

    return res.json({
      success: true,
      message: 'Profil berhasil dihapus',
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Gagal menghapus profil',
      error: error.message,
    });
  }
});

router.post('/pelanggan', async (req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const paket = typeof req.body?.paket === 'string' ? req.body.paket.trim() : '';

  if (!username || !password || !paket) {
    return res.status(400).json({
      success: false,
      message: 'Username, password, dan paket wajib diisi',
    });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    await connection.execute(
      "INSERT INTO radcheck (username, attribute, op, value) VALUES (?, 'Cleartext-Password', ':=', ?)",
      [username, password],
    );

    await connection.execute(
      'INSERT INTO radusergroup (username, groupname, priority) VALUES (?, ?, 1)',
      [username, paket],
    );

    await connection.commit();

    return res.json({
      success: true,
      message: 'Pelanggan berhasil disimpan',
    });
  } catch (error) {
    await connection.rollback();

    return res.status(500).json({
      success: false,
      message: 'Gagal menyimpan pelanggan',
      error: error.message,
    });
  } finally {
    connection.release();
  }
});

router.get('/pelanggan', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      "SELECT c.username, c.value AS password, IFNULL(ug.groupname, 'Tanpa Profil') AS paket FROM radcheck c LEFT JOIN radusergroup ug ON c.username = ug.username WHERE c.attribute = 'Cleartext-Password'",
    );

    res.json(rows);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Gagal mengambil data pelanggan',
      error: error.message,
    });
  }
});

router.put('/pelanggan/:username', async (req, res) => {
  const username = typeof req.params.username === 'string' ? req.params.username.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const paket = typeof req.body?.paket === 'string' ? req.body.paket.trim() : '';

  if (!username || !password || !paket) {
    return res.status(400).json({
      success: false,
      message: 'Password dan paket wajib diisi',
    });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [updated] = await connection.execute(
      "UPDATE radcheck SET value = ? WHERE username = ? AND attribute = 'Cleartext-Password'",
      [password, username],
    );

    if (updated.affectedRows === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: 'Pelanggan tidak ditemukan',
      });
    }

    await connection.execute('DELETE FROM radusergroup WHERE username = ?', [username]);

    await connection.execute(
      'INSERT INTO radusergroup (username, groupname, priority) VALUES (?, ?, 1)',
      [username, paket],
    );

    await connection.commit();

    return res.json({
      success: true,
      message: 'Pelanggan berhasil diperbarui',
    });
  } catch (error) {
    await connection.rollback();

    return res.status(500).json({
      success: false,
      message: 'Gagal memperbarui pelanggan',
      error: error.message,
    });
  } finally {
    connection.release();
  }
});

router.delete('/pelanggan/:username', async (req, res) => {
  const username = typeof req.params.username === 'string' ? req.params.username.trim() : '';

  if (!username) {
    return res.status(400).json({
      success: false,
      message: 'Username wajib diisi',
    });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    await connection.execute('DELETE FROM radusergroup WHERE username = ?', [username]);
    await connection.execute('DELETE FROM radcheck WHERE username = ?', [username]);

    await connection.commit();

    return res.json({
      success: true,
      message: 'Pelanggan berhasil dihapus',
    });
  } catch (error) {
    await connection.rollback();

    return res.status(500).json({
      success: false,
      message: 'Gagal menghapus pelanggan',
      error: error.message,
    });
  } finally {
    connection.release();
  }
});

// Daftar user online dipindah ke GET /api/langganan/online (khusus langganan)
// dan GET /api/hotspot/online (khusus voucher) agar data tidak tercampur.

function isIpv4(value) {
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(value)) {
    return false;
  }
  return value.split('.').every((octet) => Number(octet) <= 255);
}

router.post('/disconnect', async (req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const framedIp = typeof req.body?.ip_address === 'string' ? req.body.ip_address.trim() : '';

  if (!/^[A-Za-z0-9._@-]{1,64}$/.test(username) || !isIpv4(framedIp)) {
    return res.status(400).json({
      success: false,
      message: 'Username atau IP address tidak valid',
    });
  }

  let secret = '';

  try {
    const [routers] = await pool.execute(
      "SELECT ip_address, secret FROM routers WHERE status = 'Aktif' LIMIT 1",
    );

    if (routers.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Router aktif tidak ditemukan di database',
      });
    }

    const ip_address = routers[0].ip_address;
    secret = typeof routers[0].secret === 'string' ? routers[0].secret : '';
    if (!isIpv4(String(ip_address || '')) || !secret || /[\s"'\\$`;&|<>()]/.test(secret)) {
      return res.status(500).json({
        success: false,
        message: 'Data router aktif tidak valid',
      });
    }

    const command = `echo "Framed-IP-Address='${framedIp}'" | radclient -x ${ip_address}:3799 disconnect ${secret}`;
    await execAsync(command, { timeout: 10000 });

    return res.json({
      success: true,
      message: 'Koneksi pelanggan berhasil diputus',
    });
  } catch (error) {
    const detail = `${error.stderr || ''}\n${error.stdout || ''}`
      .split(secret)
      .join('')
      .trim();

    if (error.code === 'ECONNREFUSED' || error.fatal) {
      return res.status(500).json({
        success: false,
        message: 'Gagal memutus koneksi pelanggan',
        error: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Gagal memutus koneksi pelanggan',
      detail,
    });
  }
});

module.exports = router;
