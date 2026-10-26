const test = require('node:test');
const assert = require('node:assert/strict');

const {
  RadiusSyncError,
  usesRadius,
  assertUsernameFree,
  writeAccount,
  syncProfileGroup,
} = require('../backend/langganan_radius');

// Database tiruan: mencatat semua statement dan menjawab lookup router/profil.
function fakeDb({ routers = {}, groups = {}, radcheckUsers = [], otherCustomers = [] } = {}) {
  const calls = [];
  return {
    calls,
    async execute(sql, params = []) {
      const text = String(sql);
      calls.push({ sql: text, params });
      if (text.includes('FROM routers')) {
        const ip = routers[params[0]];
        return [ip ? [{ ip_address: ip }] : []];
      }
      if (text.includes('FROM langganan_profiles')) {
        const group = groups[params[0]];
        return [group === undefined ? [] : [{ group_name: group }]];
      }
      if (text.includes('FROM langganan_pelanggan WHERE username')) {
        return [otherCustomers.includes(params[0]) ? [{ id: 99 }] : []];
      }
      if (text.includes('SELECT username FROM radcheck')) {
        return [radcheckUsers.includes(params[0]) ? [{ username: params[0] }] : []];
      }
      return [{ affectedRows: 1 }];
    },
  };
}

function inserted(db, table) {
  return db.calls
    .filter((call) => call.sql.startsWith(`INSERT INTO ${table}`))
    .map((call) => call.params);
}

const baseCustomer = {
  ktg: 'PPP',
  username: 'budi@net',
  password: 'rahasia1',
  profil_id: 5,
  router: 'RB TES',
  server: 'pppoe-service',
  status: 'Aktif',
};

const env = { routers: { 'RB TES': '192.168.223.250' }, groups: { 5: '10-Mbps' } };

test('router dan server tertentu dikunci lewat NAS-IP-Address dan Called-Station-Id', async () => {
  const db = fakeDb(env);
  await writeAccount(db, baseCustomer);

  assert.deepEqual(inserted(db, 'radcheck'), [
    ['budi@net', 'Cleartext-Password', ':=', 'rahasia1'],
    ['budi@net', 'NAS-IP-Address', '==', '192.168.223.250'],
    ['budi@net', 'Called-Station-Id', '==', 'pppoe-service'],
  ]);
  assert.deepEqual(inserted(db, 'radusergroup'), [['budi@net', '10-Mbps']]);
});

test('ALL ROUTER dan ALL SERVER tidak menulis batas apa pun', async () => {
  const db = fakeDb(env);
  await writeAccount(db, { ...baseCustomer, router: 'ALL ROUTER', server: 'ALL SERVER' });

  assert.deepEqual(inserted(db, 'radcheck'), [
    ['budi@net', 'Cleartext-Password', ':=', 'rahasia1'],
  ]);
  assert.equal(db.calls.some((call) => call.sql.includes('FROM routers')), false);
});

test('ALL ROUTER dengan server tertentu hanya membatasi server', async () => {
  const db = fakeDb(env);
  await writeAccount(db, { ...baseCustomer, router: 'ALL ROUTER' });

  assert.deepEqual(inserted(db, 'radcheck').map((row) => row[1]), [
    'Cleartext-Password',
    'Called-Station-Id',
  ]);
});

test('router tertentu dengan ALL SERVER hanya membatasi router', async () => {
  const db = fakeDb(env);
  await writeAccount(db, { ...baseCustomer, server: 'ALL SERVER' });

  assert.deepEqual(inserted(db, 'radcheck').map((row) => row[1]), [
    'Cleartext-Password',
    'NAS-IP-Address',
  ]);
});

test('status Non Aktif dan Isolir menolak login lewat Auth-Type Reject', async () => {
  for (const status of ['Non Aktif', 'Isolir']) {
    const db = fakeDb(env);
    await writeAccount(db, { ...baseCustomer, status });
    assert.ok(
      inserted(db, 'radcheck').some((row) => row[1] === 'Auth-Type' && row[3] === 'Reject'),
      status,
    );
  }
  const aktif = fakeDb(env);
  await writeAccount(aktif, baseCustomer);
  assert.equal(inserted(aktif, 'radcheck').some((row) => row[1] === 'Auth-Type'), false);
});

test('baris lama dihapus dulu sehingga tidak ada batas yang tertinggal', async () => {
  const db = fakeDb(env);
  await writeAccount(db, baseCustomer);

  assert.match(db.calls[0].sql, /^DELETE FROM radcheck/);
  assert.match(db.calls[1].sql, /^DELETE FROM radusergroup/);
});

test('kategori selain PPP/Hotspot atau tanpa password tidak punya akun RADIUS', async () => {
  for (const customer of [
    { ...baseCustomer, ktg: 'Static' },
    { ...baseCustomer, password: '' },
  ]) {
    assert.equal(usesRadius(customer), false);
    const db = fakeDb(env);
    await writeAccount(db, customer);
    assert.deepEqual(inserted(db, 'radcheck'), []);
    assert.deepEqual(inserted(db, 'radusergroup'), []);
    assert.match(db.calls[0].sql, /^DELETE FROM radcheck/);
  }
  assert.equal(usesRadius({ ...baseCustomer, ktg: 'Hotspot' }), true);
});

test('router tidak dikenal atau kosong membatalkan simpan, bukan menulis akun terbuka', async () => {
  await assert.rejects(
    writeAccount(fakeDb(env), { ...baseCustomer, router: 'RB HILANG' }),
    (error) => error instanceof RadiusSyncError && /RB HILANG/.test(error.message),
  );
  await assert.rejects(
    writeAccount(fakeDb(env), { ...baseCustomer, router: '' }),
    (error) => error instanceof RadiusSyncError,
  );
});

test('profil tanpa grup RADIUS tidak menulis radusergroup', async () => {
  const db = fakeDb({ ...env, groups: { 5: '' } });
  await writeAccount(db, baseCustomer);
  assert.deepEqual(inserted(db, 'radusergroup'), []);
});

test('username bentrok dengan langganan lain, voucher/akun RADIUS, atau terlalu panjang ditolak', async () => {
  await assert.rejects(
    assertUsernameFree(fakeDb({ otherCustomers: ['dobel'] }), 'dobel'),
    (error) => error.statusCode === 409,
  );
  await assert.rejects(
    assertUsernameFree(fakeDb({ radcheckUsers: ['5R2JBX4V'] }), '5R2JBX4V'),
    (error) => error.statusCode === 409,
  );
  await assert.rejects(
    assertUsernameFree(fakeDb(), 'x'.repeat(65)),
    (error) => error.statusCode === 400,
  );
  await assert.doesNotReject(assertUsernameFree(fakeDb(), 'baru@net'));
});

test('ganti grup profil memperbarui pelanggan, grup kosong hanya mencabut', async () => {
  const db = fakeDb();
  await syncProfileGroup(db, 5, '20-Mbps');
  assert.match(db.calls[0].sql, /DELETE ug FROM radusergroup/);
  assert.match(db.calls[1].sql, /INSERT INTO radusergroup/);
  assert.deepEqual(db.calls[1].params, ['20-Mbps', 5]);

  const removed = fakeDb();
  await syncProfileGroup(removed, 5, '');
  assert.equal(removed.calls.length, 1);
});
