#!/usr/bin/env bash
# Backup harian basis data Produksia: pg_dump format custom (terkompresi) ke /srv/produksia/backup,
# simpan 30 hari terakhir. Bila /srv/produksia/backup.env berisi RCLONE_REMOTE (mis. "gdrive:produksia-backup"),
# berkas juga disalin ke sana dengan rclone.
set -euo pipefail
DIR=/srv/produksia
TUJUAN="$DIR/backup"
mkdir -p "$TUJUAN"
set -a; [ -f "$DIR/app/.env" ] && . "$DIR/app/.env"; [ -f "$DIR/backup.env" ] && . "$DIR/backup.env"; set +a
BERKAS="$TUJUAN/produksia-$(date +%Y%m%d-%H%M).dump"
pg_dump --dbname="${DATABASE_URL%%\?*}" --format=custom --file="$BERKAS"
find "$TUJUAN" -name 'produksia-*.dump' -mtime +30 -delete
echo "backup: $BERKAS ($(du -h "$BERKAS" | cut -f1))"
if [ -n "${RCLONE_REMOTE:-}" ] && command -v rclone >/dev/null; then
  rclone copy "$BERKAS" "$RCLONE_REMOTE" --quiet && echo "disalin ke $RCLONE_REMOTE"
fi
