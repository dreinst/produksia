#!/usr/bin/env bash
# Memangkas font ikon Material Symbols Outlined (variable font penuh ±3,9 MB) menjadi hanya ikon
# yang benar-benar dipakai di src/ (puluhan KB). Jalankan ulang setiap kali ada ikon baru.
#
# Butuh fonttools + brotli:  python3 -m pip install fonttools brotli
# Atau arahkan ke biner lain: PYFTSUBSET=/path/ke/pyftsubset skrip/subset-font-ikon.sh
set -euo pipefail
cd "$(dirname "$0")/.."

PYFTSUBSET="${PYFTSUBSET:-pyftsubset}"
SUMBER="${SUMBER:-${TMPDIR:-/tmp}/material-symbols-outlined.full.woff2}"
TUJUAN="src/app/fonts/material-symbols-outlined.woff2"
URL='https://github.com/google/material-design-icons/raw/master/variablefont/MaterialSymbolsOutlined%5BFILL%2CGRAD%2Copsz%2Cwght%5D.woff2'

if [ ! -f "$SUMBER" ]; then
  echo "Mengunduh font penuh ke $SUMBER …"
  curl -fsSL -o "$SUMBER" "$URL"
fi

# Ikon yang dipakai = nilai nama="…" (komponen <Ikon>), ikon="…" / ikon: "…" (prop & daftar menu),
# dan literal di dalam nama={a ? "x" : "y"}. Kalau ikon dikirim lewat nama prop lain, tambahkan polanya di sini.
IKON=$(
  {
    grep -rhoE 'nama="[a-z_0-9]+"' src
    grep -rhoE 'ikon="[a-z_0-9]+"' src
    grep -rhoE 'ikon: "[a-z_0-9]+"' src
    grep -rhoE 'nama=\{[^}]*\}' src | grep -oE '"[a-z_0-9]+"'
  } | grep -oE '[a-z_0-9]+' | sort -u
)
# Nama ikon → glyph lewat ligatur (fitur rlig/rclt); sebagian ikon punya varian "nama.fill" untuk sumbu FILL=1
GLYPHS=$(printf '%s\n' $IKON | sed 's/\(.*\)/\1,\1.fill/' | paste -sd, -)

"$PYFTSUBSET" "$SUMBER" \
  --glyphs="$GLYPHS" \
  --text="abcdefghijklmnopqrstuvwxyz_0123456789" \
  --layout-features=rlig,rclt \
  --no-layout-closure \
  --glyph-names \
  --ignore-missing-glyphs \
  --flavor=woff2 \
  --output-file="$TUJUAN"

echo "Ikon dipakai : $(printf '%s\n' $IKON | wc -l | tr -d ' ')"
echo "Hasil        : $TUJUAN ($(du -h "$TUJUAN" | cut -f1))"
