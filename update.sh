#!/usr/bin/env bash
# Menarik pembaruan acs-standalone yang sudah terpasang di server produksi.
#
# Cara menjalankan (dari folder proyek, misalnya /var/www/acs-standalone):
#   chmod +x update.sh
#   ./update.sh

set -euo pipefail

# Folder utama project. Di server produksi ini biasanya /var/www/acs-standalone.
APP_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$APP_DIR"

GREEN='\033[1;32m'
YELLOW='\033[1;33m'
RED='\033[1;31m'
NC='\033[0m'

die() {
  echo -e "${RED}$*${NC}" >&2
  exit 1
}

if [[ ! -f "$APP_DIR/server.js" || ! -f "$APP_DIR/frontend/package.json" ]]; then
  die "update.sh harus berada di folder utama acs-standalone."
fi

# Paksa salinan lokal sama dengan GitHub. Perubahan lokal, termasuk package-lock.json, dibuang.
echo -e "${YELLOW}Menarik kode terbaru dari GitHub...${NC}"
git fetch --all
git reset --hard origin/main
git pull origin main

# Paket backend ada di folder utama (package.json + server.js), bukan di folder modul backend/.
echo -e "${YELLOW}Memasang dependensi backend...${NC}"
npm install

echo -e "${YELLOW}Memasang dependensi frontend dan membangun ulang Vite...${NC}"
cd "$APP_DIR/frontend"
npm install
npm run build

echo -e "${YELLOW}Me-restart acs-backend dan acs-frontend...${NC}"
cd "$APP_DIR"
pm2 restart acs-backend
pm2 restart acs-frontend

echo -e "${GREEN}Proses Update Selesai dan Berhasil!${NC}"
