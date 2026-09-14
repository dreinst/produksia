#!/usr/bin/env bash
# Mencadangkan basis data PENGEMBANGAN LOKAL Produksia dengan pg_dump format custom (-Fc).
#
#   skrip/cadangkan-basis-data.sh              # cadangkan ke cadangan/
#   skrip/cadangkan-basis-data.sh --pangkas    # cadangkan lalu buang cadangan lama sesuai retensi
#   DIR_CADANGAN=/Volumes/NAS/produksia skrip/cadangkan-basis-data.sh
#
# Format custom (-Fc) dipilih, bukan SQL biasa, karena: terkompresi, bisa dipulihkan sebagian
# (--table/--schema), dan pg_restore bisa memulihkan paralel (-j).
#
# Nama berkas: produksia-<nama-db>-YYYYmmdd-HHMMSS.dump (+ akhiran -mingguan pada hari Minggu).
#
# ----------------------------------------------------------------------------------------------
# JADWAL & RETENSI YANG DISARANKAN (SENGAJA TIDAK DIPASANG OTOMATIS)
#
# Retensi: cadangan harian disimpan 14 hari, cadangan mingguan (dibuat hari Minggu) 8 minggu.
# Pemangkasan hanya berjalan bila dipanggil dengan --pangkas.
#
# Saran entri cron (JANGAN dipasang tanpa persetujuan pemilik; lihat
# DOKUMENTASI-PERSETUJUAN-KURS-BACKUP.md):
#
#   # cadangan harian 02:00, sekaligus memangkas yang kedaluwarsa
#   0 2 * * * cd /path/ke/produksia && skrip/cadangkan-basis-data.sh --pangkas >> cadangan/cadangan.log 2>&1
#   # verifikasi cadangan terakhir tiap Senin 03:00 (pulihkan ke basis data uji lalu cek keutuhannya)
#   0 3 * * 1 cd /path/ke/produksia && skrip/verifikasi-cadangan.sh >> cadangan/verifikasi.log 2>&1
#
# Cadangan yang tidak pernah diuji pulih bukan cadangan. Karena itu ada langkah verifikasi
# terjadwal, bukan hanya dump.
# ----------------------------------------------------------------------------------------------

set -euo pipefail
# shellcheck source=skrip/lib-basis-data.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib-basis-data.sh"

PANGKAS=0
[ "${1:-}" = "--pangkas" ] && PANGKAS=1

URL="$(baca_database_url)"
[ "${IZINKAN_NON_LOKAL:-0}" = "1" ] || pastikan_lokal "$URL"
NAMA_DB="$(nama_basis_data "$URL")"

mkdir -p "$DIR_CADANGAN"
CAP="$(date +%Y%m%d-%H%M%S)"
AKHIRAN=""
# Hari Minggu (%u = 7) ditandai mingguan supaya retensinya lebih panjang
[ "$(date +%u)" = "7" ] && AKHIRAN="-mingguan"
BERKAS="$DIR_CADANGAN/produksia-$NAMA_DB-$CAP$AKHIRAN.dump"

pesan "== Cadangan basis data Produksia =="
pesan "Basis data : $NAMA_DB"
pesan "pg_dump    : $(pg_dump --version)"
pesan "Tujuan     : $BERKAS"

# --no-owner & --no-acl: dump bisa dipulihkan ke basis data uji milik pengguna lain tanpa galat hak akses
pg_dump --format=custom --compress=9 --no-owner --no-acl --file="$BERKAS" "$(url_libpq "$URL")"

UKURAN="$(du -h "$BERKAS" | cut -f1)"
JUMLAH_TABEL="$(pg_restore --list "$BERKAS" | grep -c 'TABLE DATA' || true)"
pesan "Selesai    : $UKURAN, $JUMLAH_TABEL tabel berisi data"

if [ "$PANGKAS" = "1" ]; then
  pesan ""
  pesan "== Pemangkasan sesuai retensi (harian 14 hari, mingguan 8 minggu) =="
  # Harian: lebih tua dari 14 hari DAN bukan berkas mingguan
  HAPUS_HARIAN="$(find "$DIR_CADANGAN" -maxdepth 1 -name "produksia-*.dump" ! -name "*-mingguan.dump" -mtime +14 -print)"
  # Mingguan: lebih tua dari 56 hari (8 minggu)
  HAPUS_MINGGUAN="$(find "$DIR_CADANGAN" -maxdepth 1 -name "produksia-*-mingguan.dump" -mtime +56 -print)"
  if [ -z "$HAPUS_HARIAN$HAPUS_MINGGUAN" ]; then
    pesan "Tidak ada cadangan yang kedaluwarsa."
  else
    printf '%s\n' "$HAPUS_HARIAN" "$HAPUS_MINGGUAN" | grep -v '^$' | while read -r f; do
      pesan "hapus: $f"
      rm -f "$f"
    done
  fi
fi

pesan ""
pesan "Cadangan tersimpan. Uji pulihnya dengan: skrip/verifikasi-cadangan.sh \"$BERKAS\""
printf '%s\n' "$BERKAS" > "$DIR_CADANGAN/.cadangan-terakhir"
