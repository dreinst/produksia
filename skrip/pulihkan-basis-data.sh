#!/usr/bin/env bash
# Memulihkan berkas cadangan ke basis data UJI yang TERPISAH (bawaan: produksia_restore_test).
#
#   skrip/pulihkan-basis-data.sh                          # pakai cadangan terakhir
#   skrip/pulihkan-basis-data.sh cadangan/produksia-....dump
#   DB_UJI_PEMULIHAN=produksia_coba skrip/pulihkan-basis-data.sh <berkas>
#
# Basis data tujuan DIBUAT ULANG dari nol setiap kali (drop lalu create), jadi hasil pemulihan
# selalu bersih. Skrip ini MENOLAK memulihkan ke basis data pengembangan yang dipakai aplikasi,
# supaya tidak pernah menimpa data kerja: itu pemisahan yang membuat uji pemulihan aman dijalankan
# kapan saja, termasuk lewat cron.

set -euo pipefail
# shellcheck source=skrip/lib-basis-data.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib-basis-data.sh"

BERKAS="${1:-}"
if [ -z "$BERKAS" ]; then
  [ -f "$DIR_CADANGAN/.cadangan-terakhir" ] || galat "Tidak ada berkas cadangan yang diberikan dan $DIR_CADANGAN/.cadangan-terakhir belum ada. Jalankan skrip/cadangkan-basis-data.sh lebih dulu."
  BERKAS="$(cat "$DIR_CADANGAN/.cadangan-terakhir")"
fi
[ -f "$BERKAS" ] || galat "Berkas cadangan tidak ditemukan: $BERKAS"

URL="$(baca_database_url)"
[ "${IZINKAN_NON_LOKAL:-0}" = "1" ] || pastikan_lokal "$URL"
NAMA_DB_SUMBER="$(nama_basis_data "$URL")"

[ "$DB_UJI_PEMULIHAN" != "$NAMA_DB_SUMBER" ] ||
  galat "DB_UJI_PEMULIHAN ($DB_UJI_PEMULIHAN) sama dengan basis data pengembangan. Pemulihan harus ke basis data terpisah."

URL_UJI="$(url_libpq "$(url_untuk_basis_data "$URL" "$DB_UJI_PEMULIHAN")")"
# psql butuh basis data yang pasti ada untuk menjalankan DROP/CREATE DATABASE
URL_ADMIN="$(url_libpq "$(url_untuk_basis_data "$URL" "postgres")")"

pesan "== Pemulihan cadangan ke basis data uji =="
pesan "Berkas       : $BERKAS"
pesan "Basis data   : $DB_UJI_PEMULIHAN (dibuat ulang; basis data pengembangan '$NAMA_DB_SUMBER' tidak disentuh)"
pesan "pg_restore   : $(pg_restore --version)"

psql --quiet --no-psqlrc "$URL_ADMIN" -c "DROP DATABASE IF EXISTS \"$DB_UJI_PEMULIHAN\" WITH (FORCE);" >/dev/null
psql --quiet --no-psqlrc "$URL_ADMIN" -c "CREATE DATABASE \"$DB_UJI_PEMULIHAN\";" >/dev/null
pesan "Basis data uji dibuat ulang."

# --no-owner & --no-acl: objek jadi milik pengguna yang memulihkan.
# Keluaran pg_restore ditahan dulu; hanya ditampilkan bila ada masalah.
LOG_PULIH="$(mktemp)"
if pg_restore --no-owner --no-acl --exit-on-error --dbname="$URL_UJI" "$BERKAS" >"$LOG_PULIH" 2>&1; then
  pesan "Pemulihan selesai tanpa galat."
else
  pesan "Pemulihan GAGAL:"
  cat "$LOG_PULIH" >&2
  rm -f "$LOG_PULIH"
  exit 1
fi
rm -f "$LOG_PULIH"

JUMLAH_TABEL="$(psql --quiet --no-psqlrc --tuples-only --no-align "$URL_UJI" -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';")"
pesan "Tabel di basis data uji: $JUMLAH_TABEL"
pesan ""
pesan "Lanjutkan dengan pemeriksaan keutuhan: skrip/verifikasi-cadangan.sh \"$BERKAS\""
