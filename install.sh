#!/usr/bin/env bash
# Instalasi acs-standalone di Ubuntu 24.04.
#
# Cara menjalankan (dari folder proyek, setelah git clone):
#   chmod +x install.sh
#   ./install.sh
#
# Jika perintah apt/MariaDB/UFW meminta hak admin, script memakai sudo.

set -euo pipefail

APP_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
FRONTEND_PORT=5174
BACKEND_PORT=5001

GREEN='\033[1;32m'
YELLOW='\033[1;33m'
RED='\033[1;31m'
NC='\033[0m'

if [[ "$(id -u)" -eq 0 ]]; then
  SUDO=""
  APP_USER="${SUDO_USER:-root}"
else
  SUDO="sudo"
  APP_USER="$USER"
fi
APP_HOME=$(getent passwd "$APP_USER" | cut -d: -f6)

die() {
  echo -e "${RED}$*${NC}" >&2
  exit 1
}

sql_escape() {
  local value=$1
  value=${value//\\/\\\\}
  value=${value//\'/\'\'}
  printf '%s' "$value"
}

if [[ ! -f "$APP_DIR/server.js" || ! -f "$APP_DIR/frontend/package.json" ]]; then
  die "Jalankan script ini di dalam folder hasil git clone acs-standalone."
fi

echo "Pengaturan database. Tekan Enter untuk memakai nilai dalam kurung."
read -r -p "Nama database [acs_db]: " DB_NAME
DB_NAME=${DB_NAME:-acs_db}
read -r -p "Username database [oriza]: " DB_USER
DB_USER=${DB_USER:-oriza}
read -r -p "Password database [Enter = buat otomatis]: " DB_PASSWORD
echo
if [[ -z "$DB_PASSWORD" ]]; then
  DB_PASSWORD=$(openssl rand -hex 12)
  echo "Password database dibuat otomatis."
fi

if [[ ! "$DB_NAME" =~ ^[A-Za-z][A-Za-z0-9_]{0,63}$ ]]; then
  die "Nama database hanya boleh huruf, angka, dan garis bawah, serta diawali huruf."
fi
if [[ ! "$DB_USER" =~ ^[A-Za-z][A-Za-z0-9_]{0,31}$ ]]; then
  die "Username database hanya boleh huruf, angka, dan garis bawah, serta diawali huruf."
fi
if [[ "$DB_PASSWORD" == *$'\n'* ]]; then
  die "Password database tidak boleh mengandung baris baru."
fi

echo -e "${YELLOW}Memasang curl, git, dan MariaDB...${NC}"
$SUDO apt update
$SUDO apt install -y ca-certificates curl git mariadb-server openssl ufw

# Jangan menimpa Node.js yang sudah ada: GenieACS di server yang sama memakai versi itu.
if node -v >/dev/null 2>&1; then
  echo -e "${YELLOW}Node.js sudah terpasang ($(node -v)). Instalasi Node.js dilewati.${NC}"
else
  echo -e "${YELLOW}Node.js belum ada. Memasang Node.js 22...${NC}"
  curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO -E bash -
  $SUDO apt install -y nodejs
fi

echo -e "${YELLOW}Menyalakan MariaDB dan membuat database...${NC}"
$SUDO systemctl enable --now mariadb

DB_USER_SQL=$(sql_escape "$DB_USER")
DB_PASSWORD_SQL=$(sql_escape "$DB_PASSWORD")
$SUDO mariadb <<SQL
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER_SQL}'@'localhost' IDENTIFIED BY '${DB_PASSWORD_SQL}';
ALTER USER '${DB_USER_SQL}'@'localhost' IDENTIFIED BY '${DB_PASSWORD_SQL}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER_SQL}'@'localhost';
FLUSH PRIVILEGES;
SQL

SERVER_IP=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit }}')
if [[ -z "${SERVER_IP}" ]]; then
  SERVER_IP=$(curl -fsS --max-time 8 ifconfig.me || true)
fi
[[ -n "${SERVER_IP}" ]] || die "IP server tidak ditemukan. Periksa jaringan, lalu jalankan script lagi."

JWT_SECRET=$(openssl rand -hex 48)
ADMIN_PASSWORD=$(openssl rand -hex 8)

# Backend adalah akar repositori (server.js). Berkas .env dibaca dari sana, bukan dari folder modul backend/.
echo -e "${YELLOW}Menulis .env backend...${NC}"
umask 077
{
  echo "PORT=${BACKEND_PORT}"
  echo "DB_HOST=localhost"
  echo "DB_USER=${DB_USER}"
  echo "DB_PASSWORD=${DB_PASSWORD}"
  echo "DB_NAME=${DB_NAME}"
  echo "JWT_SECRET=${JWT_SECRET}"
  echo "JWT_EXPIRES_IN=12h"
  echo "BOOTSTRAP_ADMIN_USERNAME=admin"
  echo "BOOTSTRAP_ADMIN_PASSWORD=${ADMIN_PASSWORD}"
} > "$APP_DIR/.env"
chmod 600 "$APP_DIR/.env"

echo "VITE_API_URL=http://${SERVER_IP}:${BACKEND_PORT}" > "$APP_DIR/frontend/.env.production"

echo -e "${YELLOW}Memasang dependensi backend dan frontend...${NC}"
cd "$APP_DIR"
npm install
cd "$APP_DIR/frontend"
npm install
npm run build

echo -e "${YELLOW}Menjalankan acs-backend dan acs-frontend lewat PM2...${NC}"
if ! command -v pm2 >/dev/null 2>&1; then
  $SUDO npm install -g pm2
fi
cd "$APP_DIR"
# Hanya dua proses aplikasi ini. Proses PM2 lain tidak dihentikan.
if pm2 describe acs-backend >/dev/null 2>&1; then
  pm2 delete acs-backend
fi
pm2 start "$APP_DIR/server.js" --name acs-backend --cwd "$APP_DIR"
if pm2 describe acs-frontend >/dev/null 2>&1; then
  pm2 delete acs-frontend
fi
pm2 serve "$APP_DIR/frontend/dist" "$FRONTEND_PORT" --name acs-frontend --spa
pm2 save
$SUDO env PATH="$PATH:/usr/bin" pm2 startup systemd -u "$APP_USER" --hp "$APP_HOME"
pm2 save

echo -e "${YELLOW}Membuka port aplikasi dan GenieACS di UFW...${NC}"
$SUDO ufw allow OpenSSH
$SUDO ufw allow "${FRONTEND_PORT}/tcp"
$SUDO ufw allow "${BACKEND_PORT}/tcp"
$SUDO ufw allow 3000/tcp
$SUDO ufw allow 7547/tcp
$SUDO ufw allow 7557/tcp
$SUDO ufw allow 7567/tcp
$SUDO ufw --force enable

echo
echo -e "${GREEN}Instalasi selesai.${NC}"
echo -e "${GREEN}Buka aplikasi di browser: http://${SERVER_IP}:${FRONTEND_PORT}${NC}"
echo -e "${GREEN}Login admin: admin / ${ADMIN_PASSWORD}${NC}"
echo -e "${GREEN}Database: ${DB_NAME}  pengguna: ${DB_USER}${NC}"
