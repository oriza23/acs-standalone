const test = require('node:test');
const assert = require('node:assert/strict');
const { parseWlanUpdate, planWlanUpdate, passwordPathFor } = require('../backend/acs_wlan');

const ok = { deviceId: 'ONU-1', wlanId: 1, ssid: 'Rumah', password: 'sandi1234', status: true };
const v = (value) => ({ _value: value });
const BASE = 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1';

test('parseWlanUpdate: input valid dinormalisasi', () => {
  assert.deepEqual(parseWlanUpdate(ok).value, {
    deviceId: 'ONU-1', wlanId: '1', ssid: 'Rumah', password: 'sandi1234', status: true, security: '',
  });
  assert.equal(parseWlanUpdate({ ...ok, security: 'WPA/WPA2-PSK' }).value.security, 'WPA/WPA2-PSK');
  assert.equal(parseWlanUpdate({ ...ok, security: 'Open System', password: 'sandi1234' }).value.password, '');
  assert.equal(parseWlanUpdate({ ...ok, security: 'None' }).value.password, '');
  assert.deepEqual(parseWlanUpdate({ ...ok, wlanId: '05', password: '' }).value.wlanId, '5');
  assert.equal(parseWlanUpdate({ ...ok, password: undefined }).value.password, '');
  assert.equal(parseWlanUpdate({ ...ok, status: false }).value.status, false);
  assert.equal(parseWlanUpdate({ ...ok, ssid: 'x'.repeat(32) }).error, undefined);
});

test('parseWlanUpdate: menolak input berbahaya / tidak valid', () => {
  const bad = (override) => parseWlanUpdate({ ...ok, ...override }).error;
  assert.ok(bad({ deviceId: '' }));
  assert.ok(bad({ deviceId: 5 }));
  assert.ok(bad({ wlanId: '1.SSID' }), 'wlanId tidak boleh menyisipkan path');
  assert.ok(bad({ wlanId: '../2' }));
  assert.ok(bad({ wlanId: 0 }));
  assert.ok(bad({ wlanId: 17 }));
  assert.ok(bad({ wlanId: '' }));
  assert.ok(bad({ ssid: '' }));
  assert.ok(bad({ ssid: 'x'.repeat(33) }));
  assert.ok(bad({ ssid: 'a\nb' }), 'karakter kontrol');
  assert.ok(bad({ ssid: 'é'.repeat(17) }), 'batas 32 byte, bukan 32 karakter');
  assert.ok(bad({ password: '1234567' }), 'terlalu pendek');
  assert.ok(bad({ password: 'x'.repeat(64) }), 'terlalu panjang');
  assert.ok(bad({ password: 'sandi\u00e9123' }), 'non-ASCII');
  assert.ok(bad({ password: 12345678 }));
  assert.ok(bad({ status: 'true' }), 'status harus boolean sungguhan');
  assert.ok(bad({ status: undefined }));
  assert.ok(bad({ security: 'WPA;reboot' }), 'security tidak boleh menyisipkan pemisah');
  assert.ok(bad({ security: '../None' }));
  assert.ok(bad({ security: 1 }));
  assert.ok(parseWlanUpdate(null).error);
});

test('planWlanUpdate: hanya parameter yang berubah, dengan tipe XSD yang benar', () => {
  const node = { SSID: v('Lama'), Enable: v('0'), PreSharedKey: { 1: { PreSharedKey: v('lama12345') } } };
  const { parameterValues, changed } = planWlanUpdate({ wlanId: '1', wlanNode: node, ssid: 'Baru', password: 'baru12345', status: true });
  assert.deepEqual(parameterValues, [
    [`${BASE}.SSID`, 'Baru', 'xsd:string'],
    [`${BASE}.Enable`, true, 'xsd:boolean'],
    [`${BASE}.PreSharedKey.1.PreSharedKey`, 'baru12345', 'xsd:string'],
  ]);
  assert.deepEqual(changed, ['ssid', 'status', 'password']);
});

test('planWlanUpdate: tidak ada perubahan -> tidak ada parameter', () => {
  const node = { SSID: v('Rumah'), Enable: v(true), PreSharedKey: { 1: { PreSharedKey: v('sandi1234') } } };
  assert.deepEqual(planWlanUpdate({ wlanId: '1', wlanNode: node, ssid: 'Rumah', password: 'sandi1234', status: true }), { parameterValues: [], changed: [] });
  assert.deepEqual(planWlanUpdate({ wlanId: '1', wlanNode: node, ssid: 'Rumah', password: '', status: true }).changed, []);
});

test('planWlanUpdate: password kosong tidak mengirim apa pun; status false dikirim sebagai boolean', () => {
  const node = { SSID: v('Rumah'), Enable: v('1') };
  const plan = planWlanUpdate({ wlanId: '2', wlanNode: node, ssid: 'Rumah', password: '', status: false });
  assert.deepEqual(plan.parameterValues, [['InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.Enable', false, 'xsd:boolean']]);
});

test('planWlanUpdate: sandi yang hanya dibaca ACS tersembunyi tetap dikirim bila diisi', () => {
  const node = { SSID: v('Rumah'), Enable: v(true), PreSharedKey: { 1: { PreSharedKey: v('') } } };
  const plan = planWlanUpdate({ wlanId: '1', wlanNode: node, ssid: 'Rumah', password: 'sandi1234', status: true });
  assert.deepEqual(plan.changed, ['password']);
});

test('planWlanUpdate: WPA/WPA2-PSK mengirim BeaconType WPAand11i', () => {
  const node = {
    SSID: v('Rumah'), Enable: v(true), BeaconType: v('11i'), BasicEncryptionModes: v('None'),
    PreSharedKey: { 1: { PreSharedKey: v('sandi1234') } },
  };
  const plan = planWlanUpdate({
    wlanId: '1', wlanNode: node, ssid: 'Rumah', password: '', status: true, security: 'WPA/WPA2-PSK',
  });
  assert.deepEqual(plan.parameterValues, [[`${BASE}.BeaconType`, 'WPAand11i', 'xsd:string']]);
  assert.deepEqual(plan.changed, ['security']);
});

test('planWlanUpdate: Open System mengirim BeaconType None dan tidak mengirim password', () => {
  const node = {
    SSID: v('Rumah'), Enable: v(true), BeaconType: v('WPAand11i'), BasicEncryptionModes: v('None'),
    PreSharedKey: { 1: { PreSharedKey: v('sandi1234') } },
  };
  const plan = planWlanUpdate({
    wlanId: '1', wlanNode: node, ssid: 'Rumah', password: 'lain12345', status: true, security: 'Open System',
  });
  assert.deepEqual(plan, {
    parameterValues: [[`${BASE}.BeaconType`, 'None', 'xsd:string']],
    changed: ['security'],
  });
  const none = planWlanUpdate({
    wlanId: '1', wlanNode: node, ssid: 'Rumah', password: 'lain12345', status: true, security: 'None',
  });
  assert.deepEqual(none.parameterValues, [[`${BASE}.BeaconType`, 'None', 'xsd:string']]);
});

test('planWlanUpdate: WPA2-PSK memakai BeaconType 11i; BasicEncryptionModes ikut bila nilainya berubah', () => {
  const node = {
    SSID: v('Rumah'), Enable: v(true), BeaconType: v('Basic'), BasicEncryptionModes: v('WEPEncryption'),
  };
  const plan = planWlanUpdate({
    wlanId: '1', wlanNode: node, ssid: 'Rumah', password: 'sandi1234', status: true, security: 'WPA2-PSK',
  });
  assert.deepEqual(plan.parameterValues, [
    [`${BASE}.PreSharedKey.1.PreSharedKey`, 'sandi1234', 'xsd:string'],
    [`${BASE}.BeaconType`, '11i', 'xsd:string'],
    [`${BASE}.BasicEncryptionModes`, 'None', 'xsd:string'],
  ]);
  assert.deepEqual(plan.changed, ['password', 'security']);
});

test('planWlanUpdate: label keamanan yang sama tidak mengirim BeaconType', () => {
  const node = { SSID: v('Rumah'), Enable: v(true), BeaconType: v('11i'), BasicEncryptionModes: v('None') };
  assert.deepEqual(
    planWlanUpdate({ wlanId: '1', wlanNode: node, ssid: 'Rumah', password: '', status: true, security: 'WPA2-PSK' }),
    { parameterValues: [], changed: [] },
  );
  const openNode = { SSID: v('Rumah'), Enable: v(true), BeaconType: v('Basic'), BasicEncryptionModes: v('None') };
  assert.deepEqual(
    planWlanUpdate({ wlanId: '1', wlanNode: openNode, ssid: 'Rumah', password: '', status: true, security: 'Open System' }).changed,
    [],
  );
});

test('planWlanUpdate: dari jaringan terbuka ke WPA tanpa password ditolak', () => {
  const node = { SSID: v('Rumah'), Enable: v(true), BeaconType: v('None') };
  const plan = planWlanUpdate({
    wlanId: '1', wlanNode: node, ssid: 'Rumah', password: '', status: true, security: 'WPA-PSK',
  });
  assert.equal(plan.error, 'Password wajib diisi untuk mode keamanan ini');
  assert.deepEqual(plan.parameterValues, []);
});

test('planWlanUpdate: mode tidak dikenal yang berbeda dari ONU ditolak', () => {
  const node = { SSID: v('Rumah'), Enable: v(true), BeaconType: v('11i') };
  const plan = planWlanUpdate({
    wlanId: '1', wlanNode: node, ssid: 'Rumah', password: '', status: true, security: 'WEPEncryption',
  });
  assert.equal(plan.error, 'Mode keamanan tidak didukung');
});

test('planWlanUpdate: Fiberhome 11i mengirim Password(WPA) dan Password(WPA2)', () => {
  const node = {
    SSID: v('Rumah'), Enable: v(true), BeaconType: v('11i'),
    PreSharedKey: { 1: { PreSharedKey: v('lama12345') } },
  };
  const plan = planWlanUpdate({
    wlanId: '1',
    wlanNode: node,
    ssid: 'Rumah',
    password: 'baru12345',
    status: true,
    security: 'WPA2-PSK',
    manufacturer: 'FiberHome',
  });
  assert.deepEqual(plan.vendorPasswordValues, [
    [`${BASE}.Password(WPA)`, 'baru12345', 'xsd:string'],
    [`${BASE}.Password(WPA2)`, 'baru12345', 'xsd:string'],
  ]);
  const mixed = planWlanUpdate({
    wlanId: '1',
    wlanNode: node,
    ssid: 'Rumah',
    password: 'baru12345',
    status: true,
    security: 'WPAand11i',
    manufacturer: 'HG6145D2 Fiberhome',
  });
  assert.equal(mixed.vendorPasswordValues[0][0], `${BASE}.Password(WPA)`);
  assert.equal(mixed.vendorPasswordValues[1][0], `${BASE}.Password(WPA2)`);
  const other = planWlanUpdate({
    wlanId: '1', wlanNode: node, ssid: 'Rumah', password: 'baru12345', status: true, manufacturer: 'ZTE',
  });
  assert.equal(other.vendorPasswordValues, undefined);
});

test('passwordPathFor: memilih path sandi yang ada di ONU', () => {
  assert.equal(passwordPathFor('1', { PreSharedKey: { 1: { PreSharedKey: v('x') } } }), `${BASE}.PreSharedKey.1.PreSharedKey`);
  assert.equal(passwordPathFor('1', { PreSharedKey: { 1: { PreSharedKey: v('x'), KeyPassphrase: v('y') } } }), `${BASE}.PreSharedKey.1.PreSharedKey`);
  assert.equal(passwordPathFor('1', { PreSharedKey: { 1: { KeyPassphrase: v('y') } } }), `${BASE}.PreSharedKey.1.KeyPassphrase`);
  assert.equal(passwordPathFor('1', { KeyPassphrase: v('y') }), `${BASE}.KeyPassphrase`);
  assert.equal(passwordPathFor('1', {}), `${BASE}.PreSharedKey.1.PreSharedKey`);
});
