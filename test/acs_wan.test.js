const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseWanPpp, planWanPpp, supportsPppoeRouted, connectionTypeError, vendorProfile, connectionPathOf, formatAcsFault,
  selectWanLocation, selectTr181Location, normalizeAcsObjectName, sanitizeParameterValues, batchWanParameters, omitBridgeAuth,
  parseWanIp, planWanIp, generatePortBindingString, isF67Family,
  ctcomFallbackPayload, zteVlanFallbackPayloads, detectZteVlanLink, connectionLeavesFor,
  isCtComZteVariant, isInvalidParameterFault,
} = require('../backend/acs_wan');
const { extractWans, ssidCountOf } = require('../backend/acs_summary');

const PPP = 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.3.WANPPPConnection.1.';
const CONNECTION = 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.3.';

function body(overrides = {}) {
  return {
    deviceId: 'ONU-1',
    connectionName: 'INET',
    enableConnection: true,
    natStatus: true,
    serviceList: 'INTERNET',
    connectionType: 'ip-routed',
    vlanStatus: true,
    vlanId: '200',
    priority: '5',
    username: 'user@isp',
    password: 'secret',
    mtu: '1492',
    ports: {
      lan1: true, lan2: false, lan3: false, lan4: false, ssid1: true, ssid2: false, ssid3: false, ssid4: false,
    },
    ...overrides,
  };
}

function planFor(manufacturer, overrides = {}) {
  const parsed = parseWanPpp(body(overrides));
  assert.equal(parsed.error, undefined);
  return planWanPpp({
    values: parsed.value,
    manufacturer,
    accessType: overrides.accessType || 'GPON',
    pppPath: PPP,
    connectionPath: CONNECTION,
  });
}

function sent(plan) {
  const map = new Map();
  for (const batch of plan.batches) {
    for (const [path, value] of batch.parameterValues) {
      map.set(path, value);
    }
  }
  return map;
}

test('FiberHome dan merek sejenis mendapat pppoe_routed, ZTE dan Huawei tidak', () => {
  assert.equal(supportsPppoeRouted('FiberHome'), true);
  assert.equal(supportsPppoeRouted('Fiber Home'), true);
  assert.equal(supportsPppoeRouted('FHTT'), true);
  assert.equal(supportsPppoeRouted('C-Data'), true);
  assert.equal(supportsPppoeRouted('VSOL'), true);
  assert.equal(supportsPppoeRouted('ZTE'), false);
  assert.equal(supportsPppoeRouted('Huawei Technologies Co., Ltd'), false);
  assert.equal(connectionTypeError('ZTE', 'pppoe_routed'), 'Connection Type pppoe_routed tidak didukung merek modem ini');
  assert.equal(connectionTypeError('FiberHome', 'pppoe_routed'), null);
});

test('profil vendor membedakan Huawei, ZTE, FiberHome, dan Aztech', () => {
  assert.equal(vendorProfile('Huawei Technologies'), 'huawei');
  assert.equal(vendorProfile('ZTE Corporation'), 'zte');
  assert.equal(vendorProfile('Aztech'), 'ctcom');
  assert.equal(vendorProfile('FiberHome'), 'fiberhome');
  assert.equal(vendorProfile(''), 'ctcom');
});

test('parse menolak VLAN, MTU, dan sandi yang tidak valid', () => {
  assert.match(parseWanPpp(body({ vlanId: '0' })).error, /VLAN ID/);
  assert.match(parseWanPpp(body({ mtu: '100' })).error, /MTU/);
  assert.match(parseWanPpp(body({ priority: '8' })).error, /802\.1p/);
  assert.match(parseWanPpp(body({ password: '' })).error, /Password/);
  const edit = parseWanPpp(body({
    password: '',
    wanPath: 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1',
  }));
  assert.equal(edit.error, undefined);
  assert.equal(edit.value.password, null);
  assert.equal(edit.value.vlanId, 200);
  assert.equal(edit.value.priority, 5);
  assert.equal(edit.value.mtu, 1492);
});

test('setParameterValues ZTE memetakan seluruh isian ke parameter ZTE', () => {
  const plan = planFor('ZTE');
  const values = sent(plan);
  assert.equal(plan.profile, 'zte');
  assert.equal(values.get(`${PPP}ConnectionType`), 'IP_Routed');
  assert.equal(values.get(`${PPP}Username`), 'user@isp');
  assert.equal(values.get(`${PPP}Password`), 'secret');
  assert.equal(values.get(`${PPP}NATEnabled`), true);
  assert.equal(typeof values.get(`${PPP}NATEnabled`), 'boolean');
  assert.equal(typeof values.get(`${PPP}Enable`), 'boolean');
  assert.equal(values.get(`${PPP}Enable`), true);
  assert.equal(typeof values.get(`${PPP}Name`), 'string');
  assert.equal(values.get(`${PPP}X_ZTE-COM_VLANID`), 200);
  assert.equal(typeof values.get(`${PPP}X_ZTE-COM_VLANID`), 'number');
  assert.equal(values.get(`${PPP}X_ZTE-COM_VLANEnable`), 1);
  assert.equal(values.get(`${PPP}X_ZTE-COM_8021P`), 5);
  assert.equal(values.has(`${CONNECTION}WANEthernetLinkConfig.X_ZTE-COM_VLANIDMark`), false);
  assert.equal(values.has(`${PPP}MaxMRUSize`), false);
  assert.equal(values.has(`${PPP}ConnectionTrigger`), false);
  assert.equal(values.has(`${PPP}X_ZTE-COM_8021p`), false);
  assert.equal(values.get(`${PPP}X_ZTE-COM_ServiceList`), 'INTERNET');
  assert.equal(
    values.get(`${PPP}X_ZTE-COM_LanInterface`),
    'InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.1,InternetGatewayDevice.LANDevice.1.WLANConfiguration.1',
  );
  assert.equal(plan.batches[0].parameterValues.find((row) => row[0].endsWith('.Enable'))[1], true);
  assert.equal(batchWanParameters(plan).filter((row) => row[0].endsWith('.Enable')).length, 1);
});

test('FiberHome memakai PPPoE_Routed dan 802.1p pada link GPON', () => {
  const plan = planFor('FiberHome', { connectionType: 'pppoe_routed' });
  const values = sent(plan);
  assert.equal(values.get(`${PPP}ConnectionType`), 'PPPoE_Routed');
  assert.equal(values.get(`${CONNECTION}X_FH_WANGponLinkConfig.VLANIDMark`), 200);
  assert.equal(values.get(`${CONNECTION}X_FH_WANGponLinkConfig.802-1pMark`), 5);
  assert.equal(values.get(`${PPP}X_FH_ServiceList`), 'INTERNET');
  assert.equal(plan.batches.find((batch) => batch.key === 'vendor').fallback[0][0].includes('X_CT-COM_'), true);
});

test('Huawei memakai X_HW_VLAN, X_HW_PRI, dan LAN bind', () => {
  const plan = planFor('Huawei', { connectionType: 'pppoe_bridged', natStatus: false });
  const values = sent(plan);
  assert.equal(values.get(`${PPP}ConnectionType`), 'PPPoE_Bridged');
  assert.equal(values.get(`${PPP}NATEnabled`), false);
  assert.equal(values.get(`${PPP}X_HW_VLAN`), 200);
  assert.equal(values.get(`${PPP}X_HW_PRI`), 5);
  assert.equal(values.get(`${PPP}X_HW_SERVICELIST`), 'INTERNET');
  assert.equal(values.get(`${PPP}X_HW_LANBIND.Lan1Enable`), true);
  assert.equal(values.get(`${PPP}X_HW_LANBIND.SSID1Enable`), true);
  assert.equal(values.get(`${PPP}X_HW_LANBIND.Lan2Enable`), false);
  assert.equal(values.has(`${PPP}Username`), false);
  assert.equal(values.has(`${PPP}Password`), false);
  assert.equal(connectionPathOf(PPP), CONNECTION);
});

test('pppoe_bridged mengabaikan username dan password yang masih terkirim', () => {
  const parsed = parseWanPpp(body({ connectionType: 'pppoe_bridged', username: 'lama', password: 'rahasia' }));
  assert.equal(parsed.error, undefined);
  assert.equal(parsed.value.username, '');
  assert.equal(parsed.value.password, null);
  const empty = parseWanPpp(body({ connectionType: 'pppoe_bridged', username: '', password: '' }));
  assert.equal(empty.error, undefined);
});

test('fault TR-069 menampilkan kode, pesan, dan parameter yang ditolak', () => {
  const text = formatAcsFault({
    code: 'cwmp.9003',
    message: 'Invalid arguments',
    detail: {
      faultCode: '9003',
      faultString: 'Invalid arguments',
      setParameterValuesFault: [
        { parameterName: 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.', faultCode: '9005', faultString: 'Invalid parameter name' },
      ],
    },
  });
  assert.match(text, /9003/);
  assert.match(text, /Invalid arguments/);
  assert.match(text, /9005/);
  assert.match(text, /Invalid parameter name/);
  assert.match(text, /WANConnectionDevice/);
});

test('ZTE memakai WANDevice yang punya WANConnectionDevice, bukan indeks optik pertama', () => {
  const location = selectWanLocation({
    1: { WANCommonInterfaceConfig: { WANAccessType: { _value: 'GPON' } } },
    2: {
      WANConnectionDevice: {
        1: { WANIPConnection: { 1: { Enable: { _value: true }, Name: { _value: 'TR069' } } } },
        2: {
          WANPPPConnection: {
            1: {
              Enable: { _value: true },
              Name: { _value: 'INET' },
              Username: { _value: 'user' },
              ConnectionType: { _value: 'IP_Routed' },
              NATEnabled: { _value: true },
              'X_ZTE-COM_VLANID': { _value: 200 },
            },
          },
        },
      },
    },
  }, 'zte');
  assert.equal(location.wanDeviceIndex, '2');
  assert.equal(location.connectionIndex, '2');
  assert.equal(location.createConnectionDevice, false);
  assert.equal(location.knownLeaves.includes('X_ZTE-COM_VLANID'), true);
  assert.equal(location.knownLeaves.includes('X_ZTE-COM_8021p'), false);
});

test('parameter yang tidak ada di pohon ZTE dan nilai kosong tidak dikirim', () => {
  const parsed = parseWanPpp(body({ mtu: '' }));
  assert.equal(parsed.error, undefined);
  assert.equal(parsed.value.mtu, null);
  const plan = planWanPpp({
    values: parsed.value,
    manufacturer: 'ZTE',
    accessType: 'GPON',
    pppPath: PPP,
    connectionPath: CONNECTION,
    knownLeaves: ['Enable', 'Name', 'Username', 'Password', 'ConnectionType', 'NATEnabled', 'X_ZTE-COM_VLANID', 'X_ZTE-COM_ServiceList'],
  });
  const values = sent(plan);
  assert.equal(values.has(`${PPP}MaxMRUSize`), false);
  assert.equal(values.has(`${PPP}ConnectionTrigger`), false);
  assert.equal(values.has(`${PPP}X_ZTE-COM_8021p`), false);
  assert.equal(values.get(`${PPP}X_ZTE-COM_VLANID`), 200);
  assert.equal(values.get(`${PPP}X_ZTE-COM_VLANEnable`), 1);
  assert.equal(values.has(`${CONNECTION}WANEthernetLinkConfig.X_ZTE-COM_VLANIDMark`), false);
  assert.equal(values.get(`${PPP}Username`), 'user@isp');
});

test('TR-181 memakai Device.PPP.Interface', () => {
  const location = selectTr181Location({
    PPP: { Interface: { 1: { Username: { _value: 'user' }, Enable: { _value: true } } } },
  });
  assert.equal(location.tr181, true);
  assert.equal(location.knownLeaves.includes('Username'), true);
  const plan = planFor('Generic', { });
  assert.equal(plan.profile !== 'tr181', true);
  const tr181 = planWanPpp({
    values: parseWanPpp(body()).value,
    manufacturer: 'Generic',
    pppPath: 'Device.PPP.Interface.2.',
    connectionPath: 'Device.PPP.Interface.2.',
    dataModel: 'Device',
    knownLeaves: location.knownLeaves,
  });
  const values = sent(tr181);
  assert.equal(tr181.profile, 'tr181');
  assert.equal(values.get('Device.PPP.Interface.2.Username'), 'user@isp');
  assert.equal(values.has('Device.PPP.Interface.2.X_ZTE-COM_VLANID'), false);
  assert.equal(connectionPathOf('Device.PPP.Interface.2.'), 'Device.PPP.Interface.2.');
});

test('AddObject ZTE tidak mengirim titik ganda di akhir path', () => {
  assert.equal(
    normalizeAcsObjectName('InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.'),
    'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection',
  );
  assert.equal(normalizeAcsObjectName('Device.PPP.Interface.'), 'Device.PPP.Interface');
});

test('ZTE F609 memakai WANDevice.1 dan WANConnectionDevice yang sudah punya PPP', () => {
  const location = selectWanLocation({
    1: {
      WANCommonInterfaceConfig: { WANAccessType: { _value: 'GPON' } },
      WANConnectionDevice: {
        1: {
          WANPPPConnection: {
            2: {
              Username: { _value: '' },
              'X_ZTE-COM_VLANID': { _value: 2023 },
              'X_ZTE-COM_8021P': { _value: 0 },
              'X_ZTE-COM_VLANEnable': { _value: 1 },
            },
          },
        },
      },
    },
  }, 'zte');
  assert.equal(location.wanDeviceIndex, '1');
  assert.equal(location.connectionIndex, '1');
  assert.equal(location.createConnectionDevice, false);
});

test('VLAN ZTE ada di WANPPPConnection dan bridge tidak mengirim Username atau Password', () => {
  const parsed = parseWanPpp(body({ connectionType: 'ip_routed', vlanId: '1112', priority: '0' }));
  assert.equal(parsed.error, undefined);
  assert.equal(parsed.value.connectionType, 'ip-routed');
  const plan = planWanPpp({
    values: parsed.value,
    manufacturer: 'ZTE',
    accessType: 'GPON',
    pppPath: PPP,
    connectionPath: CONNECTION,
    knownLeaves: ['Username'],
  });
  const values = sent(plan);
  assert.equal(values.get(`${PPP}ConnectionType`), 'IP_Routed');
  assert.equal(values.get(`${PPP}X_ZTE-COM_VLANEnable`), 1);
  assert.equal(values.get(`${PPP}X_ZTE-COM_VLANID`), 1112);
  assert.equal(typeof values.get(`${PPP}X_ZTE-COM_VLANID`), 'number');
  assert.equal(values.get(`${PPP}X_ZTE-COM_8021P`), 0);
  assert.equal(values.has(`${CONNECTION}WANEthernetLinkConfig.X_ZTE-COM_VLANIDMark`), false);
  assert.equal(values.has(`${PPP}X_ZTE-COM_8021PMark`), false);

  const bridged = planFor('ZTE', { connectionType: 'pppoe_bridged', username: 'lama', password: 'rahasia' });
  const bridgeValues = sent(bridged);
  assert.equal(bridgeValues.get(`${PPP}ConnectionType`), 'PPPoE_Bridged');
  assert.equal(bridgeValues.has(`${PPP}Username`), false);
  assert.equal(bridgeValues.has(`${PPP}Password`), false);
  const leaked = omitBridgeAuth([
    [`${PPP}Username`, '', 'xsd:string'],
    [`${PPP}Password`, 'rahasia', 'xsd:string'],
    [`${PPP}Enable`, true, 'xsd:boolean'],
  ], 'PPPoE_Bridged');
  assert.deepEqual(leaked.map((row) => row[0]), [`${PPP}Enable`]);
  const ipBridge = parseWanPpp(body({ connectionType: 'ip_bridged', username: 'lama', password: 'rahasia' }));
  assert.equal(ipBridge.error, undefined);
  assert.equal(ipBridge.value.username, '');
  assert.equal(ipBridge.value.password, null);
});

test('nilai kosong, null, dan undefined dibuang dari payload', () => {
  const cleaned = sanitizeParameterValues([
    ['A.Username', 'user', 'xsd:string'],
    ['A.Password', '', 'xsd:string'],
    ['A.MTU', null, 'xsd:unsignedInt'],
    ['A.Name', undefined, 'xsd:string'],
    ['A.Blank', '   ', 'xsd:string'],
    ['A.NATEnabled', false, 'xsd:boolean'],
    ['A.Priority', 0, 'xsd:unsignedInt'],
  ]);
  assert.deepEqual(cleaned.map((row) => row[0]), ['A.Username', 'A.NATEnabled', 'A.Priority']);
  const cast = sanitizeParameterValues([
    ['A.X_ZTE-COM_VLANID', '1112', 'xsd:unsignedInt'],
    ['A.X_ZTE-COM_8021P', '5', 'xsd:unsignedInt'],
    ['A.Enable', 'true', 'xsd:boolean'],
    ['A.NATEnabled', false, 'xsd:boolean'],
  ]);
  assert.equal(cast[0][1], 1112);
  assert.equal(typeof cast[0][1], 'number');
  assert.equal(cast[1][1], 5);
  assert.equal(cast[2][1], true);
  assert.equal(typeof cast[2][1], 'boolean');
  assert.equal(cast[3][1], false);
});

const IP = 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.2.';

function ipBody(overrides = {}) {
  return {
    deviceId: 'ONU-1',
    connectionName: 'HOTSPOT',
    enableConnection: true,
    serviceList: 'INTERNET',
    connectionType: 'IP_Routed',
    vlanStatus: true,
    vlanId: '1112',
    priority: '0',
    addressing: 'DHCP',
    ports: ['LAN1', 'SSID1'],
    ...overrides,
  };
}

function ipPlanFor(manufacturer, overrides = {}, modelName = '') {
  const parsed = parseWanIp(ipBody(overrides));
  assert.equal(parsed.error, undefined);
  return {
    parsed: parsed.value,
    plan: planWanIp({
      values: parsed.value,
      manufacturer,
      modelName,
      accessType: 'GPON',
      ipPath: IP,
      connectionPath: connectionPathOf(IP),
    }),
  };
}

test('generatePortBindingString memetakan LAN/SSID dan path F67', () => {
  const plain = generatePortBindingString(['LAN1', 'SSID8'], {
    manufacturer: 'ZTE',
    modelName: 'F660',
    wanIpPath: IP,
  });
  assert.equal(plain, [
    'InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.1',
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.8',
  ].join(','));
  assert.equal(plain.includes(' '), false);
  const f67 = generatePortBindingString(['LAN2', 'SSID1'], {
    manufacturer: 'ZTE',
    modelName: 'F670L',
    wanIpPath: IP,
  });
  assert.equal(f67.endsWith('InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.2'), true);
  assert.equal(isF67Family('ZTE', 'F660'), false);
  assert.equal(isF67Family('ZTE F67', ''), true);
  assert.match(parseWanIp(ipBody({ ports: ['LAN5'] })).error, /Port binding/);
  assert.match(parseWanIp(ipBody({ ports: { lan1: true } })).error, /Port binding/);
});

test('WAN IP ZTE routed DHCP memakai VLAN di WANIPConnection tanpa autentikasi', () => {
  const { parsed, plan } = ipPlanFor('ZTE');
  const values = sent(plan);
  assert.equal(parsed.natStatus, true);
  assert.equal(parsed.addressingType, 'DHCP');
  assert.equal(values.get(`${IP}Enable`), true);
  assert.equal(typeof values.get(`${IP}Enable`), 'boolean');
  assert.equal(values.get(`${IP}ConnectionType`), 'IP_Routed');
  assert.equal(values.get(`${IP}Name`), 'HOTSPOT');
  assert.equal(values.get(`${IP}NATEnabled`), true);
  assert.equal(values.get(`${IP}AddressingType`), 'DHCP');
  assert.equal(values.has(`${IP}ExternalIPAddress`), false);
  assert.equal(values.has(`${IP}Username`), false);
  assert.equal(values.has(`${IP}Password`), false);
  assert.equal(values.get(`${IP}X_ZTE-COM_VLANEnable`), 1);
  assert.equal(values.get(`${IP}X_ZTE-COM_VLANID`), 1112);
  assert.equal(values.get(`${IP}X_ZTE-COM_LanInterface`), [
    'InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.1',
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1',
  ].join(','));
  assert.equal(connectionPathOf(IP), 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.');
});

test('WAN IP bridge menyembunyikan alamat dan mematikan NAT', () => {
  const { parsed, plan } = ipPlanFor('ZTE', {
    connectionType: 'IP_Bridged',
    addressing: 'Static',
    ipAddress: '10.0.0.2',
    subnetMask: '255.255.255.0',
    gateway: '10.0.0.1',
    dnsServer: '8.8.8.8',
    username: 'tidak-boleh',
    password: 'rahasia',
    ports: [],
  }, 'F670');
  const values = sent(plan);
  assert.equal(parsed.connectionType, 'IP_Bridged');
  assert.equal(parsed.natStatus, false);
  assert.equal(parsed.addressingType, null);
  assert.equal(parsed.ipAddress, '');
  assert.equal(values.get(`${IP}ConnectionType`), 'IP_Bridged');
  assert.equal(values.get(`${IP}NATEnabled`), false);
  assert.equal(typeof values.get(`${IP}NATEnabled`), 'boolean');
  assert.equal(values.has(`${IP}AddressingType`), false);
  assert.equal(values.has(`${IP}ExternalIPAddress`), false);
  assert.equal(values.has(`${IP}Username`), false);
  assert.equal(values.has(`${IP}Password`), false);
  assert.equal(
    values.get(`${IP}X_ZTE-COM_LanInterface`),
    'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.2',
  );
});

test('WAN IP static mengirim alamat sebagai string', () => {
  const { plan } = ipPlanFor('ZTE', {
    addressing: 'Static',
    ipAddress: '10.10.10.2',
    subnetMask: '255.255.255.0',
    gateway: '10.10.10.1',
    dnsServer: '1.1.1.1',
    ports: ['SSID1'],
  });
  const values = sent(plan);
  assert.equal(values.get(`${IP}AddressingType`), 'Static');
  assert.equal(values.get(`${IP}ExternalIPAddress`), '10.10.10.2');
  assert.equal(values.get(`${IP}SubnetMask`), '255.255.255.0');
  assert.equal(values.get(`${IP}DefaultGateway`), '10.10.10.1');
  assert.equal(values.get(`${IP}DNSServers`), '1.1.1.1');
  assert.match(parseWanIp(ipBody({ addressing: 'Static', ipAddress: '' })).error, /IP Address/);
});

test('jumlah SSID mengikuti NumberOfEntries, lalu objek WLAN, lalu 4', () => {
  assert.equal(ssidCountOf({
    InternetGatewayDevice: { LANDevice: { 1: { WLANConfigurationNumberOfEntries: { _value: 8 } } } },
  }), 8);
  assert.equal(ssidCountOf({
    InternetGatewayDevice: {
      LANDevice: { 1: { WLANConfiguration: { 1: { SSID: { _value: 'a' } }, 4: { SSID: { _value: 'd' } } } } },
    },
  }), 4);
  assert.equal(ssidCountOf({
    Device: { WiFi: { SSID: { 1: { SSID: { _value: 'a' } }, 6: { SSID: { _value: 'f' } } } } },
  }), 6);
  assert.equal(ssidCountOf({}), 4);
});

test('kartu WAN membaca port yang terikat dari LanInterface', () => {
  const wans = extractWans({
    InternetGatewayDevice: {
      WANDevice: {
        1: {
          WANConnectionDevice: {
            1: {
              WANIPConnection: {
                2: {
                  Name: { _value: 'hotspot' },
                  Enable: { _value: true },
                  'X_ZTE-COM_LanInterface': {
                    _value: 'InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.1,InternetGatewayDevice.LANDevice.1.WLANConfiguration.5',
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  assert.equal(wans.length, 1);
  assert.deepEqual(wans[0].boundPorts, ['LAN1', 'SSID5']);
});

test('WAN PPP menerima array selectedPorts termasuk SSID5', () => {
  const parsed = parseWanPpp(body({ ports: ['LAN2', 'SSID5'] }));
  assert.equal(parsed.error, undefined);
  assert.equal(parsed.value.ports.lan2, true);
  assert.equal(parsed.value.ports.ssid5, true);
  assert.equal(parsed.value.ports.ssid1, false);
  const plan = planWanPpp({
    values: parsed.value,
    manufacturer: 'ZTE',
    accessType: 'GPON',
    pppPath: PPP,
    connectionPath: CONNECTION,
  });
  assert.equal(
    sent(plan).get(`${PPP}X_ZTE-COM_LanInterface`),
    'InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.2,InternetGatewayDevice.LANDevice.1.WLANConfiguration.5',
  );
});

test('objek WANGPON menaruh VLAN di link GPON dan autentikasi tetap di WANPPPConnection', () => {
  const pppPath = 'InternetGatewayDevice.WANDevice.2.WANConnectionDevice.4.WANPPPConnection.1.';
  const connectionPath = 'InternetGatewayDevice.WANDevice.2.WANConnectionDevice.4.';
  const plan = planWanPpp({
    values: parseWanPpp(body()).value,
    manufacturer: 'ZTE',
    productModel: 'F609',
    productClass: 'F609 V9.0',
    accessType: 'GPON',
    knownLeaves: ['X_CT-COM_WANGPONLinkConfig.VLANIDMark', 'X_CT-COM_WANGPONLinkConfig.Mode'],
    pppPath,
    connectionPath,
  });
  const values = sent(plan);
  assert.equal(plan.vlanKind, 'gpon');
  assert.equal(values.get(`${pppPath}Username`), 'user@isp');
  assert.equal(values.get(`${pppPath}Password`), 'secret');
  assert.equal(values.get(`${pppPath}Enable`), true);
  assert.equal(values.get(`${pppPath}NATEnabled`), true);
  assert.equal(values.has(`${pppPath}X_ZTE-COM_VLANID`), false);
  assert.equal(values.has(`${pppPath}X_ZTE-COM_VLANEnable`), false);
  assert.equal(values.get(`${connectionPath}X_CT-COM_WANGPONLinkConfig.VLANIDMark`), 200);
  assert.equal(typeof values.get(`${connectionPath}X_CT-COM_WANGPONLinkConfig.VLANIDMark`), 'number');
  assert.equal(values.get(`${connectionPath}X_CT-COM_WANGPONLinkConfig.Mode`), 2);
  assert.equal(typeof values.get(`${connectionPath}X_CT-COM_WANGPONLinkConfig.Mode`), 'number');
  assert.equal(values.get(`${pppPath}X_CT-COM_ServiceList`), 'INTERNET');
  assert.equal(values.has(`${connectionPath}X_CT-COM_WANGPONLinkConfig.802-1pMark`), false);
  assert.equal(values.has('InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.X_CT-COM_WANGPONLinkConfig.VLANIDMark'), false);
});

test('objek WANEponLinkConfig dipilih lebih dulu daripada WANGPON', () => {
  assert.equal(detectZteVlanLink(['X_CT-COM_WANEponLinkConfig', 'X_CT-COM_WANGPONLinkConfig']), 'epon');
  assert.equal(detectZteVlanLink(['X_CT-COM_WANGPONLinkConfig.VLANIDMark']), 'gpon');
  assert.equal(detectZteVlanLink(['X_ZTE-COM_VLANID']), 'zte');
  assert.equal(isCtComZteVariant({ knownLeaves: ['WANEponLinkConfig'] }), true);
  assert.equal(isCtComZteVariant({ productModel: 'F609 V9.0' }), false);
  const plan = planWanPpp({
    values: parseWanPpp(body()).value,
    manufacturer: 'ZTE',
    accessType: 'GPON',
    knownLeaves: ['X_CT-COM_WANEponLinkConfig', 'X_CT-COM_WANGPONLinkConfig'],
    pppPath: PPP,
    connectionPath: CONNECTION,
  });
  const values = sent(plan);
  assert.equal(plan.vlanKind, 'epon');
  assert.equal(values.get(`${CONNECTION}X_CT-COM_WANEponLinkConfig.VLANIDMark`), 200);
  assert.equal(values.get(`${CONNECTION}X_CT-COM_WANEponLinkConfig.Mode`), 2);
  assert.equal(typeof values.get(`${CONNECTION}X_CT-COM_WANEponLinkConfig.Mode`), 'number');
  assert.equal(values.has(`${CONNECTION}X_CT-COM_WANGPONLinkConfig.VLANIDMark`), false);
  assert.equal(values.has(`${PPP}X_ZTE-COM_VLANID`), false);
  assert.equal(values.get(`${PPP}X_CT-COM_LanInterface`).includes('LANEthernetInterfaceConfig.1'), true);
  const kinds = zteVlanFallbackPayloads(plan).map((item) => item.kind);
  assert.deepEqual(kinds, ['gpon', 'zte']);
});

test('tanpa objek optik ZTE memakai X_ZTE-COM lalu menyiapkan GPON dan EPON', () => {
  const plan = planFor('ZTE');
  assert.equal(plan.vlanKind, 'zte');
  assert.equal(sent(plan).get(`${PPP}X_ZTE-COM_VLANID`), 200);
  assert.equal(isInvalidParameterFault(new Error('9005: Invalid parameter name')), true);
  assert.equal(isInvalidParameterFault(new Error('Invalid parameter path')), true);
  assert.equal(isInvalidParameterFault(new Error('9003: Invalid arguments')), false);
  const chain = zteVlanFallbackPayloads(plan);
  assert.deepEqual(chain.map((item) => item.kind), ['gpon', 'epon']);
  const gpon = new Map(chain[0].parameterValues.map((row) => [row[0], row[1]]));
  const epon = new Map(chain[1].parameterValues.map((row) => [row[0], row[1]]));
  assert.equal(gpon.get(`${PPP}Username`), 'user@isp');
  assert.equal(gpon.get(`${PPP}NATEnabled`), true);
  assert.equal(gpon.has(`${PPP}X_ZTE-COM_VLANID`), false);
  assert.equal(gpon.get(`${CONNECTION}X_CT-COM_WANGPONLinkConfig.VLANIDMark`), 200);
  assert.equal(gpon.get(`${CONNECTION}X_CT-COM_WANGPONLinkConfig.Mode`), 2);
  assert.equal(epon.get(`${CONNECTION}X_CT-COM_WANEponLinkConfig.VLANIDMark`), 200);
  assert.equal(epon.get(`${CONNECTION}X_CT-COM_WANEponLinkConfig.Mode`), 2);
  assert.equal(ctcomFallbackPayload(plan).some((row) => String(row[0]).includes('X_CT-COM_WANGPONLinkConfig')), true);
});

test('akses EPON tanpa objek tetap standar, dengan cadangan EPON lebih dulu', () => {
  const plan = planFor('ZTE', { accessType: 'EPON' });
  assert.equal(plan.vlanKind, 'zte');
  assert.deepEqual(zteVlanFallbackPayloads(plan).map((item) => item.kind), ['epon', 'gpon']);
});

test('daun WANConnectionDevice mengikuti indeks yang sedang diproses', () => {
  const location = selectWanLocation({
    2: {
      WANCommonInterfaceConfig: { WANAccessType: { _value: 'GPON' } },
      WANConnectionDevice: {
        1: { 'X_CT-COM_WANEponLinkConfig': { VLANIDMark: { _value: 10 } }, WANPPPConnection: { 1: { Enable: { _value: true } } } },
        4: { 'X_CT-COM_WANGPONLinkConfig': { Mode: { _value: 2 } }, WANPPPConnection: { 1: { Enable: { _value: true } } } },
      },
    },
  }, 'zte');
  const eponPath = 'InternetGatewayDevice.WANDevice.2.WANConnectionDevice.1.';
  const gponPath = 'InternetGatewayDevice.WANDevice.2.WANConnectionDevice.4.';
  assert.equal(detectZteVlanLink(connectionLeavesFor(location, eponPath)), 'epon');
  assert.equal(detectZteVlanLink(connectionLeavesFor(location, gponPath)), 'gpon');
});

test('WAN IP dengan WANGPON menaruh VLAN di link CT-COM tanpa autentikasi', () => {
  const parsed = parseWanIp(ipBody());
  const plan = planWanIp({
    values: parsed.value,
    manufacturer: 'ZTE',
    modelName: 'F609 V9.0',
    accessType: 'GPON',
    knownLeaves: ['X_CT-COM_WANGPONLinkConfig'],
    ipPath: IP,
    connectionPath: connectionPathOf(IP),
  });
  const values = sent(plan);
  const link = 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.X_CT-COM_WANGPONLinkConfig';
  assert.equal(plan.vlanKind, 'gpon');
  assert.equal(values.get(`${IP}Enable`), true);
  assert.equal(values.get(`${IP}NATEnabled`), true);
  assert.equal(values.has(`${IP}Username`), false);
  assert.equal(values.has(`${IP}Password`), false);
  assert.equal(values.has(`${IP}X_ZTE-COM_VLANID`), false);
  assert.equal(values.get(`${link}.VLANIDMark`), 1112);
  assert.equal(values.get(`${link}.Mode`), 2);
});

test('WAN IP EPON memakai X_CT-COM_WANEponLinkConfig', () => {
  const parsed = parseWanIp(ipBody());
  const plan = planWanIp({
    values: parsed.value,
    manufacturer: 'ZTE',
    accessType: 'EPON',
    knownLeaves: ['X_CT-COM_WANEponLinkConfig.VLANIDMark'],
    ipPath: IP,
    connectionPath: connectionPathOf(IP),
  });
  const values = sent(plan);
  const link = 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.X_CT-COM_WANEponLinkConfig';
  assert.equal(plan.vlanKind, 'epon');
  assert.equal(values.get(`${link}.VLANIDMark`), 1112);
  assert.equal(typeof values.get(`${link}.VLANIDMark`), 'number');
  assert.equal(values.get(`${link}.Mode`), 2);
  assert.equal(values.has(`${IP}X_ZTE-COM_VLANID`), false);
});

test('EPON menaruh VLAN di link EPON, bukan GPON', () => {
  const plan = planFor('Generic ONU', { accessType: 'EPON' });
  const values = sent(plan);
  assert.equal(plan.profile, 'ctcom');
  assert.equal(values.get(`${CONNECTION}X_CT-COM_WANEponLinkConfig.VLANIDMark`), 200);
  assert.equal(values.get(`${CONNECTION}X_CT-COM_WANEponLinkConfig.802-1pMark`), 5);
  assert.equal(values.get(`${PPP}X_CT-COM_ServiceList`), 'INTERNET');
});
