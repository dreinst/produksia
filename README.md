# Accurate Copy

Aplikasi internal penjualan, pembelian & persediaan, dibangun mengikuti alur modul Accurate 5:
- **Penjualan**: Penawaran → Pesanan → Pengiriman → Faktur → Penerimaan → Retur
- **Pembelian**: Pesanan → Penerimaan Barang → Faktur → Pembayaran → Retur (mirror dari Penjualan)
- **Buku Besar & Kas/Bank**: Daftar Akun, Jurnal Umum, Buku Besar (saldo berjalan per akun), Neraca Saldo, Kas Masuk/Keluar
- **Aset Tetap**: Daftar Aset (dengan nilai buku), Penyusutan garis lurus bulanan otomatis + posting jurnal

## Menjalankan

1. Pastikan PostgreSQL lokal jalan: `~/Cooking/PostgreSQL/pgctl.sh awal`
2. `npm install`
3. `npm run dev` lalu buka http://localhost:3000

Database: `accurate_copy`, koneksi diatur lewat `.env` (`DATABASE_URL`).

## Data dummy

- `npx tsx prisma/reset.ts` — hapus semua data (transaksi + master data)
- `npx tsx prisma/seed.ts` — isi 1 alur cerita tunggal yang melewati SEMUA tahap siklus Penjualan DAN Pembelian (15 tahap total: Penawaran draft → dikonversi → Pesanan → 2x Pengiriman parsial → Faktur → 2x Penerimaan cicilan → Retur, lalu restock: Pesanan Pembelian → 2x Penerimaan Barang parsial → Faktur → 2x Pembayaran cicilan → Retur), supaya tiap halaman langsung punya contoh data yang saling terhubung dan bisa ditelusuri dari awal sampai akhir.

**Penting:** setiap kali `prisma/schema.prisma` berubah dan kamu migrate, **restart dev server** (`npm run dev`) — Turbopack tidak otomatis reload Prisma Client yang sudah ter-generate ulang, nanti errornya "Cannot read properties of undefined (reading 'findMany')".

Jalankan reset lalu seed kalau mau mulai bersih lagi.

## Pola yang wajib diikuti saat menambah fitur

- **Form → `<FormulirAksi action={xxxForm}>`**, bukan `<form action={xxx}>`. Setiap server action punya dua versi: `xxx(dataFormulir)` (melempar error, dipakai skrip regresi) dan `xxxForm(sebelumnya, dataFormulir)` (membungkus dengan `jalankanFormulir`, mengembalikan `{ error }`). Alasannya: di production Next.js menyamarkan error yang di-throw dari server action, jadi pesan validasi hanya bisa sampai ke user kalau **dikembalikan** sebagai keadaan. Lihat `src/lib/statusFormulir.ts`, `src/komponen/FormulirAksi.tsx`.
- **Nomor dokumen → `nomorDokumenBerikutnya(db.model, "PREFIX")`** (`src/lib/penomoran.ts`), jangan `count()+1`.
- **Uang & qty → `Prisma.Decimal`** lewat helper `src/lib/uang.ts` (`uang()`, `jumlahkan()`, `kali()`, `bacaUang()`), jangan `Number()` untuk nilai yang disimpan/dibandingkan.
- **Mengurangi stok → `kurangiStok()`** (`src/lib/stok.ts`), yang mengecek ketersediaan; DB juga punya `CHECK (qty >= 0)`.
- Skrip regresi: `skrip/uji-penjualan*.ts` (5 suite) — jalankan semua sebelum commit: `for s in skrip/uji-penjualan*.ts; do npx tsx $s; done`.
- **Tabel** dibungkus `<div className="overflow-x-auto ...">`, form pakai `grid-cols-1 md:grid-cols-2`, elemen lebar penuh pakai `md:col-span-2`.
- Hasil audit lengkap & daftar pekerjaan yang masih terbuka: lihat `AUDIT.md`.

## Desain (Precision Ledger)

UI mengikuti design system dari paket Stitch (`stitch_creative_architecture_portfolio.zip` di folder induk — tidak ikut repo). Aturan praktisnya:

- Pakai **kelas komponen** di `src/app/globals.css`, bukan utility lepas: `kartu`, `kartu-tabel` + `bungkus-tabel`, `tombol tombol-utama|accent|outline|soft|danger`, `isian`/`isian-kecil`, `label`, `petunjuk`, `bidang`, `tabel`/`tabel-polos`, `lencana lencana-emerald|amber|rose|slate|blue`, `angka` (angka, rata kanan), `mono`, `teks-label`.
- Nomor dokumen → `<NomorDokumen no=…/>`, status → `<LencanaStatus status=…/>`, ikon → `<Ikon nama="…"/>` (nama dari fonts.google.com/icons).
- Halaman baru: judul dengan `KepalaHalaman` (breadcrumb + lencana + aksi), konten dalam `kartu`, tabel dalam `kartu kartu-tabel`.
- Font teks dari `next/font/google` (Inter, Hanken Grotesk, JetBrains Mono); ikon Material Symbols self-hosted di `src/app/fonts/`.

## Kode dokumen (semua singkatan Indonesia)

| Kode | Dokumen | | Kode | Dokumen |
|---|---|---|---|---|
| PNW | Penawaran Penjualan | | PSB | Pesanan Pembelian |
| PSJ | Pesanan Penjualan | | TB | Terima Barang (Penerimaan Barang) |
| SJ | Surat Jalan (Pengiriman) | | FB | Faktur Pembelian |
| FJ | Faktur Penjualan | | BYR | Pembayaran Pembelian |
| TRM | Penerimaan (uang masuk) | | RB | Retur Pembelian |
| RJ | Retur Penjualan | | JU · KM · KK | Jurnal Umum · Kas Masuk · Kas Keluar |
| AT | Aset Tetap | | JU-FJ, JU-TRM, JU-RJ, JU-FB, JU-BYR, JU-RB, JU-PNY | Jurnal otomatis dari dokumen terkait |

Label status yang tampil juga Indonesia (Draf, Sebagian, Diproses, Lunas, Dikonversi, Dibatalkan, Tercatat) — nilai internalnya di database tetap kode teknis (`DRAF`, `LUNAS`, …), dipetakan di `src/komponen/ui/Lencana.tsx`.

## Struktur

- `prisma/schema.prisma` — seluruh model data (master data + siklus penjualan + siklus pembelian)
- `src/lib/aksi/dataInduk.ts` — CRUD generik untuk semua entitas master data
- `src/lib/aksi/penjualan.ts` — logika bisnis siklus penjualan (transaksi, potong/tambah stok, perubahan status dokumen)
- `src/lib/aksi/pembelian.ts` — logika bisnis siklus pembelian (mirror dari penjual.ts: stok bertambah saat terima, berkurang saat retur)
- `src/app/data-induk/[entitas]` — satu halaman generik untuk semua master data (dikonfigurasi di `src/lib/konfigurasiDataInduk.ts`)
- `src/app/penjualan/*` — halaman per tahap siklus penjualan
- `src/app/pembelian/*` — halaman per tahap siklus pembelian
- `skrip/uji-penjualan.ts` — regresi siklus Penjualan (penawaran → pesanan → pengiriman parsial & penuh → faktur → penerimaan parsial & penuh → return)
- `skrip/uji-pembelian.ts` — regresi siklus Pembelian (pesanan → penerimaan parsial & penuh → faktur → pembayaran parsial & penuh → return)

## Alur kerja

1. Buat **Pelanggan**, **Barang**, **Gudang** di Data Induk, lalu isi stok awal lewat Prisma Studio (`npx prisma studio`) — belum ada halaman "Penyesuaian Persediaan" untuk stok awal.
2. Buat **Penawaran Penjualan** (opsional) → konversi jadi **Pesanan Penjualan**, atau langsung buat Pesanan.
3. Dari daftar Pesanan, klik **Kirim** untuk membuat Pengiriman (stok otomatis berkurang) — bisa dicicil (parsial).
4. Dari daftar Pesanan, klik **Fakturkan** untuk membuat Faktur.
5. Dari daftar Faktur, klik **Terima Bayar** untuk mencatat pelunasan (bisa dicicil), atau **Retur** untuk mengembalikan barang (stok otomatis bertambah).

## Keputusan & batasan yang perlu diketahui

Karena diminta lanjut tanpa konfirmasi bertahap, berikut keputusan yang saya ambil sendiri dan hal yang **belum** dikerjakan:

- **Jurnal Penjualan/Pembelian OTOMATIS** (per permintaan). Faktur Penjualan/Pembelian, Penerimaan, Pembayaran, dan Retur sekarang otomatis membuat jurnal via `src/lib/akuntansi.ts`, menggunakan pemetaan akun yang diatur di **Pengaturan > Pemetaan Akun** (`/pengaturan/pemetaan-akun`). **Wajib diisi dulu** sebelum bisa membuat Faktur/Penerimaan/Pembayaran/Retur — kalau belum, sistem menolak dengan pesan jelas. Aturan yang dipakai: Faktur Penjualan → Dr Piutang/Cr Pendapatan + Dr HPP/Cr Persediaan (kalau ada cost). Penerimaan → Dr Kas-Bank pilihan/Cr Piutang. Retur Penjualan → kebalikannya. Faktur Pembelian → Dr Persediaan/Cr Utang. Pembayaran → Dr Utang/Cr Kas-Bank pilihan. Retur Pembelian → Dr Utang/Cr Persediaan.
  - Data dummy hasil `prisma/seed.ts` **tidak** melewati jalur ini (dibuat langsung ke database untuk kecepatan), jadi transaksi Penjualan/Pembelian di data dummy tidak otomatis muncul di Buku Besar — hanya 3 jurnal contoh manual (JU/KM/KK) yang sengaja ditambahkan untuk demo Buku Besar.
- **Aset Tetap: hanya metode garis lurus (straight-baris)**, tidak ada metode saldo menurun (saldo menurun). Pencatatan **perolehan** aset TIDAK otomatis membuat jurnal (Dr Aset/Cr Kas atau Utang) — asumsinya sudah dicatat manual lewat Jurnal Umum atau Kas Keluar saat beli. Belum ada fitur "pelepasan/penjualan aset" (disposal) yang menghitung untung/rugi.
- **Belum ada login/otorisasi.** Model `Pengguna` & `PeranPengguna` sudah ada di schema tapi belum dipakai — semua halaman bisa diakses siapa saja. Wajib ditambahkan sebelum dipakai multi-user beneran.
- **Belum ada halaman edit** untuk master data maupun dokumen transaksi — saat ini hanya tambah & hapus. Hapus dokumen transaksi yang sudah diproses juga belum dibatasi (idealnya faktur yang sudah `LUNAS` tidak boleh dihapus).
- **Belum ada Penyesuaian Persediaan / Pindah Barang** (ada di diagram Accurate asli) — untuk sekarang stok awal harus diisi manual lewat Prisma Studio.
- **Perhitungan uang pakai `Number` di sisi aplikasi**, bukan aritmatika desimal presisi tinggi — cukup untuk skala UMKM tapi berisiko untuk angka sangat besar/presisi tinggi. Kolom database tetap `Decimal(18,2)`.
- **Nomor dokumen** (`PNW-2026-0001` dst.) dihitung dari jumlah baris yang ada — cukup aman untuk pemakaian satu-persatu, tapi berpotensi bentrok kalau dua orang submit persis bersamaan (race condition). Belum kritikal untuk tim kecil, tapi perlu diperbaiki (pakai sequence DB) sebelum dipakai dengan banyak kasir sekaligus.
- **Prisma versi 7.10.0** dipakai sengaja (bukan 8.0 beta terbaru yang ternyata CLI platform cloud Prisma, bukan ORM lokal biasa).
