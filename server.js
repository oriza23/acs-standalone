const path = require('path');
require('./backend/load_env')(path.join(__dirname, '.env'));

const express = require('express');
const cors = require('cors');
const pool = require('./database');
const requireAuth = require('./backend/middleware/auth');
const adminsRouter = require('./backend/routes/admins');
const ensureBootstrapAdmin = require('./backend/bootstrap_admin');
const { ensureTables: ensureAcsTables } = require('./backend/acs');

const app = express();
app.set('trust proxy', 1);
const PORT = Number(process.env.PORT) || 5001;
const BOOTED_AT = Date.now();

const LOCAL_HOST = /^(?:localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3})$/i;

function isAllowedOrigin(origin) {
  if (!origin) {
    return true;
  }
  try {
    const url = new URL(origin);
    if (LOCAL_HOST.test(url.hostname)) {
      return true;
    }
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

// credentials tidak boleh memakai origin "*". Origin yang lolos dikembalikan apa adanya.
app.use(cors({
  origin(origin, callback) {
    callback(null, isAllowedOrigin(origin) ? origin || true : false);
  },
  credentials: true,
}));
app.use(express.json());

// Login dan ping kesehatan bersifat publik; semua route /api lainnya wajib membawa token JWT.
app.get('/api/health', (req, res) => {
  res.json({ ok: true, startedAt: BOOTED_AT });
});
app.use('/api/auth', require('./backend/routes/auth'));
app.use('/api', requireAuth);
app.use('/api/acs', require('./backend/routes/acs'));
app.use('/api/routers', require('./backend/routes/routers'));
app.use('/api/admins', adminsRouter);
app.use('/api/admin', adminsRouter);

async function start() {
  await ensureBootstrapAdmin(pool);
  await ensureAcsTables();
  const server = app.listen(PORT, () => {
    console.log(`Server berjalan di http://localhost:${PORT}`);
  });
  server.on('error', (error) => {
    console.error(
      error.code === 'EADDRINUSE'
        ? `Port ${PORT} sudah dipakai proses lain. Hentikan proses lama dulu: fuser -k ${PORT}/tcp`
        : `Gagal membuka port ${PORT}: ${error.message}`,
    );
    process.exit(1);
  });
}

start().catch((error) => {
  console.error('Gagal menjalankan server:', error.message);
  process.exit(1);
});
