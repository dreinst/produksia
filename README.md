# Accurate Copy

Aplikasi internal penjualan, pembelian & persediaan, dibangun mengikuti alur modul Accurate 5:
- **Penjualan**: Penawaran → Pesanan → Pengiriman → Faktur → Penerimaan → Retur
- **Pembelian**: Pesanan → Penerimaan Barang → Faktur → Pembayaran → Retur (mirror dari Penjualan)
- **Buku Besar & Kas/Bank**: Daftar Akun, Jurnal Umum, Buku Besar (saldo berjalan per akun), Neraca Saldo, Kas Masuk/Keluar
- **Aset Tetap**: Daftar Aset (dengan nilai buku), Penyusutan garis lurus bulanan otomatis + posting jurnal

## Menjalankan

1. Pastikan PostgreSQL lokal jalan: `~/Cooking/PostgreSQL/pgctl.sh start`
2. `npm install`
3. `npm run dev` lalu buka http://localhost:3000

Database: `accurate_copy`, koneksi diatur lewat `.env` (`DATABASE_URL`).

## Data dummy

- `npx tsx prisma/reset.ts` — hapus semua data (transaksi + master data)
- `npx tsx prisma/seed.ts` — isi 1 alur cerita tunggal yang melewati SEMUA tahap siklus Penjualan DAN Pembelian (15 tahap total: Penawaran draft → dikonversi → Pesanan → 2x Pengiriman parsial → Faktur → 2x Penerimaan cicilan → Retur, lalu restock: Pesanan Pembelian → 2x Penerimaan Barang parsial → Faktur → 2x Pembayaran cicilan → Retur), supaya tiap halaman langsung punya contoh data yang saling terhubung dan bisa ditelusuri dari awal sampai akhir.

**Penting:** setiap kali `prisma/schema.prisma` berubah dan kamu migrate, **restart dev server** (`npm run dev`) — Turbopack tidak otomatis reload Prisma Client yang sudah ter-generate ulang, nanti errornya "Cannot read properties of undefined (reading 'findMany')".

Jalankan reset lalu seed kalau mau mulai bersih lagi.

## Pola yang wajib diikuti saat menambah fitur

- **Form → `<ActionForm action={xxxForm}>`**, bukan `<form action={xxx}>`. Setiap server action punya dua versi: `xxx(formData)` (melempar error, dipakai skrip regresi) dan `xxxForm(prev, formData)` (membungkus dengan `runForm`, mengembalikan `{ error }`). Alasannya: di production Next.js menyamarkan error yang di-throw dari server action, jadi pesan validasi hanya bisa sampai ke user kalau **dikembalikan** sebagai state. Lihat `src/lib/formState.ts`, `src/components/ActionForm.tsx`.
- **Nomor dokumen → `nextDocNumber(db.model, "PREFIX")`** (`src/lib/numbering.ts`), jangan `count()+1`.
- **Uang & qty → `Prisma.Decimal`** lewat helper `src/lib/money.ts` (`money()`, `sum()`, `mul()`, `parseMoney()`), jangan `Number()` untuk nilai yang disimpan/dibandingkan.
- **Mengurangi stok → `decrementStock()`** (`src/lib/stock.ts`), yang mengecek ketersediaan; DB juga punya `CHECK (qty >= 0)`.
- Skrip regresi: `scripts/e2e-test*.ts` (5 suite) — jalankan semua sebelum commit: `for s in scripts/e2e-test*.ts; do npx tsx $s; done`.
- **Tabel** dibungkus `<div className="overflow-x-auto ...">`, form pakai `grid-cols-1 md:grid-cols-2`, elemen lebar penuh pakai `md:col-span-2`.
- Hasil audit lengkap & daftar pekerjaan yang masih terbuka: lihat `AUDIT.md`.

## Struktur

- `prisma/schema.prisma` — seluruh model data (master data + siklus penjualan + siklus pembelian)
- `src/lib/actions/master.ts` — CRUD generik untuk semua entitas master data
- `src/lib/actions/sales.ts` — logika bisnis siklus penjualan (transaksi, potong/tambah stok, perubahan status dokumen)
- `src/lib/actions/purchasing.ts` — logika bisnis siklus pembelian (mirror dari sales.ts: stok bertambah saat terima, berkurang saat retur)
- `src/app/master/[entity]` — satu halaman generik untuk semua master data (dikonfigurasi di `src/lib/masterConfig.ts`)
- `src/app/sales/*` — halaman per tahap siklus penjualan
- `src/app/purchasing/*` — halaman per tahap siklus pembelian
- `scripts/e2e-test.ts` — regresi siklus Penjualan (quotation → order → delivery parsial & penuh → invoice → receipt parsial & penuh → return)
- `scripts/e2e-test-purchasing.ts` — regresi siklus Pembelian (order → receipt parsial & penuh → invoice → payment parsial & penuh → return)

## Alur kerja

1. Buat **Pelanggan**, **Barang**, **Gudang** di Master Data, lalu isi stok awal lewat Prisma Studio (`npx prisma studio`) — belum ada halaman "Penyesuaian Persediaan" untuk stok awal.
2. Buat **Penawaran Penjualan** (opsional) → konversi jadi **Pesanan Penjualan**, atau langsung buat Pesanan.
3. Dari daftar Pesanan, klik **Kirim** untuk membuat Pengiriman (stok otomatis berkurang) — bisa dicicil (parsial).
4. Dari daftar Pesanan, klik **Fakturkan** untuk membuat Faktur.
5. Dari daftar Faktur, klik **Terima Bayar** untuk mencatat pelunasan (bisa dicicil), atau **Retur** untuk mengembalikan barang (stok otomatis bertambah).

## Keputusan & batasan yang perlu diketahui

Karena diminta lanjut tanpa konfirmasi bertahap, berikut keputusan yang saya ambil sendiri dan hal yang **belum** dikerjakan:

- **Jurnal Penjualan/Pembelian OTOMATIS** (per permintaan). Faktur Penjualan/Pembelian, Penerimaan, Pembayaran, dan Retur sekarang otomatis membuat jurnal via `src/lib/accounting.ts`, menggunakan pemetaan akun yang diatur di **Pengaturan > Pemetaan Akun** (`/settings/account-mapping`). **Wajib diisi dulu** sebelum bisa membuat Faktur/Penerimaan/Pembayaran/Retur — kalau belum, sistem menolak dengan pesan jelas. Aturan yang dipakai: Faktur Penjualan → Dr Piutang/Cr Pendapatan + Dr HPP/Cr Persediaan (kalau ada cost). Penerimaan → Dr Kas-Bank pilihan/Cr Piutang. Retur Penjualan → kebalikannya. Faktur Pembelian → Dr Persediaan/Cr Utang. Pembayaran → Dr Utang/Cr Kas-Bank pilihan. Retur Pembelian → Dr Utang/Cr Persediaan.
  - Data dummy hasil `prisma/seed.ts` **tidak** melewati jalur ini (dibuat langsung ke database untuk kecepatan), jadi transaksi Penjualan/Pembelian di data dummy tidak otomatis muncul di Buku Besar — hanya 3 jurnal contoh manual (JU/KM/KK) yang sengaja ditambahkan untuk demo Buku Besar.
- **Aset Tetap: hanya metode garis lurus (straight-line)**, tidak ada metode saldo menurun (declining balance). Pencatatan **perolehan** aset TIDAK otomatis membuat jurnal (Dr Aset/Cr Kas atau Utang) — asumsinya sudah dicatat manual lewat Jurnal Umum atau Kas Keluar saat beli. Belum ada fitur "pelepasan/penjualan aset" (disposal) yang menghitung untung/rugi.
- **Belum ada login/otorisasi.** Model `User` & `UserRole` sudah ada di schema tapi belum dipakai — semua halaman bisa diakses siapa saja. Wajib ditambahkan sebelum dipakai multi-user beneran.
- **Belum ada halaman edit** untuk master data maupun dokumen transaksi — saat ini hanya tambah & hapus. Hapus dokumen transaksi yang sudah diproses juga belum dibatasi (idealnya faktur yang sudah `PAID` tidak boleh dihapus).
- **Belum ada Penyesuaian Persediaan / Pindah Barang** (ada di diagram Accurate asli) — untuk sekarang stok awal harus diisi manual lewat Prisma Studio.
- **Perhitungan uang pakai `Number` di sisi aplikasi**, bukan aritmatika desimal presisi tinggi — cukup untuk skala UMKM tapi berisiko untuk angka sangat besar/presisi tinggi. Kolom database tetap `Decimal(18,2)`.
- **Nomor dokumen** (`SQ-2026-0001` dst.) dihitung dari jumlah baris yang ada — cukup aman untuk pemakaian satu-persatu, tapi berpotensi bentrok kalau dua orang submit persis bersamaan (race condition). Belum kritikal untuk tim kecil, tapi perlu diperbaiki (pakai sequence DB) sebelum dipakai dengan banyak kasir sekaligus.
- **Prisma versi 7.10.0** dipakai sengaja (bukan 8.0 beta terbaru yang ternyata CLI platform cloud Prisma, bukan ORM lokal biasa).
