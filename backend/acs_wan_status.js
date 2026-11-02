// Pembacaan Status Koneksi WAN yang tahan terhadap firmware lawas (Huawei lama, China Mobile / China Telecom).
//
// Tiga lapis:
//   1. Normalisasi  : 'connected' / 'Up' / 'UP' / 'Connected(1)' -> 'Connected' (format seragam ke UI).
//   2. Path cadangan: bila ...ConnectionStatus kosong, cari di leaf alternatif (Status, X_CT-COM_*, X_CMCC_*,
//                     X_HW_*, ...), lalu pola nama dinamis, lalu turunan dari Enable + ExternalIPAddress.
//   3. Deteksi      : apakah ONU termasuk Huawei lama / China Mobile-Telecom, supaya route memaksa
//                     refreshObject pada node WAN yang statusnya kosong di cache GenieACS.
//
// Modul ini murni (tanpa I/O) agar mudah diuji.

const net = require('net');

const CANONICAL = [
  // Urutan penting: 'disconnect*' dan 'unconfigured' harus dicek sebelum 'connect*'.
  [/^(?:disconnecting)/, 'Disconnecting'],
  [/^(?:pendingdisconnect)/, 'PendingDisconnect'],
  [/^(?:disconnected|disconnect|down|offline|linkdown|notconnected|unconnected|idle)/, 'Disconnected'],
  [/^(?:unconfigured|notconfigured)/, 'Unconfigured'],
  [/^(?:lowerlayerdown)/, 'LowerLayerDown'],
  [/^(?:notpresent)/, 'NotPresent'],
  [/^(?:dormant)/, 'Dormant'],
  [/^(?:disabled|disable)/, 'Disabled'],
  [/^(?:connecting|dialing|authenticating|negotiating)/, 'Connecting'],
  [/^(?:connected|connect|up|online|linkup|established|active|running)/, 'Connected'],
  [/^(?:error|fault|failed|authfailed|authenticationfailed)/, 'Error'],
];

// Nilai status dari firmware -> bentuk baku. Nilai tak dikenal dikembalikan apa adanya (dipangkas) supaya
// informasi tidak hilang. Kosong / '-' / null -> ''.
function normalizeWanStatus(value) {
  if (value === null || value === undefined || typeof value === 'object') {
    return '';
  }
  const text = String(value).trim();
  if (!text || text === '-') {
    return '';
  }
  const token = text.toLowerCase().replace(/[\s_\-().]+/g, '');
  for (const [pattern, label] of CANONICAL) {
    if (pattern.test(token)) {
      return label;
    }
  }
  return text;
}

function isNode(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Leaf pada `data` dengan nama kunci tidak peka huruf besar/kecil. Mengembalikan string tak kosong atau ''.
function leafValue(data, key) {
  if (!isNode(data)) {
    return '';
  }
  const direct = data[key];
  const found = isNode(direct) && '_value' in direct
    ? direct
    : data[Object.keys(data).find((name) => name.toLowerCase() === key.toLowerCase())];
  const value = isNode(found) ? found._value : undefined;
  if (value === undefined || value === null || typeof value === 'object') {
    return '';
  }
  return String(value).trim();
}

// Leaf yang secara standar / umum membawa status koneksi, berurutan dari yang paling dipercaya.
const STATUS_LEAVES = [
  'ConnectionStatus',
  'Status',
  'X_HW_ConnectionStatus',
  'X_HW_Status',
  'X_HW_IPv4ConnectionStatus',
  'X_CT-COM_ConnectionStatus',
  'X_CT-COM_Status',
  'X_CT-COM_IPv4ConnectionStatus',
  'X_CTCOM_ConnectionStatus',
  'X_CMCC_ConnectionStatus',
  'X_CMCC_Status',
  'X_CMCC_IPv4ConnectionStatus',
  'X_CU_ConnectionStatus',
  'X_FH_ConnectionStatus',
  'X_ZTE-COM_ConnectionStatus',
  'IPv4ConnectionStatus',
  'PPPConnectionStatus',
  'ConnStatus',
  'PPPoEStatus',
];

// Leaf status IPv6 hanya dipakai bila melaporkan 'Connected' (nilai 'Unconfigured' pada IPv4-only tidak berarti apa-apa).
const IPV6_STATUS_LEAVES = [
  'X_CT-COM_IPv6ConnectionStatus',
  'X_CMCC_IPv6ConnectionStatus',
  'X_HW_IPv6ConnectionStatus',
  'IPv6ConnectionStatus',
  'X_ZTE-COM_IPv6ConnStatus',
];

// Pola nama dinamis untuk vendor yang tidak ada di daftar: X_<VENDOR>_[IPv4|PPP]ConnectionStatus / ...ConnStatus.
const DYNAMIC_STATUS_LEAF = /^(?:x_[a-z0-9-]+_)?(?:ipv4|ppp|ip)?conn(?:ection)?status$/i;

// Alamat IP valid: IPv4/IPv6 sungguhan, bukan kosong, '-', 0.0.0.0, atau ::.
function hasUsableIp(value) {
  const ip = String(value || '').trim().replace(/\/\d+$/, '');
  return net.isIP(ip) !== 0 && ip !== '0.0.0.0' && !/^:+$/.test(ip);
}

function isFalse(value) {
  return ['0', 'false', 'disabled', 'no'].includes(String(value ?? '').trim().toLowerCase());
}

function isTrue(value) {
  return ['1', 'true', 'enabled', 'yes'].includes(String(value ?? '').trim().toLowerCase());
}

// Leaf alamat IP koneksi: standar, varian vendor, lalu pola dinamis (X_<vendor>_ExternalIPAddress / IPAddress).
const IP_LEAVES = ['ExternalIPAddress', 'X_CT-COM_ExternalIPAddress', 'X_CMCC_ExternalIPAddress', 'X_HW_ExternalIPAddress', 'IPAddress'];
const DYNAMIC_IP_LEAF = /^(?:x_[a-z0-9-]+_)?(?:external)?ip(?:v4)?address$/i;

function connectionIp(data) {
  for (const leaf of IP_LEAVES) {
    const value = leafValue(data, leaf);
    if (hasUsableIp(value)) {
      return value;
    }
  }
  for (const key of Object.keys(data)) {
    if (!key.startsWith('_') && DYNAMIC_IP_LEAF.test(key) && hasUsableIp(leafValue(data, key))) {
      return leafValue(data, key);
    }
  }
  return '';
}

// ServiceList apa pun nama vendornya (X_CT-COM_ / X_CMCC_ / X_HW_ / X_ZTE-COM_ / X_FH_ ...): true bila memuat OTHER.
function serviceListHasOther(data) {
  return Object.keys(data).some((key) => /servicelist$/i.test(key) && /\bother\b/i.test(leafValue(data, key)));
}

// Status satu koneksi WAN (node TR-098 WANPPPConnection / WANIPConnection) -> { status, source }.
//   source = nama leaf yang dipakai, 'inferred:...' bila diturunkan, '' bila kosong.
//
// Urutan keputusan (berlaku untuk semua vendor, tanpa nama vendor yang di-hardcode):
//   1. Leaf status standar / alternatif / dinamis yang berisi nilai SELAIN 'Unconfigured'.
//   2. Status IPv6, hanya bila 'Connected'.
//   3. Heuristik OTHER: status kosong atau 'Unconfigured' + ServiceList memuat OTHER + Enable true/1 +
//      IP valid -> 'Connected'. (Firmware lawas tidak mengisi status untuk koneksi OTHER/IPTV/lokal.)
//   4. 'Unconfigured' yang dilaporkan ONU (bila heuristik di atas tidak berlaku).
//   5. Turunan dari Enable + IP valid / Enable=false bila status benar-benar kosong.
function resolveWanStatus(data) {
  if (!isNode(data)) {
    return { status: '', source: '' };
  }

  let weak = null;
  const consider = (leaf) => {
    const status = normalizeWanStatus(leafValue(data, leaf));
    if (!status) {
      return null;
    }
    if (status === 'Unconfigured') {
      weak = weak || { status, source: leaf };
      return null;
    }
    return { status, source: leaf };
  };

  for (const leaf of STATUS_LEAVES) {
    const hit = consider(leaf);
    if (hit) {
      return hit;
    }
  }
  for (const key of Object.keys(data)) {
    if (key.startsWith('_') || !DYNAMIC_STATUS_LEAF.test(key) || /ipv6/i.test(key)) {
      continue;
    }
    const hit = consider(key);
    if (hit) {
      return hit;
    }
  }

  for (const leaf of IPV6_STATUS_LEAVES) {
    if (normalizeWanStatus(leafValue(data, leaf)) === 'Connected') {
      return { status: 'Connected', source: leaf };
    }
  }

  const enable = leafValue(data, 'Enable');
  const ip = connectionIp(data);
  if (isTrue(enable) && ip && serviceListHasOther(data)) {
    return { status: 'Connected', source: 'inferred:OTHER' };
  }
  if (weak) {
    return weak;
  }

  if (isFalse(enable)) {
    return { status: 'Disabled', source: 'inferred:Enable' };
  }
  if (isTrue(enable) && ip) {
    return { status: 'Connected', source: 'inferred:ExternalIPAddress' };
  }
  return { status: '', source: '' };
}

// ---- Deteksi perangkat -------------------------------------------------------------------------

const CHINA_CARRIER_IDENTITY = /chinamobile|cmcc|chinatelecom|chinaunicom|ct-?com|ctcom/i;
const CHINA_CARRIER_LEAF = /X_(?:CT-?COM|CMCC|CU)_/i;
// Huawei generasi baru (HG8145X6, EG8145X6, HN8xxx, V6, ...). Selain itu (V5, H5, HG824x, ...) dianggap lama.
const HUAWEI_MODERN_MODEL = /X[56]|XR|V6|HN8|WS8|EG8\d+X|HG8\d+X/i;

function squash(value) {
  return String(value || '').replace(/[\s_]+/g, '');
}

function isHuawei({ manufacturer, productClass, modelName }) {
  if (String(manufacturer || '').trim()) {
    return /huawei/i.test(manufacturer);
  }
  // Manufacturer tidak dilaporkan: tebak dari awalan model Huawei.
  return /^(?:HG|EG|HS|HN)\d/i.test(squash(modelName || productClass));
}

// Jenis perangkat yang statusnya sering kosong di cache GenieACS: 'china-carrier' | 'huawei-legacy' | ''.
function detectLegacyWanFirmware({ manufacturer = '', productClass = '', modelName = '', leafNames = [] } = {}) {
  const identity = [manufacturer, productClass, modelName].map(squash).join('|');
  if (CHINA_CARRIER_IDENTITY.test(identity) || leafNames.some((name) => CHINA_CARRIER_LEAF.test(String(name)))) {
    return 'china-carrier';
  }
  if (isHuawei({ manufacturer, productClass, modelName }) && !HUAWEI_MODERN_MODEL.test(`${modelName} ${productClass}`)) {
    return 'huawei-legacy';
  }
  return '';
}

module.exports = {
  normalizeWanStatus,
  resolveWanStatus,
  detectLegacyWanFirmware,
  STATUS_LEAVES,
};
