const crypto = require('crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('../../database');
const requireAuth = require('../middleware/auth');
const { hashPassword, isScryptHash, verifyPassword } = require('../password');
const { secret, expiresIn } = require('../config/jwt');

const router = express.Router();

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_WINDOW_MS = 15 * 60 * 1000;
const failedAttempts = new Map();

function readText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function sameText(a, b) {
  const hashA = crypto.createHash('sha256').update(String(a)).digest();
  const hashB = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

function attemptKey(req, username) {
  return `${req.ip}|${username.toLowerCase()}`;
}

function isLocked(key) {
  const entry = failedAttempts.get(key);
  if (!entry) {
    return false;
  }
  if (Date.now() - entry.first > LOCK_WINDOW_MS) {
    failedAttempts.delete(key);
    return false;
  }
  return entry.count >= MAX_FAILED_ATTEMPTS;
}

function recordFailure(key) {
  const entry = failedAttempts.get(key);
  if (!entry || Date.now() - entry.first > LOCK_WINDOW_MS) {
    failedAttempts.set(key, { count: 1, first: Date.now() });
    return;
  }
  entry.count += 1;
}

router.post('/login', async (req, res) => {
  const username = readText(req.body?.username);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (!username || !password) {
    return res.status(401).json({
      success: false,
      message: 'Username atau password salah',
    });
  }

  const key = attemptKey(req, username);
  if (isLocked(key)) {
    return res.status(429).json({
      success: false,
      message: 'Terlalu banyak percobaan gagal, coba lagi dalam 15 menit',
    });
  }

  try {
    const [rows] = await pool.execute(
      'SELECT username, password, role FROM web_admins WHERE username = ? LIMIT 1',
      [username],
    );
    const admin = rows[0];
    const stored = admin?.password;
    const hashed = isScryptHash(stored);
    const passwordOk = hashed
      ? await verifyPassword(password, stored)
      : Boolean(admin) && sameText(stored, password);

    if (!passwordOk) {
      recordFailure(key);
      return res.status(401).json({
        success: false,
        message: 'Username atau password salah',
      });
    }

    // Akun lama yang masih polos: izinkan login ini, lalu simpan ulang sebagai hash.
    if (!hashed) {
      const upgraded = await hashPassword(password);
      await pool.execute(
        'UPDATE web_admins SET password = ? WHERE username = ?',
        [upgraded, admin.username],
      );
    }

    failedAttempts.delete(key);
    const role = admin.role || 'admin';
    const token = jwt.sign({ username: admin.username, role }, secret, {
      algorithm: 'HS256',
      expiresIn,
    });

    return res.json({
      success: true,
      message: 'Login berhasil',
      token,
      username: admin.username,
      role,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Gagal memeriksa data login',
      error: error.message,
    });
  }
});

// Cek token masih berlaku (dipakai frontend bila perlu).
router.get('/me', requireAuth, (req, res) => {
  res.json({ success: true, username: req.user.username, role: req.user.role });
});

module.exports = router;
