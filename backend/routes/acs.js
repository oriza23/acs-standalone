const net = require('net');
const axios = require('axios');
const express = require('express');
const pool = require('../../database');
const requireRole = require('../middleware/requireRole');
const acs = require('../acs');
const { parseWlanUpdate, planWlanUpdate } = require('../acs_wlan');
const { parseLanUpdate, planLanUpdate } = require('../acs_lan');
const {
  parseWanPpp, planWanPpp, parseWanIp, planWanIp, connectionTypeError, connectionPathOf, vendorProfile, batchWanParameters, omitBridgeAuth,
} = require('../acs_wan');
const {
  LIVE_PROJECTION, HOSTS_PROJECTION, WLANS_PROJECTION, LAN_PROJECTION, WANS_PROJECTION,
  extractHosts, extractWlans, extractWans, ssidCountOf, extractLanConfig, summarizeDevice,
} = require('../acs_summary');

const router = express.Router();
const requireAdmin = requireRole('admin');

const MAX_PAGE_LIMIT = 500;
const MAX_ACTION_IDS = 200;
const ACTION_CONCURRENCY = 5;
const INSERT_BATCH = 200;
const FILTERS = ['all', 'online', 'off24', 'off24plus'];
const SUMMON_OFFLINE_MESSAGE = 'Gagal: Perangkat sedang offline, tidak dapat melakukan summon.';
const SEARCH_COLUMNS = [
  'username', 'ip_pppoe', 'ip_tr069', 'sn', 'pon', 'manufacturer',
  'tipe', 'ssid', 'device_id', 'tags',
];

function readText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function readId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function likePattern(value) {
  return `%${value.replace(/[\\%_]/g, '\\$&')}%`;
}

function fail(res, status, message, error) {
  return res.status(status).json({ success: false, message, ...(error ? { error: error.message } : {}) });
}

async function findServer(serverId) {
  const id = readId(serverId);
  if (!id) {
    return null;
  }
  const [rows] = await pool.execute(
    'SELECT id, nama_server AS nama, ip_domain AS host, port FROM data_server_acs WHERE id = ? LIMIT 1',
    [id],
  );
  return rows[0] || null;
}

// Menjalankan worker secara paralel terbatas agar ACS tidak kebanjiran request.
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      // eslint-disable-next-line no-await-in-loop
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

// ---- Server ACS ------------------------------------------------------------
// Sumber dropdown "Pilih Server": semua server tersimpan, terbaru di atas.
router.get('/server', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM data_server_acs ORDER BY id DESC');
    res.json(rows);
  } catch (error) {
    fail(res, 500, 'Gagal mengambil data server ACS', error);
  }
});

// Body: { nama_server, ip_domain, port }. Port kosong -> 7557.
router.post('/server', requireAdmin, async (req, res) => {
  const namaServer = readText(req.body?.nama_server);
  const ipDomain = acs.normalizeHost(req.body?.ip_domain);
  const port = acs.normalizePort(readText(String(req.body?.port ?? '')));

  if (!namaServer || namaServer.length > acs.MAX_SERVER_NAME) {
    return fail(res, 400, `Nama server wajib diisi, maksimal ${acs.MAX_SERVER_NAME} karakter`);
  }
  if (!ipDomain) {
    return fail(res, 400, `IP/Domain server tidak valid (maksimal ${acs.MAX_HOST_LENGTH} karakter)`);
  }
  if (!port) {
    return fail(res, 400, 'Port harus berupa angka 1-65535');
  }

  try {
    const [result] = await pool.execute(
      'INSERT INTO data_server_acs (nama_server, ip_domain, port) VALUES (?, ?, ?)',
      [namaServer, ipDomain, String(port)],
    );
    return res.json({ success: true, message: 'Server ACS berhasil disimpan', id: result.insertId });
  } catch (error) {
    return fail(res, 500, 'Gagal menyimpan server ACS', error);
  }
});

router.delete('/server/:id', requireAdmin, async (req, res) => {
  const id = readId(req.params.id);
  if (!id) {
    return fail(res, 400, 'Server tidak valid');
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute('DELETE FROM acs_devices WHERE server_id = ?', [id]);
    const [result] = await connection.execute('DELETE FROM data_server_acs WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      await connection.rollback();
      return fail(res, 404, 'Server tidak ditemukan');
    }
    await connection.commit();
    return res.json({ success: true, message: 'Server ACS berhasil dihapus' });
  } catch (error) {
    await connection.rollback().catch(() => {});
    return fail(res, 500, 'Gagal menghapus server ACS', error);
  } finally {
    connection.release();
  }
});

// ---- Daftar ONU langsung dari GenieACS (jembatan NBI) ----------------------
// Mengambil http://{ip_domain}:{port}/devices, lalu merangkum tiap perangkat menjadi objek
// bersih (ekstraksi path TR-069 + konversi satuan ada di backend/acs_summary.js).
const LIVE_TIMEOUT_MS = 5000;

// Alamat dasar NBI server ACS (http://host:port) dari data_server_acs; null bila tidak ada.
async function liveBaseUrl(serverId) {
  const [rows] = await pool.execute(
    'SELECT ip_domain, port FROM data_server_acs WHERE id = ? LIMIT 1',
    [serverId],
  );
  if (rows.length === 0) {
    return null;
  }
  const { ip_domain: ipDomain, port } = rows[0];
  const host = net.isIPv6(ipDomain) ? `[${ipDomain}]` : ipDomain;
  return `http://${host}:${port}`;
}

function registeredTime(value) {
  const time = new Date(value ?? 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

router.get('/devices', async (req, res) => {
  const serverId = readId(req.query.server_id);
  if (!serverId) {
    return fail(res, 400, 'Pilih server ACS terlebih dahulu');
  }

  try {
    const baseUrl = await liveBaseUrl(serverId);
    if (!baseUrl) {
      return fail(res, 404, 'Server ACS tidak ditemukan');
    }

    const response = await axios.get(`${baseUrl}/devices`, {
      params: { projection: LIVE_PROJECTION },
      timeout: LIVE_TIMEOUT_MS,
    });
    if (!Array.isArray(response.data)) {
      throw new Error('Format balasan NBI tidak dikenali');
    }
    const mappedDevices = response.data
      .filter((item) => item && item._id)
      .map(summarizeDevice);
    // ONU terbaru terdaftar di atas. Tanpa tanggal dianggap paling lama.
    const sortedDevices = mappedDevices.sort((a, b) => registeredTime(b.registered) - registeredTime(a.registered));
    return res.json(sortedDevices);
  } catch (error) {
    console.error('Gagal mengambil perangkat dari GenieACS:', error.code || error.message);
    return res.status(500).json({ success: false, message: 'Gagal terhubung ke server GenieACS' });
  }
});

// Endpoint per perangkat (GET ...?server_id=..&id=<_id GenieACS>): mengambil subtree tertentu satu ONU
// langsung dari NBI, lalu merangkumnya di backend. Dipanggil saat modal detail / tab dibuka,
// bukan di daftar ONU (subtree-nya terlalu berat bila diambil untuk semua perangkat).
function deviceDetailRoute(path, { projection, build, label, middlewares = [] }) {
  router.get(path, ...middlewares, async (req, res) => {
    const serverId = readId(req.query.server_id);
    const deviceId = typeof req.query.id === 'string' ? req.query.id.trim() : '';
    if (!serverId) {
      return fail(res, 400, 'Pilih server ACS terlebih dahulu');
    }
    if (!deviceId || deviceId.length > 255) {
      return fail(res, 400, 'ID perangkat tidak valid');
    }

    try {
      const baseUrl = await liveBaseUrl(serverId);
      if (!baseUrl) {
        return fail(res, 404, 'Server ACS tidak ditemukan');
      }

      const response = await axios.get(`${baseUrl}/devices/`, {
        params: { query: JSON.stringify({ _id: deviceId }), projection },
        timeout: LIVE_TIMEOUT_MS,
      });
      const item = Array.isArray(response.data) ? response.data[0] : null;
      if (!item) {
        return fail(res, 404, 'Perangkat tidak ditemukan di GenieACS');
      }
      return res.json(build(item));
    } catch (error) {
      console.error(`Gagal mengambil ${label} dari GenieACS:`, error.code || error.message);
      return res.status(500).json({ success: false, message: 'Gagal terhubung ke server GenieACS' });
    }
  });
}

// Klien terhubung (Host LAN/WLAN) -> { connected_hosts: [...] }
deviceDetailRoute('/devices/hosts', {
  projection: HOSTS_PROJECTION,
  build: (item) => ({ connected_hosts: extractHosts(item) }),
  label: 'host',
});

// Konfigurasi LAN (IP gateway, DHCP, DNS) -> { lanConfig: {...} }
deviceDetailRoute('/devices/lan', {
  projection: LAN_PROJECTION,
  build: (item) => ({ lanConfig: extractLanConfig(item) }),
  label: 'LAN',
});

// Daftar koneksi WAN -> { wans: [...] }. Sandi PPPoE disamarkan di ekstraksi.
deviceDetailRoute('/devices/wans', {
  projection: WANS_PROJECTION,
  build: (item) => ({ wans: extractWans(item), ssidCount: ssidCountOf(item) }),
  label: 'WAN',
});

// Daftar WiFi -> { wlans: [...] }. Memuat sandi WiFi pelanggan, jadi hanya untuk admin.
deviceDetailRoute('/devices/wlans', {
  projection: WLANS_PROJECTION,
  build: (item) => ({ wlans: extractWlans(item) }),
  label: 'WLAN',
  middlewares: [requireAdmin],
});

// ---- Update WLAN: push perubahan SSID / password / status / security ke ONU (setParameterValues) ----
// Body: { server_id, deviceId (_id GenieACS), wlanId, ssid, password, status, security }.
// Hanya admin. Hanya parameter yang berbeda dari konfigurasi saat ini yang dikirim.
router.post('/update-wlan', requireAdmin, async (req, res) => {
  const parsed = parseWlanUpdate(req.body);
  if (parsed.error) {
    return fail(res, 400, parsed.error);
  }
  const {
    deviceId, wlanId, ssid, password, status, security,
  } = parsed.value;

  try {
    const server = await findServer(req.body?.server_id);
    if (!server) {
      return fail(res, 400, 'Pilih server ACS terlebih dahulu');
    }

    const target = await acs.readWlanTarget(server, deviceId, wlanId);
    if (!target) {
      return fail(res, 404, 'Perangkat tidak ditemukan di GenieACS');
    }
    if (target.model === 'Device') {
      return fail(res, 400, 'ONU ini memakai data model TR-181; update WLAN baru mendukung TR-098 (InternetGatewayDevice)');
    }
    if (!target.wlanNode) {
      return fail(res, 404, `WLAN ${wlanId} tidak ditemukan pada perangkat (coba Summon lalu muat ulang)`);
    }

    const plan = planWlanUpdate({
      wlanId, wlanNode: target.wlanNode, ssid, password, status, security,
    });
    if (plan.error) {
      return fail(res, 400, plan.error);
    }
    const { parameterValues, changed } = plan;
    if (parameterValues.length === 0) {
      return res.json({ success: true, message: 'Tidak ada perubahan untuk dikirim', changed });
    }

    const { applied } = await acs.sendSetParameterValues(server, deviceId, parameterValues);
    // Catatan audit tanpa nilai password.
    console.log(`[ACS update-wlan] ${req.user?.username || '-'} ${server.host}:${server.port} ${deviceId} WLAN ${wlanId}: ${changed.join(', ')} (${applied ? 'diterapkan' : 'diantrikan'})`);
    return res.json({
      success: true,
      applied,
      changed,
      message: applied
        ? 'Perubahan WLAN diterapkan ke ONU'
        : 'Perubahan WLAN masuk antrean GenieACS dan diterapkan saat ONU terhubung',
    });
  } catch (error) {
    console.error(`[ACS update-wlan] ${deviceId} WLAN ${wlanId}: ${error.message}`);
    const status502 = error instanceof acs.NbiError;
    return fail(res, status502 ? 502 : 500, status502 ? error.message : 'Gagal mengirim perubahan WLAN');
  }
});

// ---- Update LAN: push IP gateway / DHCP / DNS ke ONU (setParameterValues) -------------
// Body: { server_id, deviceId (_id GenieACS), ip, subnet, dhcpEnabled, dhcpMin, dhcpMax, leaseTime, dns1, dns2, dns3 }.
// Hanya admin. Hanya parameter yang berbeda dari konfigurasi saat ini yang dikirim.
router.post('/update-lan', requireAdmin, async (req, res) => {
  const parsed = parseLanUpdate(req.body);
  if (parsed.error) {
    return fail(res, 400, parsed.error);
  }
  const { value } = parsed;

  try {
    const server = await findServer(req.body?.server_id);
    if (!server) {
      return fail(res, 400, 'Pilih server ACS terlebih dahulu');
    }

    const target = await acs.readLanTarget(server, value.deviceId);
    if (!target) {
      return fail(res, 404, 'Perangkat tidak ditemukan di GenieACS');
    }
    if (target.model === 'Device') {
      return fail(res, 400, 'ONU ini memakai data model TR-181; update LAN baru mendukung TR-098 (InternetGatewayDevice)');
    }
    if (!target.lanNode?.IPInterface?.[1]?.IPInterfaceIPAddress) {
      return fail(res, 404, 'Konfigurasi LAN tidak ditemukan pada perangkat (coba Summon lalu muat ulang)');
    }

    const { parameterValues, changed } = planLanUpdate({ lanNode: target.lanNode, values: value });
    if (parameterValues.length === 0) {
      return res.json({ success: true, message: 'Tidak ada perubahan untuk dikirim', changed });
    }

    const { applied } = await acs.sendSetParameterValues(server, value.deviceId, parameterValues);
    console.log(`[ACS update-lan] ${req.user?.username || '-'} ${server.host}:${server.port} ${value.deviceId}: ${changed.join(', ')} (${applied ? 'diterapkan' : 'diantrikan'})`);
    return res.json({
      success: true,
      applied,
      changed,
      message: applied
        ? 'Perubahan LAN diterapkan ke ONU'
        : 'Perubahan LAN masuk antrean GenieACS dan diterapkan saat ONU terhubung',
    });
  } catch (error) {
    console.error(`[ACS update-lan] ${value.deviceId}: ${error.message}`);
    const isNbiError = error instanceof acs.NbiError;
    return fail(res, isNbiError ? 502 : 500, isNbiError ? error.message : 'Gagal mengirim perubahan LAN');
  }
});

// Hanya instance koneksi WAN yang boleh dihapus, bukan objek TR-069 lain.
const WAN_DELETE_PATH = /^(?:InternetGatewayDevice\.WANDevice\.\d+\.WANConnectionDevice\.\d+\.WAN(?:PPP|IP)Connection\.\d+\.|Device\.PPP\.Interface\.\d+\.|Device\.IP\.Interface\.\d+\.)$/;

function parseWanDelete(body) {
  const deviceId = typeof body?.deviceId === 'string' ? body.deviceId.trim() : '';
  let wanPath = typeof body?.wanPath === 'string' ? body.wanPath.trim() : '';
  if (!deviceId || deviceId.length > 255) {
    return { error: 'ID perangkat tidak valid' };
  }
  if (!wanPath || wanPath.length > 300) {
    return { error: 'Path WAN tidak valid' };
  }
  if (!wanPath.endsWith('.')) {
    wanPath += '.';
  }
  if (!WAN_DELETE_PATH.test(wanPath)) {
    return { error: 'Path WAN tidak valid' };
  }
  return { value: { deviceId, wanPath } };
}

// Hapus satu koneksi WAN (DeleteObject) lewat NBI server ACS yang dipilih.
// Body: { server_id, deviceId (_id GenieACS), wanPath }.
router.post('/delete-wan', requireAdmin, async (req, res) => {
  const parsed = parseWanDelete(req.body);
  if (parsed.error) {
    return fail(res, 400, parsed.error);
  }
  const { deviceId, wanPath } = parsed.value;

  try {
    const server = await findServer(req.body?.server_id);
    if (!server) {
      return fail(res, 400, 'Pilih server ACS terlebih dahulu');
    }
    const { applied } = await acs.sendDeleteObject(server, deviceId, wanPath);
    console.log(`[ACS delete-wan] ${req.user?.username || '-'} ${server.host}:${server.port} ${deviceId} ${wanPath} (${applied ? 'diterapkan' : 'diantrikan'})`);
    return res.json({
      success: true,
      applied,
      message: applied
        ? 'Koneksi WAN dihapus dari ONU'
        : 'Penghapusan WAN masuk antrean dan diterapkan saat ONU terhubung',
    });
  } catch (error) {
    console.error(`[ACS delete-wan] ${deviceId} ${wanPath}: ${error.message}`);
    const isNbiError = error instanceof acs.NbiError;
    return fail(res, isNbiError ? 502 : 500, isNbiError ? error.message : 'Gagal menghapus koneksi WAN');
  }
});

async function pushWanBatch(server, deviceId, parameterValues) {
  if (!parameterValues || parameterValues.length === 0) {
    return { applied: true };
  }
  return acs.sendWanSetParameterValues(server, deviceId, parameterValues);
}

// Buat atau ubah koneksi WAN PPP. Body = isian form (nama, NAT, service, connection type,
// VLAN, 802.1p, username, password, MTU, port binding) + server_id + deviceId.
// wanPath kosong membuat instance baru (AddObject) lalu setParameterValues.
// Hanya admin. Sandi tidak dicatat di log.
router.post('/wan-ppp', requireAdmin, async (req, res) => {
  const parsed = parseWanPpp(req.body);
  if (parsed.error) {
    return fail(res, 400, parsed.error);
  }
  const values = parsed.value;
  let pppPath = values.wanPath;
  let rollbackPath = null;
  let server = null;

  try {
    server = await findServer(req.body?.server_id);
    if (!server) {
      return fail(res, 400, 'Pilih server ACS terlebih dahulu');
    }

    const target = await acs.readWanTarget(server, values.deviceId);
    if (!target) {
      return fail(res, 404, 'Perangkat tidak ditemukan di GenieACS');
    }

    const manufacturer = target.manufacturer || values.manufacturer;
    const typeError = connectionTypeError(manufacturer, values.connectionType);
    if (typeError) {
      return fail(res, 400, typeError);
    }
    if (!target.tr181 && !target.wanDeviceIndex) {
      return fail(res, 400, 'Struktur WAN tidak ditemukan pada perangkat. Jalankan Summon lalu coba lagi.');
    }
    console.log(`[ACS wan-ppp] pohon ${values.deviceId}: model=${target.model} WANDevice=${target.wanDeviceIndex || '-'} WANConnectionDevice=${target.connectionIndex || 'baru'}`);

    await acs.prepareWanPpp(server, values.deviceId, target.model);

    if (!pppPath) {
      const created = await acs.createWanPppInstance(server, values.deviceId, {
        profile: target.tr181 ? 'tr181' : vendorProfile(manufacturer),
        tr181: target.tr181,
        wanDeviceIndex: target.wanDeviceIndex,
        connectionIndex: target.connectionIndex,
        createConnectionDevice: target.createConnectionDevice,
      });
      pppPath = created.pppPath;
      rollbackPath = created.rollbackPath || created.pppPath;
    }

    // Baca ulang pohon setelah AddObject supaya VLAN/MTU hanya memakai parameter yang ada.
    const fresh = await acs.readWanTarget(server, values.deviceId);
    const knownLeaves = fresh?.knownLeaves?.length ? fresh.knownLeaves : target.knownLeaves;
    const plan = planWanPpp({
      values,
      manufacturer,
      accessType: fresh?.accessType || target.accessType,
      pppPath,
      connectionPath: connectionPathOf(pppPath),
      knownLeaves,
      dataModel: target.tr181 ? 'Device' : target.model,
    });
    const payload = omitBridgeAuth(batchWanParameters(plan), values.connectionType);
    const result = await pushWanBatch(server, values.deviceId, payload);
    const applied = result.applied;

    console.log(`[ACS wan-ppp] ${req.user?.username || '-'} ${server.host}:${server.port} ${values.deviceId} ${plan.profile} ${pppPath} ${plan.fields.join(', ')} (${applied ? 'diterapkan' : 'diantrikan'})`);
    return res.json({
      success: true,
      applied,
      partial: false,
      wanPath: pppPath,
      message: applied
        ? 'Koneksi WAN PPP diterapkan ke ONU'
        : 'Koneksi WAN PPP masuk antrean dan diterapkan saat ONU terhubung',
    });
  } catch (error) {
    console.error(`[ACS wan-ppp] ${values.deviceId} ${pppPath || '-'}: ${error.message}`);
    let rollbackNote = '';
    let leftoverPath = null;
    if (server && rollbackPath && !values.wanPath) {
      try {
        await acs.sendWanDeleteObject(server, values.deviceId, rollbackPath);
        console.log(`[ACS wan-ppp] rollback ${values.deviceId} ${rollbackPath}`);
        pppPath = null;
      } catch (rollbackError) {
        leftoverPath = pppPath;
        rollbackNote = ` Instance baru gagal dihapus (${rollbackError.message}).`;
        console.error(`[ACS wan-ppp] rollback ${values.deviceId} ${rollbackPath}: ${rollbackError.message}`);
      }
    }
    const isNbiError = error instanceof acs.NbiError;
    return res.status(isNbiError ? 502 : 500).json({
      success: false,
      message: isNbiError ? `${error.message}${rollbackNote}` : 'Gagal mengirim koneksi WAN PPP',
      ...(leftoverPath ? { wanPath: leftoverPath } : {}),
    });
  }
});

// Buat atau ubah koneksi WAN IP (WANIPConnection). IP_Routed memakai DHCP atau Static.
// IP_Bridged tidak mengirim alamat IP. Gagal setParameterValues menghapus instance baru.
async function saveWanIp(req, res) {
  const parsed = parseWanIp(req.body);
  if (parsed.error) {
    return fail(res, 400, parsed.error);
  }
  const values = parsed.value;
  let ipPath = values.wanPath;
  let rollbackPath = null;
  let server = null;

  try {
    server = await findServer(req.body?.server_id);
    if (!server) {
      return fail(res, 400, 'Pilih server ACS terlebih dahulu');
    }

    const target = await acs.readWanTarget(server, values.deviceId);
    if (!target) {
      return fail(res, 404, 'Perangkat tidak ditemukan di GenieACS');
    }
    if (target.tr181) {
      return fail(res, 400, 'Model TR-181 belum mendukung pembuatan WAN IP dari form ini.');
    }
    if (!target.wanDeviceIndex) {
      return fail(res, 400, 'Struktur WAN tidak ditemukan pada perangkat. Jalankan Summon lalu coba lagi.');
    }

    const manufacturer = target.manufacturer || values.manufacturer;
    const modelName = target.productModel || values.modelName;
    console.log(`[ACS wan-ip] pohon ${values.deviceId}: model=${modelName || '-'} WANDevice=${target.wanDeviceIndex} WANConnectionDevice=${target.connectionIndex || 'baru'}`);

    await acs.prepareWanPpp(server, values.deviceId, target.model);

    if (!ipPath) {
      const created = await acs.createWanIpInstance(server, values.deviceId, {
        profile: vendorProfile(manufacturer),
        tr181: false,
        wanDeviceIndex: target.wanDeviceIndex,
        connectionIndex: target.connectionIndex,
        createConnectionDevice: target.createConnectionDevice,
      });
      ipPath = created.ipPath;
      rollbackPath = created.rollbackPath || created.ipPath;
    }

    const fresh = await acs.readWanTarget(server, values.deviceId);
    const knownLeaves = fresh?.knownLeaves?.length ? fresh.knownLeaves : target.knownLeaves;
    const plan = planWanIp({
      values,
      manufacturer,
      modelName,
      accessType: fresh?.accessType || target.accessType,
      ipPath,
      connectionPath: connectionPathOf(ipPath),
      knownLeaves,
      dataModel: target.model,
    });
    const payload = batchWanParameters(plan).filter(([path]) => {
      const leaf = String(path).split('.').pop();
      return leaf !== 'Username' && leaf !== 'Password';
    });
    const result = await pushWanBatch(server, values.deviceId, payload);
    const applied = result.applied;

    console.log(`[ACS wan-ip] ${req.user?.username || '-'} ${server.host}:${server.port} ${values.deviceId} ${plan.profile} ${ipPath} ${plan.fields.join(', ')} (${applied ? 'diterapkan' : 'diantrikan'})`);
    return res.json({
      success: true,
      applied,
      partial: false,
      wanPath: ipPath,
      message: applied
        ? 'Koneksi WAN IP diterapkan ke ONU'
        : 'Koneksi WAN IP masuk antrean dan diterapkan saat ONU terhubung',
    });
  } catch (error) {
    console.error(`[ACS wan-ip] ${values.deviceId} ${ipPath || '-'}: ${error.message}`);
    let rollbackNote = '';
    let leftoverPath = null;
    if (server && rollbackPath && !values.wanPath) {
      try {
        await acs.sendWanDeleteObject(server, values.deviceId, rollbackPath);
        console.log(`[ACS wan-ip] rollback ${values.deviceId} ${rollbackPath}`);
        ipPath = null;
      } catch (rollbackError) {
        leftoverPath = ipPath;
        rollbackNote = ` Instance baru gagal dihapus (${rollbackError.message}).`;
        console.error(`[ACS wan-ip] rollback ${values.deviceId} ${rollbackPath}: ${rollbackError.message}`);
      }
    }
    const isNbiError = error instanceof acs.NbiError;
    return res.status(isNbiError ? 502 : 500).json({
      success: false,
      message: isNbiError ? `${error.message}${rollbackNote}` : 'Gagal mengirim koneksi WAN IP',
      ...(leftoverPath ? { wanPath: leftoverPath } : {}),
    });
  }
}

router.post('/wan-ip', requireAdmin, saveWanIp);
router.post('/add-wan-ip', requireAdmin, saveWanIp);

// ---- Daftar ONU hasil SINKRON (tersimpan di DB web) + statistik ---------------
router.get('/devices/db', async (req, res) => {
  const server = await findServer(req.query.server_id).catch(() => null);
  if (!server) {
    return fail(res, 400, 'Pilih server ACS terlebih dahulu');
  }

  const filter = FILTERS.includes(req.query.filter) ? req.query.filter : 'all';
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), MAX_PAGE_LIMIT);
  const requestedPage = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const term = readText(req.query.q).slice(0, 100);
  const cut = acs.statusCutoffs();

  try {
    // Statistik selalu untuk seluruh ONU di server terpilih, tidak ikut filter/pencarian.
    const [statRows] = await pool.query(
      `SELECT
         COUNT(*) AS total,
         COALESCE(SUM(last_inform >= ?), 0) AS online,
         COALESCE(SUM(last_inform < ? AND last_inform >= ?), 0) AS off24,
         COALESCE(SUM(last_inform IS NULL OR last_inform < ?), 0) AS off24plus
       FROM acs_devices WHERE server_id = ?`,
      [cut.online, cut.online, cut.day, cut.day, server.id],
    );
    const stats = {
      total: Number(statRows[0].total) || 0,
      online: Number(statRows[0].online) || 0,
      off24: Number(statRows[0].off24) || 0,
      off24plus: Number(statRows[0].off24plus) || 0,
    };

    const where = ['server_id = ?'];
    const params = [server.id];
    if (filter === 'online') {
      where.push('last_inform >= ?');
      params.push(cut.online);
    } else if (filter === 'off24') {
      where.push('last_inform < ? AND last_inform >= ?');
      params.push(cut.online, cut.day);
    } else if (filter === 'off24plus') {
      where.push('(last_inform IS NULL OR last_inform < ?)');
      params.push(cut.day);
    }
    if (term) {
      where.push(`(${SEARCH_COLUMNS.map((column) => `${column} LIKE ?`).join(' OR ')})`);
      SEARCH_COLUMNS.forEach(() => params.push(likePattern(term)));
    }
    const whereSql = `WHERE ${where.join(' AND ')}`;

    const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM acs_devices ${whereSql}`, params);
    const total = Number(countRows[0].total) || 0;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const page = Math.min(requestedPage, totalPages);

    const [rows] = await pool.query(
      `SELECT id, device_id, username, ip_pppoe, ip_tr069, sn, pon, manufacturer, tipe,
              ssid, wifi_users, rx_power, temp, uptime, last_inform, registered, tags
       FROM acs_devices ${whereSql}
       ORDER BY registered IS NULL, registered DESC, id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, (page - 1) * limit],
    );

    const withStatus = rows.map((row) => {
      let status = 'off24plus';
      if (row.last_inform && row.last_inform >= cut.online) {
        status = 'online';
      } else if (row.last_inform && row.last_inform >= cut.day) {
        status = 'off24';
      }
      return { ...row, status };
    });

    return res.json({
      data: withStatus,
      stats,
      pagination: { page, limit, total, totalPages },
      online_window_minutes: acs.ONLINE_WINDOW_MINUTES,
    });
  } catch (error) {
    return fail(res, 500, 'Gagal mengambil data ONU', error);
  }
});

// Satu ONU dari NBI, diringkas sama seperti baris di GET /devices.
// Didaftarkan setelah /devices/hosts|lan|wans|wlans|db supaya path itu tidak tertangkap :deviceId.
// GET /api/acs/devices/:deviceId?server_id=
router.get('/devices/:deviceId', async (req, res) => {
  const serverId = readId(req.query.server_id);
  const deviceId = typeof req.params.deviceId === 'string' ? req.params.deviceId.trim() : '';
  if (!serverId) {
    return fail(res, 400, 'Pilih server ACS terlebih dahulu');
  }
  if (!deviceId || deviceId.length > 255) {
    return fail(res, 400, 'ID perangkat tidak valid');
  }

  try {
    const baseUrl = await liveBaseUrl(serverId);
    if (!baseUrl) {
      return fail(res, 404, 'Server ACS tidak ditemukan');
    }

    const response = await axios.get(`${baseUrl}/devices/`, {
      params: {
        query: JSON.stringify({ _id: deviceId }),
        projection: LIVE_PROJECTION,
      },
      timeout: LIVE_TIMEOUT_MS,
    });
    const item = Array.isArray(response.data) ? response.data[0] : null;
    if (!item || !item._id) {
      return fail(res, 404, 'Perangkat tidak ditemukan di GenieACS');
    }
    return res.json(summarizeDevice(item));
  } catch (error) {
    console.error('Gagal mengambil perangkat dari GenieACS:', error.code || error.message);
    return res.status(500).json({ success: false, message: 'Gagal terhubung ke server GenieACS' });
  }
});

// ---- SINKRON: selaraskan DB web dengan GenieACS ----------------------------
router.post('/sync', requireAdmin, async (req, res) => {
  const server = await findServer(req.body?.server_id).catch(() => null);
  if (!server) {
    return fail(res, 400, 'Pilih server ACS terlebih dahulu');
  }

  let remote;
  try {
    remote = (await acs.fetchAllDevices(server)).filter((doc) => doc && doc._id).map(acs.mapDevice);
  } catch (error) {
    // Gagal mengambil dari ACS: jangan sentuh DB agar data lokal tidak terhapus keliru.
    return fail(res, 502, error.message);
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [existing] = await connection.query(
      'SELECT device_id FROM acs_devices WHERE server_id = ?',
      [server.id],
    );
    const known = new Set(existing.map((row) => row.device_id));
    const seen = new Set(remote.map((device) => device.device_id));

    for (let start = 0; start < remote.length; start += INSERT_BATCH) {
      const batch = remote.slice(start, start + INSERT_BATCH);
      // eslint-disable-next-line no-await-in-loop
      await connection.query(
        `INSERT INTO acs_devices
           (server_id, device_id, data_model, username, ip_pppoe, ip_tr069, sn, pon, manufacturer,
            tipe, ssid, wifi_users, rx_power, temp, uptime, last_inform, registered, tags)
         VALUES ?
         ON DUPLICATE KEY UPDATE
           data_model = VALUES(data_model), username = VALUES(username), ip_pppoe = VALUES(ip_pppoe),
           ip_tr069 = VALUES(ip_tr069), sn = VALUES(sn), pon = VALUES(pon),
           manufacturer = VALUES(manufacturer), tipe = VALUES(tipe), ssid = VALUES(ssid),
           wifi_users = VALUES(wifi_users), rx_power = VALUES(rx_power), temp = VALUES(temp),
           uptime = VALUES(uptime), last_inform = VALUES(last_inform),
           registered = VALUES(registered), tags = VALUES(tags), synced_at = CURRENT_TIMESTAMP`,
        [batch.map((d) => [
          server.id, d.device_id, d.data_model, d.username, d.ip_pppoe, d.ip_tr069, d.sn, d.pon,
          d.manufacturer, d.tipe, d.ssid, d.wifi_users, d.rx_power, d.temp, d.uptime,
          d.last_inform, d.registered, d.tags,
        ])],
      );
    }

    // ONU yang sudah tidak ada di GenieACS dibuang dari DB web.
    const stale = [...known].filter((deviceId) => !seen.has(deviceId));
    for (let start = 0; start < stale.length; start += INSERT_BATCH) {
      // eslint-disable-next-line no-await-in-loop
      await connection.query(
        'DELETE FROM acs_devices WHERE server_id = ? AND device_id IN (?)',
        [server.id, stale.slice(start, start + INSERT_BATCH)],
      );
    }
    await connection.commit();

    const added = remote.filter((device) => !known.has(device.device_id)).length;
    return res.json({
      success: true,
      message: `Sinkron selesai: ${remote.length} ONU (${added} baru, ${stale.length} dihapus)`,
      total: remote.length,
      ditambah: added,
      dihapus: stale.length,
    });
  } catch (error) {
    await connection.rollback().catch(() => {});
    return fail(res, 500, 'Gagal menyimpan hasil sinkronisasi', error);
  } finally {
    connection.release();
  }
});

// ---- Aksi massal: body { server_id, ids: [_id perangkat di GenieACS] } ------
// Tabel di frontend berisi data langsung dari NBI, jadi yang dikirim adalah _id
// GenieACS (kolom DEVICE ID). ID yang tidak ada di ACS akan dijawab 404 oleh NBI.
async function loadActionTargets(req) {
  const server = await findServer(req.body?.server_id);
  if (!server) {
    return { error: [400, 'Pilih server ACS terlebih dahulu'] };
  }
  const rawIds = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const ids = [...new Set(rawIds.filter((value) => typeof value === 'string' && value.trim() !== '' && value.length <= 255))];
  if (ids.length === 0) {
    return { error: [400, 'Pilih minimal satu ONU'] };
  }
  if (ids.length > MAX_ACTION_IDS) {
    return { error: [400, `Maksimal ${MAX_ACTION_IDS} ONU per aksi`] };
  }
  const devices = ids.map((deviceId) => ({ id: deviceId, device_id: deviceId, data_model: null }));
  return { server, devices };
}

// Kegagalan per perangkat dicatat di log backend supaya mudah dilacak.
function logFailures(label, serverRow, results) {
  results.filter((item) => !item.ok).forEach((item) => {
    console.error(`[ACS ${label}] ${serverRow.host}:${serverRow.port} ${item.device_id}: ${item.message}`);
  });
}

function summarize(label, results) {
  const berhasil = results.filter((item) => item.ok).length;
  const gagal = results.length - berhasil;
  const firstError = results.find((item) => !item.ok)?.message;
  let message = `${label}: ${berhasil} berhasil`;
  if (gagal > 0) {
    message += `, ${gagal} gagal${firstError ? ` (${firstError})` : ''}`;
  }
  return {
    success: gagal === 0, message, total: results.length, berhasil, gagal, results,
  };
}

function taskRoute(path, action, label) {
  router.post(path, requireAdmin, async (req, res) => {
    try {
      const { server, devices, error } = await loadActionTargets(req);
      if (error) {
        return fail(res, error[0], error[1]);
      }
      const results = await mapLimit(devices, ACTION_CONCURRENCY, async (device) => {
        try {
          if (action === 'summon') {
            const inform = await acs.readLastInform(server, device.device_id);
            if (!inform) {
              return { id: device.id, device_id: device.device_id, ok: false, message: 'Perangkat tidak ditemukan di GenieACS' };
            }
            if (!acs.isDeviceOnline(inform.lastInform)) {
              return { id: device.id, device_id: device.device_id, ok: false, message: SUMMON_OFFLINE_MESSAGE };
            }
          }
          return { id: device.id, device_id: device.device_id, ok: true, message: await acs.sendTask(server, device, action) };
        } catch (taskError) {
          return { id: device.id, device_id: device.device_id, ok: false, message: taskError.message };
        }
      });
      logFailures(label, server, results);
      const summary = summarize(label, results);
      if (action === 'summon' && summary.berhasil === 0 && results.every((item) => item.message === SUMMON_OFFLINE_MESSAGE)) {
        return fail(res, 409, results.length === 1 ? SUMMON_OFFLINE_MESSAGE : summary.message);
      }
      return res.json(summary);
    } catch (error) {
      return fail(res, 500, `Gagal menjalankan ${label}`, error);
    }
  });
}

taskRoute('/reset', 'reset', 'Factory Reset');
taskRoute('/reboot', 'reboot', 'Reboot');
taskRoute('/summon', 'summon', 'Summon');

// DELETE: hapus di GenieACS lebih dulu, baris lokal baru dihapus bila ACS sukses.
// Dengan urutan ini ONU yang gagal dihapus di ACS tetap tampil di tabel (tidak
// "hilang" dari web tapi masih ada di ACS).
router.post('/delete', requireAdmin, async (req, res) => {
  try {
    const { server, devices, error } = await loadActionTargets(req);
    if (error) {
      return fail(res, error[0], error[1]);
    }
    const results = await mapLimit(devices, ACTION_CONCURRENCY, async (device) => {
      try {
        await acs.deleteRemoteDevice(server, device);
        // Salinan hasil SINKRON (bila ada) ikut dibersihkan.
        await pool.execute('DELETE FROM acs_devices WHERE device_id = ? AND server_id = ?', [device.device_id, server.id]);
        return { id: device.id, device_id: device.device_id, ok: true, message: 'Dihapus' };
      } catch (deleteError) {
        return { id: device.id, device_id: device.device_id, ok: false, message: deleteError.message };
      }
    });
    logFailures('Hapus ONU', server, results);
    return res.json(summarize('Hapus ONU', results));
  } catch (error) {
    return fail(res, 500, 'Gagal menghapus ONU', error);
  }
});

module.exports = router;
