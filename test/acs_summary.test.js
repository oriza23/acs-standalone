const test = require('node:test');
const assert = require('node:assert/strict');
const { LIVE_PROJECTION, readPath, summarizeDevice } = require('../backend/acs_summary');

const v = (value) => ({ _value: value });
const base = { _id: 'DEV-1', _deviceId: { _SerialNumber: 'SN1', _Manufacturer: 'ZTE', _ProductClass: 'F670L' } };
const withIgd = (igd) => ({ ...base, InternetGatewayDevice: igd });
const rx = (igd) => summarizeDevice(withIgd(igd)).rx_onu;
const temp = (igd) => summarizeDevice(withIgd(igd)).temp;

test('readPath aman terhadap node yang tidak ada', () => {
  assert.equal(readPath({}, 'A.B.C'), undefined);
  assert.equal(readPath({ A: { B: v('x') } }, 'A.B'), 'x');
  assert.equal(readPath({ A: null }, 'A.B'), undefined);
  assert.equal(readPath({ A: { B: { C: v(1) } } }, 'A.B'), undefined);
});

test('summarizeDevice merangkum perangkat TR-098 lengkap', () => {
  const item = {
    ...base,
    _lastInform: '2026-10-21T04:00:00.000Z',
    _registered: '2026-01-02T00:00:00.000Z',
    _tags: ['vip'],
    InternetGatewayDevice: {
      DeviceInfo: { UpTime: v('190230'), Description: v('GPON ONT') },
      ManagementServer: { ConnectionRequestURL: v('http://10.20.30.40:7547/x') },
      LANDevice: { 1: { WLANConfiguration: { 1: { SSID: v('Rumah') } }, Hosts: { HostNumberOfEntries: v('0') } } },
      WANDevice: {
        1: {
          WANConnectionDevice: {
            1: { WANPPPConnection: { 1: { Username: v(' '), ExternalIPAddress: v('0.0.0.0') } } },
            2: { WANPPPConnection: { 1: { Username: v('budi@isp'), ExternalIPAddress: v('100.64.1.9') } } },
          },
        },
      },
    },
  };
  assert.deepEqual(summarizeDevice(item), {
    id: 'DEV-1',
    sn: 'SN1',
    manufaktur: 'ZTE',
    tipe: 'F670L',
    pon: 'GPON',
    username: 'budi@isp',
    last_inform: '2026-10-21T04:00:00.000Z',
    registered: '2026-01-02T00:00:00.000Z',
    tags: ['vip'],
    ip_tr069: '10.20.30.40',
    ip_pppoe: '100.64.1.9',
    ssid: 'Rumah',
    user: 0,
    uptime: 190230,
    rx_onu: null,
    temp: null,
  });
});

test('perangkat kosong menghasilkan null, bukan error', () => {
  const result = summarizeDevice({ _id: 'X' });
  assert.equal(result.id, 'X');
  for (const key of ['sn', 'manufaktur', 'tipe', 'pon', 'username', 'last_inform', 'ip_tr069', 'ip_pppoe', 'ssid', 'user', 'uptime', 'rx_onu', 'temp']) {
    assert.equal(result[key], null, key);
  }
  assert.deepEqual(result.tags, []);
});

test('rx_onu: positif = daya linear ZTE, 10*log10(val/10000)', () => {
  assert.equal(rx({ WANDevice: { 1: { WANPONInterfaceConfig: { RXPower: v('172') } } } }), -17.64);
  assert.equal(rx({ WANDevice: { 1: { WANPONInterfaceConfig: { RXPower: v(1000) } } } }), -10);
});

test('rx_onu: lebih kecil dari -100 dibagi 100, selain itu apa adanya', () => {
  assert.equal(rx({ WANDevice: { 1: { X_GponInterafceConfig: { RXPower: v('-1750') } } } }), -17.5);
  assert.equal(rx({ WANDevice: { 1: { WANPONInterfaceConfig: { RXPower: v('-24.3') } } } }), -24.3);
});

test('rx_onu: path FiberHome CT-COM dan TR-181 Optical', () => {
  assert.equal(rx({ DeviceInfo: { X_CTCOM_Optical: { RxPower: v('-1850') } } }), -18.5);
  assert.equal(rx({ WANDevice: { 1: { X_CTCOM_WANDrop: { RxPower: v('-19.2') } } } }), -19.2);
  assert.equal(rx({ WANDevice: { 1: { WANPONInterfaceConfig: { X_CTCOM_RxPower: v('-20.5') } } } }), -20.5);
  assert.equal(summarizeDevice({ ...base, Device: { Optical: { Interface: { 1: { OpticalSignalLevel: v('-19250') } } } } }).rx_onu, -192.5);
  assert.equal(rx({}), null);
  assert.equal(rx({ WANDevice: { 1: { WANPONInterfaceConfig: { RXPower: v('abc') } } } }), null);
});

test('rx_onu: nilai 0 tetap dianggap ada', () => {
  assert.equal(rx({ WANDevice: { 1: { WANPONInterfaceConfig: { RXPower: v('0') } } } }), 0);
});

test('temp: > 1000 dibagi 256, milli-celcius dibagi 1000, wajar apa adanya', () => {
  assert.equal(temp({ DeviceInfo: { X_FH_Temperature: v('13030') } }), 50.9);
  assert.equal(temp({ DeviceInfo: { X_CTCOM_Temperature: v('11492') } }), 44.89);
  assert.equal(temp({ DeviceInfo: { TemperatureStatus: { TemperatureSensor: { 1: { Value: v('45000') } } } } }), 45);
  assert.equal(temp({ WANDevice: { 1: { X_GponInterafceConfig: { TransceiverTemperature: v('38.5') } } } }), 38.5);
  assert.equal(temp({}), null);
});

test('pon: EPON diperiksa lebih dulu, lalu GPON, cadangan dari parameter lain', () => {
  const pon = (productClass, igd = {}) => summarizeDevice({
    _id: 'P', _deviceId: { _ProductClass: productClass }, InternetGatewayDevice: igd,
  }).pon;
  assert.equal(pon('ZXHN F601 EPON'), 'EPON');
  assert.equal(pon('xg-gpon'), 'GPON');
  assert.equal(pon('HG8245H'), null);
  assert.equal(pon('HG8245H', { DeviceInfo: { Description: v('GPON ONT') } }), 'GPON');
});

test('ip: hanya IPv4 valid; teks aneh ditolak', () => {
  const ips = (igd) => {
    const result = summarizeDevice(withIgd(igd));
    return [result.ip_pppoe, result.ip_tr069];
  };
  const ppp = (value) => ({ WANDevice: { 1: { WANConnectionDevice: { 1: { WANPPPConnection: { 1: { ExternalIPAddress: v(value) } } } } } } });
  assert.deepEqual(ips(ppp('evil.com/x')), [null, null]);
  assert.deepEqual(ips(ppp('127.0.0.1')), [null, null]);
  assert.equal(summarizeDevice({ ...base, _ip: '172.16.0.5' }).ip_tr069, '172.16.0.5');
  assert.equal(summarizeDevice({ ...base, _connectionRequestURL: 'http://1.2.3.4:58000/x' }).ip_tr069, '1.2.3.4');
  assert.equal(summarizeDevice({ ...base, Device: { IP: { Interface: { 1: { IPv4Address: { 1: { IPAddress: v('10.1.2.3') } } } } } } }).ip_pppoe, '10.1.2.3');
});

test('projection memuat path-path yang dibaca ringkasan', () => {
  for (const path of [
    'InternetGatewayDevice.DeviceInfo.X_CTCOM_Optical.RxPower',
    'InternetGatewayDevice.DeviceInfo.X_FH_Temperature',
    'Device.Optical.Interface.1.OpticalSignalLevel',
    'InternetGatewayDevice.LANDevice.1.Hosts.HostNumberOfEntries',
    'InternetGatewayDevice.DeviceInfo.UpTime',
  ]) {
    assert.ok(LIVE_PROJECTION.split(',').includes(path), path);
  }
});

test('FiberHome: X_FH_RxPower (WANDSLInterfaceConfig) dan suhu TR-181 / X_FH', () => {
  assert.equal(rx({ WANDevice: { 1: { WANDSLInterfaceConfig: { X_FH_RxPower: v('-1920') } } } }), -19.2);
  assert.equal(rx({ WANDevice: { 1: { WANDSLInterfaceConfig: { X_FH_RxPower: v('150') } } } }), -18.24);
  assert.equal(summarizeDevice({ ...base, Device: { DeviceInfo: { TemperatureStatus: { TemperatureSensor: { 1: { Value: v('41') } } } } } }).temp, 41);
  assert.equal(temp({ DeviceInfo: { X_FH_Temperature: v('11492') } }), 44.89);
  // Urutan: path standar menang atas path FiberHome.
  assert.equal(rx({ WANDevice: { 1: { WANPONInterfaceConfig: { RXPower: v('-20.1') }, WANDSLInterfaceConfig: { X_FH_RxPower: v('-1') } } } }), -20.1);
});

test('projection memuat path FiberHome baru', () => {
  const list = LIVE_PROJECTION.split(',');
  assert.ok(list.includes('InternetGatewayDevice.WANDevice.1.WANDSLInterfaceConfig.X_FH_RxPower'));
  assert.ok(list.includes('Device.DeviceInfo.TemperatureStatus.TemperatureSensor.1.Value'));
});

test('FiberHome: X_FH_GponInterfaceConfig.RXPower', () => {
  assert.equal(rx({ WANDevice: { 1: { X_FH_GponInterfaceConfig: { RXPower: v('-1875') } } } }), -18.75);
  assert.equal(rx({ WANDevice: { 1: { X_FH_GponInterfaceConfig: { RXPower: v('-21.4') } } } }), -21.4);
  assert.equal(rx({ WANDevice: { 1: { X_FH_GponInterfaceConfig: { RXPower: v('172') } } } }), -17.64);
  // Standar menang; X_FH_GponInterfaceConfig menang atas X_FH_RxPower (DSL).
  assert.equal(rx({ WANDevice: { 1: { WANPONInterfaceConfig: { RXPower: v('-20.1') }, X_FH_GponInterfaceConfig: { RXPower: v('-1') } } } }), -20.1);
  assert.equal(rx({ WANDevice: { 1: { X_FH_GponInterfaceConfig: { RXPower: v('-22.2') }, WANDSLInterfaceConfig: { X_FH_RxPower: v('-1') } } } }), -22.2);
  assert.ok(LIVE_PROJECTION.split(',').includes('InternetGatewayDevice.WANDevice.1.X_FH_GponInterfaceConfig.RXPower'));
});

test('FiberHome: X_FH_GponInterfaceConfig.TransceiverTemperature', () => {
  const fh = (value) => ({ WANDevice: { 1: { X_FH_GponInterfaceConfig: { TransceiverTemperature: v(value) } } } });
  assert.equal(temp(fh('42.5')), 42.5);
  assert.equal(temp(fh('13030')), 50.9);
  assert.equal(temp(fh('45000')), 45);
  // Path DeviceInfo FiberHome menang atas path transceiver ini.
  assert.equal(temp({ ...fh('40'), DeviceInfo: { X_FH_Temperature: v('36') } }), 36);
  assert.ok(LIVE_PROJECTION.split(',').includes('InternetGatewayDevice.WANDevice.1.X_FH_GponInterfaceConfig.TransceiverTemperature'));
});

test('user: HostNumberOfEntries diutamakan, TotalAssociations sebagai cadangan', () => {
  const user = (igd) => summarizeDevice(withIgd(igd)).user;
  const lan = (extra) => ({ LANDevice: { 1: extra } });
  assert.equal(user(lan({ Hosts: { HostNumberOfEntries: v('3') }, WLANConfiguration: { 1: { TotalAssociations: v('9') } } })), 3);
  assert.equal(user(lan({ WLANConfiguration: { 1: { TotalAssociations: v('2') } } })), 2);
  assert.equal(user(lan({ Hosts: { HostNumberOfEntries: v('0') }, WLANConfiguration: { 1: { TotalAssociations: v('5') } } })), 0);
  assert.equal(user({}), null);
  assert.equal(summarizeDevice({ ...base, Device: { Hosts: { HostNumberOfEntries: v('4') } } }).user, 4);
  assert.ok(LIVE_PROJECTION.split(',').includes('InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.TotalAssociations'));
});

test('CMCC: X_CMCC_GponInterfaceConfig.RXPower', () => {
  const cmcc = (value) => ({ WANDevice: { 1: { X_CMCC_GponInterfaceConfig: { RXPower: v(value) } } } });
  assert.equal(rx(cmcc('-1830')), -18.3);
  assert.equal(rx(cmcc('-22.5')), -22.5);
  assert.equal(rx(cmcc('172')), -17.64);
  // Path FiberHome/CT-COM yang lebih dulu dalam daftar menang atas CMCC.
  assert.equal(rx({ WANDevice: { 1: { ...cmcc('-1').WANDevice[1], X_CTCOM_WANDrop: { RxPower: v('-19.9') } } } }), -19.9);
  assert.ok(LIVE_PROJECTION.split(',').includes('InternetGatewayDevice.WANDevice.1.X_CMCC_GponInterfaceConfig.RXPower'));
});

test('CT-COM: X_CT-COM_GponInterfaceConfig.RXPower (nama berhubung tanda minus)', () => {
  const ct = (value) => ({ WANDevice: { 1: { 'X_CT-COM_GponInterfaceConfig': { RXPower: v(value) } } } });
  assert.equal(rx(ct('-1990')), -19.9);
  assert.equal(rx(ct('-23.1')), -23.1);
  assert.equal(rx(ct('172')), -17.64);
  // CMCC lebih dulu dalam daftar, jadi menang atas CT-COM.
  assert.equal(rx({ WANDevice: { 1: { ...ct('-1').WANDevice[1], X_CMCC_GponInterfaceConfig: { RXPower: v('-21.5') } } } }), -21.5);
  assert.ok(LIVE_PROJECTION.split(',').includes('InternetGatewayDevice.WANDevice.1.X_CT-COM_GponInterfaceConfig.RXPower'));
});

test('EPON CT-COM: X_CT-COM_EponInterfaceConfig.RXPower', () => {
  const epon = (value) => ({ WANDevice: { 1: { 'X_CT-COM_EponInterfaceConfig': { RXPower: v(value) } } } });
  assert.equal(rx(epon('-2010')), -20.1);
  assert.equal(rx(epon('-26.4')), -26.4);
  assert.equal(rx(epon('172')), -17.64);
  // X_CT-COM_GponInterfaceConfig lebih dulu dalam daftar, jadi menang atas EPON.
  assert.equal(rx({ WANDevice: { 1: { ...epon('-1').WANDevice[1], 'X_CT-COM_GponInterfaceConfig': { RXPower: v('-19.5') } } } }), -19.5);
  assert.ok(LIVE_PROJECTION.split(',').includes('InternetGatewayDevice.WANDevice.1.X_CT-COM_EponInterfaceConfig.RXPower'));
});

test('CT-COM GPON/EPON: TransceiverTemperature', () => {
  const ct = (iface, value) => ({ WANDevice: { 1: { [iface]: { TransceiverTemperature: v(value) } } } });
  assert.equal(temp(ct('X_CT-COM_GponInterfaceConfig', '41.5')), 41.5);
  assert.equal(temp(ct('X_CT-COM_EponInterfaceConfig', '13030')), 50.9);
  assert.equal(temp(ct('X_CT-COM_EponInterfaceConfig', '45000')), 45);
  // Urutan: FiberHome Gpon > CT-COM Gpon > CT-COM Epon.
  const both = { WANDevice: { 1: {
    X_FH_GponInterfaceConfig: { TransceiverTemperature: v('30') },
    'X_CT-COM_GponInterfaceConfig': { TransceiverTemperature: v('40') },
    'X_CT-COM_EponInterfaceConfig': { TransceiverTemperature: v('50') },
  } } };
  assert.equal(temp(both), 30);
  delete both.WANDevice[1].X_FH_GponInterfaceConfig;
  assert.equal(temp(both), 40);
  delete both.WANDevice[1]['X_CT-COM_GponInterfaceConfig'];
  assert.equal(temp(both), 50);
  const list = LIVE_PROJECTION.split(',');
  assert.ok(list.includes('InternetGatewayDevice.WANDevice.1.X_CT-COM_GponInterfaceConfig.TransceiverTemperature'));
  assert.ok(list.includes('InternetGatewayDevice.WANDevice.1.X_CT-COM_EponInterfaceConfig.TransceiverTemperature'));
});

const { RX_PATHS, TEMP_PATHS } = require('../backend/acs_summary');

// Membangun dokumen dari path berpemisah titik: dokumenDari('A.B.C', '5') -> { A: { B: { C: { _value: '5' } } } }
function docFrom(path, value) {
  const keys = path.split('.');
  const doc = {};
  let node = doc;
  keys.forEach((key, index) => {
    node[key] = index === keys.length - 1 ? { _value: value } : {};
    node = node[key];
  });
  return { _id: 'D', ...doc };
}

test('Ultimate: CMCC EPON untuk RX dan suhu', () => {
  assert.equal(summarizeDevice(docFrom('InternetGatewayDevice.WANDevice.1.X_CMCC_EponInterfaceConfig.RXPower', '-1960')).rx_onu, -19.6);
  assert.equal(summarizeDevice(docFrom('InternetGatewayDevice.WANDevice.1.X_CMCC_GponInterfaceConfig.TransceiverTemperature', '13030')).temp, 50.9);
  assert.equal(summarizeDevice(docFrom('InternetGatewayDevice.WANDevice.1.X_CMCC_EponInterfaceConfig.TransceiverTemperature', '38.5')).temp, 38.5);
});

test('Ultimate: setiap path RX dan suhu terbaca, dan semuanya ada di projection', () => {
  const projection = LIVE_PROJECTION.split(',');
  for (const path of RX_PATHS) {
    assert.ok(projection.includes(path), `projection: ${path}`);
    assert.equal(summarizeDevice(docFrom(path, '-21.5')).rx_onu, -21.5, path);
  }
  for (const path of TEMP_PATHS) {
    assert.ok(projection.includes(path), `projection: ${path}`);
    assert.equal(summarizeDevice(docFrom(path, '37.5')).temp, 37.5, path);
  }
  assert.equal(new Set(projection).size, projection.length, 'tanpa duplikat');
});

// Gabung dalam (deep merge) dua dokumen hasil docFrom supaya kedua path ada di satu dokumen.
function mergeDocs(target, source) {
  for (const key of Object.keys(source)) {
    const isBranch = source[key] && typeof source[key] === 'object' && !('_value' in source[key]);
    target[key] = isBranch && target[key] && typeof target[key] === 'object' ? mergeDocs(target[key], source[key]) : source[key];
  }
  return target;
}

test('Ultimate: urutan prioritas RX dan suhu mengikuti daftar (path awal menang)', () => {
  const check = (paths, early, late, read) => {
    for (let i = 0; i < paths.length - 1; i += 1) {
      const both = mergeDocs(docFrom(paths[i + 1], late), docFrom(paths[i], early));
      assert.equal(read(summarizeDevice(both)), Number(early), `${paths[i]} harus menang atas ${paths[i + 1]}`);
    }
  };
  check(RX_PATHS, '-10.5', '-30.5', (result) => result.rx_onu);
  check(TEMP_PATHS, '33.5', '44.5', (result) => result.temp);
});

const { extractHosts, HOSTS_PROJECTION } = require('../backend/acs_summary');

const host = (fields) => Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, { _value: value }]));

test('extractHosts: TR-098 LANDevice[1].Hosts.Host, hanya key angka', () => {
  const item = {
    InternetGatewayDevice: { LANDevice: { 1: { Hosts: { Host: {
      _object: true, _writable: false,
      1: host({ HostName: 'laptop-budi', IPAddress: '192.168.1.10', MACAddress: 'AA:BB:CC:DD:EE:01', InterfaceType: '802.11', Active: true }),
      2: host({ HostName: '', IPAddress: '192.168.1.11', MACAddress: 'AA:BB:CC:DD:EE:02', Layer2Interface: 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1', Active: 'true' }),
      3: host({ HostName: 'pc', IPAddress: '192.168.1.12', MACAddress: 'AA:BB:CC:DD:EE:03', Layer2Interface: 'InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.1' }),
      10: host({ IPAddress: '192.168.1.20', MACAddress: 'aa-bb-cc-dd-ee-10' }),
    } } } } },
  };
  assert.deepEqual(extractHosts(item), [
    { hostname: 'laptop-budi', ip: '192.168.1.10', mac: 'AA:BB:CC:DD:EE:01', type: '802.11', active: true },
    { hostname: 'N/A', ip: '192.168.1.11', mac: 'AA:BB:CC:DD:EE:02', type: '802.11', active: true },
    { hostname: 'pc', ip: '192.168.1.12', mac: 'AA:BB:CC:DD:EE:03', type: 'Ethernet', active: undefined },
    { hostname: 'N/A', ip: '192.168.1.20', mac: 'aa-bb-cc-dd-ee-10', type: 'Ethernet', active: undefined },
  ]);
});

test('extractHosts: Active=false dibuang, MAC tidak valid tanpa Active dibuang, Active=true tanpa MAC dipertahankan', () => {
  const item = { Device: { Hosts: { Host: {
    1: host({ HostName: 'putus', MACAddress: 'AA:BB:CC:DD:EE:01', Active: false }),
    2: host({ HostName: 'rusak', MACAddress: 'xyz', IPAddress: '10.0.0.2' }),
    3: host({ HostName: 'aktif-tanpa-mac', IPAddress: '10.0.0.3', Active: true }),
    4: host({ HostName: 'putus-string', MACAddress: 'AA:BB:CC:DD:EE:04', Active: 'false' }),
  } } } };
  const result = extractHosts(item);
  assert.deepEqual(result.map((entry) => entry.hostname), ['aktif-tanpa-mac']);
  assert.equal(result[0].mac, '-');
  assert.equal(result[0].type, 'Ethernet');
});

test('extractHosts: data kosong / tidak ada menghasilkan array kosong', () => {
  assert.deepEqual(extractHosts({}), []);
  assert.deepEqual(extractHosts(null), []);
  assert.deepEqual(extractHosts({ InternetGatewayDevice: { LANDevice: { 1: { Hosts: { Host: {} } } } } }), []);
  assert.deepEqual(extractHosts({ InternetGatewayDevice: { LANDevice: { 1: { Hosts: { Host: { 1: 'bukan-objek' } } } } } }), []);
  assert.ok(HOSTS_PROJECTION.includes('Hosts.Host'));
  // Host tidak ikut projection daftar ONU (terlalu berat untuk semua perangkat).
  assert.ok(!LIVE_PROJECTION.split(',').some((path) => /Hosts\.Host(\.|$)/.test(path)));
});

const { extractWlans, WLANS_PROJECTION } = require('../backend/acs_summary');

const wlanNode = (fields) => host(fields);

test('extractWlans: TR-098 dengan 4 SSID 2.4G + 4 SSID 5G', () => {
  const WLAN = {};
  for (let i = 1; i <= 8; i += 1) {
    WLAN[i] = wlanNode({ SSID: `Wifi-${i}`, Enable: i <= 2 ? '1' : '0', BeaconType: '11i', TotalAssociations: i === 1 ? '3' : '0' });
  }
  WLAN[1].PreSharedKey = { 1: { PreSharedKey: { _value: 'rahasia123' } } };
  WLAN[2].KeyPassphrase = { _value: 'cadangan456' };
  const wlans = extractWlans({ InternetGatewayDevice: { LANDevice: { 1: { WLANConfiguration: { _object: true, ...WLAN } } } } });
  assert.equal(wlans.length, 8);
  assert.deepEqual(wlans.map((w) => w.freq), ['2.4 GHz', '2.4 GHz', '2.4 GHz', '2.4 GHz', '5 GHz', '5 GHz', '5 GHz', '5 GHz']);
  assert.deepEqual(wlans[0], {
    id: '1', ssid: 'Wifi-1', password: 'rahasia123', security: '11i', freq: '2.4 GHz', band: '20MHz/40MHz', connected: 3, status: true,
  });
  assert.equal(wlans[1].password, 'cadangan456');
  assert.equal(wlans[2].password, '-');
  assert.equal(wlans[2].status, false);
  assert.equal(wlans[4].status, false);
});

test('extractWlans: keamanan terbuka, channel menentukan pita, slot kosong jadi SSID default', () => {
  const wlans = extractWlans({ InternetGatewayDevice: { LANDevice: { 1: { WLANConfiguration: {
    1: wlanNode({ SSID: 'Tamu', BeaconType: 'Basic', BasicEncryptionModes: 'None', Enable: true }),
    2: wlanNode({ SSID: 'Aneh', BeaconType: 'Basic', BasicEncryptionModes: 'WEPEncryption', Channel: 36, OperatingChannelBandwidth: '80MHz', Enable: 'true' }),
    3: { Enable: { _value: '1' } },
    4: 'bukan-objek',
    x: wlanNode({ SSID: 'bukan-angka' }),
  } } } } });
  assert.equal(wlans.length, 4);
  assert.equal(wlans[0].security, 'Open System');
  assert.equal(wlans[0].status, true);
  assert.equal(wlans[1].security, 'WEPEncryption');
  assert.equal(wlans[1].freq, '5 GHz');
  assert.equal(wlans[1].band, '80MHz');
  assert.deepEqual(wlans[2], {
    id: '3', ssid: 'SSID3', password: '-', security: 'None', freq: '2.4 GHz', band: '-', connected: 0, status: false,
  });
  assert.equal(wlans[3].ssid, 'SSID4');
  assert.equal(wlans[3].status, false);
});

test('extractWlans: TR-181 (SSID + AccessPoint + Radio)', () => {
  const wlans = extractWlans({ Device: { WiFi: {
    Radio: { 1: wlanNode({ OperatingFrequencyBand: '2.4GHz', OperatingChannelBandwidth: '40MHz' }), 2: wlanNode({ OperatingFrequencyBand: '5GHz' }) },
    SSID: {
      1: wlanNode({ SSID: 'Rumah', Enable: true, LowerLayers: 'Device.WiFi.Radio.1' }),
      2: wlanNode({ SSID: 'Rumah-5G', Enable: false, LowerLayers: 'Device.WiFi.Radio.2' }),
    },
    AccessPoint: {
      1: { ...wlanNode({ SSIDReference: 'Device.WiFi.SSID.1', AssociatedDeviceNumberOfEntries: 4 }), Security: wlanNode({ ModeEnabled: 'WPA2-Personal', KeyPassphrase: 'sandi-181' }) },
      2: { ...wlanNode({ SSIDReference: 'Device.WiFi.SSID.2' }), Security: wlanNode({ ModeEnabled: 'None' }) },
    },
  } } });
  assert.deepEqual(wlans[0], {
    id: '1', ssid: 'Rumah', password: 'sandi-181', security: 'WPA2-Personal', freq: '2.4 GHz', band: '40MHz', connected: 4, status: true,
  });
  assert.equal(wlans.length, 4);
  assert.equal(wlans[1].freq, '5 GHz');
  assert.equal(wlans[1].security, 'Open System');
  assert.equal(wlans[1].status, false);
  assert.equal(wlans[2].ssid, 'SSID3');
  assert.equal(wlans[2].status, false);
  assert.equal(wlans[3].freq, '2.4 GHz');
});

test('extractWlans: data kosong tetap 4 SSID default; indeks 5 GHz memperpanjang daftar', () => {
  const defaults = [1, 2, 3, 4].map((index) => ({
    id: String(index),
    ssid: `SSID${index}`,
    password: '-',
    security: 'None',
    freq: '2.4 GHz',
    band: '-',
    connected: 0,
    status: false,
  }));
  assert.deepEqual(extractWlans({}), defaults);
  assert.deepEqual(extractWlans(null), defaults);
  assert.deepEqual(extractWlans({ InternetGatewayDevice: { LANDevice: { 1: { WLANConfiguration: {} } } } }), defaults);

  const extended = extractWlans({ InternetGatewayDevice: { LANDevice: { 1: { WLANConfiguration: {
    1: wlanNode({ SSID: 'Utama', Enable: '1' }),
    6: wlanNode({ SSID: 'Lima', Enable: '0' }),
  } } } } });
  assert.equal(extended.length, 6);
  assert.equal(extended[0].ssid, 'Utama');
  assert.equal(extended[4].ssid, 'SSID5');
  assert.equal(extended[4].freq, '5 GHz');
  assert.equal(extended[5].ssid, 'Lima');
  assert.equal(extended[5].freq, '5 GHz');
  assert.ok(WLANS_PROJECTION.includes('WLANConfiguration'));
  assert.ok(!LIVE_PROJECTION.split(',').some((path) => path.endsWith('WLANConfiguration')));
});

const { extractLanConfig, LAN_PROJECTION } = require('../backend/acs_summary');

test('extractLanConfig: TR-098 LANHostConfigManagement lengkap', () => {
  const item = { InternetGatewayDevice: { LANDevice: { 1: {
    LANEthernetInterfaceConfig: { 1: wlanNode({ MACAddress: 'AA:BB:CC:00:11:22' }) },
    LANHostConfigManagement: {
      IPInterface: { 1: wlanNode({ IPInterfaceIPAddress: '192.168.1.1', IPInterfaceSubnetMask: '255.255.255.0' }) },
      DHCPServerEnable: { _value: true },
      MinAddress: { _value: '192.168.1.2' },
      MaxAddress: { _value: '192.168.1.254' },
      DHCPLeaseTime: { _value: 86400 },
      DNSServers: { _value: '8.8.8.8, 1.1.1.1' },
    },
  } } } };
  assert.deepEqual(extractLanConfig(item), {
    ip: '192.168.1.1', subnet: '255.255.255.0', mac: 'AA:BB:CC:00:11:22', dhcpEnabled: true,
    dhcpMin: '192.168.1.2', dhcpMax: '192.168.1.254', leaseTime: '86400', dns: ['8.8.8.8', '1.1.1.1', '-'],
  });
});

test('extractLanConfig: nilai DHCP berbagai bentuk, 3 DNS, dan data kosong', () => {
  const cfg = (extra) => extractLanConfig({ InternetGatewayDevice: { LANDevice: { 1: { LANHostConfigManagement: extra } } } });
  assert.equal(cfg({ DHCPServerEnable: { _value: '1' } }).dhcpEnabled, true);
  assert.equal(cfg({ DHCPServerEnable: { _value: 'true' } }).dhcpEnabled, true);
  assert.equal(cfg({ DHCPServerEnable: { _value: '0' } }).dhcpEnabled, false);
  assert.equal(cfg({ DHCPServerEnable: { _value: false } }).dhcpEnabled, false);
  assert.deepEqual(cfg({ DNSServers: { _value: '1.1.1.1,8.8.8.8,9.9.9.9,4.4.4.4' } }).dns, ['1.1.1.1', '8.8.8.8', '9.9.9.9']);
  assert.deepEqual(cfg({ DNSServers: { _value: ',  ,' } }).dns, ['-', '-', '-']);
  assert.deepEqual(extractLanConfig({}), {
    ip: '-', subnet: '-', mac: '-', dhcpEnabled: false, dhcpMin: '-', dhcpMax: '-', leaseTime: '-', dns: ['-', '-', '-'],
  });
  assert.deepEqual(extractLanConfig(null).dns, ['-', '-', '-']);
});

test('extractLanConfig: cadangan TR-181 dan projection LAN terpisah dari daftar ONU', () => {
  const cfg = extractLanConfig({ Device: {
    IP: { Interface: { 1: { IPv4Address: { 1: wlanNode({ IPAddress: '10.0.0.1', SubnetMask: '255.255.0.0' }) } } } },
    DHCPv4: { Server: { Enable: { _value: true }, Pool: { 1: wlanNode({ MinAddress: '10.0.0.10', MaxAddress: '10.0.0.99', LeaseTime: 3600, DNSServers: '10.0.0.1' }) } } },
  } });
  assert.equal(cfg.ip, '10.0.0.1');
  assert.equal(cfg.subnet, '255.255.0.0');
  assert.equal(cfg.dhcpEnabled, true);
  assert.equal(cfg.dhcpMin, '10.0.0.10');
  assert.equal(cfg.leaseTime, '3600');
  assert.deepEqual(cfg.dns, ['10.0.0.1', '-', '-']);
  assert.ok(LAN_PROJECTION.includes('LANHostConfigManagement'));
  assert.ok(!LIVE_PROJECTION.includes('LANHostConfigManagement'));
});

const { extractWans, WANS_PROJECTION, ssidCountOf } = require('../backend/acs_summary');

test('extractWans: TR-098 PPP dan IP, VLAN vendor, sandi disamarkan', () => {
  const item = {
    InternetGatewayDevice: {
      WANDevice: {
        1: {
          WANConnectionDevice: {
            1: {
              'X_CT-COM_WANGponLinkConfig': { VLANIDMark: v('200') },
              WANPPPConnection: {
                1: host({
                  Name: 'pppoe_internet',
                  ConnectionStatus: 'Connected',
                  ExternalIPAddress: '100.64.1.9',
                  RemoteIPAddress: '100.64.0.1',
                  Username: 'budi@isp',
                  Password: 'rahasia-ppp',
                  'X_CT-COM_ServiceList': 'INTERNET',
                  DNSServers: '8.8.8.8,1.1.1.1',
                  ConnectionTrigger: 'AlwaysOn',
                  NATEnabled: '1',
                  TransportType: 'PPPoE',
                  MACAddress: 'AA:BB:CC:DD:EE:FF',
                  ConnectionType: 'IP_Routed',
                  Uptime: '3660',
                }),
              },
              WANIPConnection: {
                1: {},
                2: host({
                  Name: 'ip_tr069',
                  ConnectionStatus: 'Disconnected',
                  ExternalIPAddress: '10.1.1.5',
                  DefaultGateway: '10.1.1.1',
                  'X_BROADCOM_COM_VLANID': '100',
                  NATEnabled: false,
                  Uptime: '0',
                }),
              },
            },
          },
        },
      },
    },
  };
  const wans = extractWans(item);
  assert.equal(wans.length, 2);
  assert.equal(JSON.stringify(wans).includes('rahasia-ppp'), false);
  assert.deepEqual(wans[0], {
    id: '1.1.ppp.1',
    fullPath: 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.',
    type: 'PPP',
    name: 'pppoe_internet',
    status: 'Connected',
    statusSource: 'ConnectionStatus',
    ip: '100.64.1.9',
    remoteIp: '100.64.0.1',
    username: 'budi@isp',
    password: '********',
    vlanStatus: 'Enabled',
    vlanId: '200',
    service: 'INTERNET',
    dns: '8.8.8.8,1.1.1.1',
    connTrigger: 'AlwaysOn',
    nat: 'Enabled',
    transport: 'PPPoE',
    mac: 'AA:BB:CC:DD:EE:FF',
    connType: 'IP_Routed',
    uptime: '3660',
    portBind: '',
  });
  assert.equal(wans[1].type, 'IP');
  assert.equal(wans[1].id, '1.1.ip.2');
  assert.equal(wans[1].fullPath, 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.2.');
  assert.equal(wans[1].username, '-');
  assert.equal(wans[1].password, '-');
  assert.equal(wans[1].remoteIp, '10.1.1.1');
  assert.equal(wans[1].vlanId, '100');
  assert.equal(wans[1].vlanStatus, 'Enabled');
  assert.equal(wans[1].nat, 'Disabled');
  assert.equal(wans[1].transport, 'IP_Routed');
  assert.equal(wans[1].service, 'ip_tr069');
  assert.equal(wans[1].connTrigger, 'AlwaysOn');
});

test('extractWans: TR-181 hanya PPP dan IP upstream, LAN tidak ikut', () => {
  const item = {
    Device: {
      PPP: {
        Interface: {
          1: host({
            Name: 'wanppp',
            Username: 'user@isp',
            Password: 'sandi-181',
            ConnectionStatus: 'Connected',
            ConnectionTrigger: 'OnDemand',
          }),
        },
      },
      IP: {
        Interface: {
          1: {
            ...host({ Name: 'lan', Upstream: false, Status: 'Up', MACAddress: '11:11:11:11:11:11' }),
            IPv4Address: { 1: host({ IPAddress: '192.168.1.1' }) },
          },
          2: {
            ...host({
              Name: 'wanip',
              Upstream: true,
              Status: 'Up',
              LowerLayers: 'Device.Ethernet.VLANTermination.1',
              MACAddress: '22:22:22:22:22:22',
              Type: 'Normal',
            }),
            IPv4Address: { 1: host({ IPAddress: '36.1.2.3' }) },
          },
          3: {
            ...host({ Name: 'ppp-ip', Upstream: true, Status: 'Up', LowerLayers: 'Device.PPP.Interface.1' }),
            IPv4Address: { 1: host({ IPAddress: '100.1.1.1' }) },
          },
        },
      },
      Ethernet: { VLANTermination: { 1: host({ VLANID: '300' }) } },
      NAT: { InterfaceSetting: { 1: host({ Interface: 'Device.IP.Interface.2', Enable: true }) } },
    },
  };
  const wans = extractWans(item);
  assert.equal(JSON.stringify(wans).includes('sandi-181'), false);
  assert.deepEqual(wans.map((wan) => wan.type), ['PPP', 'IP']);
  assert.equal(wans[0].fullPath, 'Device.PPP.Interface.1.');
  assert.equal(wans[1].fullPath, 'Device.IP.Interface.2.');
  assert.equal(wans[0].ip, '100.1.1.1');
  assert.equal(wans[0].username, 'user@isp');
  assert.equal(wans[0].password, '********');
  assert.equal(wans[0].connTrigger, 'OnDemand');
  assert.equal(wans[1].ip, '36.1.2.3');
  assert.equal(wans[1].vlanId, '300');
  assert.equal(wans[1].vlanStatus, 'Enabled');
  assert.equal(wans[1].nat, 'Enabled');
  assert.equal(wans[1].mac, '22:22:22:22:22:22');
  assert.ok(!wans.some((wan) => wan.ip === '192.168.1.1'));
});

test('extractWans: port binding ZTE dan Huawei dibaca, jumlah SSID dari NumberOfEntries', () => {
  const item = {
    InternetGatewayDevice: {
      LANDevice: {
        1: { WLANConfigurationNumberOfEntries: { _value: 8 } },
      },
      WANDevice: {
        1: {
          WANConnectionDevice: {
            1: {
              WANPPPConnection: {
                1: {
                  Name: { _value: 'inet' },
                  Enable: { _value: true },
                  'X_ZTE-COM_LanInterface': { _value: 'LAN1,SSID1,WAN_PPP_1' },
                },
              },
              WANIPConnection: {
                1: {
                  Name: { _value: 'bridge' },
                  Enable: { _value: true },
                  X_HW_LANBIND: {
                    Lan2Enable: { _value: true },
                    SSID5Enable: { _value: '1' },
                    SSID6Enable: { _value: false },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
  const wans = extractWans(item);
  assert.equal(wans[0].portBind, 'LAN1,SSID1,WAN_PPP_1');
  assert.equal(wans[1].portBind, 'LAN2,SSID5');
  assert.equal(ssidCountOf(item), 8);
  assert.equal(ssidCountOf({
    InternetGatewayDevice: {
      LANDevice: { 1: { WLANConfiguration: { 1: { SSID: { _value: 'a' } }, 4: { SSID: { _value: 'd' } } } } },
    },
  }), 4);
  assert.equal(ssidCountOf({}), 0);
});

test('extractWans: data kosong dan projection tidak ikut daftar ONU', () => {
  assert.deepEqual(extractWans({}), []);
  assert.deepEqual(extractWans(null), []);
  assert.deepEqual(extractWans({ InternetGatewayDevice: { WANDevice: { 1: { WANConnectionDevice: {} } } } }), []);
  assert.ok(WANS_PROJECTION.includes('InternetGatewayDevice.WANDevice.1.WANConnectionDevice'));
  // Daftar ONU hanya mengambil Username/IP, bukan seluruh subtree koneksi WAN.
  assert.ok(!LIVE_PROJECTION.split(',').includes('InternetGatewayDevice.WANDevice.1.WANConnectionDevice'));
});
