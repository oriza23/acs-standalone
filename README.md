# Deploy acs-standalone di Ubuntu 24.04

Panduan ini memasang aplikasi manajemen GenieACS (backend Express + frontend Vite/React) di Ubuntu 24.04 yang baru diperbarui. Backend mendengarkan port **5001**. Frontend produksi disajikan di port **5174**.

GenieACS sendiri (NBI, biasanya port 7557) dipasang terpisah. Setelah login, alamat server GenieACS diisi dari menu aplikasi.

Ambil kode aplikasi sekali, lalu pilih salah satu cara pemasangan di bawah.

```bash
sudo mkdir -p /var/www
sudo chown "$USER:$USER" /var/www
git clone https://github.com/oriza23/acs-standalone.git /var/www/acs-standalone
cd /var/www/acs-standalone
```

Struktur folder:

- Akar repositori (`package.json`, `server.js`) adalah **backend**.
- Folder `frontend/` adalah aplikasi Vite.
- Folder `backend/` berisi modul yang dipanggil `server.js`, bukan paket npm terpisah.

## Opsi 1: Instalasi Otomatis (Rekomendasi)

`install.sh` menanyakan nama database, username, dan password. Nilai bawaan bila Enter ditekan adalah `acs_db` dan `oriza`. Password yang dikosongkan dibuat otomatis.

Script kemudian memasang curl, Git, MariaDB, dan Node.js 22, membuat database beserta hak aksesnya, menulis `.env`, menjalankan `npm install` di backend dan frontend, membangun frontend, mendaftarkan kedua layanan ke PM2, menyimpan proses agar hidup lagi setelah reboot, dan membuka port **5001**, **5174**, serta port GenieACS **3000**, **7547**, **7557**, dan **7567** di UFW.

Dari folder proyek:

```bash
chmod +x install.sh
./install.sh
```

Di akhir, script menampilkan alamat `http://<IP_SERVER>:5174` beserta username `admin` dan password yang baru dibuat. Simpan password itu. Akun admin hanya dibuat bila tabel `web_admins` masih kosong.

## Opsi 2: Instalasi Manual

Vite 8.3 yang dipakai frontend membutuhkan **Node.js 20.19 ke atas, atau Node.js 22.12 ke atas**. Panduan ini memakai **Node.js 22**. Node bawaan repositori Ubuntu 24.04 terlalu lama untuk membangun frontend.

### 1. Environment dasar

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

### 2. Buat database `acs_db`

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

### 3. Konfigurasi `.env`

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

Akun admin awal hanya dibuat bila `BOOTSTRAP_ADMIN_USERNAME` dan `BOOTSTRAP_ADMIN_PASSWORD` terisi dan tabel `web_admins` masih kosong. Isi keduanya sebelum backend pertama kali dijalankan.

Frontend membaca alamat API pada saat **build**, dari `frontend/.env.production`. Ganti `203.0.113.10` dengan IP atau nama domain server yang dibuka browser.

```bash
nano /var/www/acs-standalone/frontend/.env.production
```

```env
VITE_API_URL=http://203.0.113.10:5001
```

Jangan menambahkan akhiran `/api`. Path itu sudah ada di kode klien. Jika berkas ini tidak ada, browser memakai hostname halaman web dengan port 5001.

### 4. Instal dependensi

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

### 5. Build frontend untuk produksi

Masih di dalam folder `frontend`:

```bash
npm run build
```

Hasilnya ada di `frontend/dist/`. Ulangi perintah ini setiap kali `VITE_API_URL` atau kode frontend berubah, lalu muat ulang proses PM2 frontend.

### 6. Jalankan dengan PM2

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

### 7. Auto-run setelah reboot

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

### 8. Firewall

Jika UFW dipakai, buka port web, API, dan GenieACS:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 5174/tcp
sudo ufw allow 5001/tcp
sudo ufw allow 3000/tcp
sudo ufw allow 7547/tcp
sudo ufw allow 7557/tcp
sudo ufw allow 7567/tcp
sudo ufw enable
sudo ufw status
```

Port **3000** adalah antarmuka GenieACS, **7547** adalah CWMP, **7557** adalah NBI, dan **7567** adalah file server. Port MariaDB `3306` tetap tertutup dari luar. Aplikasi hanya terhubung ke `localhost`.

## Cara Memperbarui Aplikasi (Update)

Saat aplikasi sudah berjalan di server produksi, pembaruan kode dari GitHub dijalankan dengan `update.sh` dari folder utama proyek. Script menarik `origin main`, memasang dependensi backend dan frontend, membangun ulang Vite, lalu me-restart proses PM2 `acs-backend` dan `acs-frontend`.

```bash
cd /var/www/acs-standalone
chmod +x update.sh
./update.sh
```

`chmod +x` cukup sekali. Pembaruan berikutnya cukup `./update.sh`. Jika script selesai, muncul pesan hijau: Proses Update Selesai dan Berhasil!

## Cara Mengakses Aplikasi

Cek alamat server dari terminal Ubuntu.

IP lokal (di jaringan yang sama dengan server):

```bash
ip a
```

Lihat alamat pada antarmuka yang aktif, biasanya `eth0` atau `ens18`, berbentuk `192.168.x.x` atau `10.x.x.x`.

IP publik (diakses dari internet):

```bash
curl ifconfig.me
```

Buka aplikasi di browser dengan IP tersebut dan port frontend. PM2 menyajikan hasil build Vite di port **5174**:

```text
http://<IP_SERVER_UBUNTU>:5174
```

Contoh: `http://192.168.69.70:5174` di jaringan lokal, atau `http://203.0.113.10:5174` lewat internet.

Backend tetap di port **5001**. Browser memanggil API ke `http://<IP_SERVER_UBUNTU>:5001`, sesuai `VITE_API_URL` saat build.

Port aplikasi dan GenieACS harus berstatus terbuka di firewall UFW, kalau tidak halaman web, login, atau GenieACS gagal terhubung:

```bash
sudo ufw allow 5174/tcp
sudo ufw allow 5001/tcp
sudo ufw allow 3000/tcp
sudo ufw allow 7547/tcp
sudo ufw allow 7557/tcp
sudo ufw allow 7567/tcp
sudo ufw status
```

Pada daftar UFW, port itu tampil sebagai `ALLOW`. Pemasangan UFW ada di bagian Firewall pada Opsi 2. Opsi 1 sudah membuka port yang sama.
