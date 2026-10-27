const { RouterOSAPI } = require('node-routeros');

const POLL_MS = 1500;
const API_TIMEOUT_SECONDS = 4;

function parseResource(rows) {
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) {
    return null;
  }
  const cpu = Number(row['cpu-load']);
  const total = Number(row['total-memory']);
  const free = Number(row['free-memory']);
  const used = Number.isFinite(total) && Number.isFinite(free) ? Math.max(0, total - free) : null;
  const ramPercent = used != null && total > 0 ? Math.min(100, Math.round((used / total) * 100)) : null;
  return {
    cpu: Number.isFinite(cpu) ? Math.min(100, Math.max(0, Math.round(cpu))) : null,
    ramPercent,
    ramUsed: used,
    ramTotal: Number.isFinite(total) ? total : null,
    board: row['board-name'] || '',
    version: row.version || '',
  };
}

// count-only mengembalikan satu baris { ret }. Print biasa dihitung dari panjang array.
function parseCount(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return 0;
  }
  const only = rows[0];
  if (rows.length === 1 && only && only.ret != null && only['.id'] == null) {
    const count = Number(only.ret);
    return Number.isFinite(count) && count >= 0 ? count : 0;
  }
  return rows.length;
}

function validInterfaceName(name) {
  return typeof name === 'string'
    && name.length >= 1
    && name.length <= 128
    && /^[A-Za-z0-9<][A-Za-z0-9_.:<>@+-]*$/.test(name);
}

function parseInterfaces(rows) {
  if (!Array.isArray(rows)) {
    return [];
  }
  const names = [];
  for (const row of rows) {
    const name = typeof row?.name === 'string' ? row.name.trim() : '';
    if (validInterfaceName(name) && !names.includes(name)) {
      names.push(name);
    }
  }
  return names;
}

function parseTraffic(rows) {
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) {
    return { rx: null, tx: null };
  }
  const rx = Number(row['rx-bits-per-second']);
  const tx = Number(row['tx-bits-per-second']);
  return {
    rx: Number.isFinite(rx) ? rx : null,
    tx: Number.isFinite(tx) ? tx : null,
  };
}

function normalizeCredentials(body) {
  const user = typeof body?.username === 'string' ? body.username.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  const requestedPort = body?.port == null || body?.port === '' ? 8728 : Number(body.port);
  const iface = typeof body?.interface === 'string' && body.interface.trim()
    ? body.interface.trim()
    : 'ether1';

  if (!user || user.length > 64 || /[\u0000-\u001f]/.test(user)) {
    throw new Error('Username API MikroTik wajib diisi');
  }
  if (!password || password.length > 128) {
    throw new Error('Password API MikroTik wajib diisi');
  }
  if (!Number.isInteger(requestedPort) || requestedPort < 1 || requestedPort > 65535) {
    throw new Error('Port API tidak valid');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:+-]{0,63}$/.test(iface)) {
    throw new Error('Nama interface tidak valid');
  }
  return { user, password, port: requestedPort, iface };
}

function validHost(host) {
  if (typeof host !== 'string') {
    return false;
  }
  const value = host.trim();
  const ipv4 = value.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    return ipv4.slice(1).every((part) => Number(part) <= 255);
  }
  return value.length > 0
    && value.length <= 253
    && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/.test(value);
}

function safeMessage(error, password) {
  const message = String(error?.message || 'Gagal menghubungi MikroTik').replace(/\s+/g, ' ').trim();
  if (!message || (password && message.includes(password))) {
    return 'Gagal menghubungi MikroTik';
  }
  return message.slice(0, 180);
}

async function collectSample(client, iface) {
  const resource = parseResource(await client.write('/system/resource/print'));
  if (!resource) {
    throw new Error('Data resource MikroTik kosong');
  }

  const warnings = [];
  let pppoe = null;
  let hotspot = null;
  let traffic = { rx: null, tx: null };

  try {
    pppoe = parseCount(await client.write('/ppp/active/print', ['=count-only=']));
  } catch {
    warnings.push('PPPoE tidak terbaca');
  }
  try {
    hotspot = parseCount(await client.write('/ip/hotspot/active/print', ['=count-only=']));
  } catch {
    warnings.push('Hotspot tidak terbaca');
  }
  try {
    traffic = parseTraffic(await client.write('/interface/monitor-traffic', [
      `=interface=${iface}`,
      '=once=',
    ]));
  } catch {
    warnings.push(`Traffic ${iface} tidak terbaca`);
  }

  return {
    ...resource,
    pppoe,
    hotspot,
    rx: traffic.rx,
    tx: traffic.tx,
    warnings,
  };
}

async function defaultCreateClient(target) {
  const client = new RouterOSAPI({
    host: target.host,
    user: target.user,
    password: target.password,
    port: target.port,
    timeout: API_TIMEOUT_SECONDS,
    keepalive: true,
  });
  await client.connect();
  return client;
}

function createMikrotikMonitor({ createClient = defaultCreateClient } = {}) {
  const monitor = {
    lastSample: null,
    target: null,
    client: null,
    timer: null,
    busy: false,
    stopped: true,
    state: 'idle',
    stateMessage: '',
    interfaces: [],
    interfacesReady: false,
  };

  function publishStatus(state, message) {
    if (monitor.state === state && monitor.stateMessage === message) {
      return;
    }
    monitor.state = state;
    monitor.stateMessage = message;
    api.onStatus?.({ state, message });
  }

  async function dropClient() {
    const current = monitor.client;
    monitor.client = null;
    monitor.interfacesReady = false;
    if (current) {
      try {
        await current.close();
      } catch {
        // koneksi sudah putus
      }
    }
  }

  async function ensureClient() {
    if (monitor.client?.connected) {
      return monitor.client;
    }
    await dropClient();
    monitor.client = await createClient(monitor.target);
    return monitor.client;
  }

  async function tick() {
    if (monitor.busy || monitor.stopped || !monitor.target) {
      return;
    }
    monitor.busy = true;
    const { target } = monitor;
    try {
      const client = await ensureClient();
      if (!monitor.interfacesReady) {
        try {
          const names = parseInterfaces(await client.write('/interface/print'));
          monitor.interfaces = names;
          monitor.interfacesReady = true;
          api.onInterfaces?.(names);
        } catch {
          // Daftar interface boleh gagal tanpa memutus sampel resource.
        }
      }
      const sample = await collectSample(client, target.iface);
      if (monitor.stopped || monitor.target !== target) {
        return;
      }
      monitor.lastSample = {
        ...sample,
        routerId: target.routerId,
        routerName: target.routerName,
        host: target.host,
        iface: target.iface,
        updatedAt: Date.now(),
      };
      api.onSample?.(monitor.lastSample);
      publishStatus('live', 'Terhubung');
    } catch (error) {
      await dropClient();
      if (!monitor.stopped && monitor.target === target) {
        publishStatus('error', safeMessage(error, target.password));
      }
    } finally {
      monitor.busy = false;
    }
  }

  const api = {
    onSample: null,
    onStatus: null,
    onInterfaces: null,
    get lastSample() {
      return monitor.lastSample;
    },
    isRunning() {
      return !monitor.stopped;
    },
    setInterface(name) {
      const iface = typeof name === 'string' ? name.trim() : '';
      if (!validInterfaceName(iface) || !monitor.target || monitor.stopped) {
        return false;
      }
      if (monitor.interfaces.length > 0 && !monitor.interfaces.includes(iface)) {
        return false;
      }
      monitor.target.iface = iface;
      return true;
    },
    start(target) {
      this.stop({ silent: true });
      monitor.target = target;
      monitor.stopped = false;
      monitor.lastSample = null;
      monitor.interfaces = [];
      monitor.interfacesReady = false;
      publishStatus('connecting', 'Menghubungkan...');
      monitor.timer = setInterval(() => {
        tick().catch(() => {});
      }, POLL_MS);
      tick().catch(() => {});
    },
    stop({ silent = false } = {}) {
      monitor.stopped = true;
      monitor.target = null;
      clearInterval(monitor.timer);
      monitor.timer = null;
      dropClient().catch(() => {});
      if (!silent) {
        publishStatus('idle', 'Pemantauan dihentikan');
      }
    },
  };

  return api;
}

module.exports = {
  POLL_MS,
  parseResource,
  parseCount,
  parseTraffic,
  parseInterfaces,
  validInterfaceName,
  normalizeCredentials,
  validHost,
  collectSample,
  createMikrotikMonitor,
};
