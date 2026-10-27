const net = require('net');
const pool = require('../database');
const {
  formatAcsFault, selectWanLocation, selectTr181Location, vendorProfile, normalizeAcsObjectName, sanitizeParameterValues,
} = require('./acs_wan');

// ---- Konstanta -------------------------------------------------------------
const DEFAULT_NBI_PORT = 7557;
const MAX_SERVER_NAME = 100;
const MAX_HOST_LENGTH = 100;
// Perangkat dianggap ONLINE bila inform terakhirnya tidak lebih lama dari ini.
// Sesuaikan dengan Periodic Inform Interval ONU (bisa diubah lewat env).
const ONLINE_WINDOW_MINUTES = Math.max(parseInt(process.env.ACS_ONLINE_MINUTES, 10) || 30, 1);
const NBI_TIMEOUT_MS = 15000;
// Batas tunggu tugas (Summon/Reboot/Reset). Dengan ?connection_request, GenieACS lebih dulu menghubungi
// ONU dan bisa lama bila ONU tidak terjangkau, jadi lebih longgar dari permintaan biasa.
const TASK_TIMEOUT_MS = Math.max(parseInt(process.env.ACS_TASK_TIMEOUT_MS, 10) || 30000, 1000);
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

async function nbiRequest(server, method, path, { body, timeout = NBI_TIMEOUT_MS } = {}) {
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
    if (!response.ok && response.status !== 404) {
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

// ONLINE bila inform terakhir masih di dalam jendela ACS_ONLINE_MINUTES.
function isDeviceOnline(lastInform, now = new Date()) {
  const date = lastInform instanceof Date ? lastInform : toDate(lastInform);
  if (!date || Number.isNaN(date.getTime())) {
    return false;
  }
  return date.getTime() >= statusCutoffs(now).online.getTime();
}

// _lastInform langsung dari NBI. null bila perangkat tidak ada di GenieACS.
async function readLastInform(server, deviceId) {
  const query = new URLSearchParams({
    query: JSON.stringify({ _id: deviceId }),
    projection: '_id,_lastInform',
  });
  const { data } = await nbiRequest(server, 'GET', `/devices/?${query}`, { timeout: 8000 });
  const doc = Array.isArray(data) ? data[0] : null;
  if (!doc || doc._id === undefined || doc._id === null) {
    return null;
  }
  return { lastInform: toDate(doc._lastInform) };
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

// Root data model ONU (TR-098 atau TR-181), dibaca dari subtree DeviceInfo.
async function detectDataModel(server, deviceId) {
  const query = new URLSearchParams({
    query: JSON.stringify({ _id: deviceId }),
    projection: 'InternetGatewayDevice.DeviceInfo,Device.DeviceInfo',
  });
  const { data } = await nbiRequest(server, 'GET', `/devices/?${query}`, { timeout: 8000 });
  const doc = Array.isArray(data) ? data[0] : null;
  return ROOTS.find((name) => isParamNode(doc?.[name])) || 'InternetGatewayDevice';
}

async function sendTask(server, deviceInput, action) {
  const device = { ...deviceInput };
  if (action === 'summon' && !device.data_model) {
    device.data_model = await detectDataModel(server, device.device_id);
  }
  const { status } = await postTask(server, device.device_id, taskBody(action, device));
  if (action === 'summon') {
    // 200 = connection request selesai, 202 = tugas masuk antrean GenieACS.
    return status === 202 ? 'Summon berhasil diantrekan' : 'Summon berhasil dikirim';
  }
  return status === 202 ? 'Diantrikan, ONU belum merespons' : 'Terkirim';
}

// POST /devices/{id}/tasks?timeout=3000&connection_request. Status 200 = tugas selesai dikerjakan ONU,
// 202 = diantrikan (ONU belum merespons). Mengembalikan { status, data }.
async function postTask(server, deviceId, body) {
  const path = `/devices/${encodeURIComponent(deviceId)}/tasks?timeout=3000&connection_request`;
  let result;
  try {
    result = await nbiRequest(server, 'POST', path, { body, timeout: TASK_TIMEOUT_MS });
  } catch (error) {
    if (error.code === 'TIMEOUT') {
      // Permintaan sudah terkirim; GenieACS biasanya sudah mengantrikan tugasnya sebelum menunggu ONU.
      throw new NbiError(
        `GenieACS belum membalas dalam ${Math.round(TASK_TIMEOUT_MS / 1000)} detik (ONU mungkin tidak terjangkau dari ACS). Perintah kemungkinan sudah diantrikan; cek di GenieACS lalu coba lagi.`,
        undefined,
        'TIMEOUT',
      );
    }
    throw error;
  }
  if (result.status === 404) {
    throw new NbiError('Perangkat tidak ditemukan di GenieACS (coba SINKRON)', 404);
  }
  return result;
}

// Tugas WAN PPP menunggu sesi TR-069 lebih lama daripada Summon biasa.
// GenieACS ?timeout= dalam milidetik: bila ONU belum selesai, NBI membalas 202 dan task tetap antre.
const WAN_TASK_TIMEOUT_MS = 30000;
const WAN_HTTP_TIMEOUT_MS = 35000;
const WAN_WAKE_TIMEOUT_MS = 10000;
const WAN_WAKE_HTTP_TIMEOUT_MS = 15000;
const WAN_WAKE_DELAY_MS = 2500;
const WAN_POLL_INTERVAL_MS = 2000;
const WAN_POLL_BUDGET_MS = 30000;

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function taskInstanceNumber(data) {
  if (!isParamNode(data) || data.instanceNumber == null || String(data.instanceNumber) === '') {
    return null;
  }
  return String(data.instanceNumber);
}

function throwTaskFault(data) {
  if (isParamNode(data) && data.fault) {
    throw new NbiError(formatAcsFault(data.fault), undefined, 'FAULT');
  }
}

async function fetchQueuedTask(server, taskId) {
  const query = new URLSearchParams({
    query: JSON.stringify({ _id: taskId }),
  });
  const { data } = await nbiRequest(server, 'GET', `/tasks/?${query}`, { timeout: 8000 });
  return Array.isArray(data) && data.length > 0 ? data[0] : null;
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

// Task 202 belum selesai. Dipantau sampai hilang dari antrean (sukses), membawa fault, atau batas waktu.
async function pollWanTask(server, deviceId, taskId) {
  const deadline = Date.now() + WAN_POLL_BUDGET_MS;
  while (Date.now() < deadline) {
    await delay(WAN_POLL_INTERVAL_MS);
    const task = await fetchQueuedTask(server, taskId);
    if (!task) {
      return null;
    }
    throwTaskFault(task);
    if (taskInstanceNumber(task)) {
      return task;
    }
  }
  const faultText = await recentDeviceFault(server, deviceId);
  throw new NbiError(
    faultText
      ? `ONU menolak perintah TR-069. ${faultText}`
      : 'Perintah masih antre di GenieACS dan sesi TR-069 belum selesai dalam batas waktu. Coba lagi beberapa saat lagi.',
    undefined,
    faultText ? 'FAULT' : 'PENDING',
  );
}

// POST task WAN dengan connection request, timeout 30 detik, lalu polling bila masih 202.
async function postWanTask(server, deviceId, body, { genieTimeout = WAN_TASK_TIMEOUT_MS, httpTimeout = WAN_HTTP_TIMEOUT_MS, poll = true } = {}) {
  const path = `/devices/${encodeURIComponent(deviceId)}/tasks?timeout=${genieTimeout}&connection_request`;
  let result;
  try {
    result = await nbiRequest(server, 'POST', path, { body, timeout: httpTimeout });
  } catch (error) {
    if (error instanceof NbiError && error.code === 'TIMEOUT') {
      const faultText = await recentDeviceFault(server, deviceId);
      throw new NbiError(
        faultText
          ? `GenieACS belum selesai, dan ONU mencatat fault TR-069. ${faultText}`
          : `GenieACS belum membalas dalam ${Math.round(httpTimeout / 1000)} detik. Perintah kemungkinan masih antre.`,
        undefined,
        faultText ? 'FAULT' : 'TIMEOUT',
      );
    }
    throw error;
  }
  if (result.status === 404) {
    throw new NbiError('Perangkat tidak ditemukan di GenieACS (coba SINKRON)', 404);
  }
  throwTaskFault(result.data);
  if (result.status === 202) {
    if (!poll) {
      return result;
    }
    const taskId = isParamNode(result.data) ? result.data._id : null;
    if (!taskId) {
      throw new NbiError('GenieACS mengantrikan perintah tanpa ID task, sehingga statusnya tidak bisa dipantau.', undefined, 'PENDING');
    }
    const polled = await pollWanTask(server, deviceId, String(taskId));
    return { status: 200, data: polled };
  }
  return result;
}

// Connection request singkat supaya ONU terbangun, lalu jeda sebelum AddObject / setParameterValues.
async function prepareWanPpp(server, deviceId, model) {
  const objectName = model === 'Device' ? 'Device.DeviceInfo' : 'InternetGatewayDevice.DeviceInfo';
  try {
    await postWanTask(
      server,
      deviceId,
      { name: 'refreshObject', objectName },
      { genieTimeout: WAN_WAKE_TIMEOUT_MS, httpTimeout: WAN_WAKE_HTTP_TIMEOUT_MS, poll: false },
    );
  } catch (error) {
    const unreachable = error instanceof NbiError && (error.status === 404 || (!error.status && !error.code));
    if (unreachable) {
      throw error;
    }
    console.warn(`[ACS wan-ppp] summon awal ${deviceId}: ${error.message}`);
  }
  await delay(WAN_WAKE_DELAY_MS);
}

async function sendWanSetParameterValues(server, deviceId, parameterValues) {
  const payload = sanitizeParameterValues(parameterValues);
  const logged = payload.map(([path, value, type]) => [
    path,
    /password/i.test(String(path).split('.').pop()) ? '***' : value,
    type,
  ]);
  console.log('PAYLOAD TR-069:', JSON.stringify(logged, null, 2));
  if (payload.length === 0) {
    return { applied: true };
  }
  await postWanTask(server, deviceId, { name: 'setParameterValues', parameterValues: payload });
  return { applied: true };
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

async function resolveNewIndex(readIndexes, previous) {
  const known = new Set(previous);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (attempt > 0) {
      await delay(1000);
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

// Menambah satu instance objek TR-069 (AddObject). Titik di akhir path dibuang.
// Hasil: { applied, instanceNumber }. instanceNumber null bila ONU belum menjawab (task diantrikan).
async function sendAddObject(server, deviceId, objectName) {
  const objectPath = normalizeAcsObjectName(objectName);
  const { status, data } = await postTask(server, deviceId, { name: 'addObject', objectName: objectPath });
  if (isParamNode(data) && data.fault) {
    const detail = [data.fault.code, data.fault.message].filter(Boolean).join(': ');
    throw new NbiError(`ONU menolak penambahan objek${detail ? ` (${detail})` : ''}`, undefined, 'FAULT');
  }
  const instanceNumber = isParamNode(data) && data.instanceNumber != null && String(data.instanceNumber) !== ''
    ? String(data.instanceNumber)
    : null;
  return { applied: status !== 202 && instanceNumber != null, instanceNumber };
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
    const before = await readWanChildIndexes(server, deviceId, wanDeviceIndex);
    const created = await sendWanAddObject(server, deviceId, `${deviceRoot}.`);
    connectionIndex = created.instanceNumber || await resolveNewIndex(
      () => readWanChildIndexes(server, deviceId, wanDeviceIndex),
      before,
    );
    if (!connectionIndex) {
      throw new NbiError(
        `AddObject ${deviceRoot}. selesai tanpa nomor instance. Path ini mungkin tidak ada pada model ONU.`,
        undefined,
        'FAULT',
      );
    }
  }
  const beforePpp = await readWanChildIndexes(server, deviceId, wanDeviceIndex, connectionIndex);
  const createdPpp = await sendWanAddObject(server, deviceId, `${deviceRoot}.${connectionIndex}.WANPPPConnection.`);
  const pppIndex = createdPpp.instanceNumber || await resolveNewIndex(
    () => readWanChildIndexes(server, deviceId, wanDeviceIndex, connectionIndex),
    beforePpp,
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
    const before = await readWanChildIndexes(server, deviceId, wanDeviceIndex);
    const created = await sendWanAddObject(server, deviceId, `${deviceRoot}.`);
    connectionIndex = created.instanceNumber || await resolveNewIndex(
      () => readWanChildIndexes(server, deviceId, wanDeviceIndex),
      before,
    );
    if (!connectionIndex) {
      throw new NbiError(
        `AddObject ${deviceRoot}. selesai tanpa nomor instance. Path ini mungkin tidak ada pada model ONU.`,
        undefined,
        'FAULT',
      );
    }
  }
  const beforeIp = await readWanChildIndexes(server, deviceId, wanDeviceIndex, connectionIndex, 'WANIPConnection');
  const createdIp = await sendWanAddObject(server, deviceId, `${deviceRoot}.${connectionIndex}.WANIPConnection.`);
  const ipIndex = createdIp.instanceNumber || await resolveNewIndex(
    () => readWanChildIndexes(server, deviceId, wanDeviceIndex, connectionIndex, 'WANIPConnection'),
    beforeIp,
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
async function sendWanDeleteObject(server, deviceId, objectName) {
  const objectPath = normalizeAcsObjectName(objectName);
  console.log('DELETEOBJECT TR-069:', objectPath);
  await postWanTask(server, deviceId, { name: 'deleteObject', objectName: objectPath });
  return { applied: true };
}

async function sendDeleteObject(server, deviceId, objectName) {
  const objectPath = normalizeAcsObjectName(objectName);
  const { status, data } = await postTask(server, deviceId, { name: 'deleteObject', objectName: objectPath });
  if (isParamNode(data) && data.fault) {
    const detail = [data.fault.code, data.fault.message].filter(Boolean).join(': ');
    throw new NbiError(`ONU menolak penghapusan${detail ? ` (${detail})` : ''}`, undefined, 'FAULT');
  }
  return { applied: status !== 202 };
}

async function deleteRemoteDevice(server, device) {
  // 404 = sudah tidak ada di ACS, dianggap berhasil.
  await nbiRequest(server, 'DELETE', `/devices/${encodeURIComponent(device.device_id)}`);
}

module.exports = {
  DEFAULT_NBI_PORT,
  TASK_TIMEOUT_MS,
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
  isDeviceOnline,
  readLastInform,
  sendTask,
  readWlanTarget,
  readLanTarget,
  sendSetParameterValues,
  sendAddObject,
  sendWanSetParameterValues,
  sendDeleteObject,
  sendWanDeleteObject,
  readWanTarget,
  prepareWanPpp,
  createWanPppInstance,
  createWanIpInstance,
  deleteRemoteDevice,
};
