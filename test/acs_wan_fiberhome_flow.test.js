const test = require('node:test');
const assert = require('node:assert/strict');
const {
  prefersAtomicWan,
  atomicIncludesName,
  compareWanReadback,
  splitWanParameters,
  batchWanParameters,
  parseWanPpp,
  planWanPpp,
} = require('../backend/acs_wan');

const CONN = 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.';
const PPP = `${CONN}WANPPPConnection.1.`;

function fhPlan(extra = {}) {
  const parsed = parseWanPpp({
    deviceId: 'ONT-1', deviceType: 'Fiberhome', connectionName: '', enableConnection: true, natStatus: true,
    vlanStatus: true, vlanId: 2033, priority: 0, serviceList: 'INTERNET', connectionType: 'pppoe_routed',
    username: 'budi@net', password: 'rahasia', ports: ['LAN1', 'SSID1'], ...extra,
  });
  assert.equal(parsed.error, undefined);
  return planWanPpp({
    values: parsed.value, manufacturer: 'FiberHome', pppPath: PPP, connectionPath: CONN, accessType: 'GPON',
    knownLeaves: ['WANPPPConnection'], dataModel: 'InternetGatewayDevice',
  });
}

const leafNames = (rows) => rows.map((row) => row[0].split('.').pop());

test('Fiberhome memakai mode atomik, Name tidak ikut RPC atomik', () => {
  assert.equal(prefersAtomicWan('fiberhome'), true);
  assert.equal(prefersAtomicWan('FiberHome'), true);
  assert.equal(prefersAtomicWan('huawei'), false);
  assert.equal(atomicIncludesName('zte'), true);
  assert.equal(atomicIncludesName('fiberhome'), false);
});

test('Fiberhome atomik: ConnectionType + ServiceList + VLAN + port binding dalam satu RPC, Enable terakhir', () => {
  const plan = fhPlan();
  const { core, risky } = splitWanParameters(batchWanParameters(plan), { atomic: true });
  assert.equal(risky.length, 0);
  const names = leafNames(core);
  for (const leaf of ['ConnectionType', 'X_FH_ServiceList', 'Username', 'Password', 'NATEnabled',
    'VLANEnable', 'VLANID', 'X_FH_802-1pMark', 'X_FH_LanInterface']) {
    assert.ok(names.includes(leaf), `${leaf} harus ada di RPC atomik`);
  }
  assert.equal(names.at(-1), 'Enable');
  // Mode lama (terpisah) memang memecah ConnectionType/ServiceList: itulah yang dihindari.
  assert.equal(splitWanParameters(batchWanParameters(plan)).risky.length, 2);
});

const readbackDoc = (leaves) => {
  const node = {};
  for (const [name, value] of Object.entries(leaves)) {
    node[name] = { _value: value };
  }
  return { InternetGatewayDevice: { WANDevice: { 1: { WANConnectionDevice: { 2: { WANPPPConnection: { 1: node } } } } } } };
};

test('compareWanReadback: sama = ok, Password dilewati, beda dan hilang dilaporkan', () => {
  const rows = batchWanParameters(fhPlan());
  const same = readbackDoc({
    Enable: true, ConnectionType: 'IP_Routed', Username: 'budi@net', NATEnabled: true, VLANEnable: true,
    VLANID: 2033, 'X_FH_802-1pMark': 0, X_FH_ServiceList: 'INTERNET',
    X_FH_LanInterface: 'InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.1,InternetGatewayDevice.LANDevice.1.WLANConfiguration.1',
  });
  const ok = compareWanReadback(same, rows);
  assert.deepEqual(ok.mismatched, []);
  assert.deepEqual(ok.missing, []);

  const bad = readbackDoc({ Enable: false, ConnectionType: 'Unconfigured', VLANID: '2033', Username: 'budi@net' });
  const result = compareWanReadback(bad, rows);
  assert.deepEqual(result.mismatched.map((item) => item.name).sort(), ['ConnectionType', 'Enable']);
  assert.ok(result.missing.includes('X_FH_LanInterface'));
  assert.equal(result.mismatched.some((item) => item.name === 'Password'), false);
});

// verifyOnOnu: GenieACS di-stub, tidak ada koneksi jaringan.
const acs = require('../backend/acs');
const { verifyOnOnu } = require('../backend/acs_wan_flow');

async function withStub({ refresh, doc }, run) {
  const saved = { r: acs.refreshDeviceObjects, s: acs.readWanSubtree };
  acs.refreshDeviceObjects = async () => refresh;
  acs.readWanSubtree = async () => (typeof doc === 'function' ? doc() : doc);
  try {
    return await run();
  } finally {
    acs.refreshDeviceObjects = saved.r;
    acs.readWanSubtree = saved.s;
  }
}

const REFRESHED = { refreshed: [PPP], failed: [], pending: [] };

test('verifyOnOnu: ok bila ONU melaporkan nilai yang sama, mismatch bila Enable tidak aktif', async () => {
  const rows = [[`${PPP}Enable`, true, 'xsd:boolean'], [`${PPP}ConnectionType`, 'IP_Routed', 'xsd:string']];
  const ok = await withStub({ refresh: REFRESHED, doc: readbackDoc({ Enable: true, ConnectionType: 'IP_Routed' }) },
    () => verifyOnOnu({}, 'ONT-1', PPP, CONN, rows));
  assert.equal(ok.state, 'ok');
  const off = await withStub({ refresh: REFRESHED, doc: readbackDoc({ Enable: false, ConnectionType: 'IP_Routed' }) },
    () => verifyOnOnu({}, 'ONT-1', PPP, CONN, rows));
  assert.equal(off.state, 'mismatch');
  assert.deepEqual(off.mismatched.map((item) => item.name), ['Enable']);
});

test('verifyOnOnu: refresh gagal = unknown (tidak dianggap hilang)', async () => {
  const rows = [[`${PPP}Enable`, true, 'xsd:boolean']];
  const result = await withStub({ refresh: { refreshed: [], failed: [{ name: PPP, reason: 'timeout' }], pending: [] }, doc: {} },
    () => verifyOnOnu({}, 'ONT-1', PPP, CONN, rows));
  assert.equal(result.state, 'unknown');
});

test('verifyOnOnu: data baru muncul pada pembacaan ke-2 tidak dianggap hilang; tak pernah muncul = absent', async () => {
  const rows = [[`${PPP}Enable`, true, 'xsd:boolean'], [`${PPP}ConnectionType`, 'IP_Routed', 'xsd:string']];
  let calls = 0;
  const late = await withStub({
    refresh: REFRESHED,
    doc: () => { calls += 1; return calls < 2 ? {} : readbackDoc({ Enable: true, ConnectionType: 'IP_Routed' }); },
  }, () => verifyOnOnu({}, 'ONT-1', PPP, CONN, rows));
  assert.equal(late.state, 'ok');
  assert.equal(calls, 2);
  const absent = await withStub({ refresh: REFRESHED, doc: {} }, () => verifyOnOnu({}, 'ONT-1', PPP, CONN, rows));
  assert.equal(absent.state, 'absent');
});
