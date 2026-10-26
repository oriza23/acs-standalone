const http = require('http');
const express = require('express');
const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../database');
const pppoeRouter = require('../backend/routes/pppoe');

async function call(method, path, body) {
  const app = express();
  app.use(express.json());
  app.use('/api/pppoe', pppoeRouter);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json() };
  } finally {
    server.close();
  }
}

// managed: grup milik profil Hotspot/Langganan; existing: grup sudah punya baris radgroupreply.
function installPool({ managed = false, existing = false } = {}) {
  const calls = [];
  const execute = async (sql, params) => {
    const text = String(sql);
    calls.push({ sql: text, params });
    if (text.includes('(SELECT ? AS groupname) g')) {
      return [managed ? [{ 1: 1 }] : []];
    }
    if (text.includes("attribute IN ('Mikrotik-Group'")) {
      return [existing ? [{ 1: 1 }] : []];
    }
    if (text.startsWith('UPDATE radgroupreply')) {
      return [{ affectedRows: 0 }];
    }
    return [{ affectedRows: 1 }];
  };
  pool.execute = execute;
  pool.getConnection = async () => ({
    execute,
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
  });
  return calls;
}

const inserts = (calls) => calls.filter((c) => c.sql.startsWith('INSERT INTO radgroupreply')).map((c) => c.params);

test('profil PPPoE tanpa limit: hanya Mikrotik-Group yang ditulis', async () => {
  const calls = installPool();
  const response = await call('POST', '/api/pppoe/profil', { groupname: 'Paket-A', rate_limit: '' });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.deepEqual(inserts(calls), [['Paket-A', 'Mikrotik-Group', 'Paket-A']]);
});

test('profil PPPoE dengan limit menulis Mikrotik-Rate-Limit', async () => {
  const calls = installPool();
  const response = await call('POST', '/api/pppoe/profil', { groupname: 'Paket-A', rate_limit: '5M/5M' });
  assert.equal(response.status, 200);
  assert.deepEqual(inserts(calls), [
    ['Paket-A', 'Mikrotik-Group', 'Paket-A'],
    ['Paket-A', 'Mikrotik-Rate-Limit', '5M/5M'],
  ]);
});

test('edit dengan limit dikosongkan menghapus Mikrotik-Rate-Limit', async () => {
  const calls = installPool({ existing: true });
  const response = await call('PUT', '/api/pppoe/profil/Paket-A', { rate_limit: '' });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.ok(calls.some((c) => c.sql.startsWith('DELETE FROM radgroupreply') && c.params[1] === 'Mikrotik-Rate-Limit'));
  assert.deepEqual(inserts(calls).filter((p) => p[1] === 'Mikrotik-Rate-Limit'), []);
});

test('nama kosong, profil ganda, grup tak ada, dan grup milik halaman lain ditolak', async () => {
  assert.equal((await call('POST', '/api/pppoe/profil', { groupname: ' ' })).status, 400);
  assert.equal((await call('POST', '/api/pppoe/profil', { groupname: 'x'.repeat(65) })).status, 400);

  installPool({ existing: true });
  assert.equal((await call('POST', '/api/pppoe/profil', { groupname: 'Paket-A' })).status, 409);

  installPool({ existing: false });
  assert.equal((await call('PUT', '/api/pppoe/profil/tidak-ada', { rate_limit: '' })).status, 404);

  const calls = installPool({ managed: true });
  assert.equal((await call('POST', '/api/pppoe/profil', { groupname: 'tes21' })).status, 409);
  assert.equal((await call('PUT', '/api/pppoe/profil/tes21', { rate_limit: '1M/1M' })).status, 409);
  assert.equal((await call('DELETE', '/api/pppoe/profil/tes21')).status, 409);
  assert.equal(inserts(calls).length, 0);
  assert.equal(calls.some((c) => c.sql.startsWith('DELETE FROM radgroupreply')), false);
});
