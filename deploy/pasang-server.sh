#!/usr/bin/env bash
# Pasang Produksia di VPS Ubuntu 24.04 LTS yang masih kosong. Jalankan sebagai root, sekali saja
# (boleh diulang; skrip ini aman dijalankan lagi):
#   curl -fsSL https://raw.githubusercontent.com/dreinst/produksia/main/deploy/pasang-server.sh -o pasang.sh
#   bash pasang.sh produksia.contoh.id
# Hasil: Node 22, PostgreSQL 16, Caddy (HTTPS otomatis), pengguna sistem `produksia`, aplikasi di
# /srv/produksia/app sebagai layanan systemd di 127.0.0.1:3000, backup harian, firewall.
set -euo pipefail
DOMAIN="${1:-}"
[ -n "$DOMAIN" ] || { echo "pakai: bash pasang-server.sh <domain>"; exit 1; }
[ "$(id -u)" = "0" ] || { echo "jalankan sebagai root"; exit 1; }
REPO="${REPO:-https://github.com/dreinst/produksia.git}"
CABANG="${CABANG:-main}"
DIR=/srv/produksia
export DEBIAN_FRONTEND=noninteractive

echo "== 1/7 Paket sistem"
apt-get update -q
apt-get -y -q upgrade
apt-get -y -q install curl git ufw fail2ban openssl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https postgresql postgresql-contrib

echo "== 2/7 Node.js 22 LTS"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get -y -q install nodejs
fi
node -v

echo "== 3/7 Caddy"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q && apt-get -y -q install caddy
fi

echo "== 4/7 Pengguna sistem & basis data"
id -u produksia >/dev/null 2>&1 || useradd --system --create-home --home-dir "$DIR" --shell /bin/bash produksia
mkdir -p "$DIR/backup"
DBPASS=$(openssl rand -base64 36 | tr -d '/+=' | cut -c1-32)
sudo -u postgres psql -q -v ON_ERROR_STOP=1 -v pass="$DBPASS" <<'SQL'
SELECT 'CREATE ROLE produksia LOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'produksia')\gexec
ALTER ROLE produksia WITH LOGIN PASSWORD :'pass';
SELECT 'CREATE DATABASE produksia OWNER produksia' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'produksia')\gexec
SQL

echo "== 5/7 Kode aplikasi"
if [ ! -d "$DIR/app/.git" ]; then
  sudo -u produksia git clone --branch "$CABANG" "$REPO" "$DIR/app"
fi
ENVFILE="$DIR/app/.env"
touch "$ENVFILE"
grep -v '^DATABASE_URL=' "$ENVFILE" > "$ENVFILE.tmp" || true
{
  echo "DATABASE_URL=postgresql://produksia:${DBPASS}@127.0.0.1:5432/produksia?schema=public"
  grep -q '^DB_POOL_MAX=' "$ENVFILE.tmp" || echo "DB_POOL_MAX=10"
  grep -q '^ZONA_WAKTU=' "$ENVFILE.tmp" || echo "ZONA_WAKTU=Asia/Jakarta"
  grep -q '^TZ=' "$ENVFILE.tmp" || echo "TZ=Asia/Jakarta"
  cat "$ENVFILE.tmp"
} > "$ENVFILE"
rm -f "$ENVFILE.tmp"
chown -R produksia:produksia "$DIR"
chmod 600 "$ENVFILE"
timedatectl set-timezone Asia/Jakarta || true

echo "== 6/7 Layanan systemd, backup, sudoers, Caddy"
install -m 644 "$DIR/app/deploy/produksia.service" /etc/systemd/system/produksia.service
install -m 644 "$DIR/app/deploy/produksia-backup.service" /etc/systemd/system/produksia-backup.service
install -m 644 "$DIR/app/deploy/produksia-backup.timer" /etc/systemd/system/produksia-backup.timer
echo "produksia ALL=(root) NOPASSWD: /usr/bin/systemctl restart produksia, /usr/bin/systemctl status produksia, /usr/bin/systemctl is-active produksia" > /etc/sudoers.d/produksia
chmod 440 /etc/sudoers.d/produksia
sed "s/DOMAIN_PRODUKSIA/$DOMAIN/g" "$DIR/app/deploy/Caddyfile" > /etc/caddy/Caddyfile
mkdir -p /var/log/caddy && chown caddy:caddy /var/log/caddy
systemctl daemon-reload
systemctl enable produksia produksia-backup.timer >/dev/null

echo "== 7/7 Build pertama & jalankan"
sudo -u produksia -H bash "$DIR/app/deploy/deploy.sh"
systemctl restart produksia
systemctl start produksia-backup.timer
systemctl reload caddy || systemctl restart caddy
ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw --force enable >/dev/null
systemctl enable --now fail2ban >/dev/null

sleep 3
if curl -fsS http://127.0.0.1:3000/api/sehat >/dev/null; then
  echo
  echo "Selesai. Buka https://$DOMAIN (sertifikat HTTPS dibuat otomatis oleh Caddy setelah DNS mengarah ke server ini)."
  echo "Basis data masih kosong: halaman masuk akan menampilkan formulir pemasangan awal untuk membuat akun Pemilik pertama."
  echo "Kata sandi basis data tersimpan di $ENVFILE (hanya bisa dibaca root & produksia)."
else
  echo "Aplikasi belum menjawab. Lihat: journalctl -u produksia -n 100"
  exit 1
fi
