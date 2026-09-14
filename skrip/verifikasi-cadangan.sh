#!/usr/bin/env bash
# Membuktikan sebuah cadangan BENAR-BENAR bisa dipulihkan dan datanya utuh.
#
#   skrip/verifikasi-cadangan.sh                          # verifikasi cadangan terakhir
#   skrip/verifikasi-cadangan.sh cadangan/produksia-....dump
#
# Langkahnya: pulihkan cadangan ke basis data uji terpisah (skrip/pulihkan-basis-data.sh), lalu
# bandingkan hasilnya dengan basis data sumber. Yang diperiksa:
#
#   1. Jumlah baris tabel kunci SAMA antara sumber dan hasil pemulihan
#      (Pengguna, Akun, Jurnal, BarisJurnal, FakturPenjualan, FakturPembelian, StokBarang, LogAktivitas)
#   2. Total debit = total kredit di BarisJurnal hasil pemulihan (buku besar tetap seimbang)
#   3. Tidak ada jurnal yang barisnya hilang (setiap Jurnal punya minimal 1 BarisJurnal)
#   4. Tidak ada BarisJurnal yatim (jurnalId/akunId menunjuk baris yang tidak ada)
#   5. Nilai debit/kredit tidak ada yang negatif
#
# "Perintah selesai tanpa galat" TIDAK dianggap bukti. Yang dianggap bukti adalah angka-angka di
# atas cocok; itulah sebabnya perbandingannya dicetak apa adanya.

set -euo pipefail
# shellcheck source=skrip/lib-basis-data.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib-basis-data.sh"

BERKAS="${1:-}"
if [ -z "$BERKAS" ]; then
  [ -f "$DIR_CADANGAN/.cadangan-terakhir" ] || galat "Tidak ada berkas cadangan yang diberikan. Jalankan skrip/cadangkan-basis-data.sh lebih dulu."
  BERKAS="$(cat "$DIR_CADANGAN/.cadangan-terakhir")"
fi

# Pulihkan dulu ke basis data uji
"$(dirname "${BASH_SOURCE[0]}")/pulihkan-basis-data.sh" "$BERKAS"

URL_MENTAH="$(baca_database_url)"
NAMA_DB_SUMBER="$(nama_basis_data "$URL_MENTAH")"
URL="$(url_libpq "$URL_MENTAH")"
URL_UJI="$(url_libpq "$(url_untuk_basis_data "$URL_MENTAH" "$DB_UJI_PEMULIHAN")")"

kueri() { psql --quiet --no-psqlrc --tuples-only --no-align "$1" -c "$2"; }

TABEL_KUNCI=(Pengguna Akun Jurnal BarisJurnal FakturPenjualan FakturPembelian StokBarang LogAktivitas)
GAGAL=0
lolos() { pesan "  [ok]   $*"; }
tidak() {
  pesan "  [GAGAL] $*"
  GAGAL=1
}

pesan ""
pesan "== Verifikasi cadangan =="
pesan "Sumber : $NAMA_DB_SUMBER"
pesan "Salinan: $DB_UJI_PEMULIHAN"
pesan ""
pesan "1. Jumlah baris tabel kunci"
printf '  %-20s %12s %12s\n' "TABEL" "SUMBER" "PULIHAN"
for t in "${TABEL_KUNCI[@]}"; do
  a="$(kueri "$URL" "SELECT count(*) FROM \"$t\";")"
  b="$(kueri "$URL_UJI" "SELECT count(*) FROM \"$t\";")"
  printf '  %-20s %12s %12s' "$t" "$a" "$b"
  if [ "$a" = "$b" ]; then
    printf '  cocok\n'
  else
    printf '  BEDA\n'
    GAGAL=1
  fi
done

pesan ""
pesan "2. Keseimbangan buku besar di salinan hasil pemulihan"
SALDO="$(kueri "$URL_UJI" "SELECT COALESCE(sum(debit),0)::text || '|' || COALESCE(sum(kredit),0)::text || '|' || COALESCE(sum(debit)-sum(kredit),0)::text FROM \"BarisJurnal\";")"
DEBIT="${SALDO%%|*}"
SISA="${SALDO#*|}"
KREDIT="${SISA%%|*}"
SELISIH="${SISA#*|}"
pesan "  debit  = $DEBIT"
pesan "  kredit = $KREDIT"
if [ "$(kueri "$URL_UJI" "SELECT abs(COALESCE(sum(debit)-sum(kredit),0)) <= 0.005 FROM \"BarisJurnal\";")" = "t" ]; then
  lolos "debit = kredit (selisih $SELISIH)"
else
  tidak "buku besar TIDAK seimbang (selisih $SELISIH)"
fi

pesan ""
pesan "3. Keutuhan relasi di salinan hasil pemulihan"
JURNAL_TANPA_BARIS="$(kueri "$URL_UJI" "SELECT count(*) FROM \"Jurnal\" j WHERE NOT EXISTS (SELECT 1 FROM \"BarisJurnal\" b WHERE b.\"jurnalId\" = j.id);")"
[ "$JURNAL_TANPA_BARIS" = "0" ] && lolos "setiap Jurnal punya baris (0 jurnal kosong)" || tidak "$JURNAL_TANPA_BARIS jurnal tanpa baris"

BARIS_YATIM="$(kueri "$URL_UJI" "SELECT count(*) FROM \"BarisJurnal\" b WHERE NOT EXISTS (SELECT 1 FROM \"Jurnal\" j WHERE j.id = b.\"jurnalId\") OR NOT EXISTS (SELECT 1 FROM \"Akun\" a WHERE a.id = b.\"akunId\");")"
[ "$BARIS_YATIM" = "0" ] && lolos "tidak ada BarisJurnal yatim (jurnal & akunnya ada semua)" || tidak "$BARIS_YATIM BarisJurnal yatim"

NEGATIF="$(kueri "$URL_UJI" "SELECT count(*) FROM \"BarisJurnal\" WHERE debit < 0 OR kredit < 0;")"
[ "$NEGATIF" = "0" ] && lolos "tidak ada nilai debit/kredit negatif" || tidak "$NEGATIF baris bernilai negatif"

JUMLAH_TABEL_SUMBER="$(kueri "$URL" "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';")"
JUMLAH_TABEL_PULIH="$(kueri "$URL_UJI" "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';")"
[ "$JUMLAH_TABEL_SUMBER" = "$JUMLAH_TABEL_PULIH" ] &&
  lolos "jumlah tabel sama ($JUMLAH_TABEL_SUMBER)" ||
  tidak "jumlah tabel beda (sumber $JUMLAH_TABEL_SUMBER, pulihan $JUMLAH_TABEL_PULIH)"

pesan ""
if [ "$GAGAL" = "0" ]; then
  pesan "== CADANGAN TERVERIFIKASI: $BERKAS bisa dipulihkan dan datanya utuh =="
  exit 0
fi
pesan "== VERIFIKASI GAGAL untuk $BERKAS =="
exit 1
