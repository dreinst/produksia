# Accurate Copy

Aplikasi internal penjualan, pembelian, persediaan & akuntansi untuk tim kecil, dibangun mengikuti alur modul Accurate 5:
- **Penjualan**: Penawaran → Pesanan → Pengiriman → Faktur → Penerimaan → Retur
- **Pembelian**: Pesanan → Penerimaan Barang → Faktur → Pembayaran → Retur (cermin dari Penjualan)
- **Buku Besar & Kas/Bank**: Daftar Akun, Jurnal Umum, Buku Besar (saldo berjalan per akun), Neraca Saldo, Kas Masuk/Keluar
- **Aset Tetap**: Daftar Aset (dengan nilai buku), Penyusutan garis lurus bulanan otomatis + posting jurnal
- **Pengguna & hak akses**: login email + kata sandi, empat peran (Pemilik, Admin, Kasir, Gudang), kelola pengguna
- **Bagan akun standar EO/WO**: 108 akun hasil kurasi catatan pemilik, diterapkan satu klik; akun kelompok tidak bisa dijurnal, akun kas/bank bertanda

Seluruh kode, skema basis data, rute, dan antarmuka memakai bahasa Indonesia (lihat `ARCHITECTURE.md`).

## Menjalankan

1. Pastikan PostgreSQL lokal jalan: `~/Cooking/PostgreSQL/pgctl.sh start`
2. `npm install`
3. `npx prisma migrate deploy --config prisma7.config.ts` (sekali, atau setiap ada migrasi baru)
4. `npm run dev` lalu buka http://localhost:3000

Database: `accurate_copy`, koneksi diatur lewat `.env` (`DATABASE_URL`). Tidak ada kunci rahasia lain yang perlu diatur.

### Masuk pertama kali

- **Basis data kosong** (belum ada pengguna): halaman `/masuk` otomatis menampilkan formulir **pemasangan awal** untuk membuat akun Pemilik pertama.
- **Setelah `prisma/seed.ts`**: tersedia 4 akun contoh, semua berkata sandi `rahasia123`:

| Email | Peran | Bisa apa |
|---|---|---|
| pemilik@contoh.id | Pemilik | Semua, termasuk mengelola akun Pemilik lain |
| admin@contoh.id | Admin | Semua modul; tidak bisa menyentuh akun Pemilik |
| kasir@contoh.id | Kasir | Penjualan, pembelian, kas & bank, data induk; buku besar & aset hanya lihat |
| gudang@contoh.id | Gudang | Surat jalan, terima barang, data induk barang/gudang; tanpa modul keuangan |

Matriks lengkapnya ada di `src/lib/hakAkses.ts`. Pengguna baru ditambah lewat **Pengguna** di sidebar (Pemilik/Admin); tiap orang mengganti kata sandinya sendiri di **Profil**.

## Bagan akun (Event/Wedding Organizer)

Bagan akun standar 108 akun (`src/lib/baganAkunStandar.ts`, dokumentasi & keputusan kurasi di `BAGAN-AKUN.md`) diterapkan lewat **Pengaturan → Bagan Akun Standar**. Aturan yang ditegakkan sistem: akun **kelompok** (induk) hanya wadah dan ditolak di semua jurnal; akun bertanda **kas/bank** yang tampil di pilihan Penerimaan/Pembayaran/Kas; Neraca Saldo menampilkan subtotal per kelompok. Tabel Markdown-nya dicetak ulang dengan `npx tsx skrip/cetak-bagan-akun.ts`.

## Data contoh

- `npx tsx prisma/reset.ts` — hapus semua data (transaksi, data induk, pengguna & sesi)
- `npx tsx prisma/seed.ts` — 4 pengguna + bagan akun standar EO/WO + satu alur cerita 20 tahap berlatar usaha event (klien PT Cahaya Nusantara, vendor CV Sinar Dekorasi, merchandise lanyard/stiker/goodie bag, aset sound system) yang melewati SEMUA modul (Penawaran draft → dikonversi → Pesanan → 2× Pengiriman parsial → Faktur → 2× Penerimaan cicilan → Retur; restock: Pesanan Pembelian → 2× Penerimaan Barang → Faktur → 2× Pembayaran → Retur; modal awal, setor bank, bayar sewa; aset + satu penyusutan), supaya tiap halaman langsung punya contoh data yang saling terhubung.

**Penting:** setiap kali `prisma/schema.prisma` berubah dan kamu migrate, **restart dev server** (`npm run dev`) — Turbopack tidak otomatis memuat ulang Prisma Client yang di-generate ulang; gejalanya "Cannot read properties of undefined (reading 'findMany')".

## Pola yang wajib diikuti saat menambah fitur

- **Hak akses di dua tempat.** Halaman memanggil `await wajibHak("modul.lihat")` (mengalihkan ke `/masuk` atau `/tanpa-akses`); aksi server memanggil `await wajibHakAksi("modul.tulis")` sebagai pernyataan pertama (melempar galat yang tampil di formulir). Sidebar/menu hanya *menyembunyikan* tautan lewat `punyaHak` — bukan pengaman. Semua di `src/lib/otentikasi.ts` & `src/lib/hakAkses.ts`.
- **Akun kelompok tidak boleh dijurnal.** Setiap pembuatan jurnal memanggil `pastikanAkunRinci` (`src/lib/baganAkun.ts`); pilihan akun di formulir memakai `where: { kelompok: false }` dan pilihan kas/bank memakai `daftarAkunKasBank()`.
- **Form → `<FormulirAksi aksi={xxxFormulir}>`**, bukan `<form action={xxx}>`. Setiap aksi server punya dua versi: `xxx(dataFormulir)` (melempar galat, dipakai skrip regresi) dan `xxxFormulir(sebelumnya, dataFormulir)` (membungkus dengan `jalankanFormulir`, mengembalikan `{ galat }`). Alasannya: di produksi Next.js menyamarkan galat yang di-throw dari aksi server, jadi pesan validasi hanya sampai ke pengguna kalau **dikembalikan** sebagai status. Lihat `src/lib/statusFormulir.ts`, `src/komponen/FormulirAksi.tsx`.
- **Halaman daftar → `bacaParamDaftar(searchParams)` + `<KontrolDaftar>`** (`src/lib/daftar.ts`, `src/komponen/ui/KontrolDaftar.tsx`): pencarian `?q=` dan paginasi `?hal=` 25 baris, tanpa JavaScript klien. Kueri memakai `count` + `findMany({ where, skip, take })`.
- **Nomor dokumen → `nomorDokumenBerikutnya(db.model, "PREFIX")`** (`src/lib/penomoran.ts`), jangan `count()+1`.
- **Uang & kuantitas → `Prisma.Decimal`** lewat `src/lib/uang.ts` (`uang()`, `jumlahkan()`, `kali()`, `bacaUang()`), jangan `Number()` untuk nilai yang disimpan/dibandingkan.
- **Mengurangi stok → `kurangiStok()`** (`src/lib/stok.ts`), yang mengecek ketersediaan; DB juga punya `CHECK ("jumlah" >= 0)`.
- **Label formulir** selalu `htmlFor` + `id` pada isiannya (bisa diklik, ramah pembaca layar).
- Skrip regresi: 6 suite di `skrip/uji-*.ts` — jalankan semua sebelum commit:
  `for s in skrip/uji-*.ts; do npx tsx $s; done`
- **Tabel** dalam `.kartu.kartu-tabel > .bungkus-tabel`, form `grid-cols-1 md:grid-cols-2`, elemen lebar penuh `md:col-span-2`.
- Hasil audit lengkap & daftar pekerjaan yang masih terbuka: `AUDIT.md`.

## Desain (Precision Ledger)

UI mengikuti design system dari paket Stitch (`stitch_creative_architecture_portfolio.zip` di folder induk — tidak ikut repo). Aturan praktisnya:

- Pakai **kelas komponen** di `src/app/globals.css`, bukan utility lepas: `kartu`, `kartu-tabel` + `bungkus-tabel`, `tombol tombol-utama|aksen|garis|lembut|bahaya|kecil`, `isian`/`isian-kecil`, `label`, `petunjuk`, `bidang`, `tabel`/`tabel-polos`, `lencana lencana-emerald|amber|rose|slate|blue`, `angka` (rata kanan, tabular), `mono`, `teks-label`.
- Nomor dokumen → `<NomorDokumen nomor=…/>`, status → `<LencanaStatus status=…/>`, ikon → `<Ikon nama="…"/>` (nama dari fonts.google.com/icons).
- Halaman baru: judul dengan `KepalaHalaman` (jejak + lencana + aksi), konten dalam `kartu`, tabel dalam `kartu kartu-tabel`.
- Font teks dari `next/font/google` (Inter, Hanken Grotesk, JetBrains Mono). **Ikon** Material Symbols di-self-host di `src/app/fonts/`, sudah di-subset ke ikon yang dipakai saja (< 50 KB). **Setiap menambah ikon baru, jalankan `skrip/subset-font-ikon.sh`** (butuh `pip install fonttools brotli`); tanpa itu ikon baru tampil sebagai teks.

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

Label status yang tampil (Draf, Sebagian, Diproses, Lunas, Dikonversi, Dibatalkan, Tercatat) dipetakan dari nilai enum di database (`DRAF`, `LUNAS`, …) di `src/komponen/ui/Lencana.tsx`.

## Struktur singkat

- `prisma/schema.prisma` — seluruh model data (36 model + `Sesi`, 6 enum)
- `src/proxy.ts` — pemeriksaan cookie sesi di tepi: tanpa cookie → `/masuk`
- `src/app/(publik)/masuk` — halaman masuk & pemasangan awal (tanpa kerangka aplikasi)
- `src/app/(aplikasi)/` — semua halaman aplikasi; `layout.tsx`-nya memasang sidebar/topbar dengan identitas pengguna
- `src/app/(aplikasi)/data-induk/[entitas]` (+ `[id]` untuk ubah) — satu halaman generik untuk semua data induk (`src/lib/konfigurasiDataInduk.ts`)
- `src/app/(aplikasi)/pengaturan/pengguna` — kelola akun; `profil` — ganti kata sandi; `tanpa-akses` — halaman 403
- `src/lib/aksi/*.ts` — logika bisnis per modul (`penjualan`, `pembelian`, `jurnal`, `asetTetap`, `dataInduk`, `pengaturan`, `otentikasi`, `pengguna`)
- `src/lib/{otentikasi,hakAkses,kataSandi}.ts` — sesi (tabel `Sesi` + cookie `sesi_ac`), matriks hak, hash scrypt
- `src/lib/baganAkunStandar.ts` (data 108 akun + keputusan kurasi), `src/lib/baganAkun.ts` (terapkan, `pastikanAkunRinci`, `daftarAkunKasBank`), halaman `pengaturan/bagan-akun`
- `skrip/uji-{bagan-akun,penjualan,pembelian,buku-besar,aset-tetap,pengaman}.ts` — regresi; `skrip/subset-font-ikon.sh` — pangkas font ikon; `skrip/cetak-bagan-akun.ts` — tabel bagan akun untuk BAGAN-AKUN.md
- `.github/workflows/ci.yml` — CI: tsc, eslint, migrasi + seed di PostgreSQL, 5 suite regresi, `next build`

Peta lengkap, model data, dan alur tiap modul: `ARCHITECTURE.md`.

## Alur kerja

1. Masuk sebagai Pemilik/Admin, terapkan **Pengaturan → Bagan Akun Standar** (sekaligus mengisi Pemetaan Akun; keduanya wajib sebelum faktur/penerimaan/pembayaran/retur bisa dibuat). Ganti nama rekening bank 1-1210 sesuai kenyataan.
2. Buat **Pelanggan**, **Barang**, **Gudang** di Data Induk; stok awal lewat pembelian (Pesanan Pembelian → Terima Barang) atau Prisma Studio (`npx prisma studio`) — belum ada halaman "Penyesuaian Persediaan".
3. Buat **Penawaran Penjualan** (opsional) → konversi jadi **Pesanan Penjualan**, atau langsung buat Pesanan.
4. Dari daftar Pesanan, **Kirim** untuk membuat Surat Jalan (stok berkurang; bisa parsial), lalu **Fakturkan**.
5. Dari daftar Faktur, **Terima Bayar** (bisa dicicil) atau **Retur** (stok bertambah).
6. Ulangi cermin-nya di Pembelian; Buku Besar & Neraca Saldo terisi otomatis dari jurnal tiap dokumen.

## Keputusan & batasan yang perlu diketahui

- **Jurnal otomatis** untuk Faktur/Penerimaan/Pembayaran/Retur via `src/lib/akuntansi.ts` memakai pemetaan akun (Piutang, Persediaan, HPP, Pendapatan, Utang). Aturan: Faktur Penjualan → Dr Piutang/Cr Pendapatan + Dr HPP/Cr Persediaan; Penerimaan → Dr Kas-Bank/Cr Piutang; Retur Penjualan → kebalikannya; Faktur Pembelian → Dr Persediaan/Cr Utang; Pembayaran → Dr Utang/Cr Kas-Bank; Retur Pembelian → Dr Utang/Cr Persediaan.
- **Aset Tetap: hanya garis lurus.** Perolehan aset tidak otomatis membuat jurnal (catat lewat Jurnal Umum/Kas Keluar); belum ada pelepasan aset.
- **Otentikasi buatan sendiri, tanpa pustaka luar**: kata sandi di-hash scrypt (Node `crypto`) + garam per pengguna; sesi disimpan di tabel `Sesi` (cookie hanya token acak, tabel menyimpan SHA-256-nya), umur 30 hari; ganti kata sandi / nonaktifkan akun mencabut semua sesi. Belum ada: lupa-kata-sandi via email (diatur ulang oleh Pemilik/Admin), 2FA, pembatasan percobaan login.
- **Hak akses per modul**, bukan per dokumen/gudang. Peran Gudang bisa *melihat* semua daftar penjualan/pembelian (perlu untuk membuat SJ/TB).
- **Dokumen transaksi belum bisa diubah/dihapus** dari UI (data induk sudah bisa: tombol Ubah/Hapus; yang masih dipakai transaksi ditolak DB dengan pesan jelas).
- **Belum ada Penyesuaian Persediaan / Pindah Barang**, laporan laba-rugi & neraca (Neraca Saldo sudah jadi bahannya).
- **Skrip regresi** memakai basis data yang sama dengan data contoh (bersih-bersih berbasis waktu mulai uji) dan menyetel `UJI_TANPA_SESI=1` agar aksi server bisa dipanggil tanpa HTTP — pintu ini hanya terbuka di luar `NODE_ENV=production`.
- **Prisma 7.10.0** dipakai sengaja (bukan 8.0 rc yang merupakan CLI platform Prisma).
