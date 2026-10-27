const net = require('net');
const { RouterOSAPI } = require('node-routeros');

const PROBE_TIMEOUT_SECONDS = 8;

function classifyConnectError(error, password) {
  const errno = typeof error?.errno === 'string' && error.errno
    ? error.errno
    : (typeof error?.code === 'string' ? error.code : '');
  let message = String(error?.message || '').replace(/\s+/g, ' ').trim();
  if (password && message.includes(password)) {
    message = '';
  }

  if (errno === 'CANTLOGIN' || /cannot log in|username or password is invalid/i.test(message)) {
    return { status: 401, message: 'Username atau password API MikroTik salah.' };
  }
  if (errno === 'ECONNREFUSED' || message === 'Connection refused.') {
    return { status: 400, message: 'Koneksi ditolak. Pastikan layanan API MikroTik aktif pada port tersebut.' };
  }
  if (errno === 'SOCKTMOUT' || errno === 'ETIMEDOUT' || /timed out/i.test(message)) {
    return { status: 400, message: 'MikroTik tidak merespons (timeout). Periksa IP dan port API.' };
  }
  if (errno === 'EHOSTUNREACH' || errno === 'ENETUNREACH' || errno === 'EHOSTDOWN') {
    return { status: 400, message: 'Router tidak dapat dijangkau. Periksa IP dan jaringan.' };
  }
  return { status: 400, message: message.slice(0, 180) || 'Gagal menghubungi MikroTik.' };
}

function reachHost(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      const error = new Error('Timed out');
      error.code = 'ETIMEDOUT';
      reject(error);
    }, timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.end();
      resolve();
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      socket.destroy();
      reject(error);
    });
  });
}

async function probeConnection(target, { connect } = {}) {
  if (connect) {
    await connect(target);
    return;
  }
  await reachHost(target.host, target.port, PROBE_TIMEOUT_SECONDS * 1000);
  const client = new RouterOSAPI({
    host: target.host,
    user: target.user,
    password: target.password,
    port: target.port,
    timeout: PROBE_TIMEOUT_SECONDS,
    keepalive: false,
  });
  try {
    await client.connect();
  } finally {
    try {
      await client.close();
    } catch {
      // soket sudah tertutup
    }
  }
}

module.exports = {
  classifyConnectError,
  probeConnection,
};
