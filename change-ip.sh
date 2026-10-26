#!/usr/bin/env bash
# Menyesuaikan IP server yang berubah, lalu membangun ulang frontend dan menyimpan PM2.
#
# Cara menjalankan (dari folder proyek, misalnya /var/www/acs-standalone):
#   chmod +x change-ip.sh
#   ./change-ip.sh

set -euo pipefail

APP_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$APP_DIR"

BACKEND_PORT=5001
GREEN='\033[1;32m'
YELLOW='\033[1;33m'
RED='\033[1;31m'
NC='\033[0m'

die() {
  echo -e "${RED}$*${NC}" >&2
  exit 1
}

if [[ ! -f "$APP_DIR/frontend/package.json" ]]; then
  die "change-ip.sh harus berada di folder utama acs-standalone."
fi

NEW_IP=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit }}')
if [[ -z "$NEW_IP" ]]; then
  NEW_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
fi
if [[ ! "$NEW_IP" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
  die "IP lokal tidak ditemukan. Periksa jaringan, lalu jalankan script lagi."
fi

echo -e "${YELLOW}IP lokal terbaru: ${NEW_IP}${NC}"

# Ganti host pada variabel URL/API. Port di belakang titik dua dibiarkan.
replace_host() {
  local file=$1
  [[ -f "$file" ]] || return 0
  local tmp
  tmp=$(mktemp)
  local changed=0
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" =~ ^(VITE_API_URL|API_URL|BACKEND_URL|PUBLIC_URL|SERVER_IP)=https?://[^[:space:]]+ ]]; then
      local updated
      updated=$(printf '%s\n' "$line" | sed -E "s#^(VITE_API_URL|API_URL|BACKEND_URL|PUBLIC_URL|SERVER_IP)=(https?://)[^:/]+#\\1=\\2${NEW_IP}#")
      if [[ "$updated" != "$line" ]]; then
        changed=1
        echo -e "${YELLOW}Memperbarui ${file}${NC}"
      fi
      printf '%s\n' "$updated" >> "$tmp"
    else
      printf '%s\n' "$line" >> "$tmp"
    fi
  done < "$file"
  if [[ "$changed" -eq 1 ]]; then
    cat "$tmp" > "$file"
  fi
  rm -f "$tmp"
}

ENV_FILES=(
  "$APP_DIR/.env"
  "$APP_DIR/frontend/.env"
  "$APP_DIR/frontend/.env.local"
  "$APP_DIR/frontend/.env.production"
  "$APP_DIR/frontend/.env.production.local"
)

found_api=0
for file in "${ENV_FILES[@]}"; do
  if [[ -f "$file" ]] && grep -qE '^(VITE_API_URL|API_URL|BACKEND_URL|PUBLIC_URL|SERVER_IP)=' "$file"; then
    found_api=1
    replace_host "$file"
  fi
done

if [[ "$found_api" -eq 0 ]]; then
  echo -e "${YELLOW}VITE_API_URL belum ada. Menulis frontend/.env.production${NC}"
  printf 'VITE_API_URL=http://%s:%s\n' "$NEW_IP" "$BACKEND_PORT" > "$APP_DIR/frontend/.env.production"
fi

echo -e "${YELLOW}Membangun ulang frontend...${NC}"
cd "$APP_DIR/frontend"
npm run build

echo -e "${YELLOW}Me-restart layanan PM2 dan menyimpan daftar proses...${NC}"
cd "$APP_DIR"
pm2 restart all
pm2 save

echo -e "${GREEN}IP diperbarui ke ${NEW_IP}.${NC}"
echo -e "${GREEN}Buka aplikasi di http://${NEW_IP}:5174${NC}"
