# Deploy acs-standalone di Ubuntu 24.04

Panduan ini memasang aplikasi manajemen GenieACS (backend Express + frontend Vite/React) di Ubuntu 24.04 yang baru diperbarui. Backend mendengarkan port **5001**. Frontend produksi disajikan di port **5174**.

GenieACS sendiri (NBI, biasanya port 7557) dipasang terpisah. Setelah login, alamat server GenieACS diisi dari menu aplikasi.

## 1. Environment dasar

Vite 8.3 yang dipakai frontend membutuhkan **Node.js 20.19 ke atas, atau Node.js 22.12 ke atas**. Panduan ini memakai **Node.js 22** (sama dengan lingkungan pengembangan proyek). Node bawaan repositori Ubuntu 24.04 terlalu lama untuk membangun frontend.

Masuk sebagai pengguna yang akan menjalankan aplikasi (bukan sesi root terus-menerus), lalu:

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y ca-certificates curl git mariadb-server
```

Pasang Node.js 22 dari NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

`node -v` harus menampilkan `v22.12` atau lebih baru.

Pasang PM2 secara global:

```bash
sudo npm install -g pm2
pm2 -v
```

Nyalakan MariaDB dan buat supaya ikut hidup setelah reboot:

```bash
sudo systemctl enable --now mariadb
sudo systemctl status mariadb
```

## 2. Ambil kode aplikasi

```bash
sudo mkdir -p /var/www
sudo chown "$USER:$USER" /var/www
git clone https://github.com/oriza23/acs-standalone.git /var/www/acs-standalone
cd /var/www/acs-standalone
```

Struktur yang dipakai saat menjalankan:

- Akar repositori (`package.json`, `server.js`) adalah **backend**.
- Folder `frontend/` adalah aplikasi Vite.
- Folder `backend/` berisi modul yang dipanggil `server.js`, bukan paket npm terpisah.

## 3. Buat database `acs_db`

Di Ubuntu 24.04, akun root MariaDB memakai soket sistem. Masuk dengan:

```bash
sudo mariadb
```

Di prompt MariaDB, ganti kata sandi di bawah sebelum dijalankan:

```sql
CREATE DATABASE acs_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'acs'@'localhost' IDENTIFIED BY 'ganti-dengan-sandi-kuat';
GRANT ALL PRIVILEGES ON acs_db.* TO 'acs'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

Tabel `web_admins`, `data_server_acs`, dan `acs_devices` dibuat otomatis saat backend pertama kali berhasil terhubung. Tidak perlu mengimpor berkas SQL.

## 4. Konfigurasi `.env`

Backend membaca `/var/www/acs-standalone/.env` saat proses dimulai. Nilai yang sudah ada di lingkungan proses (misalnya dari PM2) tidak ditimpa oleh berkas ini.

```bash
cd /var/www/acs-standalone
nano .env
```

Isi berkas:

```env
PORT=5001
DB_HOST=localhost
DB_USER=acs
DB_PASSWORD=ganti-dengan-sandi-kuat
DB_NAME=acs_db

# Minimal 32 karakter acak. Contoh pembuat: openssl rand -hex 48
JWT_SECRET=ganti-dengan-rahasia-panjang
JWT_EXPIRES_IN=12h

# Dipakai hanya bila tabel web_admins masih kosong.
BOOTSTRAP_ADMIN_USERNAME=admin
BOOTSTRAP_ADMIN_PASSWORD=ganti-sandi-admin
```

Batasi izin berkas:

```bash
chmod 600 .env
```

Akun admin awal hanya dibuat bila `BOOTSTRAP_ADMIN_USERNAME` dan `BOOTSTRAP_ADMIN_PASSWORD` terisi **dan** tabel `web_admins` masih kosong. Isi keduanya sebelum backend pertama kali dijalankan.

Frontend membaca alamat API pada saat **build**, dari `frontend/.env.production`. Ganti `203.0.113.10` dengan IP atau nama domain server yang dibuka browser.

```bash
nano /var/www/acs-standalone/frontend/.env.production
```

```env
VITE_API_URL=http://203.0.113.10:5001
```

Jangan menambahkan akhiran `/api`. Path itu sudah ada di kode klien. Jika berkas ini tidak ada, browser memakai hostname halaman web dengan port 5001.

## 5. Instal dependensi

Dari akar proyek (backend):

```bash
cd /var/www/acs-standalone
npm install
```

Lalu frontend. Vite ada di `devDependencies`, jadi instalasi ini perlu lengkap sebelum build:

```bash
cd /var/www/acs-standalone/frontend
npm install
```

## 6. Build frontend untuk produksi

Masih di dalam folder `frontend`:

```bash
npm run build
```

Hasilnya ada di `frontend/dist/`. Ulangi perintah ini setiap kali `VITE_API_URL` atau kode frontend berubah, lalu muat ulang proses PM2 frontend.

## 7. Jalankan dengan PM2

Kembali ke akar proyek dan daftarkan kedua proses:

```bash
cd /var/www/acs-standalone
pm2 start server.js --name acs-backend
pm2 serve /var/www/acs-standalone/frontend/dist 5174 --name acs-frontend --spa
```

`--spa` mengarahkan rute React (misalnya `/acs`) ke `index.html`.

Periksa status:

```bash
pm2 status
pm2 logs acs-backend --lines 30
```

Log backend yang sehat memuat baris `Server berjalan di http://localhost:5001`. Buka `http://IP-SERVER:5174/` dari browser, lalu masuk dengan akun bootstrap.

Perintah harian:

```bash
pm2 restart acs-backend
pm2 restart acs-frontend
pm2 logs
pm2 stop all
```

Setelah mengubah `.env` backend, jalankan `pm2 restart acs-backend`. Setelah build frontend baru, jalankan `pm2 restart acs-frontend`.

## 8. Auto-run setelah reboot

Simpan daftar proses yang sedang berjalan, lalu pasang layanan systemd. `pm2 startup` mencetak satu perintah `sudo ...` yang harus disalin dan dijalankan.

```bash
pm2 save
pm2 startup systemd
```

Jalankan perintah `sudo env PATH=... pm2 startup ...` yang muncul di layar, kemudian simpan ulang:

```bash
pm2 save
```

Uji dengan reboot:

```bash
sudo reboot
```

Setelah server hidup kembali:

```bash
pm2 status
```

`acs-backend` dan `acs-frontend` harus berstatus `online`.

## 9. Firewall

Jika UFW dipakai, buka port web dan API:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 5174/tcp
sudo ufw allow 5001/tcp
sudo ufw enable
sudo ufw status
```

Port MariaDB `3306` tetap tertutup dari luar. Aplikasi hanya terhubung ke `localhost`.
