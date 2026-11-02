const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeWanStatus, resolveWanStatus, detectLegacyWanFirmware } = require('../backend/acs_wan_status');
const { extractWans, wanFirmwareProfile, wanStatusRefreshTargets } = require('../backend/acs_summary');

const leaf = (value) => ({ _value: value });
const node = (fields) => Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, leaf(value)]));

test('normalizeWanStatus menyeragamkan huruf besar/kecil dan sinonim', () => {
  for (const raw of ['connected', 'Connected', 'CONNECTED', 'Up', 'up', ' UP ', 'Connected(1)', 'Established', 'Online']) {
    assert.equal(normalizeWanStatus(raw), 'Connected', raw);
  }
  for (const raw of ['disconnected', 'Down', 'DOWN', 'Not Connected', 'Link_Down']) {
    assert.equal(normalizeWanStatus(raw), 'Disconnected', raw);
  }
  assert.equal(normalizeWanStatus('connecting'), 'Connecting');
  assert.equal(normalizeWanStatus('Unconfigured'), 'Unconfigured');
  assert.equal(normalizeWanStatus('PendingDisconnect'), 'PendingDisconnect');
  assert.equal(normalizeWanStatus('LowerLayerDown'), 'LowerLayerDown');
  assert.equal(normalizeWanStatus('Disabled'), 'Disabled');
  assert.equal(normalizeWanStatus('StatusAneh'), 'StatusAneh');
  for (const empty of ['', '  ', '-', null, undefined, {}]) {
    assert.equal(normalizeWanStatus(empty), '');
  }
});

test('resolveWanStatus: ConnectionStatus standar tetap diprioritaskan', () => {
  assert.deepEqual(resolveWanStatus(node({ ConnectionStatus: 'connected', Status: 'Down' })), { status: 'Connected', source: 'ConnectionStatus' });
});

test('resolveWanStatus: fallback ke leaf alternatif Status / X_CT-COM / X_CMCC / X_HW', () => {
  assert.deepEqual(resolveWanStatus(node({ ConnectionStatus: '', Status: 'Up' })), { status: 'Connected', source: 'Status' });
  assert.deepEqual(resolveWanStatus(node({ 'X_CT-COM_ConnectionStatus': 'UP' })), { status: 'Connected', source: 'X_CT-COM_ConnectionStatus' });
  assert.deepEqual(resolveWanStatus(node({ X_CMCC_ConnectionStatus: 'disconnected' })), { status: 'Disconnected', source: 'X_CMCC_ConnectionStatus' });
  assert.deepEqual(resolveWanStatus(node({ X_HW_ConnectionStatus: 'Connected' })), { status: 'Connected', source: 'X_HW_ConnectionStatus' });
});

test('resolveWanStatus: pola nama dinamis dan kunci beda huruf', () => {
  assert.equal(resolveWanStatus(node({ X_ABC_PPPConnectionStatus: 'Up' })).status, 'Connected');
  assert.equal(resolveWanStatus(node({ connectionstatus: 'Up' })).status, 'Connected');
});

test('resolveWanStatus: status IPv6 hanya dipakai bila Connected', () => {
  assert.equal(resolveWanStatus(node({ 'X_ZTE-COM_IPv6ConnStatus': 'Unconfigured' })).status, '');
  assert.deepEqual(resolveWanStatus(node({ 'X_CT-COM_IPv6ConnectionStatus': 'Connected' })), { status: 'Connected', source: 'X_CT-COM_IPv6ConnectionStatus' });
});

test('resolveWanStatus: turunan dari Enable + ExternalIPAddress bila semua status kosong', () => {
  assert.deepEqual(resolveWanStatus(node({ Enable: true, ExternalIPAddress: '10.1.2.3' })), { status: 'Connected', source: 'inferred:ExternalIPAddress' });
  assert.deepEqual(resolveWanStatus(node({ Enable: false })), { status: 'Disabled', source: 'inferred:Enable' });
  assert.deepEqual(resolveWanStatus(node({ Enable: true, ExternalIPAddress: '0.0.0.0' })), { status: '', source: '' });
  assert.deepEqual(resolveWanStatus({}), { status: '', source: '' });
});

test('detectLegacyWanFirmware: China Mobile/Telecom dan Huawei lama, bukan Huawei baru/ZTE', () => {
  assert.equal(detectLegacyWanFirmware({ manufacturer: 'ZTE', leafNames: ['X_CT-COM_WANGPONLinkConfig'] }), 'china-carrier');
  assert.equal(detectLegacyWanFirmware({ manufacturer: 'China Mobile', modelName: 'X' }), 'china-carrier');
  assert.equal(detectLegacyWanFirmware({ manufacturer: 'FiberHome', leafNames: ['X_CMCC_ServiceList'] }), 'china-carrier');
  assert.equal(detectLegacyWanFirmware({ manufacturer: 'Huawei Technologies Co., Ltd', modelName: 'HG8145V5' }), 'huawei-legacy');
  assert.equal(detectLegacyWanFirmware({ manufacturer: 'Huawei Technologies Co., Ltd', modelName: 'EG8145V5' }), 'huawei-legacy');
  assert.equal(detectLegacyWanFirmware({ manufacturer: 'Huawei Technologies Co., Ltd', modelName: 'HG8245H' }), 'huawei-legacy');
  assert.equal(detectLegacyWanFirmware({ manufacturer: 'Huawei Technologies Co., Ltd', modelName: 'HG8145X6' }), '');
  assert.equal(detectLegacyWanFirmware({ manufacturer: 'ZTE', modelName: 'F609' }), '');
  assert.equal(detectLegacyWanFirmware({ manufacturer: 'FiberHome', modelName: 'HG6243C' }), '');
});

function igdItem({ manufacturer, modelName, ppp }) {
  return {
    InternetGatewayDevice: {
      DeviceInfo: { Manufacturer: leaf(manufacturer), ModelName: leaf(modelName) },
      WANDevice: { 1: { WANConnectionDevice: { 1: { WANPPPConnection: { 1: ppp } } } } },
    },
  };
}

test('extractWans memakai fallback & normalisasi; wanStatusRefreshTargets menunjuk node berstatus kosong', () => {
  const legacy = igdItem({
    manufacturer: 'Huawei Technologies Co., Ltd',
    modelName: 'HG8145V5',
    ppp: node({ Name: 'pppoe', Enable: true, ExternalIPAddress: '0.0.0.0' }),
  });
  const wans = extractWans(legacy);
  assert.equal(wans[0].status, '-');
  assert.deepEqual(wanStatusRefreshTargets(wans), ['InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1']);
  assert.equal(wanFirmwareProfile(legacy).kind, 'huawei-legacy');

  const cmcc = igdItem({ manufacturer: 'ZTE', modelName: 'F6xx', ppp: node({ Name: 'p', 'X_CT-COM_ConnectionStatus': 'up' }) });
  const [wan] = extractWans(cmcc);
  assert.equal(wan.status, 'Connected');
  assert.equal(wan.statusSource, 'X_CT-COM_ConnectionStatus');
  assert.deepEqual(wanStatusRefreshTargets([wan]), []);
});

test('heuristik OTHER: status kosong / Unconfigured + ServiceList OTHER + Enable + IP valid -> Connected', () => {
  const base = { Enable: true, ExternalIPAddress: '192.168.50.2' };
  for (const [vendorLeaf, list] of [
    ['X_CT-COM_ServiceList', 'OTHER'],
    ['X_HW_SERVICELIST', 'OTHER'],
    ['X_ZTE-COM_ServiceList', 'OTHER'],
    ['X_CMCC_ServiceList', 'IPTV,OTHER'],
    ['X_FH_ServiceList', 'other'],
  ]) {
    for (const status of [undefined, '', 'Unconfigured', 'unconfigured']) {
      const fields = { ...base, [vendorLeaf]: list, ...(status === undefined ? {} : { ConnectionStatus: status }) };
      assert.deepEqual(resolveWanStatus(node(fields)), { status: 'Connected', source: 'inferred:OTHER' }, `${vendorLeaf}/${status}`);
    }
  }
  assert.equal(resolveWanStatus(node({ ...base, Enable: 1, 'X_CT-COM_ServiceList': 'OTHER', ConnectionStatus: 'Unconfigured' })).status, 'Connected');
});

test('heuristik OTHER tidak berlaku bila syarat tidak lengkap', () => {
  const other = { 'X_CT-COM_ServiceList': 'OTHER', ConnectionStatus: 'Unconfigured' };
  assert.equal(resolveWanStatus(node({ ...other, Enable: false, ExternalIPAddress: '10.0.0.2' })).status, 'Unconfigured');
  assert.equal(resolveWanStatus(node({ ...other, Enable: true, ExternalIPAddress: '0.0.0.0' })).status, 'Unconfigured');
  assert.equal(resolveWanStatus(node({ ...other, Enable: true, ExternalIPAddress: '' })).status, 'Unconfigured');
  assert.equal(resolveWanStatus(node({ ...other, Enable: true, ExternalIPAddress: 'bukan-ip' })).status, 'Unconfigured');
  // ServiceList bukan OTHER: Unconfigured dari ONU dihormati.
  assert.equal(resolveWanStatus(node({ 'X_CT-COM_ServiceList': 'INTERNET', ConnectionStatus: 'Unconfigured', Enable: true, ExternalIPAddress: '10.0.0.2' })).status, 'Unconfigured');
});

test('status nyata dari ONU selalu menang atas heuristik OTHER', () => {
  const fields = { Enable: true, ExternalIPAddress: '10.0.0.2', 'X_CT-COM_ServiceList': 'OTHER' };
  assert.deepEqual(resolveWanStatus(node({ ...fields, ConnectionStatus: 'Disconnected' })), { status: 'Disconnected', source: 'ConnectionStatus' });
  assert.deepEqual(resolveWanStatus(node({ ...fields, ConnectionStatus: 'UP' })), { status: 'Connected', source: 'ConnectionStatus' });
  assert.deepEqual(resolveWanStatus(node({ ...fields, ConnectionStatus: 'Unconfigured', 'X_HW_ConnectionStatus': 'Up' })), { status: 'Connected', source: 'X_HW_ConnectionStatus' });
});

test('extractWans WAN IP OTHER: status terbaca Connected di respons', () => {
  const item = {
    InternetGatewayDevice: {
      WANDevice: { 1: { WANConnectionDevice: { 1: { WANIPConnection: { 3: node({
        Name: 'iptv', Enable: true, ConnectionStatus: 'Unconfigured', ExternalIPAddress: '172.16.0.9', 'X_CT-COM_ServiceList': 'OTHER',
      }) } } } } },
    },
  };
  const [wan] = extractWans(item);
  assert.equal(wan.type, 'IP');
  assert.equal(wan.status, 'Connected');
  assert.equal(wan.statusSource, 'inferred:OTHER');
});
