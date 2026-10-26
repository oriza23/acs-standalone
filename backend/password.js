const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);

// Parameter tetap. Bentuk simpanan muat di kolom web_admins.password VARCHAR(255).
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

function isScryptHash(stored) {
  return typeof stored === 'string' && stored.startsWith('scrypt$');
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const derived = await scrypt(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return [
    'scrypt',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

// Hanya hash dengan parameter di atas yang diterima, supaya baris yang diubah
// tidak bisa memaksa biaya scrypt yang jauh lebih besar saat login.
async function verifyPassword(password, stored) {
  if (!isScryptHash(stored)) {
    return false;
  }
  const parts = stored.split('$');
  if (parts.length !== 6) {
    return false;
  }
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (N !== SCRYPT_N || r !== SCRYPT_R || p !== SCRYPT_P) {
    return false;
  }
  const salt = Buffer.from(parts[4], 'base64');
  const expected = Buffer.from(parts[5], 'base64');
  if (salt.length !== SALT_LENGTH || expected.length !== KEY_LENGTH) {
    return false;
  }
  const actual = await scrypt(password, salt, expected.length, { N, r, p });
  if (actual.length !== expected.length) {
    return false;
  }
  return crypto.timingSafeEqual(actual, expected);
}

module.exports = {
  hashPassword,
  verifyPassword,
  isScryptHash,
};
