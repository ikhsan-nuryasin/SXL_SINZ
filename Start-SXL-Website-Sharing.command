#!/bin/sh
set -eu
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js tidak ditemukan. Untuk pemakaian biasa, gunakan aplikasi SXL Localhost (.dmg/.pkg)."
  echo "Untuk menjalankan mode pengembangan: pasang Node.js 22+ dan jalankan npm install."
  read -r -p "Tekan Enter untuk menutup..." _
  exit 1
fi
npm run app
