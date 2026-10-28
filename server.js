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

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    return callback(null, origin);
  },
  credentials: true,
}));
app.use(express.json());

// Login dan ping kesehatan bersifat publik; semua route /api lainnya wajib membawa token JWT.
app.get('/api/health', (req, res) => {
  res.json({ ok: true, startedAt: BOOTED_AT });
});
const authRouter = require('./backend/routes/auth');
app.use('/api/auth', authRouter);
app.use('/api', authRouter);
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
