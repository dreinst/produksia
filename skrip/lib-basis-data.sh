#!/usr/bin/env bash
# Pembantu bersama skrip cadangan/pemulihan basis data.
# Tidak untuk dijalankan langsung; di-"source" oleh cadangkan-basis-data.sh, pulihkan-basis-data.sh,
# dan verifikasi-cadangan.sh.
#
# Tugasnya: menemukan biner PostgreSQL, membaca DATABASE_URL dari .env, dan menyusun URL untuk
# basis data lain (dipakai saat memulihkan ke basis data uji yang terpisah).

set -euo pipefail

AKAR_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

pesan() { printf '%s\n' "$*"; }
galat() {
  printf 'GALAT: %s\n' "$*" >&2
  exit 1
}

# --- Biner PostgreSQL -------------------------------------------------------
# pg_dump/pg_restore/psql tidak selalu ada di PATH (mis. Postgres.app di macOS menaruhnya di dalam
# bundel aplikasi). Cari di PATH dulu, lalu di lokasi lazim.
temukan_bin_pg() {
  if command -v pg_dump >/dev/null 2>&1; then
    dirname "$(command -v pg_dump)"
    return 0
  fi
  local kandidat=(
    /Applications/Postgres.app/Contents/Versions/latest/bin
    /opt/homebrew/opt/postgresql@18/bin
    /opt/homebrew/opt/postgresql@17/bin
    /opt/homebrew/opt/postgresql@16/bin
    /opt/homebrew/opt/libpq/bin
    /usr/local/opt/libpq/bin
    /usr/lib/postgresql/18/bin
    /usr/lib/postgresql/17/bin
    /usr/lib/postgresql/16/bin
  )
  local d
  for d in "${kandidat[@]}"; do
    if [ -x "$d/pg_dump" ]; then
      printf '%s' "$d"
      return 0
    fi
  done
  return 1
}

BIN_PG="${BIN_PG:-$(temukan_bin_pg || true)}"
[ -n "$BIN_PG" ] || galat "pg_dump tidak ditemukan. Pasang PostgreSQL client, atau jalankan dengan BIN_PG=/path/ke/bin"
export PATH="$BIN_PG:$PATH"

# --- DATABASE_URL dari .env -------------------------------------------------
# Diambil dengan cara yang sama seperti aplikasi (prisma7.config.ts & src/lib/db.ts memakai
# process.env.DATABASE_URL yang dimuat dotenv dari .env di akar repo).
baca_database_url() {
  if [ -n "${DATABASE_URL:-}" ]; then
    printf '%s' "$DATABASE_URL"
    return 0
  fi
  local berkas="$AKAR_REPO/.env"
  [ -f "$berkas" ] || galat "DATABASE_URL tidak diset dan $berkas tidak ada"
  local nilai
  nilai="$(grep -E '^[[:space:]]*DATABASE_URL[[:space:]]*=' "$berkas" | tail -n 1 | sed -E 's/^[[:space:]]*DATABASE_URL[[:space:]]*=[[:space:]]*//')"
  # buang tanda kutip dan komentar di belakang nilai
  nilai="${nilai%\"}"
  nilai="${nilai#\"}"
  nilai="${nilai%\'}"
  nilai="${nilai#\'}"
  [ -n "$nilai" ] || galat "DATABASE_URL kosong di $berkas"
  printf '%s' "$nilai"
}

# DATABASE_URL Prisma boleh memuat parameter yang TIDAK dikenal libpq (schema, connection_limit,
# pgbouncer, dst.); pg_dump/psql menolak URL seperti itu. Fungsi ini membuang parameter khusus
# Prisma dan mempertahankan yang memang dipahami libpq (sslmode, sslrootcert, connect_timeout, ...).
url_libpq() {
  local url="$1"
  case "$url" in
  *\?*) ;;
  *)
    printf '%s' "$url"
    return 0
    ;;
  esac
  local dasar="${url%%\?*}" query="${url#*\?}" sisa="" p nama
  local IFS='&'
  for p in $query; do
    nama="${p%%=*}"
    case "$nama" in
    schema | connection_limit | pool_timeout | pgbouncer | statement_cache_size | socket_timeout | connect_timeout_ms) continue ;;
    esac
    [ -n "$p" ] || continue
    sisa="${sisa:+$sisa&}$p"
  done
  printf '%s%s' "$dasar" "${sisa:+?$sisa}"
}

# Nama basis data dari URL (bagian setelah "/" terakhir, tanpa query string).
nama_basis_data() {
  local url="$1"
  local tanpa_query="${url%%\?*}"
  printf '%s' "${tanpa_query##*/}"
}

# URL yang sama tetapi menunjuk basis data lain (untuk memulihkan ke basis data uji).
url_untuk_basis_data() {
  local url="$1" db_baru="$2"
  local query=""
  case "$url" in
  *\?*) query="?${url#*\?}" ;;
  esac
  local tanpa_query="${url%%\?*}"
  printf '%s/%s%s' "${tanpa_query%/*}" "$db_baru" "$query"
}

# Menolak URL yang jelas bukan basis data lokal: skrip ini SENGAJA hanya untuk pengembangan lokal.
# Cadangan produksi/VPS dijalankan terpisah dengan persetujuan pemilik (lihat DOKUMENTASI-PERSETUJUAN-KURS-BACKUP.md).
pastikan_lokal() {
  local url="$1"
  case "$url" in
  *@localhost[:/]* | *@127.0.0.1[:/]* | *@\[::1\][:/]* | *@localhost | *@127.0.0.1)
    return 0
    ;;
  esac
  # tanpa bagian "user@host" berarti socket lokal
  case "$url" in
  postgresql://localhost* | postgres://localhost* | postgresql:///* | postgres:///*)
    return 0
    ;;
  esac
  galat "DATABASE_URL menunjuk host non-lokal ($url). Skrip ini hanya untuk basis data pengembangan lokal. Set IZINKAN_NON_LOKAL=1 kalau Anda memang tahu apa yang dikerjakan."
}

DIR_CADANGAN="${DIR_CADANGAN:-$AKAR_REPO/cadangan}"
DB_UJI_PEMULIHAN="${DB_UJI_PEMULIHAN:-produksia_restore_test}"
