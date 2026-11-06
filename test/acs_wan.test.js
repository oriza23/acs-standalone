const test = require('node:test');
const assert = require('node:assert/strict');
const {
  supportsPppoeRouted,
  connectionTypeError,
  CONNECTION_TYPE_TR069,
  parseWanPpp,
  parseWanIp,
  planWanPpp,
  planWanIp,
  batchWanParameters,
  normalizeDeviceType,
  skipConnectionName,
} = require('../backend/acs_wan');

test('FiberHome dan merek sejenis boleh pppoe_routed', () => {
  assert.equal(supportsPppoeRouted('FiberHome'), true);
  assert.equal(supportsPppoeRouted('ZTE'), false);
  assert.equal(supportsPppoeRouted('ZTE', 'Fiberhome'), true);
  assert.equal(connectionTypeError('ZTE', 'pppoe_routed'), 'Connection Type pppoe_routed tidak didukung merek modem ini');
  assert.equal(connectionTypeError('ZTE', 'pppoe_routed', 'Fiberhome'), null);
  assert.equal(connectionTypeError('FiberHome', 'pppoe_routed'), null);
});

test('nilai dropdown dipetakan ke ConnectionType TR-069', () => {
  assert.equal(CONNECTION_TYPE_TR069['ip-routed'], 'IP_Routed');
  assert.equal(CONNECTION_TYPE_TR069.pppoe_bridged, 'PPPoE_Bridged');
  assert.equal(CONNECTION_TYPE_TR069.pppoe_routed, 'PPPoE_Routed');
});

test('edit Fiberhome: nama koneksi di serviceList dipaksa INTERNET dan Name tidak ditulis', () => {
  const parsed = parseWanPpp(pppBody({
    deviceType: 'Fiberhome',
    wanPath: 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANPPPConnection.1.',
    connectionName: '2_INTERNET_R_VID_2033',
    serviceList: '2_INTERNET_R_VID_2033',
    connectionType: 'pppoe_routed',
  }));
  assert.equal(parsed.error, undefined);
  assert.equal(parsed.value.serviceList, 'INTERNET');
  assert.equal(parsed.value.connectionName, '');
  const plan = planWanPpp({
    values: parsed.value,
    manufacturer: 'FiberHome',
    pppPath: PPP_PATH,
    connectionPath: 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.',
    knownLeaves: ['WANPPPConnection.Username', 'WANPPPConnection.X_FH_ServiceList', 'WANPPPConnection.VLANID'],
    dataModel: 'InternetGatewayDevice',
  });
  const rows = batchWanParameters(plan);
  assert.equal(rows.some((row) => String(row[0]).endsWith('.Name')), false);
  assert.equal(plan.connectionName.length, 0);
  const service = rows.find((row) => String(row[0]).endsWith('X_FH_ServiceList'));
  assert.equal(service[1], 'INTERNET');
});

test('parseWanPpp menolak isian tanpa device', () => {
  const parsed = parseWanPpp({});
  assert.ok(parsed.error);
});

const PPP_PATH = 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.';
const IP_PATH = 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.';

function pppBody(extra = {}) {
  return {
    deviceId: 'ONT-1',
    connectionName: 'pppoe_internet',
    enableConnection: true,
    natStatus: true,
    vlanStatus: false,
    serviceList: 'INTERNET',
    connectionType: 'ip-routed',
    priority: 0,
    username: 'budi@net',
    password: 'rahasia',
    ports: [],
    ...extra,
  };
}

function ipBody(extra = {}) {
  return {
    deviceId: 'ONT-1',
    connectionName: 'ip_internet',
    enableConnection: true,
    vlanStatus: false,
    serviceList: 'INTERNET',
    connectionType: 'IP_Routed',
    addressing: 'DHCP',
    priority: 0,
    ports: [],
    ...extra,
  };
}

function planPpp(extra, manufacturer) {
  const parsed = parseWanPpp(pppBody(extra));
  assert.equal(parsed.error, undefined);
  const plan = planWanPpp({
    values: parsed.value,
    manufacturer,
    pppPath: PPP_PATH,
    connectionPath: 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.',
    knownLeaves: ['Enable', 'Name', 'ConnectionType', 'Username', 'Password', 'NATEnabled'],
    dataModel: 'InternetGatewayDevice',
  });
  return plan;
}

function planIp(extra, manufacturer) {
  const parsed = parseWanIp(ipBody(extra));
  assert.equal(parsed.error, undefined);
  return planWanIp({
    values: parsed.value,
    manufacturer,
    ipPath: IP_PATH,
    connectionPath: 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.',
    knownLeaves: ['Enable', 'Name', 'ConnectionType', 'NATEnabled', 'AddressingType'],
    dataModel: 'InternetGatewayDevice',
  });
}

const hasName = (rows) => rows.some(([path]) => path.endsWith('.Name'));

test('normalizeDeviceType mengenali empat merek dan menolak yang lain', () => {
  assert.equal(normalizeDeviceType('ZTE'), 'zte');
  assert.equal(normalizeDeviceType('Huawei'), 'huawei');
  assert.equal(normalizeDeviceType('ChinaMobile'), 'chinamobile');
  assert.equal(normalizeDeviceType('China Mobile'), 'chinamobile');
  assert.equal(normalizeDeviceType('FiberHome'), 'fiberhome');
  assert.equal(normalizeDeviceType('Mikrotik'), '');
});

test('skipConnectionName: Fiberhome dari pilihan user atau merek ONU', () => {
  assert.equal(skipConnectionName({ deviceType: 'Fiberhome', manufacturer: 'ZTE' }), true);
  assert.equal(skipConnectionName({ deviceType: 'ZTE', manufacturer: 'FiberHome' }), true);
  assert.equal(skipConnectionName({ deviceType: 'ZTE', manufacturer: 'ZTE' }), false);
  assert.equal(skipConnectionName({ deviceType: 'Huawei', manufacturer: '' }), false);
});

test('parseWanPpp/parseWanIp: Fiberhome tidak butuh Connection Name, merek lain wajib', () => {
  for (const [parse, body] of [[parseWanPpp, pppBody], [parseWanIp, ipBody]]) {
    const fh = parse(body({ deviceType: 'Fiberhome', connectionName: '' }));
    assert.equal(fh.error, undefined);
    assert.equal(fh.value.connectionName, '');
    assert.equal(fh.value.deviceType, 'fiberhome');
    const ignored = parse(body({ deviceType: 'Fiberhome', connectionName: 'Otomatis' }));
    assert.equal(ignored.value.connectionName, '');
    for (const type of ['ZTE', 'Huawei', 'ChinaMobile']) {
      assert.match(parse(body({ deviceType: type, connectionName: '' })).error, /Connection Name wajib/);
      assert.equal(parse(body({ deviceType: type })).value.deviceType, type.toLowerCase());
    }
    assert.match(parse(body({ deviceType: 'Mikrotik' })).error, /Tipe Perangkat/);
    assert.match(parse(body({ connectionName: '' })).error, /Connection Name wajib/);
  }
});

test('WAN PPP: Fiberhome tidak mengirim ...WANPPPConnection.{i}.Name sama sekali', () => {
  const plan = planPpp({ deviceType: 'Fiberhome', connectionName: '' }, 'FiberHome');
  assert.deepEqual(plan.connectionName, []);
  assert.equal(hasName(batchWanParameters(plan)), false);
  assert.equal(plan.fields.includes('connectionName'), false);
  const userPicked = planPpp({ deviceType: 'Fiberhome', connectionName: '' }, 'ZTE');
  assert.deepEqual(userPicked.connectionName, []);
  const detected = planPpp({ deviceType: 'ZTE', connectionName: 'Otomatis' }, 'FiberHome');
  assert.deepEqual(detected.connectionName, []);
});

// Aturan TR-098 Fiberhome HG6145D2 (diverifikasi pada pohon 19 ONU asli di GenieACS).
const FH_CONN = 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.';
// Pohon instance baru yang masih sparse: hanya link config, belum ada leaf PPP.
const FH_SPARSE = ['WANPPPConnection', 'X_FH_WANGponLinkConfig', 'X_FH_WANGponLinkConfig.VLANID', 'VLANID', 'Mode', 'Enable'];
// Pohon penuh: PPP sudah punya VLANID di level PPP.
const FH_FULL = ['WANPPPConnection.Username', 'WANPPPConnection.ConnectionType', 'WANPPPConnection.VLANID',
  'WANPPPConnection.VLANEnable', 'WANPPPConnection.X_FH_LanInterface', 'X_FH_WANGponLinkConfig.VLANID'];
// Firmware Fiberhome lama: PPP terisi tetapi VLAN hanya ada di link config.
const FH_LEGACY = ['WANPPPConnection.Username', 'WANPPPConnection.ConnectionType', 'X_FH_WANGponLinkConfig.VLANID'];

function planFh(extra, knownLeaves, manufacturer = 'FiberHome') {
  const parsed = parseWanPpp(pppBody({ deviceType: 'Fiberhome', connectionName: '', vlanStatus: true, vlanId: 2033, ports: ['LAN1', 'SSID1'], ...extra }));
  assert.equal(parsed.error, undefined);
  return planWanPpp({
    values: parsed.value,
    manufacturer,
    pppPath: PPP_PATH,
    connectionPath: FH_CONN,
    accessType: 'GPON',
    knownLeaves,
    dataModel: 'InternetGatewayDevice',
  });
}

const valueOf = (plan, leaf) => (batchWanParameters(plan).find(([path]) => path === `${PPP_PATH}${leaf}`) || [])[1];

test('Fiberhome: pppoe_routed -> IP_Routed, pppoe_bridged -> PPPoE_Bridged', () => {
  assert.equal(valueOf(planFh({ connectionType: 'pppoe_routed' }, FH_SPARSE), 'ConnectionType'), 'IP_Routed');
  assert.equal(valueOf(planFh({ connectionType: 'pppoe_bridged' }, FH_SPARSE), 'ConnectionType'), 'PPPoE_Bridged');
  // Pilihan user menang atas merek ONU yang terbaca.
  assert.equal(valueOf(planFh({ connectionType: 'pppoe_routed' }, FH_SPARSE, 'ZTE'), 'ConnectionType'), 'IP_Routed');
  // Merek lain tidak berubah.
  const cdata = planPpp({ connectionType: 'pppoe_routed' }, 'C-Data');
  assert.equal(valueOf(cdata, 'ConnectionType'), 'PPPoE_Routed');
});

test('Fiberhome PPP: parameter wajib (Enable, Username, Password, NAT) dan NAT hanya untuk routed', () => {
  const routed = planFh({ connectionType: 'pppoe_routed', natStatus: true }, FH_SPARSE);
  assert.equal(valueOf(routed, 'Enable'), true);
  assert.equal(valueOf(routed, 'Username'), 'budi@net');
  assert.equal(valueOf(routed, 'Password'), 'rahasia');
  assert.equal(valueOf(routed, 'NATEnabled'), true);
  const bridged = planFh({ connectionType: 'pppoe_bridged', natStatus: true }, FH_SPARSE);
  assert.equal(valueOf(bridged, 'NATEnabled'), false);
  // Bridge tidak punya autentikasi PPPoE.
  assert.equal(valueOf(bridged, 'Username'), undefined);
});

test('Fiberhome PPP: VLAN ditulis di WANPPPConnection, bukan link config / X_FH_VLANID', () => {
  for (const leaves of [FH_SPARSE, FH_FULL]) {
    const plan = planFh({ connectionType: 'pppoe_routed', priority: 3 }, leaves);
    assert.equal(valueOf(plan, 'VLANEnable'), true);
    assert.equal(valueOf(plan, 'VLANID'), 2033);
    assert.equal(valueOf(plan, 'X_FH_802-1pMark'), 3);
    assert.equal(valueOf(plan, 'X_FH_ServiceList'), 'INTERNET');
    const paths = batchWanParameters(plan).map(([path]) => path);
    assert.equal(paths.some((path) => /LinkConfig|X_FH_VLANID|VlanMuxID/.test(path)), false);
  }
  const noVlan = planFh({ connectionType: 'pppoe_routed', vlanStatus: false }, FH_SPARSE);
  assert.equal(valueOf(noVlan, 'VLANID'), undefined);
});

test('Fiberhome PPP: firmware lama tanpa VLANID di level PPP memakai link config', () => {
  const plan = planFh({ connectionType: 'pppoe_routed' }, FH_LEGACY);
  const paths = batchWanParameters(plan).map(([path]) => path);
  assert.ok(paths.includes(`${FH_CONN}X_FH_WANGponLinkConfig.VLANID`));
  assert.equal(valueOf(plan, 'VLANID'), undefined);
});

test('Fiberhome PPP: port binding ke X_FH_LanInterface (daftar path dipisah koma)', () => {
  const expected = [
    'InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.1',
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1',
  ].join(',');
  for (const leaves of [FH_SPARSE, FH_FULL]) {
    const plan = planFh({ connectionType: 'pppoe_routed' }, leaves);
    assert.equal(valueOf(plan, 'X_FH_LanInterface'), expected);
    assert.equal(valueOf(plan, 'X_CT-COM_LanInterface'), undefined);
    assert.ok(plan.fields.includes('ports'));
  }
  // Firmware China-Telecom yang hanya punya X_CT-COM_LanInterface tetap terlayani.
  // collectTreeMeta selalu memuat nama polos dan nama berprefiks.
  const ct = planFh({ connectionType: 'pppoe_bridged' }, [...FH_FULL.filter((n) => !/LanInterface/.test(n)), 'X_CT-COM_LanInterface', 'WANPPPConnection.X_CT-COM_LanInterface']);
  assert.equal(valueOf(ct, 'X_CT-COM_LanInterface'), expected);
  assert.equal(valueOf(ct, 'X_FH_LanInterface'), undefined);
});

test('Edit Fiberhome: uncheck sebagian menulis ulang string; uncheck semua tidak mengirim ""', () => {
  const lan = (index) => `InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.${index}`;
  const both = planFh({
    wanPath: PPP_PATH,
    connectionType: 'pppoe_routed',
    ports: ['LAN1', 'LAN2'],
  }, FH_FULL);
  assert.equal(valueOf(both, 'X_FH_LanInterface'), `${lan(1)},${lan(2)}`);
  const onlyLan2 = planFh({
    wanPath: PPP_PATH,
    connectionType: 'pppoe_routed',
    ports: ['LAN2'],
  }, FH_FULL);
  assert.equal(valueOf(onlyLan2, 'X_FH_LanInterface'), lan(2));
  assert.equal(onlyLan2.bindClearSkipped, false);
  const cleared = planFh({
    wanPath: PPP_PATH,
    connectionType: 'pppoe_routed',
    ports: [],
  }, FH_FULL);
  assert.equal(valueOf(cleared, 'X_FH_LanInterface'), undefined);
  assert.equal(cleared.bindClearSkipped, true);
  const created = planFh({ connectionType: 'pppoe_routed', ports: [] }, FH_FULL);
  assert.equal(valueOf(created, 'X_FH_LanInterface'), undefined);
  assert.equal(created.bindClearSkipped, false);
});

test('Fiberhome PPP: Connection Name opsional; bila diisi dikirim sebagai task terpisah', () => {
  const auto = planFh({ connectionType: 'pppoe_routed', connectionName: 'Otomatis' }, FH_SPARSE);
  assert.deepEqual(auto.connectionName, []);
  const named = planFh({ connectionType: 'pppoe_routed', connectionName: 'PPPOE-BUDI' }, FH_SPARSE);
  assert.deepEqual(named.connectionName, [[`${PPP_PATH}Name`, 'PPPOE-BUDI', 'xsd:string']]);
  assert.equal(hasName(batchWanParameters(named)), false);
  assert.equal(named.fields[0], 'connectionName');
  const tooLong = parseWanPpp(pppBody({ deviceType: 'Fiberhome', connectionName: 'x'.repeat(129) }));
  assert.match(tooLong.error, /Connection Name/);
});

test('WAN PPP: ZTE/Huawei/ChinaMobile membawa Name terpisah dari batch utama', () => {
  for (const [type, manufacturer] of [['ZTE', 'ZTE'], ['Huawei', 'Huawei'], ['ChinaMobile', 'CMCC']]) {
    const plan = planPpp({ deviceType: type }, manufacturer);
    assert.deepEqual(plan.connectionName, [[`${PPP_PATH}Name`, 'pppoe_internet', 'xsd:string']]);
    assert.equal(hasName(batchWanParameters(plan)), false);
    assert.equal(plan.fields[0], 'connectionName');
    const rows = batchWanParameters(plan).map(([path]) => path);
    assert.ok(rows.includes(`${PPP_PATH}Username`));
    assert.ok(rows.includes(`${PPP_PATH}Password`));
  }
});

test('WAN IP: Fiberhome tanpa Name, merek lain membawa Name terpisah', () => {
  const fh = planIp({ deviceType: 'Fiberhome', connectionName: '' }, 'FiberHome');
  assert.deepEqual(fh.connectionName, []);
  assert.equal(hasName(batchWanParameters(fh)), false);
  for (const type of ['ZTE', 'Huawei', 'ChinaMobile']) {
    const plan = planIp({ deviceType: type }, type === 'Huawei' ? 'Huawei' : 'ZTE');
    assert.deepEqual(plan.connectionName, [[`${IP_PATH}Name`, 'ip_internet', 'xsd:string']]);
    assert.equal(hasName(batchWanParameters(plan)), false);
  }
});

test('9003: koneksi bridged selalu NATEnabled=false walau form mencentang NAT', () => {
  const natOf = (extra) => batchWanParameters(planPpp({ natStatus: true, ...extra }, 'ZTE'))
    .find(([path]) => path.endsWith('.NATEnabled'))[1];
  assert.equal(natOf({ connectionType: 'PPPoE_Bridged' }), false);
  assert.equal(natOf({ connectionType: 'ip-routed' }), true);
});
