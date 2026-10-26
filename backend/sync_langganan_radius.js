// Menulis akun RADIUS untuk pelanggan Data Langganan yang dibuat sebelum fitur
// sinkronisasi ada.
//
//   node backend/sync_langganan_radius.js            -> hanya menampilkan rencana
//   node backend/sync_langganan_radius.js --apply    -> benar-benar menulis ke RADIUS
//
// Pelanggan yang username-nya sudah ada di radcheck dilewati, supaya akun yang
// diatur manual (voucher, PPPoE Pelanggan) tidak tertimpa.
const pool = require('../database');
const { usesRadius, writeAccount, buildAccountRows } = require('./langganan_radius');

async function backfill(db, { apply = false } = {}) {
  const [customers] = await db.query(
    `SELECT id, pelanggan, ktg, profil_id, username, password, router, server, status
     FROM langganan_pelanggan ORDER BY id`,
  );
  const report = [];

  for (const customer of customers) {
    const entry = { id: customer.id, username: customer.username, hasil: '' };
    report.push(entry);

    if (!usesRadius(customer)) {
      entry.hasil = 'dilewati: bukan PPP/Hotspot atau tanpa username/password';
      continue;
    }
    const [existing] = await db.execute(
      'SELECT 1 FROM radcheck WHERE username = ? LIMIT 1',
      [customer.username],
    );
    if (existing.length > 0) {
      entry.hasil = 'dilewati: username sudah ada di RADIUS';
      continue;
    }

    try {
      const { radcheck, groupName } = await buildAccountRows(db, customer);
      entry.rencana = {
        radcheck: radcheck.map(([attribute, op, value]) => `${attribute} ${op} ${attribute === 'Cleartext-Password' ? '***' : value}`),
        group: groupName || '(tanpa grup)',
      };
      if (!apply) {
        entry.hasil = 'akan ditulis';
        continue;
      }
      const conn = await db.getConnection();
      try {
        await conn.beginTransaction();
        await writeAccount(conn, customer);
        await conn.commit();
      } catch (error) {
        await conn.rollback().catch(() => {});
        throw error;
      } finally {
        conn.release();
      }
      entry.hasil = 'ditulis';
    } catch (error) {
      entry.hasil = `gagal: ${error.message}`;
    }
  }
  return report;
}

module.exports = { backfill };

if (require.main === module) {
  const apply = process.argv.includes('--apply');
  backfill(pool, { apply })
    .then((report) => {
      console.log(apply ? 'Hasil sinkronisasi:' : 'Rencana sinkronisasi (tambahkan --apply untuk menulis):');
      console.log(JSON.stringify(report, null, 2));
    })
    .catch((error) => {
      console.error('Sinkronisasi gagal:', error.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
