// Merangkum dokumen perangkat GenieACS (NBI) menjadi objek ONU yang bersih dan standar.
// Seluruh ekstraksi path TR-069 dan konversi satuan dilakukan di sini, bukan di frontend.

// ---- Projection NBI ---------------------------------------------------------
// Hanya path yang dipakai ringkasan di bawah (balasan tetap kecil). Projection NBI tidak
// mendukung wildcard, jadi instance 1-4 ditulis eksplisit.
const INSTANCES = [1, 2, 3, 4];
const IGD = 'InternetGatewayDevice';
// Urutan = prioritas: path pertama yang berisi nilai dipakai. Satu daftar ini dipakai untuk
// projection NBI sekaligus untuk pembacaan nilai, jadi keduanya tidak bisa tidak sinkron.
// Nama berhubung tanda minus (X_CT-COM_...) aman: path hanya dipecah pada titik.
const RX_PATHS = [
  // Standar TR-098 / TR-181
  `${IGD}.WANDevice.1.WANPONInterfaceConfig.RXPower`,
  'Device.Optical.Interface.1.OpticalSignalLevel',
  // FiberHome
  `${IGD}.WANDevice.1.X_FH_GponInterfaceConfig.RXPower`,
  `${IGD}.WANDevice.1.WANDSLInterfaceConfig.X_FH_RxPower`,
  // CT-COM
  `${IGD}.WANDevice.1.X_CTCOM_WANDrop.RxPower`,
  `${IGD}.WANDevice.1.WANPONInterfaceConfig.X_CTCOM_RxPower`,
  // CMCC (GPON dan EPON)
  `${IGD}.WANDevice.1.X_CMCC_GponInterfaceConfig.RXPower`,
  `${IGD}.WANDevice.1.X_CMCC_EponInterfaceConfig.RXPower`,
  // CT-COM (GPON dan EPON)
  `${IGD}.WANDevice.1.X_CT-COM_GponInterfaceConfig.RXPower`,
  `${IGD}.WANDevice.1.X_CT-COM_EponInterfaceConfig.RXPower`,
  // Cadangan: CT-COM DeviceInfo, Huawei, ZTE
  `${IGD}.DeviceInfo.X_CTCOM_Optical.RxPower`,
  `${IGD}.WANDevice.1.X_GponInterafceConfig.RXPower`,
  `${IGD}.WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig.RXPower`,
];

const TEMP_PATHS = [
  // Standar TR-098 / TR-181
  `${IGD}.DeviceInfo.TemperatureStatus.TemperatureSensor.1.Value`,
  'Device.DeviceInfo.TemperatureStatus.TemperatureSensor.1.Value',
  // FiberHome / CT-COM (DeviceInfo)
  `${IGD}.DeviceInfo.X_FH_Temperature`,
  `${IGD}.DeviceInfo.X_CTCOM_Temperature`,
  // FiberHome
  `${IGD}.WANDevice.1.X_FH_GponInterfaceConfig.TransceiverTemperature`,
  // CMCC (GPON dan EPON)
  `${IGD}.WANDevice.1.X_CMCC_GponInterfaceConfig.TransceiverTemperature`,
  `${IGD}.WANDevice.1.X_CMCC_EponInterfaceConfig.TransceiverTemperature`,
  // CT-COM (GPON dan EPON)
  `${IGD}.WANDevice.1.X_CT-COM_GponInterfaceConfig.TransceiverTemperature`,
  `${IGD}.WANDevice.1.X_CT-COM_EponInterfaceConfig.TransceiverTemperature`,
  // Cadangan: Huawei, ZTE, TR-181 Optical
  `${IGD}.WANDevice.1.X_GponInterafceConfig.TransceiverTemperature`,
  `${IGD}.WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig.TransceiverTemperature`,
  'Device.Optical.Interface.1.TransceiverTemperature',
];

const LIVE_PROJECTION = [
  '_id', '_lastInform', '_registered', '_tags', '_deviceId', '_ip', '_connectionRequestURL',
  `${IGD}.ManagementServer.ConnectionRequestURL`,
  'Device.ManagementServer.ConnectionRequestURL',
  // IP PPPoE
  ...INSTANCES.flatMap((wan) => INSTANCES.map(
    (ppp) => `${IGD}.WANDevice.1.WANConnectionDevice.${wan}.WANPPPConnection.${ppp}.ExternalIPAddress`,
  )),
  ...INSTANCES.map((iface) => `Device.IP.Interface.${iface}.IPv4Address.1.IPAddress`),
  // Username PPPoE
  ...INSTANCES.flatMap((wan) => INSTANCES.map(
    (ppp) => `${IGD}.WANDevice.1.WANConnectionDevice.${wan}.WANPPPConnection.${ppp}.Username`,
  )),
  ...INSTANCES.map((ppp) => `Device.PPP.Interface.${ppp}.Username`),
  // SSID, jumlah host, uptime
  `${IGD}.LANDevice.1.WLANConfiguration.1.SSID`,
  'Device.WiFi.SSID.1.SSID',
  `${IGD}.LANDevice.1.Hosts.HostNumberOfEntries`,
  'Device.Hosts.HostNumberOfEntries',
  `${IGD}.LANDevice.1.WLANConfiguration.1.TotalAssociations`,
  `${IGD}.DeviceInfo.UpTime`,
  'Device.DeviceInfo.UpTime',
  // RX dan suhu optik
  ...RX_PATHS,
  ...TEMP_PATHS,
  // Deteksi PON (GPON/EPON)
  `${IGD}.DeviceInfo.ModelName`,
  `${IGD}.DeviceInfo.Description`,
  `${IGD}.WANDevice.1.WANCommonInterfaceConfig.WANAccessType`,
  'Device.DeviceInfo.ModelName',
  'Device.DeviceInfo.Description',
].filter((path, index, all) => all.indexOf(path) === index).join(',');

// ---- Helper pembaca path ----------------------------------------------------
function isNode(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isEmpty(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

// Nilai (_value) pada path berpemisah titik, mis. "InternetGatewayDevice.DeviceInfo.UpTime".
// Aman terhadap node yang tidak ada (setara optional chaining ?.) dan mengembalikan undefined.
function readPath(doc, path) {
  let node = doc;
  for (const key of path.split('.')) {
    node = isNode(node) ? node[key] : undefined;
    if (node === undefined) {
      return undefined;
    }
  }
  return isNode(node) ? node._value : undefined;
}

// Nilai pertama yang tidak kosong dari beberapa path (setara "||" tetapi nilai 0 tetap dianggap ada).
function firstOf(doc, paths) {
  for (const path of paths) {
    const value = readPath(doc, path);
    if (!isEmpty(value)) {
      return value;
    }
  }
  return undefined;
}

// Semua nilai pada path yang memakai "*" sebagai pengganti satu level instance.
function readAll(doc, path) {
  let nodes = [doc];
  for (const key of path.split('.')) {
    nodes = nodes.flatMap((node) => {
      if (!isNode(node)) {
        return [];
      }
      if (key === '*') {
        return Object.keys(node).filter((name) => !name.startsWith('_')).map((name) => node[name]);
      }
      return node[key] === undefined ? [] : [node[key]];
    });
  }
  return nodes.map((node) => (isNode(node) ? node._value : undefined)).filter((value) => !isEmpty(value));
}

function toNumber(value) {
  if (isEmpty(value)) {
    return null;
  }
  const number = parseFloat(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits) {
  return value === null ? null : Number(value.toFixed(digits));
}

function toText(value) {
  return isEmpty(value) ? null : String(value).trim();
}

const IPV4_PATTERN = /(\d{1,3}(?:\.\d{1,3}){3})/;
const IPV4_EXACT = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;

// Dipakai frontend sebagai href: hanya IPv4 valid, bukan 0.0.0.0 / loopback.
function cleanIp(value) {
  const ip = typeof value === 'string' ? value.trim() : '';
  return IPV4_EXACT.test(ip) && ip !== '0.0.0.0' && !ip.startsWith('127.') ? ip : null;
}

// ---- Ekstraksi per kolom ----------------------------------------------------
function extractIpTr069(doc) {
  const url = doc._connectionRequestURL ?? firstOf(doc, [
    `${IGD}.ManagementServer.ConnectionRequestURL`,
    'Device.ManagementServer.ConnectionRequestURL',
  ]);
  const fromUrl = typeof url === 'string' ? url.match(IPV4_PATTERN)?.[1] : null;
  return cleanIp(typeof doc._ip === 'string' ? doc._ip : doc._ip?._value) ?? cleanIp(fromUrl);
}

function extractIpPppoe(doc) {
  const candidates = [
    ...readAll(doc, `${IGD}.WANDevice.1.WANConnectionDevice.*.WANPPPConnection.*.ExternalIPAddress`),
    ...readAll(doc, 'Device.IP.Interface.*.IPv4Address.*.IPAddress'),
  ];
  return candidates.map(cleanIp).find(Boolean) ?? null;
}

function extractUsername(doc) {
  const candidates = [
    ...readAll(doc, `${IGD}.WANDevice.1.WANConnectionDevice.*.WANPPPConnection.*.Username`),
    ...readAll(doc, 'Device.PPP.Interface.*.Username'),
  ];
  return candidates.map(toText).find(Boolean) ?? null;
}

// EPON dicek lebih dulu, lalu GPON. ProductClass sering hanya kode model, jadi
// ModelName, Description, dan WANAccessType dipakai sebagai cadangan.
function detectPon(doc) {
  const sources = [
    doc._deviceId?._ProductClass,
    readPath(doc, `${IGD}.DeviceInfo.ModelName`),
    readPath(doc, 'Device.DeviceInfo.ModelName'),
    readPath(doc, `${IGD}.DeviceInfo.Description`),
    readPath(doc, 'Device.DeviceInfo.Description'),
    readPath(doc, `${IGD}.WANDevice.1.WANCommonInterfaceConfig.WANAccessType`),
  ];
  for (const source of sources) {
    const text = typeof source === 'string' ? source.toUpperCase() : '';
    if (text.includes('EPON')) {
      return 'EPON';
    }
    if (text.includes('GPON')) {
      return 'GPON';
    }
  }
  return null;
}

// RX ONU (dBm). Positif = daya linear ZTE dalam 0.1 uW: 10 * log10(val / 10000).
// Lebih kecil dari -100 = Huawei tanpa koma (-1750): dibagi 100. Selain itu apa adanya.
function extractRxOnu(doc) {
  let value = toNumber(firstOf(doc, RX_PATHS));
  if (value === null) {
    return null;
  }
  if (value > 0) {
    value = 10 * Math.log10(value / 10000);
  } else if (value < -100) {
    value /= 100;
  }
  return round(value, 2);
}

// Suhu (°C). Nilai > 1000 bukan °C: umumnya 1/256 °C (13030 -> 50.9). Bila hasil bagi 256
// tidak masuk akal (> 150 °C) dianggap milli-°C dan dibagi 1000 (45000 -> 45).
function extractTemp(doc) {
  let value = toNumber(firstOf(doc, TEMP_PATHS));
  if (value === null) {
    return null;
  }
  if (value > 1000) {
    value /= 256;
    if (value > 150) {
      value = (value * 256) / 1000;
    }
  }
  return round(value, 2);
}

// ---- Ringkasan satu perangkat -----------------------------------------------
function summarizeDevice(item) {
  const tags = Array.isArray(item._tags) ? item._tags.map(String) : [];
  return {
    id: String(item._id),
    sn: toText(item._deviceId?._SerialNumber),
    manufaktur: toText(item._deviceId?._Manufacturer),
    tipe: toText(item._deviceId?._ProductClass),
    pon: detectPon(item),
    username: extractUsername(item),
    last_inform: item._lastInform ?? null,
    registered: item._registered ?? null,
    tags,
    ip_tr069: extractIpTr069(item),
    ip_pppoe: extractIpPppoe(item),
    ssid: toText(firstOf(item, [
      `${IGD}.LANDevice.1.WLANConfiguration.1.SSID`,
      'Device.WiFi.SSID.1.SSID',
    ])),
    user: toNumber(firstOf(item, [
      `${IGD}.LANDevice.1.Hosts.HostNumberOfEntries`,
      'Device.Hosts.HostNumberOfEntries',
      // Cadangan: jumlah klien WiFi yang terhubung (hanya WiFi, bukan seluruh host LAN).
      `${IGD}.LANDevice.1.WLANConfiguration.1.TotalAssociations`,
    ])),
    uptime: toNumber(firstOf(item, [`${IGD}.DeviceInfo.UpTime`, 'Device.DeviceInfo.UpTime'])),
    rx_onu: extractRxOnu(item),
    temp: extractTemp(item),
  };
}

// ---- Daftar klien terhubung (Hosts.Host) -------------------------------------
// Tidak ikut di LIVE_PROJECTION: subtree Host berisi puluhan parameter per klien, dan daftar
// ONU mengambil semua perangkat sekaligus. Diambil per perangkat saat modal detail dibuka.
const HOSTS_PROJECTION = `${IGD}.LANDevice.1.Hosts.Host,Device.Hosts.Host`;
const MAC_PATTERN = /^([0-9A-F]{2}[:-]){5}[0-9A-F]{2}$/i;
const MAX_HOSTS = 200;

function hostIsActive(value) {
  if (value === true || value === 1) {
    return true;
  }
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return text === 'true' || text === '1';
}

// Host yang ditampilkan: Active = true, atau (bila Active tidak dilaporkan) punya MAC valid.
// Active = false berarti klien sudah putus (TR-069 menyimpan riwayat host), jadi tidak ikut.
function shouldKeepHost(host) {
  if (host.active === true) {
    return true;
  }
  if (host.active === false) {
    return false;
  }
  return MAC_PATTERN.test(host.mac);
}

function extractHosts(item) {
  const hostNode = item?.InternetGatewayDevice?.LANDevice?.[1]?.Hosts?.Host ?? item?.Device?.Hosts?.Host;
  if (!isNode(hostNode)) {
    return [];
  }
  const connectedHosts = [];
  // Key angka saja ('1', '2', ...); key berawalan "_" adalah metadata GenieACS.
  for (const key of Object.keys(hostNode).filter((name) => /^\d+$/.test(name))) {
    const hostData = hostNode[key];
    if (!isNode(hostData)) {
      continue;
    }
    const layer2 = hostData?.Layer2Interface?._value;
    const rawActive = hostData?.Active?._value;
    connectedHosts.push({
      hostname: toText(hostData?.HostName?._value) || 'N/A',
      ip: toText(hostData?.IPAddress?._value) || '-',
      mac: toText(hostData?.MACAddress?._value) || '-',
      type: toText(hostData?.InterfaceType?._value)
        || (typeof layer2 === 'string' && layer2.includes('WLAN') ? '802.11' : 'Ethernet'),
      active: isEmpty(rawActive) ? undefined : hostIsActive(rawActive),
    });
  }
  return connectedHosts.filter(shouldKeepHost).slice(0, MAX_HOSTS);
}

// ---- Daftar WiFi (WLAN) --------------------------------------------------------
// Seperti host: tidak ikut LIVE_PROJECTION karena subtree WLANConfiguration berisi puluhan
// parameter per SSID. Diambil per perangkat saat tab WLAN dibuka.
const WLANS_PROJECTION = `${IGD}.LANDevice.1.WLANConfiguration,Device.WiFi.SSID,Device.WiFi.AccessPoint,Device.WiFi.Radio`;
const MIN_WLANS = 4;
const MAX_WLANS = 16;
const DEFAULT_BAND = '20MHz/40MHz';

function numericKeys(node) {
  return isNode(node) ? Object.keys(node).filter((name) => /^\d+$/.test(name)) : [];
}

// 2.4 GHz untuk index 1-4 dan 5 GHz untuk 5-8 (asumsi umum). Bila channel dilaporkan, channel
// yang menentukan: 1-14 = 2.4 GHz, >= 32 = 5 GHz (channel 0 / auto tidak dipakai).
function frequencyOf(key, channel) {
  if (channel !== null && channel >= 32) {
    return '5 GHz';
  }
  if (channel !== null && channel >= 1 && channel <= 14) {
    return '2.4 GHz';
  }
  return parseInt(key, 10) > 4 ? '5 GHz' : '2.4 GHz';
}

// BeaconType "Basic" berarti tanpa WPA: lihat BasicEncryptionModes ("None" = terbuka).
function securityTr098(wlanData) {
  const beacon = toText(wlanData?.BeaconType?._value);
  if (beacon && beacon !== 'Basic') {
    return beacon;
  }
  const basic = toText(wlanData?.BasicEncryptionModes?._value);
  if (basic && basic !== 'None') {
    return basic;
  }
  return 'Open System';
}

function placeholderWlan(index) {
  return {
    id: String(index),
    ssid: `SSID${index}`,
    password: '-',
    security: 'None',
    freq: index > 4 ? '5 GHz' : '2.4 GHz',
    band: '-',
    connected: 0,
    status: false,
  };
}

// Minimal 4 baris. Jika ONT melaporkan indeks lebih tinggi (misalnya SSID 5 GHz),
// batas ikut indeks tertinggi itu, tetapi tidak melewati MAX_WLANS.
function wlanLimit(keys) {
  const highest = keys.reduce((max, key) => Math.max(max, parseInt(key, 10) || 0), 0);
  return Math.min(MAX_WLANS, Math.max(MIN_WLANS, highest));
}

function wlansTr098(wlanObj) {
  const wlans = [];
  const limit = wlanLimit(numericKeys(wlanObj));
  for (let i = 1; i <= limit; i += 1) {
    const wlanData = wlanObj?.[i];
    if (isNode(wlanData) && wlanData.SSID) {
      const channel = toNumber(wlanData?.Channel?._value);
      wlans.push({
        id: String(i),
        ssid: toText(wlanData?.SSID?._value) || 'N/A',
        password: toText(wlanData?.PreSharedKey?.[1]?.PreSharedKey?._value)
          || toText(wlanData?.KeyPassphrase?._value)
          || toText(wlanData?.PreSharedKey?.[1]?.KeyPassphrase?._value)
          || '-',
        security: securityTr098(wlanData),
        freq: frequencyOf(i, channel),
        band: toText(wlanData?.OperatingChannelBandwidth?._value) || DEFAULT_BAND,
        connected: toNumber(wlanData?.TotalAssociations?._value) ?? 0,
        status: hostIsActive(wlanData?.Enable?._value),
      });
    } else {
      wlans.push(placeholderWlan(i));
    }
  }
  return wlans;
}

// TR-181: SSID.{i} (nama, enable), AccessPoint.{j} (sandi, keamanan, klien; dirujuk lewat
// SSIDReference, cadangannya index sama), Radio.{k} (pita frekuensi; dirujuk lewat LowerLayers).
function wlansTr181(wifi) {
  const wlans = [];
  const accessPoints = numericKeys(wifi?.AccessPoint).map((name) => wifi.AccessPoint[name]);
  const limit = wlanLimit(numericKeys(wifi?.SSID));
  for (let i = 1; i <= limit; i += 1) {
    const key = String(i);
    const ssidData = wifi?.SSID?.[i];
    if (isNode(ssidData) && ssidData.SSID) {
      const accessPoint = accessPoints.find((entry) => String(entry?.SSIDReference?._value ?? '').endsWith(`WiFi.SSID.${key}`))
        ?? wifi?.AccessPoint?.[i];
      const radioIndex = String(ssidData?.LowerLayers?._value ?? '').match(/Radio\.(\d+)/)?.[1];
      const radio = radioIndex ? wifi?.Radio?.[radioIndex] : undefined;
      const radioBand = toText(radio?.OperatingFrequencyBand?._value);
      const mode = toText(accessPoint?.Security?.ModeEnabled?._value);
      wlans.push({
        id: key,
        ssid: toText(ssidData?.SSID?._value) || 'N/A',
        password: toText(accessPoint?.Security?.KeyPassphrase?._value)
          || toText(accessPoint?.Security?.PreSharedKey?._value)
          || '-',
        security: mode && mode !== 'None' ? mode : 'Open System',
        freq: radioBand ? radioBand.replace(/GHz/i, ' GHz').replace(/\s+/g, ' ').trim() : frequencyOf(key, null),
        band: toText(radio?.OperatingChannelBandwidth?._value) || DEFAULT_BAND,
        connected: toNumber(accessPoint?.AssociatedDeviceNumberOfEntries?._value) ?? 0,
        status: hostIsActive(ssidData?.Enable?._value),
      });
    } else {
      wlans.push(placeholderWlan(i));
    }
  }
  return wlans;
}

function extractWlans(item) {
  const wlanObj = item?.InternetGatewayDevice?.LANDevice?.[1]?.WLANConfiguration;
  const wifi = item?.Device?.WiFi;
  if (numericKeys(wlanObj).length > 0) {
    return wlansTr098(wlanObj);
  }
  if (numericKeys(wifi?.SSID).length > 0) {
    return wlansTr181(wifi);
  }
  return wlansTr098(wlanObj);
}

// ---- Konfigurasi LAN (IP gateway, DHCP server, DNS) -----------------------------
// Seperti host/WLAN: diambil per perangkat saat tab LAN dibuka, tidak ikut LIVE_PROJECTION.
const LAN_PROJECTION = [
  `${IGD}.LANDevice.1.LANHostConfigManagement`,
  `${IGD}.LANDevice.1.LANEthernetInterfaceConfig.1.MACAddress`,
  'Device.IP.Interface.1',
  'Device.DHCPv4.Server',
  'Device.Ethernet.Interface.1.MACAddress',
].join(',');

const LAN_BASE = `${IGD}.LANDevice.1.LANHostConfigManagement`;

// Teks tidak kosong atau '-'.
function textOrDash(value) {
  return toText(value) || '-';
}

// DNSServers berformat "8.8.8.8,8.8.4.4": dipecah, dipangkas, dan selalu 3 elemen ('-' bila kosong).
function parseDns(value) {
  const servers = String(value ?? '').split(',').map((entry) => entry.trim()).filter(Boolean).slice(0, 3);
  while (servers.length < 3) {
    servers.push('-');
  }
  return servers;
}

// Utama TR-098 (LANHostConfigManagement). Cadangan TR-181: Device.IP.Interface.1 dan
// Device.DHCPv4.Server.Pool.1 (diasumsikan interface 1 = LAN).
function extractLanConfig(item) {
  const pool = 'Device.DHCPv4.Server.Pool.1';
  const dhcpEnable = firstOf(item, [`${LAN_BASE}.DHCPServerEnable`, 'Device.DHCPv4.Server.Enable', `${pool}.Enable`]);
  return {
    ip: textOrDash(firstOf(item, [
      `${LAN_BASE}.IPInterface.1.IPInterfaceIPAddress`,
      'Device.IP.Interface.1.IPv4Address.1.IPAddress',
    ])),
    subnet: textOrDash(firstOf(item, [
      `${LAN_BASE}.IPInterface.1.IPInterfaceSubnetMask`,
      'Device.IP.Interface.1.IPv4Address.1.SubnetMask',
    ])),
    mac: textOrDash(firstOf(item, [
      `${IGD}.LANDevice.1.LANEthernetInterfaceConfig.1.MACAddress`,
      'Device.Ethernet.Interface.1.MACAddress',
    ])),
    dhcpEnabled: hostIsActive(dhcpEnable),
    dhcpMin: textOrDash(firstOf(item, [`${LAN_BASE}.MinAddress`, `${pool}.MinAddress`])),
    dhcpMax: textOrDash(firstOf(item, [`${LAN_BASE}.MaxAddress`, `${pool}.MaxAddress`])),
    leaseTime: textOrDash(firstOf(item, [`${LAN_BASE}.DHCPLeaseTime`, `${pool}.LeaseTime`])),
    dns: parseDns(firstOf(item, [`${LAN_BASE}.DNSServers`, `${pool}.DNSServers`])),
  };
}

// ---- Daftar koneksi WAN -------------------------------------------------------
// Tidak ikut LIVE_PROJECTION: subtree WANConnectionDevice besar. Diambil per perangkat
// saat tab WAN dibuka. Sandi PPPoE tidak pernah dikirim apa adanya.
const SSID_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8];
const WANS_PROJECTION = [
  `${IGD}.WANDevice.1.WANConnectionDevice`,
  `${IGD}.WANDevice.2.WANConnectionDevice`,
  'Device.PPP.Interface',
  'Device.IP.Interface',
  'Device.Ethernet.VLANTermination',
  'Device.NAT.InterfaceSetting',
  `${IGD}.LANDevice.1.WLANConfigurationNumberOfEntries`,
  'Device.WiFi.SSIDNumberOfEntries',
  ...SSID_SLOTS.map((index) => `${IGD}.LANDevice.1.WLANConfiguration.${index}.SSID`),
  ...SSID_SLOTS.map((index) => `Device.WiFi.SSID.${index}.SSID`),
].join(',');
const MAX_WANS = 32;

const SERVICE_KEYS = [
  'X_CT-COM_ServiceList',
  'X_CMCC_ServiceList',
  'X_CU_ServiceList',
  'X_HW_SERVICELIST',
  'X_BROADCOM_COM_ServiceName',
  'X_BROADCOM_COM_IfName',
];

const VLAN_KEYS = [
  'X_BROADCOM_COM_VLANID',
  'X_CT-COM_VLANIDMark',
  'X_CTCOM_VLAN',
  'X_CT-COM_VLAN',
  'X_HW_VLAN',
  'X_CMCC_VLANIDMark',
  'X_ZTE-COM_VLANID',
  'X_FH_VLAN',
  'VLANID',
];

const LINK_VLAN_NODES = [
  'X_CT-COM_WANGponLinkConfig',
  'X_CT-COM_WANEponLinkConfig',
  'X_CMCC_WANGponLinkConfig',
  'X_CMCC_WANEponLinkConfig',
  'X_FH_WANGponLinkConfig',
  'X_FH_WANEponLinkConfig',
  'X_CU_WANGponLinkConfig',
];

const PRIORITY_KEYS = [
  'X_HW_PRI',
  'X_ZTE-COM_8021p',
  'X_CT-COM_802-1pMark',
  'X_CT-COM_8021p',
];

function leafText(node, key) {
  return toText(node?.[key]?._value);
}

function firstLeaf(node, keys) {
  for (const key of keys) {
    const value = leafText(node, key);
    if (value) {
      return value;
    }
  }
  return null;
}

function enabledLabel(value) {
  if (isEmpty(value)) {
    return '-';
  }
  if (value === true || value === 1) {
    return 'Enabled';
  }
  const text = String(value).trim().toLowerCase();
  if (text === '1' || text === 'true' || text === 'enabled') {
    return 'Enabled';
  }
  if (text === '0' || text === 'false' || text === 'disabled') {
    return 'Disabled';
  }
  return '-';
}

function maskedSecret(value) {
  return isEmpty(value) ? '-' : '********';
}

function vlanIdOf(data, parent) {
  const direct = firstLeaf(data, VLAN_KEYS);
  if (direct) {
    return direct;
  }
  for (const name of LINK_VLAN_NODES) {
    const mark = leafText(parent?.[name], 'VLANIDMark') || leafText(parent?.[name], 'VLANID');
    if (mark) {
      return mark;
    }
  }
  return leafText(parent?.WANEthernetLinkConfig, 'X_CT-COM_VLANIDMark')
    || leafText(parent?.WANEthernetLinkConfig, 'VLANID');
}

function priorityOf(data, parent) {
  const direct = firstLeaf(data, PRIORITY_KEYS);
  if (direct) {
    return direct;
  }
  for (const name of LINK_VLAN_NODES) {
    const mark = leafText(parent?.[name], '802-1pMark');
    if (mark) {
      return mark;
    }
  }
  return null;
}

function vlanStatusOf(data, vlanId) {
  const flag = firstLeaf(data, ['X_CT-COM_VLANEnabled', 'X_HW_VLANEnabled', 'X_CMCC_VLANEnabled']);
  if (flag) {
    const label = enabledLabel(flag);
    if (label !== '-') {
      return label;
    }
  }
  if (vlanId && vlanId !== '0') {
    return 'Enabled';
  }
  if (vlanId === '0') {
    return 'Disabled';
  }
  return '-';
}

function hasConnectionData(data) {
  return isNode(data) && Boolean(
    data.Name || data.ConnectionStatus || data.ExternalIPAddress || data.Username
    || data.Enable || data.ConnectionType || data.TransportType || data.DNSServers,
  );
}

const BIND_STRING_KEYS = [
  'X_ZTE-COM_LanInterface',
  'X_CT-COM_LanInterface',
  'X_CMCC_LanInterface',
  'X_CU_LanInterface',
  'X_FH_LanInterface',
];
const BIND_LABELS = ['LAN1', 'LAN2', 'LAN3', 'LAN4', 'SSID1', 'SSID2', 'SSID3', 'SSID4', 'SSID5', 'SSID6', 'SSID7', 'SSID8'];
const HUAWEI_BIND_LEAVES = [
  ['Lan1Enable', 'LAN1'],
  ['Lan2Enable', 'LAN2'],
  ['Lan3Enable', 'LAN3'],
  ['Lan4Enable', 'LAN4'],
  ['SSID1Enable', 'SSID1'],
  ['SSID2Enable', 'SSID2'],
  ['SSID3Enable', 'SSID3'],
  ['SSID4Enable', 'SSID4'],
  ['SSID5Enable', 'SSID5'],
  ['SSID6Enable', 'SSID6'],
  ['SSID7Enable', 'SSID7'],
  ['SSID8Enable', 'SSID8'],
];

function labelsFromBindingText(text) {
  const seen = new Set();
  const value = String(text || '');
  for (const match of value.matchAll(/LANEthernetInterfaceConfig\.(\d+)/gi)) {
    const index = Number(match[1]);
    if (index >= 1 && index <= 4) {
      seen.add(`LAN${index}`);
    }
  }
  for (const match of value.matchAll(/WLANConfiguration\.(\d+)/gi)) {
    const index = Number(match[1]);
    if (index >= 1 && index <= 8) {
      seen.add(`SSID${index}`);
    }
  }
  for (const match of value.matchAll(/WiFi\.SSID\.(\d+)/gi)) {
    const index = Number(match[1]);
    if (index >= 1 && index <= 8) {
      seen.add(`SSID${index}`);
    }
  }
  for (const match of value.matchAll(/\b(LAN[1-4]|SSID[1-8])\b/gi)) {
    seen.add(match[1].toUpperCase());
  }
  return BIND_LABELS.filter((label) => seen.has(label));
}

function flagEnabled(value) {
  return value === true || value === 1 || value === '1' || String(value || '').toLowerCase() === 'true';
}

function boundPortsOf(data) {
  if (!isNode(data)) {
    return [];
  }
  const seen = new Set(labelsFromBindingText(firstLeaf(data, BIND_STRING_KEYS) || ''));
  const bind = data.X_HW_LANBIND;
  if (isNode(bind)) {
    for (const [leaf, label] of HUAWEI_BIND_LEAVES) {
      if (flagEnabled(bind[leaf]?._value)) {
        seen.add(label);
      }
    }
  }
  return BIND_LABELS.filter((label) => seen.has(label));
}

function presentSsidCount(node) {
  let highest = 0;
  for (const index of SSID_SLOTS) {
    const child = node?.[index];
    if (isNode(child) && (child.SSID || child.Enable)) {
      highest = index;
    }
  }
  return highest;
}

function ssidCountOf(item) {
  const reported = toNumber(item?.InternetGatewayDevice?.LANDevice?.[1]?.WLANConfigurationNumberOfEntries?._value)
    ?? toNumber(item?.Device?.WiFi?.SSIDNumberOfEntries?._value);
  if (reported && reported >= 1) {
    return Math.min(8, Math.max(1, Math.round(reported)));
  }
  const fromWlan = presentSsidCount(item?.InternetGatewayDevice?.LANDevice?.[1]?.WLANConfiguration);
  if (fromWlan > 0) {
    return Math.min(8, fromWlan);
  }
  const fromWifi = presentSsidCount(item?.Device?.WiFi?.SSID);
  if (fromWifi > 0) {
    return Math.min(8, fromWifi);
  }
  return 4;
}

function connectionRecord(id, kind, data, parent, fullPath) {
  const ppp = kind === 'PPP';
  const vlanId = vlanIdOf(data, parent);
  return {
    id,
    fullPath,
    type: kind,
    name: leafText(data, 'Name') || '-',
    status: leafText(data, 'ConnectionStatus') || '-',
    ip: leafText(data, 'ExternalIPAddress') || '-',
    remoteIp: leafText(data, 'RemoteIPAddress') || leafText(data, 'DefaultGateway') || '-',
    username: ppp ? (leafText(data, 'Username') || '-') : '-',
    password: ppp ? maskedSecret(data?.Password?._value) : '-',
    vlanStatus: vlanStatusOf(data, vlanId),
    vlanId: vlanId || '-',
    priority: priorityOf(data, parent) || '-',
    mtu: leafText(data, 'MaxMRUSize') || '-',
    service: firstLeaf(data, SERVICE_KEYS) || leafText(data, 'Name') || '-',
    dns: leafText(data, 'DNSServers') || '-',
    connTrigger: leafText(data, 'ConnectionTrigger') || 'AlwaysOn',
    nat: enabledLabel(data?.NATEnabled?._value),
    transport: leafText(data, 'TransportType') || (ppp ? 'PPPoE' : 'IP_Routed'),
    mac: leafText(data, 'MACAddress') || '-',
    connType: leafText(data, 'ConnectionType') || (ppp ? 'PPPoE' : 'IP_Routed'),
    uptime: leafText(data, 'Uptime') || '0',
    boundPorts: boundPortsOf(data),
  };
}

function wansTr098(igd) {
  const wans = [];
  const wanDevices = igd?.WANDevice;
  for (const wanKey of numericKeys(wanDevices)) {
    const connections = wanDevices[wanKey]?.WANConnectionDevice;
    for (const key of numericKeys(connections)) {
      const device = connections[key];
      if (!isNode(device)) {
        continue;
      }
      for (const connKey of numericKeys(device.WANPPPConnection)) {
        const data = device.WANPPPConnection[connKey];
        if (hasConnectionData(data)) {
          wans.push(connectionRecord(
            `${wanKey}.${key}.ppp.${connKey}`,
            'PPP',
            data,
            device,
            `${IGD}.WANDevice.${wanKey}.WANConnectionDevice.${key}.WANPPPConnection.${connKey}.`,
          ));
        }
      }
      for (const connKey of numericKeys(device.WANIPConnection)) {
        const data = device.WANIPConnection[connKey];
        if (hasConnectionData(data)) {
          wans.push(connectionRecord(
            `${wanKey}.${key}.ip.${connKey}`,
            'IP',
            data,
            device,
            `${IGD}.WANDevice.${wanKey}.WANConnectionDevice.${key}.WANIPConnection.${connKey}.`,
          ));
        }
      }
    }
  }
  return wans;
}

function ipv4Of(iface) {
  for (const key of numericKeys(iface?.IPv4Address)) {
    const ip = leafText(iface.IPv4Address[key], 'IPAddress');
    if (ip) {
      return ip;
    }
  }
  return null;
}

function natForInterface(device, interfaceRef) {
  for (const key of numericKeys(device?.NAT?.InterfaceSetting)) {
    const setting = device.NAT.InterfaceSetting[key];
    const ref = leafText(setting, 'Interface') || '';
    if (ref && (ref === interfaceRef || ref.endsWith(interfaceRef) || interfaceRef.endsWith(ref))) {
      return enabledLabel(setting?.Enable?._value);
    }
  }
  return '-';
}

function vlanFromLower(device, lower) {
  const match = String(lower || '').match(/VLANTermination\.(\d+)/);
  if (!match) {
    return null;
  }
  return leafText(device?.Ethernet?.VLANTermination?.[match[1]], 'VLANID');
}

function wansTr181(device) {
  if (!isNode(device)) {
    return [];
  }
  const wans = [];
  const interfaces = device.IP?.Interface;

  for (const key of numericKeys(device.PPP?.Interface)) {
    const data = device.PPP.Interface[key];
    if (!isNode(data) || !(data.Username || data.Name || data.Status || data.ConnectionStatus)) {
      continue;
    }
    let ip = '-';
    let mac = '-';
    let nat = '-';
    let lower = '';
    for (const ipKey of numericKeys(interfaces)) {
      const iface = interfaces[ipKey];
      const layers = leafText(iface, 'LowerLayers') || '';
      if (layers.includes(`PPP.Interface.${key}`)) {
        ip = ipv4Of(iface) || '-';
        mac = leafText(iface, 'MACAddress') || '-';
        nat = natForInterface(device, `Device.IP.Interface.${ipKey}`);
        lower = layers;
        break;
      }
    }
    const vlanId = vlanFromLower(device, lower);
    wans.push({
      id: `ppp.${key}`,
      fullPath: `Device.PPP.Interface.${key}.`,
      type: 'PPP',
      name: leafText(data, 'Name') || '-',
      status: leafText(data, 'ConnectionStatus') || leafText(data, 'Status') || '-',
      ip,
      remoteIp: '-',
      username: leafText(data, 'Username') || '-',
      password: maskedSecret(data?.Password?._value),
      vlanStatus: vlanId && vlanId !== '0' ? 'Enabled' : '-',
      vlanId: vlanId || '-',
      service: leafText(data, 'Name') || '-',
      dns: '-',
      connTrigger: leafText(data, 'ConnectionTrigger') || 'AlwaysOn',
      nat,
      transport: 'PPPoE',
      mac,
      connType: 'PPPoE',
      uptime: leafText(data, 'LastChange') || '0',
      boundPorts: boundPortsOf(data),
    });
  }

  for (const key of numericKeys(interfaces)) {
    const iface = interfaces[key];
    if (!isNode(iface) || !hostIsActive(iface?.Upstream?._value)) {
      continue;
    }
    const lower = leafText(iface, 'LowerLayers') || '';
    if (lower.includes('PPP.Interface')) {
      continue;
    }
    const vlanId = vlanFromLower(device, lower);
    wans.push({
      id: `ip.${key}`,
      fullPath: `Device.IP.Interface.${key}.`,
      type: 'IP',
      name: leafText(iface, 'Name') || '-',
      status: leafText(iface, 'Status') || '-',
      ip: ipv4Of(iface) || '-',
      remoteIp: '-',
      username: '-',
      password: '-',
      vlanStatus: vlanId && vlanId !== '0' ? 'Enabled' : '-',
      vlanId: vlanId || '-',
      service: leafText(iface, 'Name') || '-',
      dns: '-',
      connTrigger: 'AlwaysOn',
      nat: natForInterface(device, `Device.IP.Interface.${key}`),
      transport: 'IP_Routed',
      mac: leafText(iface, 'MACAddress') || '-',
      connType: leafText(iface, 'Type') || 'IP_Routed',
      uptime: '0',
      boundPorts: boundPortsOf(iface),
    });
  }
  return wans;
}

function extractWans(item) {
  if (!isNode(item)) {
    return [];
  }
  const tr098 = wansTr098(item.InternetGatewayDevice);
  const wans = tr098.length > 0 ? tr098 : wansTr181(item.Device);
  return wans.slice(0, MAX_WANS);
}

module.exports = {
  LIVE_PROJECTION,
  HOSTS_PROJECTION,
  WLANS_PROJECTION,
  LAN_PROJECTION,
  WANS_PROJECTION,
  extractLanConfig,
  extractHosts,
  extractWlans,
  extractWans,
  ssidCountOf,
  RX_PATHS,
  TEMP_PATHS,
  readPath,
  summarizeDevice,
};
