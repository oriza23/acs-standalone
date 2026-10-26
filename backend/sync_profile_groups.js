// Menulis ulang jawaban RADIUS grup (Mikrotik-Group dan Mikrotik-Rate-Limit) untuk
// semua profil Hotspot dan Langganan yang dibuat sebelum aturan ini ada.
//
//   node backend/sync_profile_groups.js
//
// Rate limit yang kosong di profil akan menghapus Mikrotik-Rate-Limit grup itu,
// sehingga kecepatan mengikuti profil di MikroTik.
const pool = require('../database');
const { syncAllProfileReplies } = require('./radius_group');

syncAllProfileReplies(pool)
  .then((count) => {
    console.log(`Selesai: ${count.langganan} profil langganan, ${count.hotspot} profil hotspot disinkronkan.`);
  })
  .catch((error) => {
    console.error('Sinkronisasi profil gagal:', error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
