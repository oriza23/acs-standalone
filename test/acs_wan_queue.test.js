const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const acs = require('../backend/acs');
const { splitWanParameters, isRiskyParameter } = require('../backend/acs_wan');

const BASE = 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.4.';
const row = (leaf, value, type = 'xsd:string') => [`${BASE}${leaf}`, value, type];

// NBI GenieACS palsu yang stateful: POST tanpa connection_request = antre (202 + _id), POST kosong dengan
// connection_request = Connection Request (menguras antrean lewat drain()), GET /tasks = isi antrean.
async function startFakeNbi({ drain, onRequest } = {}) {
  const requests = [];
  const tasks = new Map();
  let counter = 0;
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const entry = { method: req.method, url: req.url, path: url.pathname, flags: url.searchParams, body: raw ? JSON.parse(raw) : null };
      requests.push(entry);
      const send = (status, data) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data ?? {}));
      };
      const custom = onRequest && onRequest(entry, { tasks, send });
      if (custom === true) {
        return;
      }
      if (req.method === 'POST' && url.pathname.endsWith('/tasks')) {
        if (!entry.body) {
          drain?.(tasks);
          return send(200, {});
        }
        if (url.searchParams.has('connection_request')) {
          return send(200, { _id: 'direct', instanceNumber: entry.body.name === 'addObject' ? '7' : undefined });
        }
        counter += 1;
        const task = { _id: `t${counter}`, ...entry.body, timestamp: new Date().toISOString() };
        tasks.set(task._id, task);
        return send(202, task);
      }
      if (req.method === 'GET' && url.pathname === '/tasks/') {
        const query = JSON.parse(url.searchParams.get('query') || '{}');
        let list = [...tasks.values()];
        if (typeof query._id === 'string') {
          list = list.filter((task) => task._id === query._id);
        } else if (query._id?.$in) {
          list = list.filter((task) => query._id.$in.includes(task._id));
        }
        // GenieACS asli: task yang ditolak ONU tetap di antrean TANPA field fault.
        return send(200, list.map(({ fault, ...task }) => task));
      }
      if (req.method === 'GET' && url.pathname === '/faults/') {
        return send(200, [...tasks.values()].filter((task) => task.fault).map((task) => ({
          _id: `DEV1:task_${task._id}`, device: 'DEV1', channel: `task_${task._id}`, ...task.fault,
        })));
      }
      if (req.method === 'DELETE' && url.pathname.startsWith('/tasks/')) {
        tasks.delete(decodeURIComponent(url.pathname.slice('/tasks/'.length)));
        return send(200, {});
      }
      return send(200, {});
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    requests,
    tasks,
    acsServer: { host: '127.0.0.1', port: server.address().port },
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); }),
  };
}

const taskPosts = (nbi) => nbi.requests.filter((item) => item.method === 'POST' && item.path.endsWith('/tasks'));
const clearAll = (tasks) => tasks.clear();

// ---- perencana ------------------------------------------------------------------------------

test('splitWanParameters memisahkan ConnectionType, ServiceList dan Name menjadi task sendiri', () => {
  const rows = [
    row('Enable', true, 'xsd:boolean'),
    row('Name', 'tes'),
    row('Username', 'u'),
    row('X_ZTE-COM_ServiceList', 'INTERNET'),
    row('ConnectionType', 'IP_Routed'),
    row('X_ZTE-COM_VLANID', 21, 'xsd:unsignedInt'),
    row('X_HW_SERVICELIST', 'INTERNET'),
  ];
  const { core, risky } = splitWanParameters(rows);
  assert.deepEqual(core.map((item) => item[0].split('.').pop()), ['Enable', 'Username', 'X_ZTE-COM_VLANID']);
  assert.equal(risky.length, 4);
  assert.ok(risky.every((group) => group.length === 1), 'satu parameter per task');
  assert.equal(risky[0][0][0].split('.').pop(), 'ConnectionType');
  assert.equal(risky[risky.length - 1][0][0].split('.').pop(), 'Name');
  assert.equal(isRiskyParameter(`${BASE}Username`), false);
  assert.equal(isRiskyParameter(`${BASE}X_CT-COM_ServiceList`), true);
});

// ---- Queue-and-Fire --------------------------------------------------------------------------

test('Queue-and-Fire: semua task diantre tanpa CR, lalu tepat satu Connection Request di akhir', async () => {
  const nbi = await startFakeNbi({ drain: clearAll });
  try {
    const { core, risky } = splitWanParameters([
      row('Enable', true, 'xsd:boolean'), row('Username', 'u'), row('Password', 'p'),
      row('ConnectionType', 'IP_Routed'), row('X_ZTE-COM_ServiceList', 'INTERNET'),
    ]);
    const started = Date.now();
    const result = await acs.queueAndFireWanBatch(nbi.acsServer, 'DEV1', { core, risky: [...risky, [row('Name', 'tes')]] });
    assert.ok(Date.now() - started < 1500, `tidak boleh ada jeda statis, ternyata ${Date.now() - started}ms`);

    const posts = taskPosts(nbi);
    const queued = posts.filter((item) => item.body);
    const fired = posts.filter((item) => !item.body);
    assert.equal(queued.length, 4, '1 inti + 3 berisiko');
    assert.ok(queued.every((item) => !item.flags.has('connection_request')), 'task diantre tanpa connection_request');
    assert.equal(fired.length, 1, 'tepat satu Connection Request');
    assert.ok(fired[0].flags.has('connection_request'));
    assert.equal(nbi.requests.indexOf(fired[0]), nbi.requests.findLastIndex((item) => item.method === 'POST'), 'CR adalah POST terakhir');
    assert.equal(nbi.requests.find((item) => item.body).body.parameterValues.length, 3, 'inti pertama masuk antrean dan membawa 3 parameter');
    assert.equal(result.applied, true);
    assert.deepEqual(result.risky.rejected, []);
    assert.deepEqual(result.risky.pending, []);
    assert.deepEqual([...result.risky.applied].sort(), ['ConnectionType', 'Name', 'X_ZTE-COM_ServiceList']);
    assert.equal(nbi.requests.some((item) => item.body?.name === 'refreshObject'), false);
  } finally {
    await nbi.close();
  }
});

test('Queue-and-Fire: fault pada task inti -> error FAULT, semua task kita dibuang dari antrean', async () => {
  const nbi = await startFakeNbi({
    drain: (tasks) => {
      const core = tasks.get('t1');
      core.fault = { code: 'cwmp.9003', message: 'Invalid arguments' };
    },
  });
  try {
    const { core, risky } = splitWanParameters([row('Enable', true, 'xsd:boolean'), row('ConnectionType', 'IP_Routed')]);
    await assert.rejects(
      () => acs.queueAndFireWanBatch(nbi.acsServer, 'DEV1', { core, risky }),
      (error) => error.code === 'FAULT' && /9003/.test(error.message),
    );
    const deleted = nbi.requests.filter((item) => item.method === 'DELETE' && item.url.startsWith('/tasks/')).map((item) => item.path);
    assert.ok(deleted.includes('/tasks/t1'), 'task inti dibuang');
    assert.ok(deleted.includes('/tasks/t2'), 'task berisiko tidak tertinggal di antrean');
    assert.equal(nbi.tasks.size, 0);
  } finally {
    await nbi.close();
  }
});

test('Queue-and-Fire: task berisiko yang ditolak ONU tidak menggagalkan inti dan dibuang mandiri', async () => {
  const nbi = await startFakeNbi({
    drain: (tasks) => {
      // task berisiko diantre paralel, jadi urutan ID tidak dijamin: cari lewat nama parameternya
      const byLeaf = (leaf) => [...tasks.values()].find((task) => String(task.parameterValues?.[0]?.[0]).endsWith(`.${leaf}`));
      byLeaf('ConnectionType').fault = { code: 'cwmp.9008', message: 'Non-writable parameter' };
      tasks.delete('t1');
      tasks.delete(byLeaf('X_ZTE-COM_ServiceList')._id);
    },
  });
  try {
    const { core, risky } = splitWanParameters([
      row('Enable', true, 'xsd:boolean'), row('ConnectionType', 'IP_Routed'), row('X_ZTE-COM_ServiceList', 'INTERNET'),
    ]);
    const result = await acs.queueAndFireWanBatch(nbi.acsServer, 'DEV1', { core, risky });
    assert.equal(result.applied, true);
    assert.equal(result.risky.rejected.length, 1);
    assert.equal(result.risky.rejected[0].name, 'ConnectionType');
    assert.match(result.risky.rejected[0].reason, /9008/);
    assert.deepEqual(result.risky.applied, ['X_ZTE-COM_ServiceList']);
    // pembuangan dilakukan di latar belakang: beri satu putaran event loop
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.ok(nbi.requests.some((item) => item.method === 'DELETE' && /^\/tasks\/t[23]$/.test(item.path)));
  } finally {
    await nbi.close();
  }
});

test('Queue-and-Fire: task berisiko yang belum selesai tidak menahan respons dan diselesaikan di latar belakang', async () => {
  let riskyChecks = 0;
  const nbi = await startFakeNbi({
    drain: (tasks) => { tasks.delete('t1'); },
    onRequest: (entry, { tasks, send }) => {
      if (entry.method === 'GET' && entry.path === '/tasks/' && entry.flags.get('query').includes('t2')) {
        riskyChecks += 1;
        // t2 baru hilang setelah jendela singkat habis (>3 detik), jadi sempat dilaporkan "pending".
        if (riskyChecks > 8) {
          tasks.delete('t2');
        }
      }
      return false;
    },
  });
  try {
    const { core, risky } = splitWanParameters([row('Enable', true, 'xsd:boolean'), row('Name', 'tes')]);
    const started = Date.now();
    const result = await acs.queueAndFireWanBatch(nbi.acsServer, 'DEV1', { core, risky });
    const elapsed = Date.now() - started;
    assert.deepEqual(result.risky.pending, ['Name']);
    assert.ok(elapsed < 4500, `respons tidak boleh menunggu task berisiko sampai tuntas (${elapsed}ms)`);
    // tunggu latar belakang selesai supaya proses tes tidak menggantung
    const deadline = Date.now() + 15000;
    while (nbi.tasks.has('t2') && Date.now() < deadline) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await new Promise((resolve) => setTimeout(resolve, 1200));
  } finally {
    await nbi.close();
  }
});

test('Queue-and-Fire: ONU lambat (202 lalu selesai) tetap selesai lewat polling rapat', async () => {
  let crAt = 0;
  const nbi = await startFakeNbi({
    drain: (tasks) => {
      crAt = Date.now();
      setTimeout(() => tasks.clear(), 700);
    },
  });
  try {
    const { core } = splitWanParameters([row('Enable', true, 'xsd:boolean')]);
    await acs.queueAndFireWanBatch(nbi.acsServer, 'DEV1', { core });
    const lag = Date.now() - crAt;
    assert.ok(lag >= 650 && lag < 1700, `polling harus menangkap selesai segera setelah 700ms, ternyata ${lag}ms`);
  } finally {
    await nbi.close();
  }
});

test('Queue-and-Fire: tanpa parameter tidak mengirim apa pun', async () => {
  const nbi = await startFakeNbi();
  try {
    const result = await acs.queueAndFireWanBatch(nbi.acsServer, 'DEV1', { core: [], risky: [] });
    assert.equal(result.applied, true);
    assert.equal(nbi.requests.length, 0);
  } finally {
    await nbi.close();
  }
});

// ---- Fase 1 & utilitas -------------------------------------------------------------------------

test('Fase 1: AddObject satu POST (CR + push), instanceNumber dari response, tanpa refreshObject', async () => {
  const nbi = await startFakeNbi();
  try {
    const started = Date.now();
    const created = await acs.createWanPppInstance(nbi.acsServer, 'DEV1', {
      profile: 'zte', wanDeviceIndex: '1', connectionIndex: '1', createConnectionDevice: false,
    });
    assert.ok(Date.now() - started < 1000);
    assert.equal(created.pppPath, 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.7.');
    const posts = taskPosts(nbi);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].body.name, 'addObject');
    assert.ok(posts[0].flags.has('connection_request'));
    assert.ok(posts[0].flags.has('timeout'));
  } finally {
    await nbi.close();
  }
});

test('Fase 1: 202 lalu task hilang dari antrean tanpa instanceNumber -> indeks dicari lewat polling rapat', async () => {
  let reads = 0;
  const nbi = await startFakeNbi({
    onRequest: (entry, { send }) => {
      if (entry.method === 'POST' && entry.body?.name === 'addObject') {
        send(202, { _id: 'ao1' });
        return true;
      }
      if (entry.method === 'GET' && entry.path === '/devices/') {
        reads += 1;
        // pembacaan pertama = sebelum AddObject, berikutnya instance baru sudah ada
        send(200, [{ InternetGatewayDevice: { WANDevice: { 1: { WANConnectionDevice: { 1: { WANPPPConnection: reads === 1 ? { 1: {} } : { 1: {}, 2: {} } } } } } } }]);
        return true;
      }
      return false;
    },
  });
  try {
    const started = Date.now();
    const created = await acs.createWanPppInstance(nbi.acsServer, 'DEV1', {
      profile: 'zte', wanDeviceIndex: '1', connectionIndex: '1', createConnectionDevice: false,
    });
    assert.ok(Date.now() - started < 1500, `ditemukan ${Date.now() - started}ms`);
    assert.match(created.pppPath, /WANPPPConnection\.2\.$/);
  } finally {
    await nbi.close();
  }
});

test('purgeStaleWanTasks hanya membuang task berfault (dari koleksi faults) atau basi', async () => {
  const old = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const fresh = new Date().toISOString();
  const nbi = await startFakeNbi({
    onRequest: (entry, { send }) => {
      if (entry.method === 'GET' && entry.path === '/tasks/') {
        send(200, [
          { _id: 'ok', timestamp: fresh },
          { _id: 'faulted', timestamp: fresh },
          { _id: 'stale', timestamp: old },
        ]);
        return true;
      }
      if (entry.method === 'GET' && entry.path === '/faults/') {
        send(200, [{ _id: 'DEV1:task_faulted', device: 'DEV1', channel: 'task_faulted', code: 'cwmp.9002' }]);
        return true;
      }
      return false;
    },
  });
  try {
    const dropped = await acs.purgeStaleWanTasks(nbi.acsServer, 'DEV1');
    assert.equal(dropped, 2);
    const deleted = nbi.requests.filter((item) => item.method === 'DELETE' && item.url.startsWith('/tasks/')).map((item) => item.path);
    assert.deepEqual(deleted.sort(), ['/tasks/faulted', '/tasks/stale']);
  } finally {
    await nbi.close();
  }
});

test('fault inti terdeteksi dalam hitungan ratusan ms, bukan menunggu batas waktu', async () => {
  const nbi = await startFakeNbi({
    drain: (tasks) => { tasks.get('t1').fault = { code: 'cwmp.9003', message: 'Invalid arguments' }; },
  });
  try {
    const started = Date.now();
    await assert.rejects(
      () => acs.queueAndFireWanBatch(nbi.acsServer, 'DEV1', { core: [row('Enable', true, 'xsd:boolean')], budgetMs: 20000 }),
      (error) => error.code === 'FAULT' && /9003/.test(error.message),
    );
    assert.ok(Date.now() - started < 1500, `fault harus langsung terdeteksi, ternyata ${Date.now() - started}ms`);
  } finally {
    await nbi.close();
  }
});

test('wanTimer merangkum langkah', () => {
  const timer = acs.wanTimer();
  timer.mark('baca');
  timer.mark('set');
  assert.match(timer.summary(), /^baca=\d+ms set=\d+ms$/);
});

test('mode atomik: tidak ada task terpisah, Name sebelum Enable dan Enable paling akhir', () => {
  const { prefersAtomicWan } = require('../backend/acs_wan');
  const rows = [
    [`${BASE}Enable`, true, 'xsd:boolean'],
    [`${BASE}ConnectionType`, 'PPPoE_Bridged', 'xsd:string'],
    [`${BASE}X_ZTE-COM_ServiceList`, 'INTERNET', 'xsd:string'],
    [`${BASE}Name`, 'tes', 'xsd:string'],
  ];
  const atomic = splitWanParameters(rows, { atomic: true });
  assert.deepEqual(atomic.core.map((r) => r[0].split('.').pop()), ['ConnectionType', 'X_ZTE-COM_ServiceList', 'Name', 'Enable']);
  assert.equal(atomic.risky.length, 0);
  assert.equal(splitWanParameters(rows).risky.length, 3);
  assert.equal(prefersAtomicWan('zte'), true);
  assert.equal(prefersAtomicWan('huawei'), false);
});
