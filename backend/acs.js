
const net = require('net');
const pool = require('../database');
const {
  formatAcsFault, selectWanLocation, selectTr181Location, vendorProfile, normalizeAcsObjectName, sanitizeParameterValues,
  isCommitLoopFault,
} = require('./acs_wan');

// ---- Konstanta -------------------------------------------------------------
const DEFAULT_NBI_PORT = 7557;
const MAX_SERVER_NAME = 100;
const MAX_HOST_LENGTH = 100;
// Perangkat dianggap ONLINE bila inform terakhirnya tidak lebih lama dari ini.
// Sesuaikan dengan Periodic Inform Interval ONU (bisa diubah lewat env).
const ONLINE_WINDOW_MINUTES = Math.max(parseInt(process.env.ACS_ONLINE_MINUTES, 10) || 30, 1);
const NBI_TIMEOUT_MS = 15000;
// Batas tunggu HTTP ke GenieACS untuk tugas (Summon/Reboot/Reset). Parameter query timeout=3000
// di URL task membuat GenieACS tidak menunggu ONT lama (200 selesai / 202 diantrikan).
// Angka ini hanya batas klien bila ACS sendiri lambat membalas, bukan batas tunggu ONT.
const TASK_TIMEOUT_MS = Math.max(parseInt(process.env.ACS_TASK_TIMEOUT_MS, 10) || 45000, 1000);
const NBI_PAGE_SIZE = 500;
const NBI_MAX_PAGES = 200;

async function ensureTables() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS data_server_acs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nama_server VARCHAR(${MAX_SERVER_NAME}) NOT NULL,
      ip_domain VARCHAR(${MAX_HOST_LENGTH}) NOT NULL,
      port VARCHAR(10) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
  );
  // device_id = _id di GenieACS (huruf besar kecil dibedakan).
  await pool.query(
    `CREATE TABLE IF NOT EXISTS acs_devices (
      id INT AUTO_INCREMENT PRIMARY KEY,
      server_id INT NOT NULL,
      device_id VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
      data_model VARCHAR(30) DEFAULT NULL,
      username VARCHAR(100) DEFAULT NULL,
      ip_pppoe VARCHAR(64) DEFAULT NULL,
      ip_tr069 VARCHAR(64) DEFAULT NULL,
      sn VARCHAR(100) DEFAULT NULL,
      pon VARCHAR(100) DEFAULT NULL,
      manufacturer VARCHAR(100) DEFAULT NULL,
      tipe VARCHAR(100) DEFAULT NULL,
      ssid VARCHAR(100) DEFAULT NULL,
      wifi_users INT DEFAULT NULL,
      rx_power VARCHAR(20) DEFAULT NULL,
      temp VARCHAR(20) DEFAULT NULL,
      uptime BIGINT DEFAULT NULL,
      last_inform DATETIME DEFAULT NULL,
      registered DATETIME DEFAULT NULL,
      tags VARCHAR(500) DEFAULT NULL,
      synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_acs_device (server_id, device_id),
      KEY idx_acs_last_inform (server_id, last_inform)
    )`,
  );
}

// ---- Validasi server -------------------------------------------------------
// Menerima "10.0.0.5", "acs.contoh.com", atau "http://acs.contoh.com/" lalu
// mengembalikan host polos. null bila tidak valid.
function normalizeHost(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const host = value.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '').replace(/^\[|\]$/g, '');
  if (!host || host.length > MAX_HOST_LENGTH) {
    return null;
  }
  if (net.isIP(host)) {
    return host;
  }
  const validDomain = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;
  return validDomain.test(host) ? host : null;
}

function normalizePort(value) {
  const port = Number(value === '' || value === undefined || value === null ? DEFAULT_NBI_PORT : value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

function baseUrl(server) {
  const host = net.isIPv6(server.host) ? `[${server.host}]` : server.host;
  return `http://${host}:${server.port}`;
}

// ---- Klien NBI GenieACS ----------------------------------------------------
class NbiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'NbiError';
    this.status = status;
    this.code = code;
  }
}

async function nbiRequest(server, method, path, { body, timeout = NBI_TIMEOUT_MS, allowBusy = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(`${baseUrl(server)}${path}`, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    // 404 = tidak ditemukan (ditangani pemanggil). 503 = sesi CWMP sedang berjalan: hanya diteruskan
    // bila pemanggil meminta (allowBusy). Default sama seperti acs-standalone: 503 dilempar sebagai error,
    // supaya alur WAN (AddObject/setParameterValues) tidak mengira perintah berhasil.
    if (!response.ok && response.status !== 404 && !(allowBusy && response.status === 503)) {
      throw new NbiError(`NBI membalas ${response.status}${text ? `: ${text.slice(0, 500)}` : ''}`, response.status);
    }
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    return { status: response.status, data };
  } catch (error) {
    if (error instanceof NbiError) {
      throw error;
    }
    if (error.name === 'AbortError') {
      throw new NbiError(`Server ACS tidak merespons dalam ${Math.round(timeout / 1000)} detik`, undefined, 'TIMEOUT');
    }
    throw new NbiError(`Tidak dapat terhubung ke ACS ${server.host}:${server.port} (${error.cause?.code || error.message})`);
  } finally {
    clearTimeout(timer);
  }
}

// Root data model TR-098 ("InternetGatewayDevice") atau TR-181 ("Device").
const ROOTS = ['InternetGatewayDevice', 'Device'];

// Hanya subtree yang dibutuhkan; mengambil seluruh parameter akan sangat berat.
const PROJECTION = [
  '_id', '_lastInform', '_registered', '_tags', '_deviceId',
  'InternetGatewayDevice.DeviceInfo',
  'InternetGatewayDevice.ManagementServer',
  'InternetGatewayDevice.WANDevice',
  'InternetGatewayDevice.LANDevice',
  'Device.DeviceInfo',
  'Device.ManagementServer',
  'Device.PPP',
  'Device.IP',
  'Device.WiFi',
  'Device.Optical',
].join(',');

async function fetchAllDevices(server) {
  const devices = [];
  for (let page = 0; page < NBI_MAX_PAGES; page += 1) {
    const query = new URLSearchParams({
      projection: PROJECTION,
      sort: JSON.stringify({ _id: 1 }),
      limit: String(NBI_PAGE_SIZE),
      skip: String(page * NBI_PAGE_SIZE),
    });
    // eslint-disable-next-line no-await-in-loop
    const { data } = await nbiRequest(server, 'GET', `/devices/?${query}`, { timeout: 60000 });
    if (!Array.isArray(data)) {
      throw new NbiError('Format balasan NBI tidak dikenali');
    }
    devices.push(...data);
    if (data.length < NBI_PAGE_SIZE) {
      return devices;
    }
  }
  throw new NbiError('Jumlah perangkat melebihi batas sinkronisasi');
}

// ---- Pemetaan dokumen perangkat GenieACS -> baris DB -----------------------
function isParamNode(node) {
  return node !== null && typeof node === 'object' && !Array.isArray(node);
}

function childKeys(node) {
  return Object.keys(node).filter((key) => !key.startsWith('_'));
}

// Menelusuri path berpemisah titik; "*" mencocokkan semua anak (mis. instance 1,2,3).
function collectValues(doc, path) {
  let nodes = [doc];
  for (const segment of path.split('.')) {
    const next = [];
    for (const node of nodes) {
      if (!isParamNode(node)) {
        continue;
      }
      if (segment === '*') {
        childKeys(node).forEach((key) => next.push(node[key]));
      } else if (node[segment] !== undefined) {
        next.push(node[segment]);
      }
    }
    nodes = next;
  }
  return nodes
    .map((node) => (isParamNode(node) ? node._value : undefined))
    .filter((value) => value !== undefined && value !== null && String(value).trim() !== '');
}

function pick(doc, paths) {
  for (const path of paths) {
    const values = collectValues(doc, path);
    if (values.length > 0) {
      return values[0];
    }
  }
  return null;
}

// Mencari parameter berdasarkan nama belakang (mis. RXPower) di seluruh subtree.
// Parameter optik berbeda-beda per vendor (X_HW_..., X_ZTE-COM_..., dst).
function findLeaf(node, pattern) {
  if (!isParamNode(node)) {
    return null;
  }
  for (const key of childKeys(node)) {
    const child = node[key];
    if (!isParamNode(child)) {
      continue;
    }
    if (pattern.test(key) && child._value !== undefined && child._value !== null && String(child._value).trim() !== '') {
      return child._value;
    }
    const found = findLeaf(child, pattern);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

function toText(value, max) {
  if (value === null || value === undefined) {
    return null;
  }
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

function toInt(value) {
  const number = parseInt(value, 10);
  return Number.isFinite(number) ? number : null;
}

function toDate(value) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function hostFromUrl(value) {
  if (!value) {
    return null;
  }
  try {
    return new URL(String(value)).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return null;
  }
}

function sumValues(doc, path) {
  const values = collectValues(doc, path).map((value) => parseInt(value, 10)).filter(Number.isFinite);
  return values.length > 0 ? values.reduce((total, value) => total + value, 0) : null;
}

// Path per vendor/data model dikumpulkan di sini supaya mudah disesuaikan.
function mapDevice(doc) {
  const root = ROOTS.find((name) => isParamNode(doc?.[name])) || null;
  const igd = root === 'InternetGatewayDevice';
  const deviceId = doc._deviceId || {};

  const ipTr069Url = pick(doc, [
    'InternetGatewayDevice.ManagementServer.ConnectionRequestURL',
    'Device.ManagementServer.ConnectionRequestURL',
  ]);

  const ssidPaths = igd
    ? ['InternetGatewayDevice.LANDevice.*.WLANConfiguration.*.SSID']
    : ['Device.WiFi.SSID.*.SSID'];

  return {
    device_id: String(doc._id),
    data_model: root,
    username: toText(pick(doc, [
      'InternetGatewayDevice.WANDevice.*.WANConnectionDevice.*.WANPPPConnection.*.Username',
      'Device.PPP.Interface.*.Username',
    ]), 100),
    ip_pppoe: toText(pick(doc, [
      'InternetGatewayDevice.WANDevice.*.WANConnectionDevice.*.WANPPPConnection.*.ExternalIPAddress',
      'Device.PPP.Interface.*.IPCP.LocalIPAddress',
    ]), 64),
    ip_tr069: toText(hostFromUrl(ipTr069Url), 64),
    sn: toText(deviceId._SerialNumber, 100),
    pon: toText(pick(doc, [
      'InternetGatewayDevice.WANDevice.*.X_GponInterafceConfig.TransceiverType',
      'InternetGatewayDevice.WANDevice.*.WANCommonInterfaceConfig.WANAccessType',
      'Device.Optical.Interface.*.Name',
    ]), 100),
    manufacturer: toText(deviceId._Manufacturer, 100),
    tipe: toText(deviceId._ProductClass, 100),
    ssid: toText(pick(doc, ssidPaths), 100),
    wifi_users: igd
      ? sumValues(doc, 'InternetGatewayDevice.LANDevice.*.WLANConfiguration.*.TotalAssociations')
      : sumValues(doc, 'Device.WiFi.AccessPoint.*.AssociatedDeviceNumberOfEntries'),
    rx_power: toText(findLeaf(doc[root], /RXPower$/i), 20),
    temp: toText(findLeaf(doc[root], /(TransceiverTemperature|^Temperature)$/i), 20),
    uptime: toInt(pick(doc, ['InternetGatewayDevice.DeviceInfo.UpTime', 'Device.DeviceInfo.UpTime'])),
    last_inform: toDate(doc._lastInform),
    registered: toDate(doc._registered),
    tags: Array.isArray(doc._tags) && doc._tags.length > 0 ? toText(doc._tags.join(','), 500) : null,
  };
}

// ---- Status online ---------------------------------------------------------
function statusCutoffs(now = new Date()) {
  return {
    online: new Date(now.getTime() - ONLINE_WINDOW_MINUTES * 60 * 1000),
    day: new Date(now.getTime() - 24 * 60 * 60 * 1000),
  };
}

// ---- Tugas NBI -------------------------------------------------------------
// ?connection_request: ACS langsung menghubungi ONU. Bila ONU tidak terjangkau
// NBI membalas 202 dan task diantrikan sampai ONU inform berikutnya.
function taskBody(action, device) {
  switch (action) {
    case 'reboot':
      return { name: 'reboot' };
    case 'reset':
      return { name: 'factoryReset' };
    case 'summon':
      return { name: 'refreshObject', objectName: device.data_model || 'InternetGatewayDevice' };
    default:
      throw new Error(`Aksi tidak dikenal: ${action}`);
  }
}

// Summon hanya untuk ONU online (last_inform dalam jendela ONLINE_WINDOW_MINUTES).
// Sekalian membaca data model agar tidak perlu request NBI kedua.
async function readSummonTarget(server, deviceId) {
  const query = new URLSearchParams({
    query: JSON.stringify({ _id: deviceId }),
    projection: '_lastInform,InternetGatewayDevice.DeviceInfo,Device.DeviceInfo',
  });
  const { data } = await nbiRequest(server, 'GET', `/devices/?${query}`, { timeout: 8000 });
  const doc = Array.isArray(data) ? data[0] : null;
  if (!doc) {
    throw new NbiError('Perangkat tidak ditemukan di GenieACS', 404);
  }
  const lastInform = doc._lastInform ? new Date(doc._lastInform) : null;
  const online = Boolean(lastInform && !Number.isNaN(lastInform.getTime()) && lastInform >= statusCutoffs().online);
  if (!online) {
    throw new NbiError('Perangkat sedang offline, tidak dapat melakukan summon', 400, 'OFFLINE');
  }
  return {
    dataModel: ROOTS.find((name) => isParamNode(doc[name])) || 'InternetGatewayDevice',
  };
}

async function sendTask(server, deviceInput, action) {
  const device = { ...deviceInput };
  if (action === 'summon') {
    const target = await readSummonTarget(server, device.device_id);
    device.data_model = device.data_model || target.dataModel;
  }
  // Summon: fire-and-forget — GenieACS timeout=0 agar NBI segera 200/202 tanpa menunggu ONT.
  const waitMs = action === 'summon' ? 0 : 3000;
  const { status } = await postTask(server, device.device_id, taskBody(action, device), { waitMs });
  if (action === 'summon') {
    return 'Perintah masuk antrean';
  }
  return status === 202 ? 'Diantrikan, ONU belum merespons' : 'Terkirim';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// POST /devices/{id}/tasks?timeout={waitMs}&connection_request.
// waitMs=0 (Summon): GenieACS mengantrikan task + connection_request lalu segera membalas
// tanpa menunggu sesi ONT. waitMs>0: tunggu agar tugas bisa selesai (200) atau 202.
async function postTask(server, deviceId, body, { waitMs = 3000, retries = 2, connectionRequest = true } = {}) {
  const acsWait = Math.max(0, Number(waitMs) || 0);
  const flags = [`timeout=${acsWait}`];
  if (connectionRequest) {
    flags.push('connection_request');
  }
  const path = `/devices/${encodeURIComponent(deviceId)}/tasks?${flags.join('&')}`;
  // HTTP client harus menunggu lebih lama dari timeout GenieACS + buffer.
  const httpTimeout = Math.max(TASK_TIMEOUT_MS, acsWait + 20000);

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let result;
    try {
      // eslint-disable-next-line no-await-in-loop
      result = await nbiRequest(server, 'POST', path, { body, timeout: httpTimeout, allowBusy: true });
    } catch (error) {
      if (error.code === 'TIMEOUT') {
        throw new NbiError(
          `GenieACS belum membalas dalam ${Math.round(httpTimeout / 1000)} detik (ONU mungkin tidak terjangkau dari ACS). Perintah kemungkinan sudah diantrikan; cek di GenieACS lalu coba lagi.`,
          undefined,
          'TIMEOUT',
        );
      }
      throw error;
    }
    if (result.status === 404) {
      throw new NbiError('Perangkat tidak ditemukan di GenieACS (coba SINKRON)', 404);
    }
    if (result.status === 503) {
      lastError = new NbiError(
        'GenieACS sibuk (ONU sedang dalam sesi CWMP). Menunggu lalu mencoba lagi...',
        503,
        'BUSY',
      );
      // eslint-disable-next-line no-await-in-loop
      await sleep(2000);
      continue;
    }
    return result;
  }
  throw lastError || new NbiError('GenieACS sibuk (perangkat dalam sesi CWMP). Coba lagi sebentar.', 503, 'BUSY');
}

async function sendDeleteObject(server, deviceId, objectName) {
  const objectPath = normalizeAcsObjectName(objectName);
  const { status, data } = await postTask(
    server,
    deviceId,
    { name: 'deleteObject', objectName: objectPath },
    { waitMs: 3000, retries: 0, connectionRequest: true },
  );
  if (isParamNode(data) && data.fault) {
    const detail = [data.fault.code, data.fault.message].filter(Boolean).join(': ');
    throw new NbiError(`ONU menolak penghapusan${detail ? ` (${detail})` : ''}`, undefined, 'FAULT');
  }
  return { applied: status !== 202 };
}

// ---- WAN: arsitektur Queue-and-Fire ------------------------------------------------------------
// Tanpa jeda statis. Semua penantian adalah polling rapat (300 ms naik ke 1 detik) atau push GenieACS
// (?timeout), sehingga di LAN lokal selesai dalam hitungan ratusan milidetik dan di jaringan remote
// hanya menunggu selama ONU memang butuh waktu.
//
//   Fase 1 (Wait)       AddObject: POST ?connection_request&timeout -> instanceNumber di response (satu-satunya
//                       round-trip yang wajib karena nomor slot dibutuhkan).
//   Fase 2 (Batch Push) Parameter inti (Username, Password, VLAN, NAT, binding) = SATU task SetParameterValues
//                       yang hanya diantrekan (tanpa connection_request). Parameter berisiko (ConnectionType,
//                       ServiceList, Name) diantrekan sebagai task terpisah sesudahnya.
//   Fase 3 (Summon)     SATU Connection Request kosong di paling akhir. GenieACS menguras seluruh antrean
//                       dalam satu sesi TR-069. Hanya task inti yang ditunggu; task berisiko diselesaikan
//                       di latar belakang dan fault-nya dibuang sendiri tanpa memblokir respons.
const WAN_ADD_WAIT_MS = 15000;
const WAN_HTTP_SLACK_MS = 8000;
const WAN_ROLLBACK_WAIT_MS = 15000;
const WAN_POLL_START_MS = 300;
const WAN_POLL_MAX_MS = 1000;
const WAN_POLL_BUDGET_MS = 60000;
const WAN_ROLLBACK_POLL_BUDGET_MS = 20000;
const WAN_RISKY_GRACE_MS = 3000;
const WAN_RISKY_BUDGET_MS = 60000;
const WAN_PURGE_BUDGET_MS = 8000;
const WAN_STALE_TASK_MS = 2 * 60 * 1000;
const WAN_QUEUE_TIMEOUT_MS = 15000;

// Penanda waktu per langkah untuk log.
function wanTimer() {
  const startedAt = Date.now();
  const marks = [];
  return {
    mark(name) {
      marks.push(`${name}=${Date.now() - startedAt}ms`);
    },
    summary() {
      return marks.join(' ');
    },
  };
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// Interval polling: 300 ms, lalu naik bertahap sampai 1 detik.
function pollSteps() {
  let wait = WAN_POLL_START_MS;
  return () => {
    const current = wait;
    wait = Math.min(Math.round(wait * 1.4), WAN_POLL_MAX_MS);
    return current;
  };
}

function taskInstanceNumber(data) {
  if (!isParamNode(data) || data.instanceNumber == null || String(data.instanceNumber) === '') {
    return null;
  }
  return String(data.instanceNumber);
}

const COMMIT_LOOP_MESSAGE = 'Gagal: GenieACS menghentikan sesi karena too many commits. Antrean tugas perangkat ini dibersihkan agar server tidak macet.';

function commitLoopSeen(fault) {
  if (fault == null) {
    return false;
  }
  if (typeof fault === 'string') {
    return isCommitLoopFault({ message: fault });
  }
  const text = [fault.code, fault.message, formatAcsFault(fault, '')].filter(Boolean).join(' ');
  return isCommitLoopFault({ message: text, code: fault.code });
}

// Hapus satu task beserta fault-nya. Task yang fault tidak boleh tertinggal di antrean:
// GenieACS mengulangnya di setiap sesi dan menahan task berikutnya (AddObject baru ikut gagal/timeout).
// NBI membalas 503 selagi ONU masih dalam sesi CWMP; dengan budgetMs > 0 penghapusan diulang lewat
// polling sampai sesi selesai. Tidak pernah melempar error.
async function dropWanTask(server, deviceId, taskId, { budgetMs = 0 } = {}) {
  if (!taskId) {
    return;
  }
  const id = encodeURIComponent(String(taskId));
  const deadline = Date.now() + budgetMs;
  const step = pollSteps();
  for (;;) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await nbiRequest(server, 'DELETE', `/tasks/${id}`, { timeout: 8000 });
      break;
    } catch (error) {
      if (error.status === 404) {
        break;
      }
      if (error.status !== 503 || Date.now() >= deadline) {
        console.warn(`[ACS wan] hapus task ${taskId}: ${error.message}`);
        break;
      }
      // eslint-disable-next-line no-await-in-loop
      await delay(step());
    }
  }
  if (deviceId) {
    try {
      await nbiRequest(server, 'DELETE', `/faults/${encodeURIComponent(`${deviceId}:task_${taskId}`)}`, { timeout: 8000 });
    } catch (error) {
      if (error.status !== 404 && error.status !== 503) {
        console.warn(`[ACS wan] hapus fault ${taskId}: ${error.message}`);
      }
    }
  }
}

async function clearWanQueue(server, deviceId, taskId) {
  await dropWanTask(server, deviceId, taskId, { budgetMs: WAN_PURGE_BUDGET_MS });
  if (!deviceId) {
    return;
  }
  try {
    // NBI tertentu menolak bulk DELETE /tasks/?query (405), jadi daftar lalu hapus per ID.
    const query = new URLSearchParams({ query: JSON.stringify({ device: deviceId }), projection: '_id' });
    const { data } = await nbiRequest(server, 'GET', `/tasks/?${query}`, { timeout: 8000 });
    const ids = Array.isArray(data) ? data.map((item) => item?._id).filter(Boolean) : [];
    await Promise.all(ids.map((id) => dropWanTask(server, deviceId, id, { budgetMs: WAN_PURGE_BUDGET_MS })));
    console.warn(`[ACS wan] antrean ${deviceId} dibersihkan (${ids.length} task)`);
  } catch (error) {
    console.warn(`[ACS wan] bersihkan antrean ${deviceId}: ${error.message}`);
  }
}

// Sebelum operasi WAN: buang task berfault dan task basi (>2 menit) sisa operasi sebelumnya. Task seperti
// itu diulang GenieACS di setiap sesi dan memperlambat/menggagalkan task baru. Satu GET; tidak melempar error.
async function purgeStaleWanTasks(server, deviceId) {
  try {
    const query = new URLSearchParams({ query: JSON.stringify({ device: deviceId }) });
    const [{ data: tasks }, { data: faults }] = await Promise.all([
      nbiRequest(server, 'GET', `/tasks/?${query}`, { timeout: 8000 }),
      nbiRequest(server, 'GET', `/faults/?${query}`, { timeout: 8000 }).catch(() => ({ data: [] })),
    ]);
    const faulted = new Set((Array.isArray(faults) ? faults : []).map((fault) => String(fault?.channel || '').replace(/^task_/, '')));
    const now = Date.now();
    const stale = (Array.isArray(tasks) ? tasks : []).filter((task) => {
      const stamp = new Date(task?.timestamp).getTime();
      return task?._id && (task.fault || faulted.has(String(task._id)) || (Number.isFinite(stamp) && now - stamp > WAN_STALE_TASK_MS));
    });
    await Promise.all(stale.map((task) => dropWanTask(server, deviceId, task._id)));
    return stale.length;
  } catch (error) {
    console.warn(`[ACS wan] cek antrean ${deviceId}: ${error.message}`);
    return 0;
  }
}

function throwTaskFault(data) {
  if (isParamNode(data) && data.fault) {
    throw new NbiError(formatAcsFault(data.fault), undefined, commitLoopSeen(data.fault) ? 'COMMIT_LOOP' : 'FAULT');
  }
}

// Task yang ditolak ONU TIDAK memiliki field `fault` di koleksi tasks: ia tetap di antrean dan faultnya
// dicatat di koleksi faults (_id = "{device}:task_{id}", muncul <100 ms setelah ONU menolak). Karena itu
// tasks dan faults dibaca bersamaan (dua GET paralel) lalu digabung: task.fault terisi bila ditolak.
async function fetchWanTasks(server, ids, deviceId = null) {
  const taskQuery = new URLSearchParams({
    query: JSON.stringify({ _id: ids.length === 1 ? ids[0] : { $in: ids } }),
  });
  const faultQuery = new URLSearchParams({ query: JSON.stringify({ device: deviceId }) });
  const [tasksResult, faultsResult] = await Promise.all([
    nbiRequest(server, 'GET', `/tasks/?${taskQuery}`, { timeout: 20000 }),
    deviceId
      ? nbiRequest(server, 'GET', `/faults/?${faultQuery}`, { timeout: 8000 }).catch(() => ({ data: [] }))
      : Promise.resolve({ data: [] }),
  ]);
  const tasks = Array.isArray(tasksResult.data) ? tasksResult.data : [];
  const faults = new Map();
  for (const fault of Array.isArray(faultsResult.data) ? faultsResult.data : []) {
    const channel = String(fault?.channel || '');
    if (channel.startsWith('task_')) {
      faults.set(channel.slice('task_'.length), fault);
    }
  }
  return tasks.map((task) => (task.fault || !faults.has(String(task._id)) ? task : { ...task, fault: faults.get(String(task._id)) }));
}

async function recentDeviceFault(server, deviceId) {
  const query = new URLSearchParams({
    query: JSON.stringify({ device: deviceId }),
    sort: JSON.stringify({ timestamp: -1 }),
    limit: '1',
  });
  try {
    const { data } = await nbiRequest(server, 'GET', `/faults/?${query}`, { timeout: 8000 });
    const fault = Array.isArray(data) ? data[0] : null;
    if (!fault) {
      return '';
    }
    const stamp = new Date(fault.timestamp).getTime();
    if (!Number.isFinite(stamp) || Date.now() - stamp > 2 * 60 * 1000) {
      return '';
    }
    return formatAcsFault(fault, '');
  } catch {
    return '';
  }
}

// Menunggu satu task sampai hilang dari antrean (selesai), membawa fault, atau waktu habis.
// Pengecekan pertama langsung, sesudahnya polling rapat. Mengembalikan task (bila membawa instanceNumber)
// atau null (selesai).
async function pollWanTask(server, deviceId, taskId, budgetMs = WAN_POLL_BUDGET_MS) {
  const deadline = Date.now() + budgetMs;
  const step = pollSteps();
  for (;;) {
    let task = null;
    let readable = true;
    try {
      // eslint-disable-next-line no-await-in-loop
      [task = null] = await fetchWanTasks(server, [taskId], deviceId);
    } catch (error) {
      readable = false;
      console.warn(`[ACS wan] cek task ${taskId}: ${error.message}`);
    }
    if (readable) {
      if (!task) {
        return null;
      }
      if (commitLoopSeen(task.fault)) {
        // eslint-disable-next-line no-await-in-loop
        await clearWanQueue(server, deviceId, taskId);
        throw new NbiError(COMMIT_LOOP_MESSAGE, undefined, 'COMMIT_LOOP');
      }
      if (task.fault) {
        // eslint-disable-next-line no-await-in-loop
        await dropWanTask(server, deviceId, taskId, { budgetMs: WAN_PURGE_BUDGET_MS });
      }
      throwTaskFault(task);
      if (taskInstanceNumber(task)) {
        return task;
      }
    }
    if (Date.now() >= deadline) {
      break;
    }
    // eslint-disable-next-line no-await-in-loop
    await delay(step());
  }
  const faultText = await recentDeviceFault(server, deviceId);
  if (commitLoopSeen(faultText)) {
    await clearWanQueue(server, deviceId, taskId);
    throw new NbiError(COMMIT_LOOP_MESSAGE, undefined, 'COMMIT_LOOP');
  }
  // Task yang tak selesai dalam batas waktu dibuang agar tidak jalan terlambat dan meninggalkan WAN yatim.
  await dropWanTask(server, deviceId, taskId, { budgetMs: WAN_PURGE_BUDGET_MS });
  throw new NbiError(
    faultText
      ? `ONU menolak perintah TR-069. ${faultText}`
      : 'Perintah masih antre di GenieACS dan sesi TR-069 belum selesai dalam batas waktu. Coba lagi beberapa saat lagi.',
    undefined,
    faultText ? 'FAULT' : 'PENDING',
  );
}

// Task yang butuh hasil langsung (AddObject / DeleteObject): satu POST membawa task + connection request.
// GenieACS membalas 200 begitu ONU selesai (instanceNumber ikut di response); 202 = belum selesai, lalu polling.
async function postWanTask(server, deviceId, body, { waitMs = WAN_ADD_WAIT_MS, pollBudget = WAN_POLL_BUDGET_MS } = {}) {
  const httpMs = waitMs + WAN_HTTP_SLACK_MS;
  const path = `/devices/${encodeURIComponent(deviceId)}/tasks?timeout=${waitMs}&connection_request`;
  let result;
  try {
    result = await nbiRequest(server, 'POST', path, { body, timeout: httpMs });
  } catch (error) {
    if (error instanceof NbiError && error.code === 'TIMEOUT') {
      const faultText = await recentDeviceFault(server, deviceId);
      if (commitLoopSeen(faultText)) {
        await clearWanQueue(server, deviceId);
        throw new NbiError(COMMIT_LOOP_MESSAGE, undefined, 'COMMIT_LOOP');
      }
      throw new NbiError(
        faultText
          ? `GenieACS belum selesai, dan ONU mencatat fault TR-069. ${faultText}`
          : `GenieACS belum membalas dalam ${Math.round(httpMs / 1000)} detik. Perintah kemungkinan masih antre.`,
        undefined,
        faultText ? 'FAULT' : 'TIMEOUT',
      );
    }
    throw error;
  }
  if (result.status === 404) {
    throw new NbiError('Perangkat tidak ditemukan di GenieACS (coba SINKRON)', 404);
  }
  if (commitLoopSeen(result.data?.fault)) {
    await clearWanQueue(server, deviceId, result.data?._id);
    throw new NbiError(COMMIT_LOOP_MESSAGE, undefined, 'COMMIT_LOOP');
  }
  if (isParamNode(result.data) && result.data.fault) {
    await dropWanTask(server, deviceId, result.data._id, { budgetMs: WAN_PURGE_BUDGET_MS });
  }
  throwTaskFault(result.data);
  if (result.status === 202) {
    const taskId = isParamNode(result.data) ? result.data._id : null;
    if (!taskId) {
      throw new NbiError('GenieACS mengantrikan perintah tanpa ID task, sehingga statusnya tidak bisa dipantau.', undefined, 'PENDING');
    }
    const polled = await pollWanTask(server, deviceId, String(taskId), pollBudget);
    return { status: 200, data: polled };
  }
  return result;
}

// Fase 2: masukkan task ke antrean NBI TANPA connection_request (balasan 202 + ID task, beberapa ms).
async function queueWanTask(server, deviceId, body) {
  const path = `/devices/${encodeURIComponent(deviceId)}/tasks`;
  const result = await nbiRequest(server, 'POST', path, { body, timeout: WAN_QUEUE_TIMEOUT_MS, allowBusy: true });
  if (result.status === 404) {
    throw new NbiError('Perangkat tidak ditemukan di GenieACS (coba SINKRON)', 404);
  }
  const taskId = isParamNode(result.data) ? result.data._id : null;
  if (!taskId) {
    throw new NbiError('GenieACS tidak mengembalikan ID task, sehingga statusnya tidak bisa dipantau.', undefined, 'PENDING');
  }
  return String(taskId);
}

// Fase 3: satu Connection Request kosong (tanpa task). 200 = ONU menjawab; 202 = ONU belum terjangkau,
// task menunggu periodic inform. Dilempar hanya bila ACS sendiri tidak bisa dihubungi.
async function fireConnectionRequest(server, deviceId) {
  const path = `/devices/${encodeURIComponent(deviceId)}/tasks?connection_request`;
  const result = await nbiRequest(server, 'POST', path, { timeout: 20000, allowBusy: true });
  if (result.status === 404) {
    throw new NbiError('Perangkat tidak ditemukan di GenieACS (coba SINKRON)', 404);
  }
  return { reached: result.status === 200, status: result.status };
}

function parameterLeaf(row) {
  return String(row?.[0] || '').split('.').pop() || 'parameter';
}

// Pantau task berisiko (Fase 2). Satu GET per putaran untuk semua task. Mengembalikan:
//   applied  = nama parameter yang sudah selesai (hilang dari antrean)
//   rejected = [{ name, reason }] task yang fault (langsung dibuang dari antrean)
//   pending  = item yang belum selesai sampai batas waktu
async function watchRiskyTasks(server, deviceId, items, budgetMs) {
  const deadline = Date.now() + budgetMs;
  const step = pollSteps();
  const applied = [];
  const rejected = [];
  let pending = items.slice();
  while (pending.length > 0) {
    let tasks = null;
    try {
      // eslint-disable-next-line no-await-in-loop
      tasks = await fetchWanTasks(server, pending.map((item) => item.id), deviceId);
    } catch (error) {
      console.warn(`[ACS wan] cek task berisiko ${deviceId}: ${error.message}`);
    }
    if (tasks) {
      const byId = new Map(tasks.map((task) => [String(task._id), task]));
      const stillPending = [];
      for (const item of pending) {
        const task = byId.get(item.id);
        if (!task) {
          applied.push(item.name);
        } else if (task.fault) {
          rejected.push({ name: item.name, reason: formatAcsFault(task.fault) });
          // Dibuang di latar belakang: bila sesi ONU masih berjalan, penghapusan diulang sampai sesi selesai.
          dropWanTask(server, deviceId, item.id, { budgetMs: WAN_RISKY_BUDGET_MS });
        } else {
          stillPending.push(item);
        }
      }
      pending = stillPending;
    }
    if (pending.length === 0 || Date.now() >= deadline) {
      break;
    }
    // eslint-disable-next-line no-await-in-loop
    await delay(step());
  }
  return { applied, rejected, pending };
}

async function purgeWanTasks(server, deviceId, ids) {
  await Promise.all(ids.filter(Boolean).map((id) => dropWanTask(server, deviceId, id, { budgetMs: WAN_PURGE_BUDGET_MS })));
}

function logWanPayload(label, rows) {
  const logged = rows.map(([path, value, type]) => [
    path,
    /password/i.test(String(path).split('.').pop()) ? '***' : value,
    type,
  ]);
  console.log(label, JSON.stringify(logged));
}

// Paksa ONU membaca ulang node tertentu (refreshObject) agar nilai yang kosong di cache GenieACS terisi.
// Queue-and-Fire: semua node diantrekan dulu, satu Connection Request, lalu polling rapat sampai task selesai
// atau budget habis. Task yang belum selesai dibuang supaya tidak menumpuk di antrean ONU yang lambat.
// Tidak melempar error ONU: hasilnya { refreshed: [...], failed: [{ name, reason }], pending: [...] }.
async function refreshDeviceObjects(server, deviceId, objectNames, { budgetMs = 8000 } = {}) {
  const names = [...new Set((Array.isArray(objectNames) ? objectNames : []).map((name) => String(name).trim()).filter(Boolean))];
  const result = { refreshed: [], failed: [], pending: [] };
  if (names.length === 0) {
    return result;
  }
  const queued = [];
  await Promise.all(names.map(async (name) => {
    try {
      const id = await queueWanTask(server, deviceId, { name: 'refreshObject', objectName: name });
      queued.push({ id, name });
    } catch (error) {
      result.failed.push({ name, reason: error.message });
    }
  }));
  if (queued.length === 0) {
    return result;
  }
  try {
    await fireConnectionRequest(server, deviceId);
  } catch (error) {
    await purgeWanTasks(server, deviceId, queued.map((item) => item.id));
    result.failed.push(...queued.map((item) => ({ name: item.name, reason: error.message })));
    return result;
  }
  const settled = await watchRiskyTasks(server, deviceId, queued, budgetMs);
  result.refreshed = settled.applied;
  result.failed.push(...settled.rejected);
  result.pending = settled.pending.map((item) => item.name);
  await purgeWanTasks(server, deviceId, settled.pending.map((item) => item.id));
  return result;
}

// Queue-and-Fire untuk satu batch WAN.
//   core  = parameter inti, satu task SetParameterValues (ditunggu hasilnya).
//   risky = array grup baris ([[row], [row], ...]); tiap grup menjadi task sendiri, tidak ditunggu lama.
// Hasil: { applied: true, risky: { applied: [], rejected: [{ name, reason }], pending: [] } }.
// Bila task inti gagal, seluruh task yang kita antrekan dibuang dari antrean lalu error dilempar.
async function queueAndFireWanBatch(server, deviceId, { core = [], risky = [], budgetMs = WAN_POLL_BUDGET_MS } = {}) {
  const coreRows = sanitizeParameterValues(core);
  const riskyGroups = risky.map((rows) => sanitizeParameterValues(rows)).filter((rows) => rows.length > 0);
  const queueFailures = [];
  if (coreRows.length === 0 && riskyGroups.length === 0) {
    return { applied: true, risky: { applied: [], rejected: [], pending: [] } };
  }

  // Fase 2: antrekan. Task inti lebih dulu (urutan antrean = urutan eksekusi), task berisiko menyusul paralel.
  let coreId = null;
  if (coreRows.length > 0) {
    logWanPayload('PAYLOAD TR-069 (inti):', coreRows);
    coreId = await queueWanTask(server, deviceId, { name: 'setParameterValues', parameterValues: coreRows });
  }
  const queuedRisky = [];
  await Promise.all(riskyGroups.map(async (rows) => {
    logWanPayload('PAYLOAD TR-069 (berisiko):', rows);
    try {
      const id = await queueWanTask(server, deviceId, { name: 'setParameterValues', parameterValues: rows });
      queuedRisky.push({ id, name: parameterLeaf(rows[0]), rows });
    } catch (error) {
      console.warn(`[ACS wan] antre ${parameterLeaf(rows[0])} ${deviceId}: ${error.message}`);
      queueFailures.push({ name: parameterLeaf(rows[0]), reason: error.message });
    }
  }));
  const riskyIds = queuedRisky.map((item) => item.id);

  // Fase 3: satu Connection Request sesudah semua task masuk antrean.
  try {
    const fired = await fireConnectionRequest(server, deviceId);
    if (!fired.reached) {
      console.warn(`[ACS wan] ${deviceId}: ONU belum menjawab Connection Request, task menunggu inform berikutnya`);
    }
  } catch (error) {
    await purgeWanTasks(server, deviceId, [coreId, ...riskyIds]);
    throw error;
  }

  if (coreId) {
    try {
      await pollWanTask(server, deviceId, coreId, budgetMs);
    } catch (error) {
      // Task berisiko tidak boleh tertinggal dan jalan di instance yang akan di-rollback.
      await purgeWanTasks(server, deviceId, riskyIds);
      throw error;
    }
  }

  // Task berisiko berjalan di sesi yang sama tepat setelah task inti: beri jendela singkat (polling, bukan
  // jeda) supaya hasilnya ikut dilaporkan. Sisanya diselesaikan di latar belakang tanpa menahan respons.
  const settled = await watchRiskyTasks(server, deviceId, queuedRisky, WAN_RISKY_GRACE_MS);
  if (settled.pending.length > 0) {
    watchRiskyTasks(server, deviceId, settled.pending, WAN_RISKY_BUDGET_MS)
      .then(async (late) => {
        await purgeWanTasks(server, deviceId, late.pending.map((item) => item.id));
        const parts = [];
        if (late.rejected.length) {
          parts.push(`ditolak ${late.rejected.map((item) => `${item.name} (${item.reason})`).join(', ')}`);
        }
        if (late.pending.length) {
          parts.push(`tidak selesai ${late.pending.map((item) => item.name).join(', ')}`);
        }
        if (parts.length) {
          console.warn(`[ACS wan] latar belakang ${deviceId}: ${parts.join('; ')}`);
        }
      })
      .catch((error) => console.warn(`[ACS wan] latar belakang ${deviceId}: ${error.message}`));
  }
  return {
    applied: true,
    risky: {
      applied: settled.applied,
      rejected: [...queueFailures, ...settled.rejected],
      pending: settled.pending.map((item) => item.name),
    },
  };
}

async function sendWanAddObject(server, deviceId, objectName) {
  const objectPath = normalizeAcsObjectName(objectName);
  console.log('ADDOBJECT TR-069:', objectPath);
  const { data } = await postWanTask(server, deviceId, { name: 'addObject', objectName: objectPath });
  return { applied: true, instanceNumber: taskInstanceNumber(data) };
}

async function readWanChildIndexes(server, deviceId, wanDeviceIndex, connectionIndex, childName = 'WANPPPConnection') {
  const base = `InternetGatewayDevice.WANDevice.${wanDeviceIndex}.WANConnectionDevice`;
  const projection = connectionIndex ? `${base}.${connectionIndex}.${childName}` : base;
  const query = new URLSearchParams({
    query: JSON.stringify({ _id: deviceId }),
    projection,
  });
  const { data } = await nbiRequest(server, 'GET', `/devices/?${query}`, { timeout: 8000 });
  const doc = Array.isArray(data) ? data[0] : null;
  const connectionNode = doc?.InternetGatewayDevice?.WANDevice?.[wanDeviceIndex]?.WANConnectionDevice;
  if (connectionIndex) {
    return numericInstanceKeys(connectionNode?.[connectionIndex]?.[childName]);
  }
  return numericInstanceKeys(connectionNode);
}

// Indeks sebelum AddObject dibaca bersamaan dengan AddObject (bukan berurutan): pembacaan DB ACS selesai
// jauh sebelum ONU membuat instance, jadi hasilnya tetap "sebelum". Hanya ditunggu bila response AddObject
// tanpa instanceNumber. Gagal baca = daftar kosong.
function startIndexRead(readIndexes) {
  return readIndexes().catch(() => []);
}

async function resolveNewIndex(readIndexes, previous) {
  const known = new Set(previous);
  const step = pollSteps();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (attempt > 0) {
      await delay(step());
    }
    const current = await readIndexes();
    const added = current.filter((key) => !known.has(key)).sort((left, right) => Number(left) - Number(right));
    if (added.length > 0) {
      return added[added.length - 1];
    }
  }
  return null;
}

// Konfigurasi WLAN saat ini dari ACS: { model, wlanNode }. model = 'InternetGatewayDevice' (TR-098)
// atau 'Device' (TR-181); wlanNode = node LANDevice.1.WLANConfiguration.{wlanId} (hanya TR-098).
// null bila perangkat tidak ada di ACS.
async function readWlanTarget(server, deviceId, wlanId) {
  const query = new URLSearchParams({
    query: JSON.stringify({ _id: deviceId }),
    projection: `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${wlanId},Device.DeviceInfo`,
  });
  const { data } = await nbiRequest(server, 'GET', `/devices/?${query}`, { timeout: 8000 });
  const doc = Array.isArray(data) ? data[0] : null;
  if (!doc) {
    return null;
  }
  const wlanNode = doc.InternetGatewayDevice?.LANDevice?.[1]?.WLANConfiguration?.[wlanId];
  return {
    model: wlanNode ? 'InternetGatewayDevice' : (isParamNode(doc.Device) ? 'Device' : 'InternetGatewayDevice'),
    wlanNode: isParamNode(wlanNode) ? wlanNode : undefined,
  };
}

// Konfigurasi LAN saat ini dari ACS: { model, lanNode } (lanNode = LANDevice.1.LANHostConfigManagement,
// hanya TR-098). null bila perangkat tidak ada di ACS.
async function readLanTarget(server, deviceId) {
  const query = new URLSearchParams({
    query: JSON.stringify({ _id: deviceId }),
    projection: `InternetGatewayDevice.LANDevice.1.LANHostConfigManagement,Device.DeviceInfo`,
  });
  const { data } = await nbiRequest(server, 'GET', `/devices/?${query}`, { timeout: 8000 });
  const doc = Array.isArray(data) ? data[0] : null;
  if (!doc) {
    return null;
  }
  const lanNode = doc.InternetGatewayDevice?.LANDevice?.[1]?.LANHostConfigManagement;
  return {
    model: lanNode ? 'InternetGatewayDevice' : (isParamNode(doc.Device) ? 'Device' : 'InternetGatewayDevice'),
    lanNode: isParamNode(lanNode) ? lanNode : undefined,
  };
}

// Mengirim task setParameterValues. parameterValues = [[path, nilai, tipe], ...].
// Hasil: { applied: true } bila ONU sudah menerapkan, { applied: false } bila hanya diantrikan.
async function sendSetParameterValues(server, deviceId, parameterValues) {
  const { status, data } = await postTask(server, deviceId, { name: 'setParameterValues', parameterValues });
  // Bila ONU menolak nilainya (fault TR-069), GenieACS melaporkannya pada task.
  if (isParamNode(data) && data.fault) {
    const detail = [data.fault.code, data.fault.message].filter(Boolean).join(': ');
    throw new NbiError(`ONU menolak perubahan${detail ? ` (${detail})` : ''}`, undefined, 'FAULT');
  }
  return { applied: status !== 202 };
}

function numericInstanceKeys(node) {
  if (!isParamNode(node)) {
    return [];
  }
  return Object.keys(node).filter((key) => /^\d+$/.test(key)).sort((left, right) => Number(left) - Number(right));
}

function manufacturerText(value) {
  if (value === undefined || value === null) {
    return '';
  }
  return String(value).trim().slice(0, 200);
}

// Konteks WAN untuk membuat koneksi PPP: merek dari DeviceInfo.Manufacturer (cadangan _deviceId),
// indeks WANDevice, dan WANConnectionDevice pertama bila sudah ada.
async function readWanTarget(server, deviceId) {
  const query = new URLSearchParams({
    query: JSON.stringify({ _id: deviceId }),
    projection: [
      '_deviceId',
      'InternetGatewayDevice.DeviceInfo.Manufacturer',
      'InternetGatewayDevice.DeviceInfo.ModelName',
      'InternetGatewayDevice.DeviceInfo.ProductClass',
      'InternetGatewayDevice.WANDevice',
      'Device.DeviceInfo.Manufacturer',
      'Device.DeviceInfo.ModelName',
      'Device.DeviceInfo.ProductClass',
      'Device.PPP.Interface',
    ].join(','),
  });
  const { data } = await nbiRequest(server, 'GET', `/devices/?${query}`, { timeout: 8000 });
  const doc = Array.isArray(data) ? data[0] : null;
  if (!doc) {
    return null;
  }
  const igd = isParamNode(doc.InternetGatewayDevice) ? doc.InternetGatewayDevice : null;
  const tr181 = isParamNode(doc.Device) ? doc.Device : null;
  const manufacturer = manufacturerText(
    igd?.DeviceInfo?.Manufacturer?._value
    ?? tr181?.DeviceInfo?.Manufacturer?._value
    ?? doc._deviceId?._Manufacturer,
  );
  const productClass = manufacturerText(
    igd?.DeviceInfo?.ProductClass?._value
    ?? tr181?.DeviceInfo?.ProductClass?._value
    ?? doc._deviceId?._ProductClass,
  );
  const productModel = manufacturerText(
    igd?.DeviceInfo?.ModelName?._value
    ?? tr181?.DeviceInfo?.ModelName?._value
    ?? productClass,
  );
  const profile = vendorProfile(manufacturer);
  const hasWan = numericInstanceKeys(igd?.WANDevice).length > 0;
  const location = hasWan
    ? selectWanLocation(igd.WANDevice, profile)
    : selectTr181Location(tr181);
  return {
    model: hasWan ? 'InternetGatewayDevice' : (tr181 ? 'Device' : 'InternetGatewayDevice'),
    manufacturer,
    productModel,
    productClass,
    profile,
    ...location,
  };
}

// Membuat instance WANPPPConnection. Huawei menaruh VLAN di koneksi PPP, jadi instance baru
// ditambahkan pada WANConnectionDevice yang sudah ada. Merek lain (VLAN di link GPON/EPON)
// mendapat WANConnectionDevice baru lalu WANPPPConnection di bawahnya.
async function readTr181PppIndexes(server, deviceId) {
  const query = new URLSearchParams({
    query: JSON.stringify({ _id: deviceId }),
    projection: 'Device.PPP.Interface',
  });
  const { data } = await nbiRequest(server, 'GET', `/devices/?${query}`, { timeout: 8000 });
  const doc = Array.isArray(data) ? data[0] : null;
  return numericInstanceKeys(doc?.Device?.PPP?.Interface);
}

async function createTr181PppInstance(server, deviceId) {
  const before = await readTr181PppIndexes(server, deviceId);
  const created = await sendWanAddObject(server, deviceId, 'Device.PPP.Interface.');
  const pppIndex = created.instanceNumber || await resolveNewIndex(
    () => readTr181PppIndexes(server, deviceId),
    before,
  );
  if (!pppIndex) {
    throw new NbiError(
      'AddObject Device.PPP.Interface selesai tanpa nomor instance. Path TR-181 ini mungkin tidak didukung model ONU.',
      undefined,
      'FAULT',
    );
  }
  const pppPath = `Device.PPP.Interface.${pppIndex}.`;
  return { connectionPath: pppPath, pppPath, rollbackPath: pppPath };
}

async function createWanPppInstance(server, deviceId, options) {
  if (options.tr181 || options.profile === 'tr181') {
    return createTr181PppInstance(server, deviceId);
  }
  const { wanDeviceIndex, createConnectionDevice } = options;
  const createdConnectionDevice = Boolean(createConnectionDevice || !options.connectionIndex);
  if (!wanDeviceIndex) {
    throw new NbiError(
      'Struktur WAN tidak ditemukan pada perangkat. Jalankan Summon lalu coba lagi.',
      undefined,
      'FAULT',
    );
  }
  const deviceRoot = `InternetGatewayDevice.WANDevice.${wanDeviceIndex}.WANConnectionDevice`;
  let connectionIndex = options.connectionIndex || null;
  if (createdConnectionDevice || !connectionIndex) {
    const beforePromise = startIndexRead(() => readWanChildIndexes(server, deviceId, wanDeviceIndex));
    const created = await sendWanAddObject(server, deviceId, `${deviceRoot}.`);
    connectionIndex = created.instanceNumber || await resolveNewIndex(
      () => readWanChildIndexes(server, deviceId, wanDeviceIndex),
      await beforePromise,
    );
    if (!connectionIndex) {
      throw new NbiError(
        `AddObject ${deviceRoot}. selesai tanpa nomor instance. Path ini mungkin tidak ada pada model ONU.`,
        undefined,
        'FAULT',
      );
    }
  }
  const beforePpp = startIndexRead(() => readWanChildIndexes(server, deviceId, wanDeviceIndex, connectionIndex));
  const createdPpp = await sendWanAddObject(server, deviceId, `${deviceRoot}.${connectionIndex}.WANPPPConnection.`);
  const pppIndex = createdPpp.instanceNumber || await resolveNewIndex(
    () => readWanChildIndexes(server, deviceId, wanDeviceIndex, connectionIndex),
    await beforePpp,
  );
  if (!pppIndex) {
    throw new NbiError(
      `AddObject ${deviceRoot}.${connectionIndex}.WANPPPConnection. selesai tanpa nomor instance. Path ini mungkin tidak ada pada model ONU.`,
      undefined,
      'FAULT',
    );
  }
  const connectionPath = `${deviceRoot}.${connectionIndex}.`;
  const pppPath = `${connectionPath}WANPPPConnection.${pppIndex}.`;
  return {
    connectionPath,
    pppPath,
    rollbackPath: createdConnectionDevice ? connectionPath : pppPath,
  };
}

// Instance WANIPConnection pada WANConnectionDevice yang sama dengan koneksi yang sudah ada.
// Indeks WANDevice tidak dikunci ke 1: ONU ZTE lain menaruh layanan di WANDevice yang lebih tinggi.
async function createWanIpInstance(server, deviceId, options) {
  if (options.tr181 || options.profile === 'tr181') {
    throw new NbiError(
      'Model TR-181 belum mendukung pembuatan WAN IP dari form ini.',
      undefined,
      'FAULT',
    );
  }
  const { wanDeviceIndex, createConnectionDevice } = options;
  const createdConnectionDevice = Boolean(createConnectionDevice || !options.connectionIndex);
  if (!wanDeviceIndex) {
    throw new NbiError(
      'Struktur WAN tidak ditemukan pada perangkat. Jalankan Summon lalu coba lagi.',
      undefined,
      'FAULT',
    );
  }
  const deviceRoot = `InternetGatewayDevice.WANDevice.${wanDeviceIndex}.WANConnectionDevice`;
  let connectionIndex = options.connectionIndex || null;
  if (createdConnectionDevice || !connectionIndex) {
    const beforePromise = startIndexRead(() => readWanChildIndexes(server, deviceId, wanDeviceIndex));
    const created = await sendWanAddObject(server, deviceId, `${deviceRoot}.`);
    connectionIndex = created.instanceNumber || await resolveNewIndex(
      () => readWanChildIndexes(server, deviceId, wanDeviceIndex),
      await beforePromise,
    );
    if (!connectionIndex) {
      throw new NbiError(
        `AddObject ${deviceRoot}. selesai tanpa nomor instance. Path ini mungkin tidak ada pada model ONU.`,
        undefined,
        'FAULT',
      );
    }
  }
  const beforeIp = startIndexRead(() => readWanChildIndexes(server, deviceId, wanDeviceIndex, connectionIndex, 'WANIPConnection'));
  const createdIp = await sendWanAddObject(server, deviceId, `${deviceRoot}.${connectionIndex}.WANIPConnection.`);
  const ipIndex = createdIp.instanceNumber || await resolveNewIndex(
    () => readWanChildIndexes(server, deviceId, wanDeviceIndex, connectionIndex, 'WANIPConnection'),
    await beforeIp,
  );
  if (!ipIndex) {
    throw new NbiError(
      `AddObject ${deviceRoot}.${connectionIndex}.WANIPConnection. selesai tanpa nomor instance. Path ini mungkin tidak ada pada model ONU.`,
      undefined,
      'FAULT',
    );
  }
  const connectionPath = `${deviceRoot}.${connectionIndex}.`;
  const ipPath = `${connectionPath}WANIPConnection.${ipIndex}.`;
  return {
    connectionPath,
    ipPath,
    rollbackPath: createdConnectionDevice ? connectionPath : ipPath,
  };
}

// Menghapus satu instance objek TR-069 (DeleteObject). Titik di akhir path dibuang.
// Hasil: { applied: true } bila ONU sudah menghapus, { applied: false } bila hanya diantrikan.
async function sendWanDeleteObject(server, deviceId, objectName, { rollback = false } = {}) {
  const objectPath = normalizeAcsObjectName(objectName);
  console.log('DELETEOBJECT TR-069:', objectPath);
  await postWanTask(
    server,
    deviceId,
    { name: 'deleteObject', objectName: objectPath },
    rollback ? { waitMs: WAN_ROLLBACK_WAIT_MS, pollBudget: WAN_ROLLBACK_POLL_BUDGET_MS } : {},
  );
  return { applied: true };
}

async function deleteRemoteDevice(server, device) {
  // 404 = sudah tidak ada di ACS, dianggap berhasil.
  await nbiRequest(server, 'DELETE', `/devices/${encodeURIComponent(device.device_id)}`);
}

module.exports = {
  DEFAULT_NBI_PORT,
  MAX_SERVER_NAME,
  MAX_HOST_LENGTH,
  ONLINE_WINDOW_MINUTES,
  NbiError,
  ensureTables,
  normalizeHost,
  normalizePort,
  fetchAllDevices,
  mapDevice,
  statusCutoffs,
  sendTask,
  readWlanTarget,
  readLanTarget,
  sendSetParameterValues,
  queueAndFireWanBatch,
  refreshDeviceObjects,
  purgeStaleWanTasks,
  sendWanDeleteObject,
  sendDeleteObject,
  readWanTarget,
  wanTimer,
  createWanPppInstance,
  createWanIpInstance,
  deleteRemoteDevice,
};
