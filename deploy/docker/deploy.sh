#!/usr/bin/env bash
# Memperbarui Produksia di server Docker/Coolify: tarik kode, build image, jalankan migrasi, ganti kontainer
# tanpa menyentuh data (volume produksia-db), lalu cek /api/sehat dari dalam jaringan.
set -euo pipefail
cd "$(dirname "$0")/../.."
CABANG="${CABANG:-main}"
[ -f .env.docker ] || { echo "Belum ada .env.docker (salin dari .env.docker.example)"; exit 1; }

echo "== Tarik kode ($CABANG)"
git fetch --quiet origin "$CABANG"
git reset --quiet --hard "origin/$CABANG"
git log -1 --format='%h %s'

echo "== Build & jalankan (migrasi otomatis)"
docker compose --env-file .env.docker up -d --build --remove-orphans

echo "== Cek kesehatan"
for i in $(seq 1 30); do
  if docker compose --env-file .env.docker exec -T app wget -qO- http://127.0.0.1:3000/api/sehat 2>/dev/null | grep -q '"ok":true'; then
    echo "Sehat setelah ${i}x cek."
    docker image prune -f >/dev/null
    exit 0
  fi
  sleep 2
done
echo "Aplikasi belum sehat. Lihat: docker compose --env-file .env.docker logs --tail=100 app migrasi" >&2
exit 1
