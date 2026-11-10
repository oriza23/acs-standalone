const test = require('node:test');
const assert = require('node:assert/strict');
const { parseZteWanRequest, zteBindingString, normalizePortLabels } = require('../backend/acs_zte_wan');
const { parseWanPpp, planWanPpp, batchWanParameters, splitWanParameters } = require('../backend/acs_wan');
const acs = require('../backend/acs');
const { addWanPpp, WanFlowError } = require('../backend/acs_wan_flow');

const CONN = 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.3.';
const PPP = `${CONN}WANPPPConnection.1.`;
const IGD = 'InternetGatewayDevice.LANDevice.1';
const ZTE_LEAVES = [
  'WANPPPConnection.Username', 'WANPPPConnection.ConnectionType', 'WANPPPConnection.X_ZTE-COM_ServiceList',
  'WANPPPConnection.X_ZTE-COM_VLANEnable', 'WANPPPConnection.X_ZTE-COM_VLANID', 'WANPPPConnection.X_ZTE-COM_8021P',
  'WANPPPConnection.X_ZTE-COM_LanInterface',
];

const pppoeInput = (extra = {}) => ({
  server_id: 1, deviceId: 'ONT-ZTE', type: 'pppoe', name: 'PPPoE', username: 'budi@net', password: 'rahasia',
  vlanId: 2033, priority: 0, ports: ['LAN1', 'SSID1'], ...extra,
});

function planFor(input) {
  const adapted = parseZteWanRequest(input);
  assert.equal(adapted.error, undefined, adapted.error);
  const parsed = parseWanPpp(adapted.body);
  assert.equal(parsed.error, undefined, parsed.error);
  const plan = planWanPpp({
    values: parsed.value, manufacturer: 'ZTE', pppPath: PPP, connectionPath: CONN, accessType: 'GPON',
    knownLeaves: ZTE_LEAVES, dataModel: 'InternetGatewayDevice',
  });
  // Sama seperti fireAttempt (mode atomik ZTE): baris Name digabung ke satu RPC, Enable paling akhir.
  const atomic = splitWanParameters([...batchWanParameters(plan), ...plan.connectionName], { atomic: true });
  assert.equal(atomic.risky.length, 0);
  return { adapted, plan, rows: atomic.core };
}

const byLeaf = (rows) => Object.fromEntries(rows.map(([path, value]) => [path.replace(PPP, ''), value]));

test('label port -> string binding ZTE (daftar path TR-098 dipisah koma)', () => {
  assert.equal(
    zteBindingString(['LAN1', 'SSID1']),
    `${IGD}.LANEthernetInterfaceConfig.1,${IGD}.WLANConfiguration.1`,
  );
  assert.deepEqual(normalizePortLabels('lan1, ssid2;LAN1').labels, ['LAN1', 'SSID2']);
  assert.match(normalizePortLabels(['LAN9']).error, /Port binding tidak valid/);
  assert.match(normalizePortLabels([5]).error, /Port binding tidak valid/);
  assert.match(normalizePortLabels({}).error, /array/);
});

test('PPPoE: IP_Routed, kredensial, ServiceList INTERNET, VLAN ZTE, binding, Enable terakhir', () => {
  const { rows } = planFor(pppoeInput());
  const leaf = byLeaf(rows);
  assert.equal(leaf.ConnectionType, 'IP_Routed');
  assert.equal(leaf.Username, 'budi@net');
  assert.equal(leaf.Password, 'rahasia');
  assert.equal(leaf.Name, 'PPPoE');
  assert.equal(leaf.NATEnabled, true);
  assert.equal(leaf['X_ZTE-COM_ServiceList'], 'INTERNET');
  assert.equal(leaf['X_ZTE-COM_VLANEnable'], 1);
  assert.equal(leaf['X_ZTE-COM_VLANID'], 2033);
  assert.equal(leaf['X_ZTE-COM_8021P'], 0);
  assert.equal(leaf['X_ZTE-COM_LanInterface'], `${IGD}.LANEthernetInterfaceConfig.1,${IGD}.WLANConfiguration.1`);
  assert.equal(rows.at(-1)[0].split('.').pop(), 'Enable');
  assert.equal(leaf.Enable, true);
});

test('Bridge: PPPoE_Bridged di WANPPPConnection, tanpa Username/Password, NAT dipaksa false', () => {
  const { rows } = planFor({ ...pppoeInput(), type: 'bridge', name: 'bridge', nat: true });
  const leaf = byLeaf(rows);
  assert.equal(leaf.ConnectionType, 'PPPoE_Bridged');
  assert.equal(leaf.NATEnabled, false);
  assert.equal('Username' in leaf, false);
  assert.equal('Password' in leaf, false);
  assert.equal(leaf['X_ZTE-COM_VLANID'], 2033);
});

test('tanpa vlanId = tanpa parameter VLAN; tanpa ports = tanpa binding', () => {
  const { rows } = planFor(pppoeInput({ vlanId: undefined, ports: undefined }));
  const leaf = byLeaf(rows);
  assert.equal('X_ZTE-COM_VLANID' in leaf, false);
  assert.equal('X_ZTE-COM_VLANEnable' in leaf, false);
  assert.equal('X_ZTE-COM_LanInterface' in leaf, false);
});

test('validasi adapter: type, boolean, port, dan validasi lanjutan parseWanPpp', () => {
  assert.match(parseZteWanRequest({ ...pppoeInput(), type: 'ip' }).error, /type/);
  assert.match(parseZteWanRequest(pppoeInput({ enable: 'ya' })).error, /enable/);
  assert.match(parseZteWanRequest(pppoeInput({ nat: 1 })).error, /nat/);
  assert.match(parseZteWanRequest(pppoeInput({ ports: ['LAN7'] })).error, /Port binding/);
  assert.match(parseZteWanRequest(null).error, /type/);
  const noPass = parseWanPpp(parseZteWanRequest(pppoeInput({ password: undefined })).body);
  assert.match(noPass.error, /Password/);
  const badVlan = parseWanPpp(parseZteWanRequest(pppoeInput({ vlanId: 5000 })).body);
  assert.match(badVlan.error, /VLAN/);
  const noName = parseWanPpp(parseZteWanRequest(pppoeInput({ name: '' })).body);
  assert.match(noName.error, /Connection Name/);
});

test('penjaga merek: ONU non-ZTE ditolak 409 sebelum AddObject apa pun', async () => {
  const saved = { read: acs.readWanTarget, purge: acs.purgeStaleWanTasks, create: acs.createWanPppInstance };
  let created = false;
  acs.readWanTarget = async () => ({ manufacturer: 'FiberHome', model: 'InternetGatewayDevice', wanDeviceIndex: '1', connectionIndex: null });
  acs.purgeStaleWanTasks = async () => 0;
  acs.createWanPppInstance = async () => { created = true; return {}; };
  try {
    const adapted = parseZteWanRequest(pppoeInput());
    const parsed = parseWanPpp(adapted.body);
    await assert.rejects(
      addWanPpp({ server: { host: 'x', port: 7557 }, values: parsed.value, username: 'tes', expectProfile: 'zte' }),
      (error) => error instanceof WanFlowError && error.status === 409 && /bukan ZTE/.test(error.message),
    );
    assert.equal(created, false);
  } finally {
    acs.readWanTarget = saved.read;
    acs.purgeStaleWanTasks = saved.purge;
    acs.createWanPppInstance = saved.create;
  }
});

test('Service Control ZTE tidak lagi disisipkan ke batch WAN PPP (diterapkan lewat ACL terpisah)', () => {
  const off = byLeaf(planFor(pppoeInput()).rows);
  assert.equal(Object.hasOwn(off, 'X_ZTE-COM_ServiceControl'), false);
  const on = byLeaf(planFor(pppoeInput({ enableServiceControl: true })).rows);
  assert.equal(Object.hasOwn(on, 'X_ZTE-COM_ServiceControl'), false);
  assert.match(parseZteWanRequest(pppoeInput({ enableServiceControl: 'ya' })).error, /enableServiceControl/);
});

test('Service Control lewat /wan-ppp: diabaikan untuk non-ZTE', () => {
  const base = {
    deviceId: 'ONT', connectionName: 'X', enableConnection: true, natStatus: true, vlanStatus: false,
    connectionType: 'ip-routed', serviceList: 'INTERNET', ports: [], username: 'u', password: 'p', enableServiceControl: true,
  };
  const zte = parseWanPpp({ ...base, deviceType: 'ZTE' });
  assert.equal(zte.value.enableServiceControl, true);
  assert.equal(zte.value.writeServiceControl, true);
  const huawei = parseWanPpp({ ...base, deviceType: 'Huawei' });
  assert.equal(huawei.value.enableServiceControl, false);
  assert.equal(huawei.value.writeServiceControl, false);
  assert.match(parseWanPpp({ ...base, deviceType: 'ZTE', enableServiceControl: 1 }).error, /enableServiceControl/);
});

test('Service Control ZTE edit: writeServiceControl bila routed; bridge tidak menulis', () => {
  const editBase = {
    deviceId: 'ONT', connectionName: 'PPPoE', enableConnection: true, natStatus: true, vlanStatus: false,
    connectionType: 'ip-routed', serviceList: 'INTERNET', ports: [], username: 'u', password: 'p',
    deviceType: 'ZTE', wanPath: PPP,
  };
  const off = parseWanPpp({ ...editBase, enableServiceControl: false });
  assert.equal(off.value.writeServiceControl, true);
  assert.equal(off.value.enableServiceControl, false);

  const bridge = parseWanPpp({
    ...editBase, connectionType: 'pppoe_bridged', enableServiceControl: true, username: '', password: '',
  });
  assert.equal(bridge.value.writeServiceControl, false);
});
