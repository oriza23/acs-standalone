const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const acs = require('../backend/acs');
const { selectWanLocation } = require('../backend/acs_wan');

const ROOT = 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice';
const ppp = { WANPPPConnection: { 1: { Enable: { _value: true } } } };
const ipc = { WANIPConnection: { 1: { Enable: { _value: true } } } };

function wanDevices(wcd) {
  return { 1: { WANCommonInterfaceConfig: { WANAccessType: { _value: 'EPON' } }, WANConnectionDevice: wcd } };
}

test('Fiberhome: WCD kosong terendah dipakai ulang, tidak membuat WCD baru', () => {
  // Pola nyata ONU uji: WCD1 = IP TR069, sisanya cangkang kosong sisa WAN yang dihapus, WCD8 = PPP.
  const location = selectWanLocation(wanDevices({ 1: ipc, 2: {}, 3: {}, 4: ppp, 5: {} }), 'fiberhome');
  assert.equal(location.connectionIndex, '2');
  assert.equal(location.reusedEmpty, true);
  assert.equal(location.createConnectionDevice, false);
});

test('Fiberhome tanpa WCD kosong tetap membuat WCD baru; WCD berisi tidak pernah dicampur', () => {
  const location = selectWanLocation(wanDevices({ 1: ipc, 2: ppp }), 'fiberhome');
  assert.equal(location.connectionIndex, null);
  assert.equal(location.reusedEmpty, false);
  assert.equal(location.createConnectionDevice, true);
});

test('merek lain tidak memakai WCD kosong (perilaku ZTE/CT-COM tidak berubah)', () => {
  const ctcom = selectWanLocation(wanDevices({ 1: ipc, 2: {} }), 'ctcom');
  assert.equal(ctcom.reusedEmpty, false);
  assert.equal(ctcom.createConnectionDevice, true);
});

// NBI palsu: addObject dijawab oleh respond(objectName) -> { status, body }.
async function startNbi(respond) {
  const adds = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data ?? {})); };
      const body = raw ? JSON.parse(raw) : null;
      if (req.method === 'POST' && body?.name === 'addObject') {
        adds.push(body.objectName);
        const reply = respond(body.objectName);
        return send(reply.status || 200, reply.body);
      }
      if (req.method === 'GET' && req.url.startsWith('/devices/')) {
        return send(200, [{}]);
      }
      return send(200, req.method === 'GET' ? [] : {});
    });
  });
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  return {
    adds,
    acsServer: { host: '127.0.0.1', port: server.address().port },
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); }),
  };
}

const options = (extra = {}) => ({ profile: 'fiberhome', wanDeviceIndex: '1', ...extra });

test('wadah kosong dipakai ulang: hanya AddObject WANPPPConnection, rollback hanya instance PPP', async () => {
  const nbi = await startNbi(() => ({ body: { _id: 'a', instanceNumber: '1' } }));
  try {
    const created = await acs.createWanPppInstance(nbi.acsServer, 'DEV1', options({ connectionIndex: '2', createConnectionDevice: false, reusedEmpty: true }));
    assert.deepEqual(nbi.adds, [`${ROOT}.2.WANPPPConnection`]);
    assert.equal(created.pppPath, `${ROOT}.2.WANPPPConnection.1.`);
    assert.equal(created.rollbackPath, created.pppPath);
  } finally {
    await nbi.close();
  }
});

test('WAN IP juga memakai wadah kosong yang sama', async () => {
  const nbi = await startNbi(() => ({ body: { _id: 'a', instanceNumber: '1' } }));
  try {
    const created = await acs.createWanIpInstance(nbi.acsServer, 'DEV1', options({ connectionIndex: '3', createConnectionDevice: false, reusedEmpty: true }));
    assert.deepEqual(nbi.adds, [`${ROOT}.3.WANIPConnection`]);
    assert.equal(created.ipPath, `${ROOT}.3.WANIPConnection.1.`);
    assert.equal(created.rollbackPath, created.ipPath);
  } finally {
    await nbi.close();
  }
});

test('wadah kosong basi (ditolak ONU): membuat satu WCD baru lalu mengulang; rollback = WCD baru', async () => {
  const nbi = await startNbi((objectName) => {
    if (objectName === `${ROOT}.2.WANPPPConnection`) {
      return { body: { _id: 'bad', fault: { code: '9005', message: 'Invalid parameter name' } } };
    }
    if (objectName === ROOT) {
      return { body: { _id: 'wcd', instanceNumber: '9' } };
    }
    return { body: { _id: 'ppp', instanceNumber: '1' } };
  });
  try {
    const created = await acs.createWanPppInstance(nbi.acsServer, 'DEV1', options({ connectionIndex: '2', createConnectionDevice: false, reusedEmpty: true }));
    assert.deepEqual(nbi.adds, [`${ROOT}.2.WANPPPConnection`, ROOT, `${ROOT}.9.WANPPPConnection`]);
    assert.equal(created.pppPath, `${ROOT}.9.WANPPPConnection.1.`);
    assert.equal(created.rollbackPath, `${ROOT}.9.`);
  } finally {
    await nbi.close();
  }
});

test('penolakan pada wadah yang BUKAN hasil pakai-ulang tidak memicu pembuatan WCD', async () => {
  const nbi = await startNbi(() => ({ body: { _id: 'bad', fault: { code: '9003', message: 'Invalid arguments' } } }));
  try {
    await assert.rejects(
      acs.createWanPppInstance(nbi.acsServer, 'DEV1', options({ connectionIndex: '1', createConnectionDevice: false })),
      /9003/,
    );
    assert.deepEqual(nbi.adds, [`${ROOT}.1.WANPPPConnection`]);
  } finally {
    await nbi.close();
  }
});

test('9004 saat membuat WCD dijelaskan: slot penuh dan tidak ada wadah kosong', async () => {
  const nbi = await startNbi(() => ({ body: { _id: 'full', fault: { code: '9004', message: 'Resources exceeded' } } }));
  try {
    await assert.rejects(
      acs.createWanPppInstance(nbi.acsServer, 'DEV1', options({ connectionIndex: null, createConnectionDevice: true })),
      (error) => /Slot WANConnectionDevice ONU sudah penuh/.test(error.message) && /9004/.test(error.message) && error.code === 'FAULT',
    );
    assert.deepEqual(nbi.adds, [ROOT]);
  } finally {
    await nbi.close();
  }
});

test('tanpa wadah dan tanpa kendala: dua langkah AddObject berurutan (WCD lalu PPP)', async () => {
  const nbi = await startNbi((objectName) => ({ body: { _id: 'x', instanceNumber: objectName === ROOT ? '4' : '1' } }));
  try {
    const created = await acs.createWanPppInstance(nbi.acsServer, 'DEV1', options({ connectionIndex: null, createConnectionDevice: true }));
    assert.deepEqual(nbi.adds, [ROOT, `${ROOT}.4.WANPPPConnection`]);
    assert.equal(created.rollbackPath, `${ROOT}.4.`);
  } finally {
    await nbi.close();
  }
});
