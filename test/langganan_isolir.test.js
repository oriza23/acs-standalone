const test = require('node:test');
const assert = require('node:assert/strict');

const {
  disconnectUser,
  isExpired,
  isolateExpiredCustomers,
} = require('../backend/langganan_isolir');
const {
  writeProfileReply,
  releaseGroupReply,
  assertGroupAvailable,
  GroupConflictError,
} = require('../backend/radius_group');

function fakeDb({ due = [], sessions = [], routers = {}, rows = {} } = {}) {
  const calls = [];
  const exec = async (sql, params = []) => {
    const text = String(sql);
    calls.push({ sql: text, params });
    if (text.includes('FROM radacct')) {
      return [sessions];
    }
    if (text.includes('FROM routers')) {
      return [routers[params[0]] ? [{ secret: routers[params[0]] }] : []];
    }
    for (const [needle, result] of Object.entries(rows)) {
      if (text.includes(needle)) {
        return [result];
      }
    }
    if (text.startsWith('UPDATE radgroupreply')) {
      return [{ affectedRows: 0 }];
    }
    return [{ affectedRows: 1 }];
  };
  const conn = {
    execute: exec,
    query: exec,
    beginTransaction: async () => calls.push({ sql: 'BEGIN' }),
    commit: async () => calls.push({ sql: 'COMMIT' }),
    rollback: async () => calls.push({ sql: 'ROLLBACK' }),
    release: () => {},
  };
  return {
    calls,
    execute: exec,
    query: async (sql, params) => {
      if (String(sql).includes('FROM langganan_pelanggan')) {
        calls.push({ sql: String(sql), params });
        return [due];
      }
      if (String(sql).includes('<= NOW()')) {
        return [[{ expired: rows.expired ? 1 : 0 }]];
      }
      return exec(sql, params);
    },
    getConnection: async () => conn,
  };
}

test('masa aktif habis: status jadi Isolir, login ditolak, sesi aktif diputus', async () => {
  const db = fakeDb({
    due: [{ id: 7, username: 'budi@net' }],
    sessions: [{ nasipaddress: '10.0.0.1', framedipaddress: '172.16.0.5', acctsessionid: '81a0001' }],
    routers: { '10.0.0.1': 'rahasia-router' },
  });
  const sent = [];
  const isolated = await isolateExpiredCustomers(db, { run: async (job) => sent.push(job) });

  assert.deepEqual(isolated, ['budi@net']);
  assert.ok(db.calls.some((call) => call.sql.includes("SET status = 'Isolir'") && call.params[0] === 7));
  assert.ok(db.calls.some((call) => call.sql.includes("'Auth-Type', ':=', 'Reject'") && call.params[0] === 'budi@net'));
  assert.equal(db.calls.filter((call) => call.sql === 'COMMIT').length, 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].ip, '10.0.0.1');
  assert.equal(sent[0].secret, 'rahasia-router');
  assert.deepEqual(sent[0].attributes, [
    'User-Name = "budi@net"',
    'Acct-Session-Id = "81a0001"',
    'Framed-IP-Address = 172.16.0.5',
  ]);
});

test('status sudah berubah di tengah jalan: tidak ada penolakan atau pemutusan ganda', async () => {
  const db = fakeDb({ due: [{ id: 7, username: 'budi@net' }] });
  const original = db.getConnection;
  db.getConnection = async () => {
    const conn = await original();
    const execute = conn.execute;
    conn.execute = async (sql, params) => (
      String(sql).includes("SET status = 'Isolir'") ? [{ affectedRows: 0 }] : execute(sql, params)
    );
    return conn;
  };
  const sent = [];
  const isolated = await isolateExpiredCustomers(db, { run: async (job) => sent.push(job) });
  assert.deepEqual(isolated, []);
  assert.equal(sent.length, 0);
  assert.equal(db.calls.some((call) => call.sql.includes('Auth-Type')), false);
});

test('pemutusan memakai secret router tempat sesi berjalan, dan melewati router tak dikenal', async () => {
  const db = fakeDb({
    sessions: [
      { nasipaddress: '10.0.0.1', framedipaddress: '', acctsessionid: 'a' },
      { nasipaddress: '10.0.0.9', framedipaddress: '', acctsessionid: 'b' },
    ],
    routers: { '10.0.0.1': 's1' },
  });
  const sent = [];
  const result = await disconnectUser(db, 'x@net', { run: async (job) => sent.push(job.ip) });
  assert.deepEqual(result, { diputus: 1, gagal: 1 });
  assert.deepEqual(sent, ['10.0.0.1']);

  const failing = await disconnectUser(db, 'x@net', { run: async () => { throw new Error('timeout'); } });
  assert.equal(failing.diputus, 0);
});

test('isExpired membaca jam database dan tanggal kosong tidak pernah habis', async () => {
  assert.equal(await isExpired(fakeDb({ rows: { expired: true } }), '2020-01-01 00:00:00'), true);
  assert.equal(await isExpired(fakeDb({ rows: { expired: false } }), '2099-01-01 00:00:00'), false);
  assert.equal(await isExpired(fakeDb(), null), false);
});

test('profil: Mikrotik-Group selalu ditulis, limit hanya bila diisi', async () => {
  const withLimit = fakeDb();
  await writeProfileReply(withLimit, '10-Mbps', '10M/10M');
  const inserted = withLimit.calls.filter((call) => call.sql.startsWith('INSERT INTO radgroupreply')).map((call) => call.params);
  assert.deepEqual(inserted, [
    ['10-Mbps', 'Mikrotik-Group', '10-Mbps'],
    ['10-Mbps', 'Mikrotik-Rate-Limit', '10M/10M'],
  ]);

  const noLimit = fakeDb();
  await writeProfileReply(noLimit, '10-Mbps', '');
  assert.ok(noLimit.calls.some((call) => call.sql.startsWith('DELETE FROM radgroupreply')
    && call.params[1] === 'Mikrotik-Rate-Limit'));
  assert.equal(noLimit.calls.some((call) => call.params?.includes('Mikrotik-Rate-Limit') && call.sql.startsWith('INSERT')), false);
});

test('grup yang masih dipakai profil lain tidak dicabut, grup bebas dicabut', async () => {
  const used = fakeDb({ rows: { 'FROM langganan_profiles': [{ id: 1 }] } });
  await releaseGroupReply(used, 'g');
  assert.equal(used.calls.some((call) => call.sql.startsWith('DELETE')), false);

  const free = fakeDb({ rows: { 'FROM langganan_profiles': [], 'FROM hotspot_profiles': [] } });
  await releaseGroupReply(free, 'g');
  assert.ok(free.calls.some((call) => call.sql.startsWith('DELETE FROM radgroupreply')));
});

test('grup dipakai profil hotspot atau profil lain dengan limit berbeda ditolak', async () => {
  await assert.rejects(
    assertGroupAvailable(fakeDb({ rows: { 'FROM hotspot_profiles': [{ id: 1 }] } }), 'g', ''),
    (error) => error instanceof GroupConflictError && error.statusCode === 409,
  );
  await assert.rejects(
    assertGroupAvailable(fakeDb({ rows: { 'FROM hotspot_profiles': [], 'FROM langganan_profiles': [{ id: 2 }] } }), 'g', '5M/5M', 1),
    GroupConflictError,
  );
  await assert.doesNotReject(
    assertGroupAvailable(fakeDb({ rows: { 'FROM hotspot_profiles': [], 'FROM langganan_profiles': [] } }), 'g', ''),
  );
});
