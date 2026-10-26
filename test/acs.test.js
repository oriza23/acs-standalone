const test = require('node:test');
const assert = require('node:assert/strict');
const { mapDevice, normalizeHost, normalizePort, statusCutoffs } = require('../backend/acs');

const leaf = (value) => ({ _value: value, _type: 'xsd:string' });

test('mapDevice membaca perangkat TR-098 (InternetGatewayDevice)', () => {
  const device = mapDevice({
    _id: '00259E-HG8245H-4857544312345678',
    _lastInform: '2026-10-21T04:00:00.000Z',
    _registered: '2026-01-02T03:04:05.000Z',
    _tags: ['pelanggan', 'vip'],
    _deviceId: { _Manufacturer: 'Huawei', _ProductClass: 'HG8245H', _SerialNumber: '4857544312345678' },
    InternetGatewayDevice: {
      DeviceInfo: { UpTime: leaf('3600') },
      ManagementServer: { ConnectionRequestURL: leaf('http://10.20.30.40:7547/') },
      LANDevice: {
        1: { WLANConfiguration: { 1: { SSID: leaf('Rumah Budi'), TotalAssociations: leaf('3') } } },
      },
      WANDevice: {
        1: {
          X_GponInterafceConfig: { RXPower: leaf('-18.5'), TransceiverTemperature: leaf('41') },
          WANConnectionDevice: {
            1: { WANPPPConnection: { 1: { Username: leaf('budi@isp'), ExternalIPAddress: leaf('100.64.1.9') } } },
          },
        },
      },
    },
  });

  assert.equal(device.device_id, '00259E-HG8245H-4857544312345678');
  assert.equal(device.data_model, 'InternetGatewayDevice');
  assert.equal(device.username, 'budi@isp');
  assert.equal(device.ip_pppoe, '100.64.1.9');
  assert.equal(device.ip_tr069, '10.20.30.40');
  assert.equal(device.sn, '4857544312345678');
  assert.equal(device.manufacturer, 'Huawei');
  assert.equal(device.tipe, 'HG8245H');
  assert.equal(device.ssid, 'Rumah Budi');
  assert.equal(device.wifi_users, 3);
  assert.equal(device.rx_power, '-18.5');
  assert.equal(device.temp, '41');
  assert.equal(device.uptime, 3600);
  assert.equal(device.tags, 'pelanggan,vip');
  assert.equal(device.last_inform.toISOString(), '2026-10-21T04:00:00.000Z');
});

test('mapDevice tidak error untuk perangkat yang belum punya parameter', () => {
  const device = mapDevice({ _id: 'ABC', _deviceId: {} });
  assert.equal(device.device_id, 'ABC');
  assert.equal(device.data_model, null);
  assert.equal(device.username, null);
  assert.equal(device.last_inform, null);
  assert.equal(device.tags, null);
});

test('normalizeHost menerima IP/domain dan menolak input berbahaya', () => {
  assert.equal(normalizeHost('10.0.0.5'), '10.0.0.5');
  assert.equal(normalizeHost('  http://acs.contoh.com/ '), 'acs.contoh.com');
  assert.equal(normalizeHost('::1'), '::1');
  assert.equal(normalizeHost('acs.contoh.com/path?x=1'), null);
  assert.equal(normalizeHost('a b'), null);
  assert.equal(normalizeHost(''), null);
  assert.equal(normalizeHost(undefined), null);
});

test('normalizePort bawaan 7557 dan menolak di luar 1-65535', () => {
  assert.equal(normalizePort(''), 7557);
  assert.equal(normalizePort('7557'), 7557);
  assert.equal(normalizePort(0), null);
  assert.equal(normalizePort(70000), null);
  assert.equal(normalizePort('abc'), null);
  assert.equal(normalizePort(80.5), null);
});

test('statusCutoffs: batas online lebih baru daripada batas 24 jam', () => {
  const now = new Date('2026-10-21T12:00:00Z');
  const cut = statusCutoffs(now);
  assert.equal(cut.day.toISOString(), '2026-10-20T12:00:00.000Z');
  assert.ok(cut.online > cut.day && cut.online < now);
});
