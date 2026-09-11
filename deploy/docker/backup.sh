#!/usr/bin/env bash
# Backup harian basis data Produksia (kontainer): pg_dump format custom ke <dir app>/backup, simpan 30 hari.
# Pasang di cron root: 30 2 * * * /data/produksia/app/deploy/docker/backup.sh >> /var/log/produksia-backup.log 2>&1
# Bila RCLONE_REMOTE diisi di .env.docker (mis. gdrive:produksia-backup), berkas juga disalin dengan rclone.
set -euo pipefail
cd "$(dirname "$0")/../.."
TUJUAN="$PWD/backup"
mkdir -p "$TUJUAN"
set -a; . ./.env.docker; set +a
BERKAS="$TUJUAN/produksia-$(date +%Y%m%d-%H%M).dump"
docker compose --env-file .env.docker exec -T db pg_dump -U produksia -d produksia --format=custom > "$BERKAS"
find "$TUJUAN" -name 'produksia-*.dump' -mtime +30 -delete
echo "$(date '+%F %T') backup: $BERKAS ($(du -h "$BERKAS" | cut -f1))"
if [ -n "${RCLONE_REMOTE:-}" ] && command -v rclone >/dev/null; then
  rclone copy "$BERKAS" "$RCLONE_REMOTE" --quiet && echo "disalin ke $RCLONE_REMOTE"
fi
