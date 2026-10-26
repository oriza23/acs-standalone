const express = require('express');
const cors = require('cors');
const pool = require('./database');
const requireAuth = require('./backend/middleware/auth');
const ensureBootstrapAdmin = require('./backend/bootstrap_admin');
const { ensureTables: ensureAcsTables } = require('./backend/acs');

const app = express();
const PORT = 5001;

// Frontend GenieACS berjalan di port 5174 (localhost maupun IP LAN).
app.use(cors({ origin: '*' }));
app.use(express.json());

// Login bersifat publik; semua route /api lainnya wajib membawa token JWT.
app.use('/api/auth', require('./backend/routes/auth'));
app.use('/api', requireAuth);
app.use('/api/acs', require('./backend/routes/acs'));

async function start() {
  await ensureBootstrapAdmin(pool);
  await ensureAcsTables();
  // Express 5 mengirim error bind (mis. EADDRINUSE) ke callback listen. Tanpa pengecekan ini,
  // server kedua tetap mencetak "berjalan" padahal port dipakai proses lama.
  app.listen(PORT, (error) => {
    if (error) {
      console.error(
        error.code === 'EADDRINUSE'
          ? `Port ${PORT} sudah dipakai proses lain. Hentikan proses lama dulu: fuser -k ${PORT}/tcp`
          : `Gagal membuka port ${PORT}: ${error.message}`,
      );
      process.exit(1);
    }
    console.log(`Server berjalan di http://localhost:${PORT}`);
  });
}

start().catch((error) => {
  console.error('Gagal menjalankan server:', error.message);
  process.exit(1);
});
