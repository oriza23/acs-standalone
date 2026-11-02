// Validasi form WAN PPP dan penyusunan parameterValues TR-069 (setParameterValues).
// Murni (tanpa jaringan/DB) supaya mudah dites. Nama parameter mengikuti data model
// yang dipakai ONU ZTE, Huawei, FiberHome, dan turunan China-Telecom (X_CT-COM).

const IGD = 'InternetGatewayDevice';
const PPP_UI_TYPES = ['ip-routed', 'pppoe_bridged', 'pppoe_routed', 'ip-bridged'];
const SERVICE_LIST = ['INTERNET', 'TR069', 'VOIP', 'IPTV', 'OTHER'];
const PORT_KEYS = ['lan1', 'lan2', 'lan3', 'lan4', 'ssid1', 'ssid2', 'ssid3', 'ssid4', 'ssid5', 'ssid6', 'ssid7', 'ssid8'];
const MTU_MIN = 576;
const MTU_MAX = 1540;
const WAN_PPP_PATH = /^(?:InternetGatewayDevice\.WANDevice\.\d+\.WANConnectionDevice\.\d+\.WANPPPConnection\.\d+\.|Device\.PPP\.Interface\.\d+\.)$/;
// Parameter inti TR-098/TR-181 yang hampir selalu ada. Sisanya hanya dikirim bila pohon perangkat memuatnya.
const CORE_LEAVES = new Set(['Enable', 'Name', 'ConnectionType', 'Username', 'Password', 'NATEnabled']);

// ConnectionType TR-098 / ekstensi vendor. Nilai UI tetap yang dipakai dropdown.
const CONNECTION_TYPE_TR069 = {
  'ip-routed': 'IP_Routed',
  ip_routed: 'IP_Routed',
  pppoe_bridged: 'PPPoE_Bridged',
  pppoe_routed: 'PPPoE_Routed',
  'ip-bridged': 'IP_Bridged',
  ip_bridged: 'IP_Bridged',
};

// Merek yang memajang PPPoE_Routed selain FiberHome (sering firmware turunan yang sama).
const PPP_ROUTED_BRANDS = ['fhtt', 'cdata', 'c-data', 'vsol', 'hioso', 'optilink', 'bdcom'];

const LAN_INTERFACE = {
  lan1: `${IGD}.LANDevice.1.LANEthernetInterfaceConfig.1`,
  lan2: `${IGD}.LANDevice.1.LANEthernetInterfaceConfig.2`,
  lan3: `${IGD}.LANDevice.1.LANEthernetInterfaceConfig.3`,
  lan4: `${IGD}.LANDevice.1.LANEthernetInterfaceConfig.4`,
  ssid1: `${IGD}.LANDevice.1.WLANConfiguration.1`,
  ssid2: `${IGD}.LANDevice.1.WLANConfiguration.2`,
  ssid3: `${IGD}.LANDevice.1.WLANConfiguration.3`,
  ssid4: `${IGD}.LANDevice.1.WLANConfiguration.4`,
  ssid5: `${IGD}.LANDevice.1.WLANConfiguration.5`,
  ssid6: `${IGD}.LANDevice.1.WLANConfiguration.6`,
  ssid7: `${IGD}.LANDevice.1.WLANConfiguration.7`,
  ssid8: `${IGD}.LANDevice.1.WLANConfiguration.8`,
};

const HUAWEI_BIND = {
  lan1: 'Lan1Enable',
  lan2: 'Lan2Enable',
  lan3: 'Lan3Enable',
  lan4: 'Lan4Enable',
  ssid1: 'SSID1Enable',
  ssid2: 'SSID2Enable',
  ssid3: 'SSID3Enable',
  ssid4: 'SSID4Enable',
  ssid5: 'SSID5Enable',
  ssid6: 'SSID6Enable',
  ssid7: 'SSID7Enable',
  ssid8: 'SSID8Enable',
};

function supportsPppoeRouted(manufacturer, deviceType = '') {
  if (normalizeDeviceType(deviceType) === 'fiberhome') {
    return true;
  }
  const name = String(manufacturer || '').toLowerCase();
  const compact = name.replace(/[^a-z0-9]+/g, '');
  return name.includes('fiberhome')
    || compact.includes('fiberhome')
    || PPP_ROUTED_BRANDS.some((brand) => name.includes(brand) || compact.includes(brand.replace(/-/g, '')));
}

function connectionTypeError(manufacturer, connectionType, deviceType = '') {
  if (connectionType === 'pppoe_routed' && !supportsPppoeRouted(manufacturer, deviceType)) {
    return 'Connection Type pppoe_routed tidak didukung merek modem ini';
  }
  return null;
}

// Profil parameter vendor. Selain tiga merek utama, pakai X_CT-COM (umum di ONU Tiongkok).
function mentionsZte(name, compact) {
  // "Aztech" memuat huruf zte, tetapi bukan merek ZTE.
  return /(^|[^a-z0-9])zte([^a-z0-9]|$)/.test(name) || compact.startsWith('zte');
}

function vendorProfile(manufacturer) {
  const name = String(manufacturer || '').toLowerCase();
  const compact = name.replace(/[^a-z0-9]+/g, '');
  if (name.includes('huawei') || compact.includes('huawei')) {
    return 'huawei';
  }
  if (mentionsZte(name, compact)) {
    return 'zte';
  }
  if (name.includes('fiberhome') || compact.includes('fiberhome') || name.includes('fhtt') || compact.includes('fhtt')) {
    return 'fiberhome';
  }
  return 'ctcom';
}

// Tipe Perangkat dari form: menentukan apakah Connection Name dikirim ke ONU.
const DEVICE_TYPES = ['zte', 'huawei', 'chinamobile', 'fiberhome'];

function normalizeDeviceType(value) {
  const compact = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (compact === 'cmcc') {
    return 'chinamobile';
  }
  return DEVICE_TYPES.includes(compact) ? compact : '';
}

// Fiberhome (HG6145D2) membuat nama koneksi sendiri, mis. "3_INTERNET_R_VID_2033". Nama bersifat OPSIONAL:
// kosong / "Otomatis" = ONT yang menamai. Bila diisi, Name tetap dikirim, tetapi sebagai task terpisah
// (Safe-Write) karena menulis ...Name pernah dibalas ONT dengan 9002 Internal Error.
const FIBERHOME_AUTO_NAME = 'otomatis';

function skipConnectionName({ deviceType, manufacturer } = {}) {
  return normalizeDeviceType(deviceType) === 'fiberhome' || vendorProfile(manufacturer) === 'fiberhome';
}

// Nama dari form. Fiberhome: kosong atau "Otomatis" (placeholder UI) berarti nama dibuat ONT => ''.
// Mengembalikan null bila nama tidak valid (terlalu panjang / karakter kontrol); caller yang memutuskan.
function readConnectionName(body, deviceType) {
  const raw = typeof body?.connectionName === 'string' ? body.connectionName.trim() : '';
  if (deviceType === 'fiberhome' && (!raw || raw.toLowerCase() === FIBERHOME_AUTO_NAME)) {
    return '';
  }
  return readText(raw, 128);
}

// Connection Name tidak ikut batch utama. Dikirim terpisah (Safe-Write) setelah Username/Password/VLAN
// berhasil, supaya Name yang read-only/ditolak tidak menggagalkan parameter utama.
function connectionNameRows(basePath, values, manufacturer) {
  const name = String(values?.connectionName || '').trim();
  const isAuto = skipConnectionName({ deviceType: values?.deviceType, manufacturer: manufacturer || values?.manufacturer });
  if (isAuto && name.toLowerCase() === FIBERHOME_AUTO_NAME) {
    return [];
  }
  return name ? [[`${basePath}Name`, name, 'xsd:string']] : [];
}

// deviceType opsional (klien lama): kosong berarti ditentukan dari merek ONU yang terbaca di ACS.
function readDeviceType(body) {
  const raw = body?.deviceType;
  if (raw === undefined || raw === null || raw === '') {
    return { deviceType: '' };
  }
  const deviceType = normalizeDeviceType(raw);
  if (!deviceType) {
    return { error: 'Tipe Perangkat tidak valid (ZTE, Huawei, ChinaMobile, atau Fiberhome)' };
  }
  return { deviceType };
}

function readText(value, max) {
  if (typeof value !== 'string') {
    return null;
  }
  const text = value.trim();
  if (!text || text.length > max || /[\u0000-\u001F\u007F]/.test(text)) {
    return null;
  }
  return text;
}

function readInt(value, min, max) {
  const text = typeof value === 'number' && Number.isInteger(value)
    ? String(value)
    : (typeof value === 'string' ? value.trim() : '');
  if (!/^\d+$/.test(text)) {
    return null;
  }
  const number = Number(text);
  if (number < min || number > max) {
    return null;
  }
  return number;
}

function readPorts(value) {
  const ports = {};
  for (const key of PORT_KEYS) {
    ports[key] = false;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const key = String(item || '').trim().toLowerCase();
      if (!PORT_KEYS.includes(key)) {
        return { error: 'Port binding tidak valid' };
      }
      ports[key] = true;
    }
    return { value: ports };
  }
  const source = value && typeof value === 'object' ? value : null;
  if (!source) {
    return { error: 'Port binding tidak valid' };
  }
  for (const key of PORT_KEYS) {
    if (source[key] === undefined) {
      continue;
    }
    if (typeof source[key] !== 'boolean') {
      return { error: 'Port binding tidak valid' };
    }
    ports[key] = source[key];
  }
  return { value: ports };
}

// Body form Add/Edit WAN PPP. wanPath kosong = buat instance baru.
function parseWanPpp(body) {
  const deviceId = typeof body?.deviceId === 'string' ? body.deviceId.trim() : '';
  if (!deviceId || deviceId.length > 255) {
    return { error: 'ID perangkat tidak valid' };
  }

  let wanPath = '';
  if (body?.wanPath !== undefined && body?.wanPath !== null && body?.wanPath !== '') {
    wanPath = typeof body.wanPath === 'string' ? body.wanPath.trim() : '';
    if (wanPath && !wanPath.endsWith('.')) {
      wanPath += '.';
    }
    if (!WAN_PPP_PATH.test(wanPath)) {
      return { error: 'Path WAN PPP tidak valid' };
    }
  }

  const deviceTypeError = readDeviceType(body);
  if (deviceTypeError.error) {
    return { error: deviceTypeError.error };
  }
  const { deviceType } = deviceTypeError;
  const connectionName = readConnectionName(body, deviceType);
  if (connectionName === null || (deviceType !== 'fiberhome' && !connectionName)) {
    return { error: 'Connection Name wajib diisi (maksimal 128 karakter)' };
  }
  if (typeof body?.enableConnection !== 'boolean' || typeof body?.natStatus !== 'boolean' || typeof body?.vlanStatus !== 'boolean') {
    return { error: 'Status koneksi, NAT, dan VLAN harus berupa true atau false' };
  }

  const serviceList = typeof body?.serviceList === 'string' ? body.serviceList.trim() : '';
  if (!SERVICE_LIST.includes(serviceList)) {
    return { error: 'Service List tidak valid' };
  }
  const connectionType = normalizeConnectionType(body?.connectionType);
  if (!PPP_UI_TYPES.includes(connectionType)) {
    return { error: 'Connection Type tidak valid' };
  }

  let vlanId = 0;
  if (body.vlanStatus) {
    vlanId = readInt(body?.vlanId, 1, 4094);
    if (vlanId === null) {
      return { error: 'VLAN ID harus bilangan bulat 1-4094' };
    }
  }
  const priority = readInt(body?.priority ?? 0, 0, 7);
  if (priority === null) {
    return { error: '802.1p harus bilangan bulat 0-7' };
  }
  let mtu = null;
  if (body?.mtu !== undefined && body?.mtu !== null && String(body.mtu).trim() !== '') {
    mtu = readInt(body.mtu, MTU_MIN, MTU_MAX);
    if (mtu === null) {
      return { error: `MTU harus bilangan bulat ${MTU_MIN}-${MTU_MAX}` };
    }
  }

  // Bridge tidak memakai autentikasi PPPoE. Nilai yang masih terbawa dari mode routed diabaikan.
  const bridged = isBridgedConnection(connectionType);
  let username = '';
  let password = null;
  if (!bridged) {
    username = readText(body?.username, 128);
    if (!username) {
      return { error: 'Username wajib diisi (maksimal 128 karakter)' };
    }
    const rawPassword = body?.password;
    if (rawPassword !== undefined && rawPassword !== null && String(rawPassword) !== '') {
      if (typeof rawPassword !== 'string') {
        return { error: 'Password tidak valid' };
      }
      password = rawPassword.trim();
      if (!password || password.length > 64 || /[\u0000-\u001F\u007F]/.test(password)) {
        return { error: 'Password wajib diisi (maksimal 64 karakter)' };
      }
    } else if (!wanPath) {
      return { error: 'Password wajib diisi (maksimal 64 karakter)' };
    }
  }

  const ports = readPorts(body?.ports);
  if (ports.error) {
    return { error: ports.error };
  }

  const manufacturer = typeof body?.manufacturer === 'string' ? body.manufacturer.trim().slice(0, 200) : '';

  return {
    value: {
      deviceId,
      wanPath: wanPath || null,
      connectionName,
      enableConnection: body.enableConnection,
      natStatus: body.natStatus,
      serviceList,
      connectionType,
      vlanStatus: body.vlanStatus,
      vlanId,
      priority,
      username,
      password,
      mtu,
      ports: ports.value,
      manufacturer,
      deviceType,
    },
  };
}

function normalizeConnectionType(value) {
  const compact = String(value || '').trim().toLowerCase().replace(/-/g, '_');
  if (compact === 'ip_routed') {
    return 'ip-routed';
  }
  if (compact === 'pppoe_bridged' || compact === 'pppoe_routed') {
    return compact;
  }
  if (compact === 'ip_bridged') {
    return 'ip-bridged';
  }
  return typeof value === 'string' ? value.trim() : '';
}

function isBridgedConnection(connectionType) {
  const compact = String(connectionType || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  return compact === 'pppoebridged' || compact === 'ipbridged';
}

function omitBridgeAuth(parameterValues, connectionType) {
  if (!isBridgedConnection(connectionType) || !Array.isArray(parameterValues)) {
    return parameterValues;
  }
  return parameterValues.filter(([path]) => {
    const leaf = String(path).split('.').pop();
    return leaf !== 'Username' && leaf !== 'Password';
  });
}

function accessKind(accessType) {
  return String(accessType || '').toLowerCase().includes('epon') ? 'Epon' : 'Gpon';
}

function selectedLanInterfaces(ports) {
  return PORT_KEYS.filter((key) => ports[key]).map((key) => LAN_INTERFACE[key]).join(',');
}

const PORT_BIND_ORDER = [
  ['LAN1', `${IGD}.LANDevice.1.LANEthernetInterfaceConfig.1`],
  ['LAN2', `${IGD}.LANDevice.1.LANEthernetInterfaceConfig.2`],
  ['LAN3', `${IGD}.LANDevice.1.LANEthernetInterfaceConfig.3`],
  ['LAN4', `${IGD}.LANDevice.1.LANEthernetInterfaceConfig.4`],
  ['SSID1', `${IGD}.LANDevice.1.WLANConfiguration.1`],
  ['SSID2', `${IGD}.LANDevice.1.WLANConfiguration.2`],
  ['SSID3', `${IGD}.LANDevice.1.WLANConfiguration.3`],
  ['SSID4', `${IGD}.LANDevice.1.WLANConfiguration.4`],
  ['SSID5', `${IGD}.LANDevice.1.WLANConfiguration.5`],
  ['SSID6', `${IGD}.LANDevice.1.WLANConfiguration.6`],
  ['SSID7', `${IGD}.LANDevice.1.WLANConfiguration.7`],
  ['SSID8', `${IGD}.LANDevice.1.WLANConfiguration.8`],
];
const PORT_BIND_PATH = new Map(PORT_BIND_ORDER);
const HUAWEI_BIND_LABEL = {
  LAN1: 'Lan1Enable',
  LAN2: 'Lan2Enable',
  LAN3: 'Lan3Enable',
  LAN4: 'Lan4Enable',
  SSID1: 'SSID1Enable',
  SSID2: 'SSID2Enable',
  SSID3: 'SSID3Enable',
  SSID4: 'SSID4Enable',
  SSID5: 'SSID5Enable',
  SSID6: 'SSID6Enable',
  SSID7: 'SSID7Enable',
  SSID8: 'SSID8Enable',
};
const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
const WAN_IP_PATH = /^InternetGatewayDevice\.WANDevice\.\d+\.WANConnectionDevice\.\d+\.WANIPConnection\.\d+\.$/;
const IP_CONNECTION_TYPES = ['IP_Routed', 'IP_Bridged'];

function isF67Family(manufacturer, modelName) {
  const text = `${manufacturer || ''} ${modelName || ''}`;
  return /F670|F67/i.test(text);
}

function normalizePortLabels(value) {
  if (!Array.isArray(value)) {
    return { error: 'Port binding tidak valid' };
  }
  const labels = [];
  for (const item of value) {
    const label = String(item || '').trim().toUpperCase();
    if (!PORT_BIND_PATH.has(label)) {
      return { error: 'Port binding tidak valid' };
    }
    if (!labels.includes(label)) {
      labels.push(label);
    }
  }
  return { value: labels };
}

// Array ['LAN1', 'SSID1'] menjadi path TR-069 dipisah koma tanpa spasi.
// ZTE F67x mewajibkan path WANIPConnection itu sendiri ikut di ujung string.
function generatePortBindingString(ports, { manufacturer = '', modelName = '', wanIpPath = '' } = {}) {
  const selected = new Set(
    (Array.isArray(ports) ? ports : []).map((item) => String(item || '').trim().toUpperCase()),
  );
  const paths = PORT_BIND_ORDER.filter(([label]) => selected.has(label)).map(([, path]) => path);
  if (isF67Family(manufacturer, modelName)) {
    const self = String(wanIpPath || '').trim().replace(/\.+$/, '');
    if (self) {
      paths.push(self);
    }
  }
  return paths.join(',');
}

function readIpv4(value, label) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!IPV4.test(text) || text === '0.0.0.0') {
    return { error: `${label} harus alamat IPv4 yang valid` };
  }
  return { value: text };
}

function normalizeIpConnectionType(value) {
  const compact = String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (compact === 'iprouted') {
    return 'IP_Routed';
  }
  if (compact === 'ipbridged') {
    return 'IP_Bridged';
  }
  return '';
}

function normalizeAddressingType(value) {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'dhcp') {
    return 'DHCP';
  }
  if (text === 'static') {
    return 'Static';
  }
  return '';
}

// Body form Add/Edit WAN IP. wanPath kosong = buat instance WANIPConnection baru.
function parseWanIp(body) {
  const deviceId = typeof body?.deviceId === 'string' ? body.deviceId.trim() : '';
  if (!deviceId || deviceId.length > 255) {
    return { error: 'ID perangkat tidak valid' };
  }

  let wanPath = '';
  if (body?.wanPath !== undefined && body?.wanPath !== null && body?.wanPath !== '') {
    wanPath = typeof body.wanPath === 'string' ? body.wanPath.trim() : '';
    if (wanPath && !wanPath.endsWith('.')) {
      wanPath += '.';
    }
    if (!WAN_IP_PATH.test(wanPath)) {
      return { error: 'Path WAN IP tidak valid' };
    }
  }

  const deviceTypeError = readDeviceType(body);
  if (deviceTypeError.error) {
    return { error: deviceTypeError.error };
  }
  const { deviceType } = deviceTypeError;
  const connectionName = readConnectionName(body, deviceType);
  if (connectionName === null || (deviceType !== 'fiberhome' && !connectionName)) {
    return { error: 'Connection Name wajib diisi (maksimal 128 karakter)' };
  }
  if (typeof body?.enableConnection !== 'boolean' || typeof body?.vlanStatus !== 'boolean') {
    return { error: 'Status koneksi dan VLAN harus berupa true atau false' };
  }

  const serviceList = typeof body?.serviceList === 'string' ? body.serviceList.trim() : '';
  if (!SERVICE_LIST.includes(serviceList)) {
    return { error: 'Service List tidak valid' };
  }
  const connectionType = normalizeIpConnectionType(body?.connectionType);
  if (!IP_CONNECTION_TYPES.includes(connectionType)) {
    return { error: 'Connection Type tidak valid' };
  }

  let vlanId = 0;
  if (body.vlanStatus) {
    vlanId = readInt(body?.vlanId, 1, 4094);
    if (vlanId === null) {
      return { error: 'VLAN ID harus bilangan bulat 1-4094' };
    }
  }
  const priority = readInt(body?.priority ?? 0, 0, 7);
  if (priority === null) {
    return { error: '802.1p harus bilangan bulat 0-7' };
  }

  const bridged = connectionType === 'IP_Bridged';
  let addressingType = 'DHCP';
  let ipAddress = '';
  let subnetMask = '';
  let gateway = '';
  let dnsServer = '';
  if (!bridged) {
    addressingType = normalizeAddressingType(body?.addressing ?? body?.addressingType);
    if (!addressingType) {
      return { error: 'Addressing Type tidak valid' };
    }
    if (addressingType === 'Static') {
      const ip = readIpv4(body?.ipAddress, 'IP Address');
      if (ip.error) {
        return { error: ip.error };
      }
      const mask = readIpv4(body?.subnetMask, 'Subnet Mask');
      if (mask.error) {
        return { error: mask.error };
      }
      const gate = readIpv4(body?.gateway, 'Default Gateway');
      if (gate.error) {
        return { error: gate.error };
      }
      const dns = readIpv4(body?.dnsServer, 'DNS');
      if (dns.error) {
        return { error: dns.error };
      }
      ipAddress = ip.value;
      subnetMask = mask.value;
      gateway = gate.value;
      dnsServer = dns.value;
    }
  }

  const ports = normalizePortLabels(body?.ports);
  if (ports.error) {
    return { error: ports.error };
  }

  const manufacturer = typeof body?.manufacturer === 'string' ? body.manufacturer.trim().slice(0, 200) : '';
  const modelName = typeof body?.modelName === 'string' ? body.modelName.trim().slice(0, 200) : '';

  return {
    value: {
      deviceId,
      wanPath: wanPath || null,
      connectionName,
      enableConnection: body.enableConnection,
      natStatus: !bridged,
      serviceList,
      connectionType,
      vlanStatus: body.vlanStatus,
      vlanId,
      priority,
      addressingType: bridged ? null : addressingType,
      ipAddress,
      subnetMask,
      gateway,
      dnsServer,
      ports: ports.value,
      manufacturer,
      modelName,
      deviceType,
    },
  };
}

function ipCoreParameters(ipPath, values) {
  const bridged = values.connectionType === 'IP_Bridged';
  const list = [];
  push(list, `${ipPath}Enable`, values.enableConnection === true, 'xsd:boolean');
  push(list, `${ipPath}ConnectionType`, values.connectionType, 'xsd:string');
  push(list, `${ipPath}NATEnabled`, bridged ? false : true, 'xsd:boolean');
  if (!bridged && values.addressingType) {
    push(list, `${ipPath}AddressingType`, values.addressingType, 'xsd:string');
    if (values.addressingType === 'Static') {
      push(list, `${ipPath}ExternalIPAddress`, values.ipAddress, 'xsd:string');
      push(list, `${ipPath}SubnetMask`, values.subnetMask, 'xsd:string');
      push(list, `${ipPath}DefaultGateway`, values.gateway, 'xsd:string');
      push(list, `${ipPath}DNSServers`, values.dnsServer, 'xsd:string');
    }
  }
  return list;
}

function ipBindParameters(profile, ctx) {
  if (profile === 'huawei') {
    const baseLabels = new Set(['LAN1', 'LAN2', 'LAN3', 'LAN4', 'SSID1', 'SSID2', 'SSID3', 'SSID4']);
    return PORT_BIND_ORDER
      .filter(([label]) => baseLabels.has(label) || ctx.ports.includes(label))
      .map(([label]) => [
        `${ctx.pppPath}X_HW_LANBIND.${HUAWEI_BIND_LABEL[label]}`,
        ctx.ports.includes(label),
        'xsd:boolean',
      ]);
  }
  const lan = generatePortBindingString(ctx.ports, {
    manufacturer: ctx.manufacturer,
    modelName: ctx.modelName,
    wanIpPath: ctx.pppPath,
  });
  if (!lan) {
    return [];
  }
  const name = profile === 'zte' ? 'X_ZTE-COM_LanInterface' : 'X_CT-COM_LanInterface';
  return [[`${ctx.pppPath}${name}`, lan, 'xsd:string']];
}

function planWanIp({ values, manufacturer, modelName, productModel, productClass, accessType, ipPath, connectionPath, knownLeaves, deviceLeaves, readOnlyLeaves, wanIndexValues, dataModel }) {
  const profile = dataModel === 'Device' || String(ipPath || '').startsWith('Device.')
    ? 'tr181'
    : vendorProfile(manufacturer || values.manufacturer);
  const resolvedModel = modelName || productModel || values.modelName || '';
  const vlanKind = profile === 'zte' ? detectZteVlanLink(knownLeaves) : null;
  const ctcomVariant = vlanKind === 'epon' || vlanKind === 'gpon';
  const ctx = {
    pppPath: ipPath,
    connectionPath,
    accessType,
    serviceList: values.serviceList,
    connectionType: values.connectionType,
    vlanStatus: values.vlanStatus,
    vlanId: Number.parseInt(values.vlanStatus ? values.vlanId : 0, 10),
    priority: Number.parseInt(values.vlanStatus ? values.priority : 0, 10),
    ports: values.ports,
    isEdit: Boolean(values.wanPath),
    manufacturer: manufacturer || values.manufacturer,
    modelName: resolvedModel,
  };
  const vendor = profile === 'zte' ? zteVendorForKind(ctx, vlanKind) : vendorParameters(profile, ctx, knownLeaves);
  const alternate = profile === 'zte' ? null : fallbackProfile(profile);
  const bindProfile = ctcomVariant ? 'ctcom' : profile;
  const batches = [
    {
      key: 'core',
      label: 'parameter standar',
      optional: false,
      parameterValues: sanitizeParameterValues(ipCoreParameters(ipPath, values)),
    },
    {
      key: 'vendor',
      label: 'VLAN, 802.1p, dan service list',
      optional: true,
      parameterValues: profile === 'zte'
        ? sanitizeParameterValues(vendor)
        : finalizeParameters(vendor, knownLeaves),
      fallback: alternate ? finalizeParameters(vendorParameters(alternate, ctx), knownLeaves) : null,
    },
    {
      key: 'bind',
      label: 'port binding',
      optional: true,
      parameterValues: profile === 'zte'
        ? sanitizeParameterValues(ipBindParameters(bindProfile, ctx))
        : finalizeParameters(ipBindParameters(profile, ctx), knownLeaves),
    },
  ];
  const connectionName = connectionNameRows(ipPath, values, manufacturer || values.manufacturer);
  const fields = ['enable', 'connectionType', 'nat', 'serviceList', 'vlan', 'priority'];
  if (connectionName.length > 0) {
    fields.unshift('connectionName');
  }
  if (values.connectionType === 'IP_Routed') {
    fields.push('addressing');
  }
  if (batches.some((batch) => batch.key === 'bind' && batch.parameterValues.length > 0)) {
    fields.push('ports');
  }
  const fallbackPayloads = profile === 'zte'
    ? zteVlanPayloads(batches, ctx, ipBindParameters, vlanKind)
    : [];
  return applyCmccDetection(applyWanIndexGuard({
    profile, ctcomVariant, vlanKind, fields, batches, connectionName, fallbackPayloads, singleAttempt: false, vlanBlocked: false, blockedMessage: '',
  }, ctcomWanIndexGuard({
    knownLeaves, readOnlyLeaves, wanIndexValues, vlanRequested: values.vlanStatus === true,
  })), ctx, {
    knownLeaves, deviceLeaves, readOnlyLeaves, manufacturer, productModel, productClass, modelName: resolvedModel,
  });
}

function isEmptyParameterValue(value) {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

function castByType(value, type) {
  if (type === 'xsd:boolean') {
    return value === true || value === 'true' || value === 1 || value === '1';
  }
  if (type === 'xsd:unsignedInt' || type === 'xsd:int' || type === 'xsd:integer') {
    const number = Number.parseInt(value, 10);
    return Number.isInteger(number) ? number : value;
  }
  return value;
}

function push(list, path, value, type) {
  if (isEmptyParameterValue(value)) {
    return;
  }
  list.push([path, value, type]);
}

// GenieACS menambahkan ".[]" sendiri pada objectName AddObject.
// Path yang sudah berakhir titik menjadi "WANPPPConnection..[]" dan ditolak sebagai Invalid parameter path.
function normalizeAcsObjectName(objectName) {
  return String(objectName || '').trim().replace(/\.+$/, '');
}

function sanitizeParameterValues(parameterValues) {
  if (!Array.isArray(parameterValues)) {
    return [];
  }
  return parameterValues
    .filter((row) => Array.isArray(row) && row.length >= 2 && !isEmptyParameterValue(row[1]))
    .map(([path, value, type]) => [path, castByType(value, type), type]);
}

function isTreeNode(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function instanceKeys(node) {
  if (!isTreeNode(node)) {
    return [];
  }
  return Object.keys(node).filter((key) => /^\d+$/.test(key)).sort((left, right) => Number(left) - Number(right));
}

// Nama parameter yang benar-benar ada di subtree (bukan indeks instance).
function isReadOnlyFlag(value) {
  return value === false || value === 0 || value === '0' || value === 'false';
}

function isCombinedWanIndex(value) {
  const text = String(value ?? '').trim();
  return text !== '' && !/^\d+$/.test(text);
}

function isVlanWritePath(path) {
  return /VLANID|VLANEnable|LinkConfig\.Mode|LinkConfig\.802/i.test(String(path));
}

function collectTreeMeta(node, prefix = '', into = null, depth = 0) {
  const meta = into || { names: new Set(), readOnly: new Set(), wanIndexValues: [] };
  if (!isTreeNode(node) || depth > 5) {
    return meta;
  }
  for (const key of Object.keys(node)) {
    if (key.startsWith('_')) {
      continue;
    }
    const child = node[key];
    if (!isTreeNode(child)) {
      continue;
    }
    if (/^\d+$/.test(key)) {
      collectTreeMeta(child, prefix, meta, depth + 1);
      continue;
    }
    const name = prefix ? `${prefix}.${key}` : key;
    meta.names.add(key);
    meta.names.add(name);
    if (isReadOnlyFlag(child._writable)) {
      meta.readOnly.add(key);
      meta.readOnly.add(name);
    }
    if (key === 'X_CT-COM_WANIndex' && child._value != null && String(child._value).trim() !== '') {
      meta.wanIndexValues.push(String(child._value).trim());
    }
    if (!Object.prototype.hasOwnProperty.call(child, '_value')) {
      collectTreeMeta(child, name, meta, depth + 1);
    }
  }
  return meta;
}

function collectParameterNames(node, prefix = '', into = new Set(), depth = 0) {
  if (!isTreeNode(node) || depth > 5) {
    return into;
  }
  for (const key of Object.keys(node)) {
    if (key.startsWith('_')) {
      continue;
    }
    const child = node[key];
    if (!isTreeNode(child)) {
      continue;
    }
    if (/^\d+$/.test(key)) {
      collectParameterNames(child, prefix, into, depth + 1);
      continue;
    }
    const name = prefix ? `${prefix}.${key}` : key;
    into.add(key);
    into.add(name);
    if (!Object.prototype.hasOwnProperty.call(child, '_value')) {
      collectParameterNames(child, name, into, depth + 1);
    }
  }
  return into;
}

function parameterKnown(path, known) {
  const parts = String(path).split('.');
  const leaf = parts[parts.length - 1];
  if (CORE_LEAVES.has(leaf)) {
    return true;
  }
  const parent = parts[parts.length - 2];
  return known.has(leaf) || known.has(`${parent}.${leaf}`);
}

function finalizeParameters(list, knownLeaves) {
  const known = Array.isArray(knownLeaves) ? new Set(knownLeaves) : null;
  return sanitizeParameterValues(list).filter(([path]) => !known || parameterKnown(path, known));
}

// Pilih WANDevice yang benar-benar punya WANConnectionDevice. Pada ZTE, indeks 1 sering
// hanya port optik; koneksi PPP/IP ada di indeks yang lebih tinggi (misalnya 2).
function selectWanLocation(wanDevices, profile) {
  const described = instanceKeys(wanDevices).map((index) => {
    const device = wanDevices[index];
    const connectionNode = device?.WANConnectionDevice;
    const connections = instanceKeys(connectionNode).map((connIndex) => {
      const node = connectionNode[connIndex];
      return {
        index: connIndex,
        ppp: instanceKeys(node?.WANPPPConnection),
        ip: instanceKeys(node?.WANIPConnection),
      };
    });
    const access = device?.WANCommonInterfaceConfig?.WANAccessType?._value;
    const meta = collectTreeMeta(connectionNode);
    const connectionMeta = Object.fromEntries(instanceKeys(connectionNode).map((connIndex) => {
      const item = collectTreeMeta(connectionNode[connIndex]);
      return [connIndex, item];
    }));
    return {
      index,
      hasConnectionObject: isTreeNode(connectionNode),
      connections,
      accessType: access == null ? '' : String(access),
      knownLeaves: [...meta.names],
      deviceLeaves: [...collectTreeMeta(device).names],
      readOnlyLeaves: [...meta.readOnly],
      wanIndexValues: meta.wanIndexValues,
      connectionLeaves: Object.fromEntries(Object.entries(connectionMeta).map(([connIndex, item]) => [connIndex, [...item.names]])),
      connectionReadOnly: Object.fromEntries(Object.entries(connectionMeta).map(([connIndex, item]) => [connIndex, [...item.readOnly]])),
    };
  });
  const usable = described.filter((item) => item.hasConnectionObject);
  const withService = usable.filter((item) => item.connections.some((conn) => conn.ppp.length > 0 || conn.ip.length > 0));
  const pool = withService.length > 0 ? withService : usable;
  const chosen = pool.length > 0 ? pool[pool.length - 1] : null;
  if (!chosen) {
    const fallback = described.length > 0 ? described[described.length - 1] : null;
    return {
      wanDeviceIndex: fallback ? fallback.index : null,
      connectionIndex: null,
      createConnectionDevice: Boolean(fallback),
      accessType: fallback ? fallback.accessType : '',
      knownLeaves: fallback ? fallback.knownLeaves : [],
      deviceLeaves: fallback?.deviceLeaves || [],
      readOnlyLeaves: fallback?.readOnlyLeaves || [],
      wanIndexValues: fallback?.wanIndexValues || [],
      connectionLeaves: fallback?.connectionLeaves || {},
      connectionReadOnly: fallback?.connectionReadOnly || {},
      tr181: false,
    };
  }
  const reuseConnection = profile === 'huawei' || profile === 'zte';
  let connectionIndex = null;
  if (reuseConnection && chosen.connections.length > 0) {
    const withPpp = chosen.connections.filter((conn) => conn.ppp.length > 0);
    const host = (withPpp.length > 0 ? withPpp : chosen.connections).at(-1);
    connectionIndex = host.index;
  }
  // Fiberhome menaruh tepat SATU koneksi per WANConnectionDevice (diukur pada 13 ONU: WCD1 = IP TR069, tiap
  // WAN lain di WCD sendiri), jadi koneksi baru tidak boleh dicampur ke WCD yang sudah berisi. Wadah kosong sisa
  // WAN yang dihapus dipakai ulang dulu; ONU membatasi jumlah WCD (9004 Resources exceeded) dan cangkang kosong
  // yang menumpuk menghabiskan slot itu.
  let reusedEmpty = false;
  if (profile === 'fiberhome' && !connectionIndex) {
    const empty = chosen.connections
      .filter((conn) => conn.ppp.length === 0 && conn.ip.length === 0)
      .sort((left, right) => Number(left.index) - Number(right.index))[0];
    if (empty) {
      connectionIndex = empty.index;
      reusedEmpty = true;
    }
  }
  return {
    wanDeviceIndex: chosen.index,
    connectionIndex,
    reusedEmpty,
    createConnectionDevice: !connectionIndex,
    accessType: chosen.accessType,
    knownLeaves: chosen.knownLeaves,
    deviceLeaves: chosen.deviceLeaves || [],
    readOnlyLeaves: chosen.readOnlyLeaves || [],
    wanIndexValues: chosen.wanIndexValues || [],
    connectionLeaves: chosen.connectionLeaves || {},
    connectionReadOnly: chosen.connectionReadOnly || {},
    tr181: false,
  };
}

function selectTr181Location(deviceNode) {
  const ppp = deviceNode?.PPP?.Interface;
  return {
    wanDeviceIndex: null,
    connectionIndex: null,
    createConnectionDevice: false,
    accessType: '',
    knownLeaves: [...collectParameterNames(ppp)],
    deviceLeaves: [],
    readOnlyLeaves: [],
    wanIndexValues: [],
    connectionReadOnly: {},
    tr181: true,
  };
}

// ConnectionType TR-098 yang ditulis ke ONU. Fiberhome: TR-098 baku tidak punya nilai "PPPoE_Routed",
// koneksi PPPoE routed ditulis IP_Routed (mayoritas ONU HG6145D2 di lapangan); bridged tetap PPPoE_Bridged.
function connectionTypeForOnu(connectionType, { fiberhome = false } = {}) {
  if (fiberhome && (connectionType === 'pppoe_routed' || connectionType === 'ip-routed' || connectionType === 'ip_routed')) {
    return 'IP_Routed';
  }
  return CONNECTION_TYPE_TR069[connectionType];
}

function coreParameters(pppPath, values, { fiberhome = false } = {}) {
  const list = [];
  // Satu nilai Enable boolean. ConnectionTrigger dan MTU tidak dikirim.
  push(list, `${pppPath}Enable`, values.enableConnection === true, 'xsd:boolean');
  push(list, `${pppPath}ConnectionType`, connectionTypeForOnu(values.connectionType, { fiberhome }), 'xsd:string');
  if (!isBridgedConnection(values.connectionType)) {
    if (values.username) {
      push(list, `${pppPath}Username`, values.username, 'xsd:string');
    }
    if (values.password) {
      push(list, `${pppPath}Password`, values.password, 'xsd:string');
    }
  }
  // ONU menolak NAT pada koneksi bridge dengan CWMP 9003 (Invalid arguments). Koneksi bridged bawaan
  // ONU (mis. ZTE "hotspot") selalu NATEnabled=false, jadi nilainya dipaksa false walau form mencentang NAT.
  const nat = isBridgedConnection(values.connectionType) ? false : values.natStatus === true;
  push(list, `${pppPath}NATEnabled`, nat, 'xsd:boolean');
  return list;
}

function tr181Parameters() {
  return [];
}

function isCtComZteVariant({ knownLeaves } = {}) {
  return detectZteVlanLink(knownLeaves) !== 'zte';
}

// Objek pada WANConnectionDevice yang sedang diproses. EPON dicek lebih dulu, lalu GPON.
function detectZteVlanLink(knownLeaves) {
  const leaves = (Array.isArray(knownLeaves) ? knownLeaves : [])
    .map((name) => String(name))
    .filter((name) => !/X_CMCC_/i.test(name));
  const has = (token) => leaves.some((name) => name.includes(token));
  if (has('WANEponLinkConfig')) {
    return 'epon';
  }
  if (has('WANGPONLinkConfig')) {
    return 'gpon';
  }
  return 'zte';
}

const CMCC_CANCEL_MESSAGE = 'Firmware China Mobile mendeteksi parameter tidak standar, konfigurasi otomatis dibatalkan';

function detectionLeaves({ knownLeaves, deviceLeaves } = {}) {
  return [...new Set([...(knownLeaves || []), ...(deviceLeaves || [])].map((name) => String(name)))];
}

function hasCmccKeyword(value) {
  const text = String(value || '');
  return /X_CMCC_/i.test(text) || /chinamobile/i.test(text.replace(/[\s_-]+/g, ''));
}

function isCmccSignal({ knownLeaves, deviceLeaves, manufacturer, productModel, productClass, modelName } = {}) {
  const identity = [manufacturer, productModel, productClass, modelName];
  if (identity.some((value) => hasCmccKeyword(value))) {
    return true;
  }
  return detectionLeaves({ knownLeaves, deviceLeaves }).some((name) => hasCmccKeyword(name));
}

function detectCmccLink(knownLeaves, deviceLeaves) {
  const objects = [];
  for (const name of detectionLeaves({ knownLeaves, deviceLeaves })) {
    const parts = name.includes('.') ? name.split('.') : [name];
    for (const part of parts) {
      if (/X_CMCC_/i.test(part) && /WAN/i.test(part) && /LinkConfig/i.test(part) && !objects.includes(part)) {
        objects.push(part);
      }
    }
  }
  return objects.find((name) => /epon/i.test(name))
    || objects.find((name) => /gpon/i.test(name))
    || objects[0]
    || '';
}

function cmccLinkLocked(readOnlyLeaves, linkObject) {
  return (Array.isArray(readOnlyLeaves) ? readOnlyLeaves : []).some((name) => {
    const text = String(name);
    return text.includes(linkObject) && isVlanWritePath(text);
  });
}

function cmccGuard(hints = {}) {
  if (!isCmccSignal(hints)) {
    return { cmcc: false, blocked: false, linkObject: '', message: '' };
  }
  const linkObject = detectCmccLink(hints.knownLeaves, hints.deviceLeaves);
  if (!linkObject || cmccLinkLocked(hints.readOnlyLeaves, linkObject)) {
    return { cmcc: true, blocked: true, linkObject: '', message: CMCC_CANCEL_MESSAGE };
  }
  return { cmcc: true, blocked: false, linkObject, message: '' };
}

function cmccVlanParameters(ctx, linkObject, knownLeaves, deviceLeaves) {
  const known = detectionLeaves({ knownLeaves, deviceLeaves });
  const link = `${ctx.connectionPath}${linkObject}`;
  const vlanId = Number.parseInt(ctx.vlanId, 10);
  const mode = Number.parseInt(2, 10);
  const list = [];
  if (ctx.vlanStatus && Number.isInteger(vlanId) && Number.isInteger(mode)) {
    push(list, `${link}.VLANIDMark`, vlanId, 'xsd:unsignedInt');
    if (known.some((name) => name === `${linkObject}.Mode` || name.endsWith(`.${linkObject}.Mode`))) {
      push(list, `${link}.Mode`, mode, 'xsd:unsignedInt');
    }
  }
  if (known.some((name) => name.includes('X_CMCC_ServiceList'))) {
    push(list, `${ctx.pppPath}X_CMCC_ServiceList`, ctx.serviceList, 'xsd:string');
  }
  return list;
}

function cmccBindParameters(ctx, knownLeaves, deviceLeaves) {
  const known = detectionLeaves({ knownLeaves, deviceLeaves });
  if (!known.some((name) => name.includes('X_CMCC_LanInterface'))) {
    return [];
  }
  const lan = Array.isArray(ctx.ports)
    ? generatePortBindingString(ctx.ports, {
      manufacturer: ctx.manufacturer,
      modelName: ctx.modelName,
      wanIpPath: ctx.pppPath,
    })
    : selectedLanInterfaces(ctx.ports);
  if (!lan) {
    return [];
  }
  return [[`${ctx.pppPath}X_CMCC_LanInterface`, lan, 'xsd:string']];
}

function applyCmccDetection(plan, ctx, hints) {
  const guard = cmccGuard(hints);
  if (!guard.cmcc) {
    return plan;
  }
  if (guard.blocked) {
    return {
      ...plan,
      vlanKind: 'cmcc',
      ctcomVariant: false,
      fallbackPayloads: [],
      singleAttempt: true,
      vlanBlocked: true,
      blockedMessage: guard.message,
    };
  }
  const batches = plan.batches.map((batch) => {
    if (batch.key === 'vendor') {
      return {
        ...batch,
        parameterValues: sanitizeParameterValues(cmccVlanParameters(ctx, guard.linkObject, hints.knownLeaves, hints.deviceLeaves)),
        fallback: null,
      };
    }
    if (batch.key === 'bind') {
      return {
        ...batch,
        parameterValues: sanitizeParameterValues(cmccBindParameters(ctx, hints.knownLeaves, hints.deviceLeaves)),
        fallback: null,
      };
    }
    return batch;
  });
  return {
    ...plan,
    batches,
    vlanKind: 'cmcc',
    ctcomVariant: false,
    cmccLink: guard.linkObject,
    fallbackPayloads: [],
    singleAttempt: true,
    vlanBlocked: false,
    blockedMessage: '',
  };
}

function zteVlanFallbackKinds(primary, accessType) {
  const optical = String(accessType || '').toLowerCase().includes('epon')
    ? ['epon', 'gpon']
    : ['gpon', 'epon'];
  if (primary === 'zte') {
    return optical;
  }
  return [...optical.filter((kind) => kind !== primary), 'zte'];
}

function connectionLeavesFor(location, connectionPath) {
  const match = String(connectionPath || '').match(/WANConnectionDevice\.(\d+)\./);
  const index = match ? match[1] : '';
  const scoped = index && location?.connectionLeaves ? location.connectionLeaves[index] : null;
  if (Array.isArray(scoped) && scoped.length > 0) {
    return scoped;
  }
  return Array.isArray(location?.knownLeaves) ? location.knownLeaves : [];
}

function readOnlyLeavesFor(location, connectionPath) {
  const match = String(connectionPath || '').match(/WANConnectionDevice\.(\d+)\./);
  const index = match ? match[1] : '';
  const scoped = index && location?.connectionReadOnly ? location.connectionReadOnly[index] : null;
  if (Array.isArray(scoped) && scoped.length > 0) {
    return scoped;
  }
  return Array.isArray(location?.readOnlyLeaves) ? location.readOnlyLeaves : [];
}

function ctcomWanIndexGuard({ knownLeaves, readOnlyLeaves, wanIndexValues, vlanRequested = false } = {}) {
  const leaves = Array.isArray(knownLeaves) ? knownLeaves : [];
  const hasName = leaves.some((name) => String(name).includes('X_CT-COM_WANIndex'));
  const values = Array.isArray(wanIndexValues) ? wanIndexValues : [];
  const combined = values.some((value) => isCombinedWanIndex(value));
  if (!hasName || !combined) {
    return { blocked: false, singleAttempt: false, omitVlan: false, message: '' };
  }
  const locked = (Array.isArray(readOnlyLeaves) ? readOnlyLeaves : [])
    .some((name) => isVlanWritePath(name));
  if (locked && vlanRequested) {
    return {
      blocked: true,
      singleAttempt: true,
      omitVlan: true,
      message: 'Gagal: struktur VLAN pada modem CT-COM ini hanya bisa dibaca (X_CT-COM_WANIndex). Pembuatan profil dihentikan.',
    };
  }
  return {
    blocked: false,
    singleAttempt: true,
    omitVlan: locked,
    message: '',
  };
}

function isInvalidParameterFault(error) {
  return /invalid parameter (?:name|path)/i.test(String(error?.message || ''));
}

function isReadOnlyParameterFault(error) {
  return /9008|read[\s-]*only|not writable|non-writable/i.test(String(error?.message || ''));
}

function isCommitLoopFault(error) {
  return error?.code === 'COMMIT_LOOP' || /too_many_commits|too many commits/i.test(String(error?.message || ''));
}

function isStructuralRejection(error) {
  return isInvalidParameterFault(error) || isReadOnlyParameterFault(error) || isCommitLoopFault(error);
}

function applyWanIndexGuard(plan, guard) {
  if (!guard?.singleAttempt && !guard?.omitVlan) {
    return plan;
  }
  const batches = guard.omitVlan
    ? plan.batches.map((batch) => (
      batch.key === 'vendor'
        ? { ...batch, parameterValues: batch.parameterValues.filter(([path]) => !isVlanWritePath(path)) }
        : batch
    ))
    : plan.batches;
  return {
    ...plan,
    batches,
    fallbackPayloads: [],
    singleAttempt: true,
    vlanBlocked: Boolean(guard.blocked),
    blockedMessage: guard.message || '',
  };
}

const ZTE_VLAN_LINK = {
  epon: 'X_CT-COM_WANEponLinkConfig',
  gpon: 'X_CT-COM_WANGPONLinkConfig',
};

// VLAN CT-COM ZTE ada di WANConnectionDevice, terpisah dari WANPPPConnection / WANIPConnection.
function zteOpticalLink(ctx, kind) {
  const link = `${ctx.connectionPath}${ZTE_VLAN_LINK[kind]}`;
  const vlanId = Number.parseInt(ctx.vlanId, 10);
  const mode = Number.parseInt(2, 10);
  const list = [];
  if (ctx.vlanStatus && Number.isInteger(vlanId) && Number.isInteger(mode)) {
    push(list, `${link}.Mode`, mode, 'xsd:unsignedInt');
    push(list, `${link}.VLANIDMark`, vlanId, 'xsd:unsignedInt');
  }
  push(list, `${ctx.pppPath}X_CT-COM_ServiceList`, ctx.serviceList, 'xsd:string');
  return list;
}

function zteVendorForKind(ctx, kind) {
  return kind === 'zte' ? zteParameters(ctx) : zteOpticalLink(ctx, kind);
}

function ctcomParameters(ctx) {
  const link = `${ctx.connectionPath}X_CT-COM_WAN${accessKind(ctx.accessType)}LinkConfig`;
  const mode = ctx.vlanStatus ? 2 : 0;
  const list = [];
  push(list, `${link}.Mode`, mode, 'xsd:unsignedInt');
  push(list, `${link}.VLANIDMark`, ctx.vlanId, 'xsd:unsignedInt');
  push(list, `${link}.802-1pMark`, ctx.priority, 'xsd:unsignedInt');
  push(list, `${ctx.pppPath}X_CT-COM_ServiceList`, ctx.serviceList, 'xsd:string');
  return list;
}

// Fiberhome HG6145D2 (diukur pada 19 ONU): VLAN, 802.1p, dan service list disimpan di WANPPPConnection itu
// sendiri (VLANEnable, VLANID, X_FH_802-1pMark, X_FH_ServiceList). X_FH_WANGponLinkConfig pada
// WANConnectionDevice tetap Mode=0/VLANID=0 untuk WAN yang berjalan, jadi tidak ditulis. X_BROADCOM_COM_VlanMuxID,
// X_FH_VLANID, dan X_FH_PortBinding tidak ada pada pohon ONU ini.
// Firmware Fiberhome lain yang pohon PPP-nya sudah terisi tetapi TIDAK punya VLANID di level PPP memakai
// link config (perilaku lama).
function fiberhomeVlanAtLink(knownLeaves) {
  const known = new Set(Array.isArray(knownLeaves) ? knownLeaves : []);
  const pppPopulated = known.has('WANPPPConnection.Username') || known.has('WANPPPConnection.ConnectionType');
  const pppVlan = known.has('WANPPPConnection.VLANID');
  const linkVlan = [...known].some((name) => /^X_FH_WAN\w*LinkConfig\.VLANID$/.test(name));
  return pppPopulated && !pppVlan && linkVlan;
}

function fiberhomeParameters(ctx, knownLeaves) {
  const list = [];
  push(list, `${ctx.pppPath}X_FH_ServiceList`, ctx.serviceList, 'xsd:string');
  if (fiberhomeVlanAtLink(knownLeaves)) {
    const link = `${ctx.connectionPath}X_FH_WAN${accessKind(ctx.accessType)}LinkConfig`;
    push(list, `${link}.Enable`, ctx.vlanStatus ? 1 : 0, 'xsd:unsignedInt');
    push(list, `${link}.Mode`, ctx.vlanStatus ? 2 : 0, 'xsd:unsignedInt');
    push(list, `${link}.VLANID`, ctx.vlanId, 'xsd:unsignedInt');
    push(list, `${link}.VLANIDMark`, ctx.vlanId, 'xsd:unsignedInt');
    push(list, `${link}.802-1pMark`, ctx.priority, 'xsd:unsignedInt');
    return list;
  }
  if (ctx.vlanStatus) {
    push(list, `${ctx.pppPath}VLANEnable`, true, 'xsd:boolean');
    push(list, `${ctx.pppPath}VLANID`, ctx.vlanId, 'xsd:unsignedInt');
    push(list, `${ctx.pppPath}X_FH_802-1pMark`, ctx.priority, 'xsd:unsignedInt');
  }
  return list;
}

// Nama leaf port binding Fiberhome. X_FH_LanInterface (daftar path dipisah koma, sama dengan format ZTE/CT-COM);
// firmware China-Telecom yang hanya punya X_CT-COM_LanInterface tetap didukung.
function fiberhomeLanLeaf(knownLeaves) {
  const known = new Set(Array.isArray(knownLeaves) ? knownLeaves : []);
  return known.has('X_CT-COM_LanInterface') && !known.has('X_FH_LanInterface')
    ? 'X_CT-COM_LanInterface'
    : 'X_FH_LanInterface';
}

// VLAN ZTE berada di WANPPPConnection yang sama dengan autentikasi.
// X_ZTE-COM_8021PMark tidak ada pada modem ini; prioritas memakai X_ZTE-COM_8021P.
function zteParameters(ctx) {
  const vlanId = Number.parseInt(ctx.vlanId, 10);
  const priority = Number.parseInt(ctx.priority, 10);
  const list = [];
  push(list, `${ctx.pppPath}X_ZTE-COM_ServiceList`, ctx.serviceList, 'xsd:string');
  if (ctx.vlanStatus) {
    push(list, `${ctx.pppPath}X_ZTE-COM_VLANEnable`, 1, 'xsd:unsignedInt');
    if (Number.isInteger(vlanId)) {
      push(list, `${ctx.pppPath}X_ZTE-COM_VLANID`, vlanId, 'xsd:unsignedInt');
    }
    if (Number.isInteger(priority)) {
      push(list, `${ctx.pppPath}X_ZTE-COM_8021P`, priority, 'xsd:unsignedInt');
    }
  }
  return list;
}

function huaweiParameters(ctx) {
  const list = [];
  push(list, `${ctx.pppPath}X_HW_SERVICELIST`, ctx.serviceList, 'xsd:string');
  push(list, `${ctx.pppPath}X_HW_VLAN`, ctx.vlanId, 'xsd:unsignedInt');
  push(list, `${ctx.pppPath}X_HW_PRI`, ctx.priority, 'xsd:unsignedInt');
  return list;
}

function vendorParameters(profile, ctx, knownLeaves) {
  if (profile === 'tr181') {
    return tr181Parameters();
  }
  if (profile === 'huawei') {
    return huaweiParameters(ctx);
  }
  if (profile === 'zte') {
    return zteParameters(ctx);
  }
  if (profile === 'fiberhome') {
    return fiberhomeParameters(ctx, knownLeaves);
  }
  return ctcomParameters(ctx);
}

function fallbackProfile(profile) {
  // ZTE dan FiberHome versi China-Telecom menolak parameter X_ZTE / X_FH dan memakai X_CT-COM.
  if (profile === 'zte' || profile === 'fiberhome') {
    return 'ctcom';
  }
  return null;
}

function bindParameters(profile, ctx) {
  const lan = selectedLanInterfaces(ctx.ports);
  if (!lan && !ctx.isEdit) {
    return [];
  }
  if (profile === 'huawei') {
    return PORT_KEYS.filter((key) => !/^ssid[5-8]$/.test(key) || ctx.ports[key]).map((key) => [
      `${ctx.pppPath}X_HW_LANBIND.${HUAWEI_BIND[key]}`,
      ctx.ports[key],
      'xsd:boolean',
    ]);
  }
  let name = 'X_CT-COM_LanInterface';
  if (profile === 'zte') {
    name = 'X_ZTE-COM_LanInterface';
  } else if (profile === 'fiberhome') {
    // Dulu jatuh ke X_CT-COM_LanInterface yang tidak ada di Fiberhome, lalu dibuang diam-diam oleh filter leaf.
    name = fiberhomeLanLeaf(ctx.knownLeaves);
  }
  return [[`${ctx.pppPath}${name}`, lan, 'xsd:string']];
}

// batches dijalankan berurutan. fallback hanya dicoba bila batch vendor ditolak ONU.
function planWanPpp({ values, manufacturer, productModel, productClass, accessType, pppPath, connectionPath, knownLeaves, deviceLeaves, readOnlyLeaves, wanIndexValues, dataModel }) {
  let profile = dataModel === 'Device' || String(pppPath || '').startsWith('Device.')
    ? 'tr181'
    : vendorProfile(manufacturer);
  // Tipe Perangkat yang dipilih user di form menang atas merek yang terbaca dari ACS.
  if (profile !== 'tr181' && normalizeDeviceType(values.deviceType) === 'fiberhome') {
    profile = 'fiberhome';
  }
  const fiberhome = profile === 'fiberhome';
  const vlanKind = profile === 'zte' ? detectZteVlanLink(knownLeaves) : null;
  const ctcomVariant = vlanKind === 'epon' || vlanKind === 'gpon';
  const ctx = {
    pppPath,
    connectionPath,
    knownLeaves,
    accessType,
    serviceList: values.serviceList,
    connectionType: values.connectionType,
    vlanStatus: values.vlanStatus,
    vlanId: Number.parseInt(values.vlanStatus ? values.vlanId : 0, 10),
    priority: Number.parseInt(values.vlanStatus ? values.priority : 0, 10),
    ports: values.ports,
    isEdit: Boolean(values.wanPath),
  };
  const vendor = profile === 'zte' ? zteVendorForKind(ctx, vlanKind) : vendorParameters(profile, ctx, knownLeaves);
  const alternate = profile === 'zte' ? null : fallbackProfile(profile);
  const bindProfile = ctcomVariant ? 'ctcom' : profile;
  const batches = [
    {
      key: 'core',
      label: 'parameter standar',
      optional: false,
      parameterValues: finalizeParameters(coreParameters(pppPath, values, { fiberhome }), knownLeaves),
    },
    {
      key: 'vendor',
      label: 'VLAN, 802.1p, dan service list',
      optional: true,
      // ZTE dan Fiberhome: struktur sudah dipilih dari pohon ONU (fiberhomeParameters / detectZteVlanLink).
      // Instance yang baru di-AddObject belum tentu sudah punya leaf PPP di DB ACS, jadi filter leaf
      // akan membuang VLANID/VLANEnable secara diam-diam.
      parameterValues: profile === 'zte' || fiberhome
        ? sanitizeParameterValues(vendor)
        : finalizeParameters(vendor, knownLeaves),
      fallback: alternate ? finalizeParameters(vendorParameters(alternate, ctx), knownLeaves) : null,
    },
    {
      key: 'bind',
      label: 'port binding',
      optional: true,
      parameterValues: profile === 'zte'
        ? sanitizeParameterValues(bindParameters(bindProfile, ctx))
        : fiberhome
          ? sanitizeParameterValues(bindParameters(profile, ctx))
          : finalizeParameters(bindParameters(profile, ctx), knownLeaves),
    },
  ];
  const connectionName = connectionNameRows(pppPath, values, manufacturer || values.manufacturer);
  const fields = [
    'enable', 'connectionType', 'nat', 'serviceList', 'vlan', 'priority',
  ];
  if (connectionName.length > 0) {
    fields.unshift('connectionName');
  }
  if (!isBridgedConnection(values.connectionType) && values.username) {
    fields.push('username');
  }
  if (!isBridgedConnection(values.connectionType) && values.password) {
    fields.push('password');
  }
  if (batches.some((batch) => batch.key === 'bind' && batch.parameterValues.length > 0)) {
    fields.push('ports');
  }
  const fallbackPayloads = profile === 'zte'
    ? zteVlanPayloads(batches, ctx, bindParameters, vlanKind)
    : [];
  return applyCmccDetection(applyWanIndexGuard({
    profile, ctcomVariant, vlanKind, fields, batches, connectionName, fallbackPayloads, singleAttempt: false, vlanBlocked: false, blockedMessage: '',
  }, ctcomWanIndexGuard({
    knownLeaves, readOnlyLeaves, wanIndexValues, vlanRequested: values.vlanStatus === true,
  })), ctx, {
    knownLeaves, deviceLeaves, readOnlyLeaves, manufacturer, productModel, productClass,
  });
}

function zteVlanPayloads(batches, ctx, bindFn, primaryKind) {
  return zteVlanFallbackKinds(primaryKind, ctx.accessType).map((kind) => ({
    kind,
    parameterValues: batchWanParameters({
      batches: batches.map((batch) => {
        if (batch.key === 'vendor') {
          return { ...batch, parameterValues: sanitizeParameterValues(zteVendorForKind(ctx, kind)) };
        }
        if (batch.key === 'bind') {
          return { ...batch, parameterValues: sanitizeParameterValues(bindFn(kind === 'zte' ? 'zte' : 'ctcom', ctx)) };
        }
        return batch;
      }),
    }),
  })).filter((item) => item.parameterValues.length > 0);
}

function ctcomFallbackPayload(plan) {
  const list = Array.isArray(plan?.fallbackPayloads) ? plan.fallbackPayloads : [];
  const first = list.find((item) => Array.isArray(item?.parameterValues) && item.parameterValues.length > 0);
  return first ? first.parameterValues : null;
}

function zteVlanFallbackPayloads(plan) {
  return (plan?.fallbackPayloads || []).filter((item) => Array.isArray(item?.parameterValues) && item.parameterValues.length > 0);
}

// Parameter yang sering ditolak/read-only di firmware tertentu (CWMP 9002/9003/9008). Di arsitektur
// Queue-and-Fire ketiganya dikirim sebagai task SetParameterValues TERPISAH (satu task per parameter),
// sehingga penolakan ONU hanya menggagalkan task itu dan tidak menahan Username/Password/VLAN.
const RISKY_LEAF = /^(?:connectiontype|name|[a-z0-9_-]*servicelist)$/i;
// Mode atomik: tidak ada parameter yang diisolasi; seluruh konfigurasi (ConnectionType, ServiceList, VLAN,
// LanInterface, Name) dikirim dalam satu RPC dan Enable ditaruh paling akhir. ZTE F609 memvalidasi seluruh
// konfigurasi instance baru saat Enable=true: Enable tanpa Name terisi / ServiceList / ConnectionType yang
// ikut dalam RPC yang sama menghasilkan CWMP 9003 (terukur di lab).
function isRiskyParameter(path, { atomic = false } = {}) {
  return !atomic && RISKY_LEAF.test(String(path).split('.').pop());
}

// Profil yang membutuhkan mode atomik. ZTE terukur di lab. Fiberhome: memecah ConnectionType/ServiceList ke
// task SESUDAH Enable=true membuat ONT mengaktifkan WAN yang belum lengkap (ConnectionType masih bawaan,
// ServiceList kosong), lalu tidak membentuknya; penolakan task susulan hanya tercatat sebagai "parsial".
function prefersAtomicWan(profile) {
  const name = String(profile || '').toLowerCase();
  return name === 'zte' || name === 'fiberhome';
}

// Mode atomik memasukkan Connection Name ke RPC yang sama (ZTE). Fiberhome pernah membalas 9002 pada
// Name, jadi Name tetap task terpisah supaya penolakannya tidak menggagalkan seluruh WAN.
function atomicIncludesName(profile) {
  return String(profile || '').toLowerCase() !== 'fiberhome';
}

function sameOnuValue(expected, actual) {
  if (typeof expected === 'boolean') {
    return ['true', '1'].includes(String(actual).trim().toLowerCase()) === expected;
  }
  if (typeof expected === 'number') {
    return Number(actual) === expected;
  }
  return String(actual) === String(expected);
}

function leafValueAt(doc, path) {
  let node = doc;
  for (const part of String(path).split('.')) {
    node = node == null ? undefined : node[part];
  }
  return node && typeof node === 'object' && '_value' in node ? node._value : undefined;
}

// Bandingkan parameter yang kita kirim dengan yang dilaporkan ONU setelah refreshObject.
// Password dilewati (ONU tidak membacakannya). missing = leaf tidak dilaporkan; mismatched = nilai berbeda.
function compareWanReadback(doc, rows) {
  const missing = [];
  const mismatched = [];
  for (const [path, expected] of Array.isArray(rows) ? rows : []) {
    const name = String(path).split('.').pop();
    if (/password/i.test(name)) {
      continue;
    }
    const actual = leafValueAt(doc, path);
    if (actual === undefined) {
      missing.push(name);
    } else if (!sameOnuValue(expected, actual)) {
      mismatched.push({ name, expected, actual });
    }
  }
  return { missing, mismatched };
}

// Pisahkan satu daftar [path, value, type] menjadi { core, risky }. risky = array berisi satu baris
// per task (ConnectionType, ServiceList, Name).
function splitWanParameters(parameterValues, options = {}) {
  const rows = Array.isArray(parameterValues) ? parameterValues : [];
  const core = [];
  const riskyRows = [];
  for (const row of rows) {
    (isRiskyParameter(row[0], options) ? riskyRows : core).push(row);
  }
  if (options.atomic) {
    const isEnable = (row) => String(row[0]).split('.').pop() === 'Enable';
    core.sort((left, right) => Number(isEnable(left)) - Number(isEnable(right)));
  }
  const rank = (row) => {
    const leaf = String(row[0]).split('.').pop().toLowerCase();
    if (leaf === 'connectiontype') {
      return 0;
    }
    return leaf === 'name' ? 2 : 1;
  };
  riskyRows.sort((left, right) => rank(left) - rank(right));
  return { core, risky: riskyRows.map((row) => [row]) };
}

// Seluruh parameter WAN dikirim dalam satu setParameterValues.
function batchWanParameters(plan) {
  const byPath = new Map();
  for (const batch of plan.batches || []) {
    for (const row of batch.parameterValues || []) {
      byPath.set(row[0], row);
    }
  }
  return [...byPath.values()];
}

function connectionPathOf(pppPath) {
  if (String(pppPath).startsWith('Device.PPP.Interface.')) {
    return pppPath;
  }
  return String(pppPath).replace(/WAN(?:PPP|IP)Connection\.\d+\.$/, '');
}

// Pesan fault GenieACS / CWMP (kode + teks + parameter yang ditolak) untuk alert frontend.
function formatAcsFault(fault, fallback = 'ONU menolak perintah TR-069') {
  if (fault == null || fault === '') {
    return fallback;
  }
  if (typeof fault === 'string') {
    const text = fault.trim();
    return text || fallback;
  }
  if (typeof fault !== 'object') {
    return fallback;
  }
  const detail = fault.detail && typeof fault.detail === 'object' ? fault.detail : {};
  const code = detail.faultCode || fault.code || '';
  const message = detail.faultString || fault.message || '';
  const rawList = detail.setParameterValuesFault || detail.SetParameterValuesFault || [];
  const list = Array.isArray(rawList) ? rawList : [rawList];
  const extra = list.map((item) => {
    if (!item || typeof item !== 'object') {
      return '';
    }
    const path = item.parameterName || item.ParameterName || '';
    const itemCode = item.faultCode || item.FaultCode || '';
    const itemText = item.faultString || item.FaultString || item.message || '';
    const reason = [itemCode, itemText].filter(Boolean).join(': ');
    return [path, reason].filter(Boolean).join(' — ');
  }).filter(Boolean).join('; ');
  const head = [code, message].filter(Boolean).join(': ');
  return [head, extra].filter(Boolean).join('. ') || fallback;
}

module.exports = {
  parseWanPpp,
  planWanPpp,
  supportsPppoeRouted,
  connectionTypeError,
  selectedLanInterfaces,
  vendorProfile,
  normalizeDeviceType,
  skipConnectionName,
  connectionPathOf,
  formatAcsFault,
  selectWanLocation,
  selectTr181Location,
  normalizeAcsObjectName,
  sanitizeParameterValues,
  batchWanParameters,
  splitWanParameters,
  isRiskyParameter,
  prefersAtomicWan,
  ctcomFallbackPayload,
  zteVlanFallbackPayloads,
  detectZteVlanLink,
  connectionLeavesFor,
  readOnlyLeavesFor,
  ctcomWanIndexGuard,
  cmccGuard,
  CMCC_CANCEL_MESSAGE,
  isCtComZteVariant,
  isInvalidParameterFault,
  isReadOnlyParameterFault,
  isCommitLoopFault,
  isStructuralRejection,
  omitBridgeAuth,
  isBridgedConnection,
  CONNECTION_TYPE_TR069,
  connectionTypeForOnu,
  atomicIncludesName,
  compareWanReadback,
  parseWanIp,
  planWanIp,
  generatePortBindingString,
  isF67Family,
};
