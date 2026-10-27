const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const { secret } = require('./config/jwt');
const { createMikrotikMonitor } = require('./mikrotikMonitor');

// Polling hanya hidup selama ada soket halaman Dashboard yang sedang mendengarkan.
// Jeda singkat menutup balapan saat soket tersambung ulang, lalu koneksi API dilepas.
const STOP_GRACE_MS = 800;

const monitor = createMikrotikMonitor();
let io = null;
let currentKey = '';
let stopTimer = null;
let lastInterfaces = [];

function targetKey(target) {
  return [target.host, target.user, target.port, target.iface].join('\n');
}

function watchingSockets() {
  if (!io) {
    return [];
  }
  return [...io.sockets.sockets.values()].filter((socket) => socket.data.watching);
}

function emitWatchers(event, payload) {
  for (const socket of watchingSockets()) {
    socket.emit(event, payload);
  }
}

monitor.onSample = (sample) => emitWatchers('mikrotik:stats', sample);
monitor.onStatus = (status) => emitWatchers('mikrotik:status', status);
monitor.onInterfaces = (names) => {
  lastInterfaces = Array.isArray(names) ? names : [];
  emitWatchers('interfaceList', lastInterfaces);
};

function scheduleStop() {
  clearTimeout(stopTimer);
  stopTimer = setTimeout(() => {
    if (watchingSockets().length === 0) {
      currentKey = '';
      monitor.stop();
    }
  }, STOP_GRACE_MS);
}

function beginStreaming(target) {
  clearTimeout(stopTimer);
  lastInterfaces = [];
  currentKey = targetKey(target);
  for (const socket of watchingSockets()) {
    socket.data.targetKey = currentKey;
  }
  monitor.start(target);
}

function attachMikrotikMonitor(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: '*' },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (typeof token !== 'string' || !token) {
      next(new Error('unauthorized'));
      return;
    }
    try {
      socket.user = jwt.verify(token, secret, { algorithms: ['HS256'] });
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.on('mikrotik:listen', () => {
      clearTimeout(stopTimer);
      socket.data.watching = true;
      socket.data.targetKey = currentKey;
      if (monitor.lastSample && monitor.isRunning()) {
        socket.emit('mikrotik:stats', monitor.lastSample);
        socket.emit('mikrotik:status', { state: 'live', message: 'Terhubung' });
      }
      if (lastInterfaces.length > 0) {
        socket.emit('interfaceList', lastInterfaces);
      }
    });

    socket.on('setInterface', (ifaceName) => {
      if (!socket.data.watching || !monitor.isRunning()) {
        return;
      }
      monitor.setInterface(ifaceName);
    });

    socket.on('mikrotik:stop', () => {
      socket.data.watching = false;
      scheduleStop();
    });

    socket.on('disconnect', () => {
      socket.data.watching = false;
      scheduleStop();
    });
  });

  return io;
}

module.exports = {
  attachMikrotikMonitor,
  beginStreaming,
};
