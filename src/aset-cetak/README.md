# Aset cetak bawaan

Font dan gambar yang dibaca mesin PDF (`src/lib/cetak/aset.ts`) saat merender dokumen. Folder ini ikut `.next/standalone`
lewat `outputFileTracingIncludes` di `next.config.ts`, jadi jangan dipindah tanpa mengubah konfigurasi itu.

## Isi

| Folder | Isi | Sumber |
|---|---|---|
| `font/` | Carlito Regular, Bold, Italic, BoldItalic, dan `OFL.txt` | generator dokumen D'Pro (`dpro-docgen/fonts/`), lisensi SIL OFL 1.1 |
| `dpro/` | `kop`, `kaki`, `watermark`, `judul-invoice`, `label-pembayaran`, `label-salam` | `dpro-docgen/assets/`, desain Figma FieLBHqlbxXYcpx2pQBYaV (862:2 invoice, 891:318 proposal) |
| `tapussa/` | `kop`, `logo`, `kaki`, `judul-invoice`, `judul-kwitansi` | `dpro-docgen/assets/kw/tapussa-*` |
| `bonanova/` | `logo`, `watermark` | `dpro-docgen/assets/kw/bonanova-*` |
| `sahara/` | `logo` (garis pemisah digambar mesin, tanpa PNG) | `dpro-docgen/assets/kw/sahara-logo.png` |
| `nawasena/` | `kop`, `judul-invoice`, `judul-kwitansi` | `dpro-docgen/assets/kw/nawasena-*` |

Nama berkas mengikuti slot `JenisAsetKop` dalam huruf kecil dengan tanda hubung (`KOP` = `kop.png`, `JUDUL_INVOICE` =
`judul-invoice.png`), dan nama folder mengikuti `GayaEntitas` dalam huruf kecil. Font Carlito tersalin utuh; SHA-256-nya
dicatat di rancangan D3 §1.4 dan diperiksa `skrip/uji-mesin-cetak.ts`.

Email di `dpro/kop.png` dan `dpro/kaki.png` sudah diganti menjadi `office@dpro.events`. Teks email lama ditimpa warna
latarnya, lalu email baru ditulis dengan Montserrat Medium (SIL OFL 1.1, sama dengan teks lain di kedua gambar): 34 px
di kop dan 28,4 px di kaki pada lebar 2480 px. Di kaki, `| @dpro.duction` tidak bergeser dan email baru berakhir di titik
yang sama dengan email lama. Font Montserrat tidak disalin ke repo karena hanya dipakai untuk menggambar ulang PNG.

## Larangan

Jangan pernah menaruh tanda tangan, cap atau stempel, KTP, maupun NPWP di folder ini. Folder ini masuk repo dan image
Docker, sehingga siapa pun yang punya akses kode bisa mengambilnya. Gambar seperti itu diunggah lewat Pengaturan, Kop &
Template, lalu disimpan privat sebagai `Berkas` dan hanya dibubuhkan untuk pemegang hak yang sesuai. Uji
`uji-mesin-cetak.ts` gagal bila ada berkas bernama `ttd`, `cap`, `ktp`, atau `npwp` di sini.

Gambar baru wajib PNG atau JPEG yang lolos `periksaGambar()`. PNG rusak bisa mematikan proses server saat dicetak.
