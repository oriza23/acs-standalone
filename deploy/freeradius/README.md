# FreeRADIUS: sisa waktu voucher

Modul `mods-available/hotspot_time` menjumlahkan `acctsessiontime` di `radacct` dan membandingkannya dengan `Max-All-Session` pada `radgroupcheck`.

## Pemasangan

1. Salin `mods-available/hotspot_time` ke `/etc/freeradius/3.0/mods-available/hotspot_time` (pemilik `freerad`, mode `640`).
2. Aktifkan modul: `ln -s ../mods-available/hotspot_time /etc/freeradius/3.0/mods-enabled/hotspot_time`.
3. Di bagian `authorize` situs `sites-enabled/default`, panggil `hotspot_time` tepat sesudah `sql`.
4. `freeradius -XC`, lalu muat ulang FreeRADIUS hanya jika pemeriksaan itu berhasil.

Aplikasi menulis `radgroupcheck` / `Max-All-Session` sebesar masa aktif profil dalam detik. `Session-Timeout` pada jawaban RADIUS diisi modul ini sebesar sisa waktu, bukan dari `radgroupreply`.

## Batas

`sqlcounter` menghitung sisa waktu saat pengguna autentikasi, dari catatan `radacct` yang sudah masuk. Sisa waktu di tengah sesi yang sedang berjalan bergantung pada accounting MikroTik: sebelum interim update atau accounting stop tercatat, hitungan kumulatif belum bertambah. `shared` lebih dari 1 masih bisa terlewati sedikit, karena dua perangkat yang login bersamaan sama-sama menerima sisa waktu yang sama sebelum salah satu sesi tercatat.
