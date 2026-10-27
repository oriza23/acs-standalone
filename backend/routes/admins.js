const crypto = require('crypto');
const fs = require('fs');
const { spawn } = require('child_process');
const express = require('express');
const pool = require('../../database');
const requireRole = require('../middleware/requireRole');
const { hashBcrypt, hashPassword, isBcryptHash, isScryptHash, verifyBcrypt, verifyPassword } = require('../password');

const router = express.Router();
const requireAdmin = requireRole('admin');
const UPDATE_SCRIPT = '/var/www/acs-standalone/update.sh';

router.post('/system-update', requireAdmin, (req, res) => {
  if (!fs.existsSync(UPDATE_SCRIPT)) {
    return res.status(500).json({
      success: false,
      message: 'Berkas update.sh tidak ditemukan',
    });
  }

  res.json({
    status: 'updating',
    success: true,
    message: 'Pembaruan dimulai',
  });

  // Respons sudah dikirim. Proses dilepas dari Node supaya tetap jalan saat PM2 me-restart backend.
  const child = spawn('bash', [UPDATE_SCRIPT], {
    cwd: '/var/www/acs-standalone',
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
});

function readText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function sameText(a, b) {
  const hashA = crypto.createHash('sha256').update(String(a)).digest();
  const hashB = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

function readId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

router.get('/list', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, username FROM web_admins ORDER BY id ASC',
    );
    res.json(rows.map((row) => ({ id: row.id, username: row.username })));
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Gagal mengambil data admin',
      error: error.message,
    });
  }
});

async function deleteAdminById(req, res) {
  const id = readId(req.params.id);
  const current = readText(req.user?.username);
  if (!id) {
    return res.status(400).json({
      success: false,
      message: 'ID admin tidak valid',
    });
  }
  if (id === 1) {
    return res.status(403).json({
      success: false,
      message: 'Superadmin utama tidak boleh dihapus!',
    });
  }

  try {
    const [rows] = await pool.execute(
      'SELECT id, username FROM web_admins WHERE id = ? LIMIT 1',
      [id],
    );
    const admin = rows[0];
    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin tidak ditemukan',
      });
    }
    if (current && admin.username.toLowerCase() === current.toLowerCase()) {
      return res.status(403).json({
        success: false,
        message: 'Akun yang sedang login tidak dapat dihapus',
      });
    }

    const [result] = await pool.execute('DELETE FROM web_admins WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Admin tidak ditemukan',
      });
    }
    return res.json({
      success: true,
      message: 'Admin berhasil dihapus',
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Gagal menghapus admin',
      error: error.message,
    });
  }
}

router.delete('/delete/:id', requireAdmin, deleteAdminById);
router.delete('/:id', requireAdmin, deleteAdminById);

function validUsername(username) {
  return username.length > 0 && username.length <= 50 && /^[A-Za-z0-9._-]+$/.test(username);
}

router.put('/edit/:id', requireAdmin, async (req, res) => {
  const id = readId(req.params.id);
  const username = readText(req.body?.username);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (!id) {
    return res.status(400).json({
      success: false,
      message: 'ID admin tidak valid',
    });
  }
  if (!validUsername(username)) {
    return res.status(400).json({
      success: false,
      message: 'Username hanya huruf, angka, titik, garis bawah, atau strip, maksimal 50 karakter',
    });
  }
  if (password && (password.length < 8 || Buffer.byteLength(password) > 72)) {
    return res.status(400).json({
      success: false,
      message: 'Password minimal 8 karakter dan maksimal 72 byte',
    });
  }

  try {
    const [rows] = await pool.execute(
      'SELECT id FROM web_admins WHERE id = ? LIMIT 1',
      [id],
    );
    if (!rows[0]) {
      return res.status(404).json({
        success: false,
        message: 'Admin tidak ditemukan',
      });
    }

    if (password) {
      await pool.execute(
        'UPDATE web_admins SET username = ?, password = ? WHERE id = ?',
        [username, await hashBcrypt(password), id],
      );
    } else {
      await pool.execute(
        'UPDATE web_admins SET username = ? WHERE id = ?',
        [username, id],
      );
    }

    return res.json({
      success: true,
      message: password ? 'Username dan password berhasil diubah' : 'Username berhasil diubah',
      id,
      username,
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        success: false,
        message: 'Username admin sudah digunakan',
      });
    }
    return res.status(500).json({
      success: false,
      message: 'Gagal mengubah admin',
      error: error.message,
    });
  }
});

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, username, role FROM web_admins ORDER BY id ASC',
    );
    res.json(rows.map(({ id, username, role }) => ({ id, username, role })));
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Gagal mengambil data admin',
      error: error.message,
    });
  }
});

router.post('/', requireAdmin, async (req, res) => {
  const username = readText(req.body?.username);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (!username || !password) {
    return res.status(400).json({
      success: false,
      message: 'Username dan password wajib diisi',
    });
  }

  try {
    if (username.length > 50 || !/^[A-Za-z0-9._-]+$/.test(username)) {
      return res.status(400).json({
        success: false,
        message: 'Username hanya huruf, angka, titik, garis bawah, atau strip, maksimal 50 karakter',
      });
    }
    if (password.length < 8 || Buffer.byteLength(password) > 72) {
      return res.status(400).json({
        success: false,
        message: 'Password minimal 8 karakter dan maksimal 72 byte',
      });
    }

    await pool.execute(
      'INSERT INTO web_admins (username, password, role) VALUES (?, ?, ?)',
      [username, await hashBcrypt(password), 'admin'],
    );

    return res.json({
      success: true,
      message: 'Admin berhasil disimpan',
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        success: false,
        message: 'Username admin sudah digunakan',
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Gagal menyimpan admin',
      error: error.message,
    });
  }
});

router.put('/password', requireAdmin, async (req, res) => {
  const username = readText(req.user?.username);
  const oldPassword = typeof req.body?.old_password === 'string' ? req.body.old_password : '';
  const newPassword = typeof req.body?.new_password === 'string' ? req.body.new_password : '';
  const confirmPassword = typeof req.body?.confirm_password === 'string' ? req.body.confirm_password : '';

  if (!username || !oldPassword || !newPassword) {
    return res.status(400).json({
      success: false,
      message: 'Password lama dan password baru wajib diisi',
    });
  }
  if (confirmPassword && confirmPassword !== newPassword) {
    return res.status(400).json({
      success: false,
      message: 'Konfirmasi password tidak sama',
    });
  }
  if (newPassword.length < 8 || Buffer.byteLength(newPassword) > 72) {
    return res.status(400).json({
      success: false,
      message: 'Password baru minimal 8 karakter dan maksimal 72 byte',
    });
  }
  if (newPassword === oldPassword) {
    return res.status(400).json({
      success: false,
      message: 'Password baru harus berbeda dari password lama',
    });
  }

  try {
    const [rows] = await pool.execute(
      'SELECT username, password FROM web_admins WHERE username = ? LIMIT 1',
      [username],
    );
    const admin = rows[0];
    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin tidak ditemukan',
      });
    }

    const stored = admin.password;
    const oldOk = isBcryptHash(stored)
      ? await verifyBcrypt(oldPassword, stored)
      : isScryptHash(stored)
        ? await verifyPassword(oldPassword, stored)
        : typeof stored === 'string' && stored.length > 0 && sameText(stored, oldPassword);
    if (!oldOk) {
      return res.status(400).json({
        success: false,
        message: 'Password lama tidak sesuai',
      });
    }

    await pool.execute(
      'UPDATE web_admins SET password = ? WHERE username = ?',
      [await hashBcrypt(newPassword), admin.username],
    );
    return res.json({
      success: true,
      message: 'Password berhasil diubah',
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Gagal mengubah password',
      error: error.message,
    });
  }
});

router.put('/:username', requireAdmin, async (req, res) => {
  const username = readText(req.params.username);
  const password = readText(req.body?.password);
  const role = readText(req.body?.role) || 'admin';

  if (!username) {
    return res.status(400).json({
      success: false,
      message: 'Username wajib diisi',
    });
  }

  try {
    const [result] = password
      ? await pool.execute(
        'UPDATE web_admins SET password = ?, role = ? WHERE username = ?',
        [await hashPassword(password), role, username],
      )
      : await pool.execute(
        'UPDATE web_admins SET role = ? WHERE username = ?',
        [role, username],
      );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Admin tidak ditemukan',
      });
    }

    return res.json({
      success: true,
      message: 'Admin berhasil diperbarui',
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Gagal memperbarui admin',
      error: error.message,
    });
  }
});

module.exports = router;
