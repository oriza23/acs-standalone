const { hashPassword } = require('./password');

// Akun pertama hanya dibuat bila kedua variabel lingkungan terisi dan tabel masih kosong.
// Kata sandi tidak ditulis ke log.
async function ensureBootstrapAdmin(db, env = process.env, logger = console) {
  await db.query(
    "CREATE TABLE IF NOT EXISTS web_admins (id INT AUTO_INCREMENT PRIMARY KEY, username VARCHAR(50) UNIQUE, password VARCHAR(255), role VARCHAR(20) DEFAULT 'admin')",
  );

  const [rows] = await db.query('SELECT COUNT(*) AS total FROM web_admins');
  if (Number(rows[0].total) !== 0) {
    return { created: false };
  }

  const username = typeof env.BOOTSTRAP_ADMIN_USERNAME === 'string'
    ? env.BOOTSTRAP_ADMIN_USERNAME.trim()
    : '';
  const password = typeof env.BOOTSTRAP_ADMIN_PASSWORD === 'string'
    ? env.BOOTSTRAP_ADMIN_PASSWORD
    : '';
  if (!username || !password) {
    return { created: false };
  }

  const hash = await hashPassword(password);
  await db.execute(
    'INSERT INTO web_admins (username, password, role) VALUES (?, ?, ?)',
    [username, hash, 'admin'],
  );
  logger.log('Akun admin awal dibuat dari variabel lingkungan.');
  return { created: true };
}

module.exports = ensureBootstrapAdmin;
