const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SECRET_FILE = path.join(__dirname, '..', '..', '.jwt_secret');

// Secret diambil dari env JWT_SECRET. Jika tidak ada, dibuat acak sekali lalu
// disimpan di file .jwt_secret (di-ignore git) agar token tetap valid setelah restart.
function loadSecret() {
  if (process.env.JWT_SECRET) {
    return process.env.JWT_SECRET;
  }
  try {
    const saved = fs.readFileSync(SECRET_FILE, 'utf8').trim();
    if (saved) {
      return saved;
    }
  } catch {
    // file belum ada, buat baru di bawah
  }
  const secret = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(SECRET_FILE, `${secret}\n`, { mode: 0o600 });
  return secret;
}

module.exports = {
  secret: loadSecret(),
  expiresIn: process.env.JWT_EXPIRES_IN || '12h',
};
