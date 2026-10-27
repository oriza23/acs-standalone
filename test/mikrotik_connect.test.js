const assert = require('node:assert/strict');
const test = require('node:test');
const { classifyConnectError } = require('../backend/mikrotik_connect');
const { publicSession } = require('../backend/mikrotik_store');

test('password salah menjadi 401', () => {
  const mapped = classifyConnectError({ errno: 'CANTLOGIN', message: 'Username or password is invalid' });
  assert.equal(mapped.status, 401);
  assert.match(mapped.message, /password/i);
});

test('koneksi ditolak dan timeout menjadi 400 yang jelas', () => {
  const refused = classifyConnectError({ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 10.0.0.1:8728' });
  assert.equal(refused.status, 400);
  assert.match(refused.message, /ditolak/i);
  const timeout = classifyConnectError({ code: 'ETIMEDOUT', message: 'Timed out' });
  assert.equal(timeout.status, 400);
  assert.match(timeout.message, /timeout/i);
});

test('pesan error tidak mengulang password', () => {
  const mapped = classifyConnectError({ message: 'gagal sandi-rahasia' }, 'sandi-rahasia');
  assert.equal(mapped.message.includes('sandi-rahasia'), false);
});

test('sesi publik tidak berisi password', () => {
  const session = publicSession({
    host: '10.0.0.1',
    port: 8728,
    user: 'admin',
    password: 'rahasia',
    iface: 'ether1',
  });
  assert.equal(session.saved, true);
  assert.equal(session.username, 'admin');
  assert.equal(session.password, undefined);
  assert.equal(JSON.stringify(session).includes('rahasia'), false);
});
