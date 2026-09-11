#!/usr/bin/env bash
# Menyiapkan direktori konfigurasi PgBouncer di server (sekali jalan, aman diulang):
# sertifikat TLS self-signed 10 tahun (SAN = IP server + nama sslip), userlist dari DB_PASSWORD di .env.docker,
# salinan pgbouncer.ini, izin berkas untuk uid pengguna di dalam image, lalu menulis nilai lingkungan untuk Vercel
# ke /data/produksia/vercel-env.txt (hanya root).
set -euo pipefail
cd "$(dirname "$0")/../.."
IP="${IP_SERVER:-$(curl -fsS --max-time 10 https://api.ipify.org || hostname -I | awk '{print $1}')}"
DIR="${PGBOUNCER_DIR:-/data/produksia/pgbouncer}"
IMAGE="${PGBOUNCER_IMAGE:-edoburu/pgbouncer:v1.25.2-p0}"
set -a; . ./.env.docker; set +a
mkdir -p "$DIR/tls"
if [ ! -f "$DIR/tls/server.crt" ]; then
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -sha256 \
    -keyout "$DIR/tls/server.key" -out "$DIR/tls/server.crt" \
    -subj "/CN=$IP/O=Produksia" -addext "subjectAltName=IP:$IP,DNS:produksia.$IP.sslip.io"
  echo "sertifikat TLS dibuat untuk $IP"
fi
cp deploy/pgbouncer/pgbouncer.ini "$DIR/pgbouncer.ini"
printf '"produksia" "%s"\n' "$DB_PASSWORD" > "$DIR/userlist.txt"
UID_PGB="$(docker run --rm --entrypoint id "$IMAGE" -u 2>/dev/null || echo 1100)"
chown -R "$UID_PGB" "$DIR"
chmod 755 "$DIR" "$DIR/tls"; chmod 644 "$DIR/pgbouncer.ini" "$DIR/tls/server.crt"; chmod 600 "$DIR/userlist.txt" "$DIR/tls/server.key"
docker compose --env-file .env.docker up -d pgbouncer
sleep 3
docker compose --env-file .env.docker ps pgbouncer --format "{{.Name}} | {{.Status}}"
CA_SATU_BARIS="$(awk 'NF {printf "%s\\n", $0}' "$DIR/tls/server.crt")"
KELUARAN=/data/produksia/vercel-env.txt
{
  echo "# Nilai Environment Variables untuk proyek Vercel (Production). Jangan bagikan berkas ini."
  echo "DATABASE_URL=postgresql://produksia:${DB_PASSWORD}@${IP}:6432/produksia?schema=public"
  echo "DATABASE_URL_MIGRASI=postgresql://produksia:${DB_PASSWORD}@${IP}:6432/produksia_migrasi?schema=public&sslmode=require&sslaccept=accept_invalid_certs"
  echo "DB_POOL_MAX=3"
  echo "ZONA_WAKTU=Asia/Jakarta"
  echo "DB_SSL_CA=${CA_SATU_BARIS}"
} > "$KELUARAN"
chmod 600 "$KELUARAN"
echo "nilai lingkungan Vercel ditulis ke $KELUARAN"
