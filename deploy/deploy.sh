#!/usr/bin/env bash
# Memperbarui Produksia di server (dijalankan sebagai pengguna `produksia`, juga oleh GitHub Actions):
# tarik kode terbaru, pasang dependensi, build (migrasi basis data otomatis lewat prebuild),
# salin aset ke keluaran standalone, restart layanan, lalu cek kesehatan.
set -euo pipefail
cd "$(dirname "$0")/.."
CABANG="${CABANG:-main}"

echo "== Tarik kode ($CABANG)"
git fetch --quiet origin "$CABANG"
git reset --quiet --hard "origin/$CABANG"
git log -1 --format='%h %s'

echo "== Dependensi"
npm ci --no-audit --no-fund --loglevel=error

echo "== Build (migrasi + generate + next build)"
npm run build

echo "== Aset standalone"
rm -rf .next/standalone/public .next/standalone/.next/static
cp -r public .next/standalone/public
cp -r .next/static .next/standalone/.next/static

if systemctl is-enabled --quiet produksia 2>/dev/null; then
  echo "== Restart layanan"
  sudo -n systemctl restart produksia
  for i in $(seq 1 20); do
    if curl -fsS http://127.0.0.1:3000/api/sehat >/dev/null 2>&1; then echo "Sehat setelah ${i}x cek."; exit 0; fi
    sleep 1
  done
  echo "Layanan tidak menjawab di /api/sehat. Lihat: journalctl -u produksia -n 100" >&2
  exit 1
fi
echo "Build selesai (layanan belum terdaftar; jalankan deploy/pasang-server.sh untuk memasangnya)."
