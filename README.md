# Produksia

Sistem informasi akuntansi untuk usaha event/wedding organizer: penjualan, pembelian, persediaan, kas/bank, buku besar, laporan, dan rekonsiliasi. Alur modulnya mengikuti kebiasaan software akuntansi pada umumnya:
- **Penjualan**: Penawaran → Pesanan (+ **Uang Muka**/DP) → Pengiriman → Faktur → Penerimaan → Retur
- **Pembelian**: Pesanan → Penerimaan Barang → Faktur → Pembayaran → Retur (cermin dari Penjualan)
- **Buku Besar & Kas/Bank**: Daftar Akun, Jurnal Umum, Buku Besar (saldo berjalan per akun), **Tutup Buku tahunan** (jurnal penutup ke Laba Ditahan + kunci tahun), Kas Masuk/Keluar
- **Laporan** (Admin/Pemilik/Superadmin): Neraca Saldo, **Laporan Piutang & Hutang** (umur per pelanggan/pemasok), Neraca, **Laba Rugi per event / per waktu** (mingguan, bulanan, tahunan; tabel 12 bulan), **Perubahan Modal** (Harta = Utang + Modal; setoran, laba, prive), **Laporan Prive** (per pemilik), Arus Kas (metode langsung), Pajak & SPT
- **Prive** (Kas & Bank → Prive): pengambilan pribadi pemilik, jurnal PRV (Dr Prive / Cr Kas), akun prive bawaan dari **pemetaan akun tambahan** (`prive`)
- **Harga jual, margin, dan nego**: Stok per Gudang menampilkan harga pokok, harga jual, dan margin (Rp dan %) per barang; di Penawaran/Pesanan harga di bawah harga jual hanya bisa diisi pemegang hak `harga.nego` (bawaan Kasir/Admin/Pemilik), dan di bawah **harga minimum** barang hanya Pemilik/Superadmin
- **Rekonsiliasi**: **Rekonsiliasi Event (LPJ)** per proyek — pemasukan (proposal ter-acc/pesanan → LPJ faktur & TOP → kas masuk → laba/rugi) dan pengeluaran (pengadaan/pembelian/beban → nota → cash flow → neraca & L/R); **Rekonsiliasi Kas/Bank** dengan **impor mutasi rekening** (CSV/HTML), pencocokan otomatis & manual
- **Proyek/Event sebagai dimensi transaksi**: penawaran, pesanan penjualan/pembelian, kas, dan jurnal manual bisa diberi event; semua jurnal turunannya bertanda event
- **Aset Tetap**: Daftar Aset (dengan nilai buku), Penyusutan garis lurus bulanan otomatis + posting jurnal, **Pelepasan aset** (dijual/dihapusbukukan dengan laba-rugi vs nilai buku)
- **Pengguna & hak akses**: masuk dengan nama pengguna + kata sandi, lima peran (Superadmin, Pemilik, Admin, Kasir, Gudang; Superadmin & Pemilik setara), kelola pengguna, **hak akses per dokumen** (lihat/buat/hapus tiap jenis dokumen per peran, diatur Superadmin/Pemilik di Pengaturan → Hak Akses)
- **Bagan akun standar EO/WO**: 111 akun hasil kurasi catatan pemilik, diterapkan satu klik; akun kelompok tidak bisa dijurnal, akun kas/bank bertanda
- **Persediaan**: stok per gudang, penyesuaian stok (saldo awal/opname) berjurnal, **pindah barang antar gudang** (stok berpindah, nilai tetap, tanpa jurnal), harga pokok rata-rata bergerak, nilai stok selalu = saldo akun Persediaan
- **Pajak**: status PKP + tarif PPN (Faktur Penjualan/Pembelian & retur), potongan PPh 23 di Penerimaan/Pembayaran, **PPh Final UMKM** bulanan dari omzet, ringkasan **Pajak & SPT** per masa (omzet, PPN kurang/lebih bayar, PPh 23, PPh Final), termin jatuh tempo, nama perusahaan — semua di Pengaturan → Perusahaan & Pajak
- **Tahun buku**: kartu perusahaan di sidebar membuka tahun buku (Superadmin/Pemilik/Admin) dan pintasan Laba Rugi/Neraca tahun itu; laporan & pintasan periode mengikutinya; mata uang tunggal Rupiah
- **Hapus dokumen dengan pembalikan penuh** (Pemilik/Admin): stok, harga pokok, jurnal, dan progres/status dokumen induk dibalik dalam satu transaksi; turunannya harus dihapus dulu; semuanya tercatat di Log Aktivitas

Seluruh kode, skema basis data, rute, dan antarmuka memakai bahasa Indonesia (lihat `ARCHITECTURE.md`).

## Menjalankan

1. Pastikan PostgreSQL lokal jalan: `~/Cooking/PostgreSQL/pgctl.sh start`
2. `npm install`
3. `npx prisma migrate deploy --config prisma7.config.ts` (sekali, atau setiap ada migrasi baru)
4. `npm run dev` lalu buka http://localhost:3000

Database: `accurate_copy`, koneksi diatur lewat `.env` (`DATABASE_URL`). Tidak ada kunci rahasia lain yang perlu diatur.

### Menjalankan

```bash
npm run dev      # migrasi + generate Prisma Client otomatis, lalu server dev di :3000
npm run seed     # kosongkan & isi data contoh (perusahaan D'Production Event Organizer)
npm run uji      # semua suite regresi
```

Setiap `npm run dev`/`build`/`start` menjalankan `npm run siapkan` (`prisma migrate deploy` + `prisma generate`) lebih dulu, jadi setelah `git pull` skema basis data langsung sinkron. Bila folder proyek atau PostgreSQL dipindahkan, hentikan server & PostgreSQL dulu, pindahkan, lalu jalankan lagi dari lokasi baru.

### Masuk pertama kali

- **Basis data kosong** (belum ada pengguna): halaman `/masuk` otomatis menampilkan formulir **pemasangan awal** untuk membuat akun Pemilik pertama.
- **Setelah `prisma/seed.ts`** (perusahaan contoh *D'Production Event Organizer*): tersedia 6 akun contoh; masuk dengan **nama pengguna** (bukan email), kata sandi = nama peran + `123`:

| Nama pengguna | Kata sandi | Nama | Peran | Bisa apa |
|---|---|---|---|---|
| superadmin | superadmin123 | Andrew Steine | Superadmin | Admin IT: semua, setara Pemilik (termasuk pengaturan, hak akses, semua akun) |
| owner | owner123 | Donny Donatus | Pemilik A | Semua; setara Superadmin |
| owner2 | owner123 | Nadia Yuliana | Pemilik B | Semua; setara Superadmin |
| admin | admin123 | Bagus Santoso | Admin | Semua dokumen (lihat/buat/hapus), laporan keuangan, rekonsiliasi, data induk; TANPA pengaturan, pengguna, bagan akun, hak akses — batasnya diatur Pemilik |
| kasir | kasir123 | Sari Wulandari | Kasir | Membuat & melihat dokumen penjualan, pembelian, kas; data induk; tanpa laporan keuangan dan tanpa hapus |
| gudang | gudang123 | Joko Prasetyo | Gudang | Surat jalan, terima barang, data induk barang/gudang; tanpa modul keuangan |

Bawaan hak tiap peran ada di `src/lib/hakAkses.ts` (`HAK_BAWAAN`); Superadmin/Pemilik bisa mengubah hak Admin/Kasir/Gudang per dokumen (lihat/buat/hapus) di **Pengaturan → Hak Akses** — perubahan langsung berlaku tanpa masuk ulang. Pengguna baru ditambah lewat **Pengguna** di sidebar (Superadmin/Pemilik/Admin); tiap orang mengganti kata sandinya sendiri di **Profil**. Email hanya kontak opsional.

**Lupa kata sandi (tanpa email):** tautan *Lupa kata sandi?* di halaman masuk → isi nama pengguna → permintaan muncul di beranda & menu Pengguna untuk Superadmin/Pemilik/Admin → mereka menekan **Buat tautan** dan memberikan tautan sekali pakai (berlaku 24 jam) langsung ke orangnya (WhatsApp/telepon) → pengguna membuka `/atur-ulang/<token>`, membuat kata sandi baru, langsung masuk, dan semua sesi lamanya dicabut. Permintaan juga otomatis selesai bila admin mengatur ulang kata sandi dari halaman pengguna. Skema via email (tautan yang sama dikirim otomatis) bisa ditambahkan bila tersedia akun SMTP/penyedia email dan alamat email tiap pengguna.

## Bagan akun (Event/Wedding Organizer)

Bagan akun standar 111 akun (`src/lib/baganAkunStandar.ts`, dokumentasi & keputusan kurasi di `BAGAN-AKUN.md`) diterapkan lewat **Pengaturan → Bagan Akun Standar**. Aturan yang ditegakkan sistem: akun **kelompok** (induk) hanya wadah dan ditolak di semua jurnal; akun bertanda **kas/bank** yang tampil di pilihan Penerimaan/Pembayaran/Kas; Neraca Saldo menampilkan subtotal per kelompok. Tabel Markdown-nya dicetak ulang dengan `npx tsx skrip/cetak-bagan-akun.ts`.

## Sinkronisasi buku besar

Semua dokumen yang memengaruhi uang atau stok menjurnal otomatis lewat `src/lib/akuntansi.ts` di dalam transaksi yang sama: **Surat Jalan** (persediaan ↔ Barang Terkirim Belum Ditagih, dinilai harga pokok saat kirim), Faktur Penjualan (piutang, pendapatan per akun barang, HPP dari barang yang sudah dikirim), Penerimaan, Retur Penjualan, **Terima Barang** (persediaan ↔ Barang Diterima Belum Ditagih), Faktur Pembelian (menutup akun belum ditagih, selisih harga ke persediaan, jasa ke beban), Pembayaran, Retur Pembelian (selisih harga ke Selisih Persediaan), **Penyesuaian Stok**, **perolehan aset tetap**, dan penyusutan. Harga pokok barang memakai rata-rata bergerak, sehingga Σ stok × harga pokok selalu sama dengan saldo akun Persediaan. Kartu *Integritas & Sinkronisasi* di beranda dan `npx tsx skrip/uji-sinkron.ts` mencocokkan buku besar dengan dokumen & stok; selisih ≠ 0 diperlakukan sebagai bug.

## Uang muka pelanggan (DP)

Dari daftar Pesanan Penjualan → **Uang Muka**: DP diterima ke kas/bank dan dicatat sebagai kewajiban *Uang Muka Pelanggan* (2-1200, jurnal JU-UM). Saat Faktur dibuat dari pesanan itu, komposer faktur mengisi otomatis DP yang dipakai (bisa dikurangi): piutang = total − DP, akun Uang Muka Pelanggan didebit, status faktur langsung Lunas bila DP menutup seluruhnya. DP dipakai urut tanggal (FIFO) lintas beberapa DP; sisa DP tetap kewajiban sampai dipakai faktur berikutnya. Menghapus faktur mengembalikan DP; DP yang sudah dipakai tidak bisa dihapus sebelum fakturnya. `periksaSinkron` menjaga saldo akun Uang Muka Pelanggan = Σ DP belum dipakai.

## Pajak & SPT

**Buku Besar → Pajak & SPT**: tabel per masa pajak (bulan) untuk tahun yang dipilih — omzet (DPP faktur penjualan − retur), PPN keluaran/masukan dan kurang/(lebih) bayar (PKP), PPh 23 yang dipotong klien dan yang kita potong, serta **PPh Final UMKM** = omzet × tarif (bawaan 0,5%, PP 55/2022). Tombol *Catat* per bulan membuat jurnal `JU-PPHF` (sumber `PAJAK`, hanya bisa dihapus dari halaman ini) Dr Beban PPh Final (5-9100) / Cr Hutang PPh Final (2-1320) bertanggal akhir bulan; catatan `PphFinalBulanan` menyimpan omzet & tarif saat itu dan bisa dihapus (pembalikan jurnal). Penyetoran ke DJP dicatat lewat Kas Keluar dengan akun lawan Hutang PPh Final.

## Rekonsiliasi & laporan per event

Setiap **Proyek/Event** (Data Induk → Proyek: nilai kontrak, anggaran biaya, tanggal) bisa dipilih di Penawaran, Pesanan Penjualan, Pesanan Pembelian, Kas Masuk/Keluar, dan Jurnal Umum; pesanan mewariskannya ke SJ/FJ/UM/TRM/RJ dan TB/FB/BYR/RB (`Jurnal.proyekId`). Dari situ:

- **Laba Rugi per event / per waktu** (Laporan → Laba Rugi): pilih event dan periode (pintasan minggu ini, bulan ini, bulan lalu, tahun buku) atau tampilan **per bulan** (12 kolom).
- **Rekonsiliasi Event (LPJ)** (menu Rekonsiliasi): satu halaman per event mengikuti skema catatan pemilik — *Pemasukan:* proposal ter-acc/pesanan → LPJ (faktur, DP, termin/TOP, sisa piutang) → kas/bank masuk → laba/rugi; *Pengeluaran:* pengadaan (PSB) / pembelian (FB) / beban-biaya (KK, JU) → nota → cash flow tunai/transfer → sisa hutang (neraca) & beban (L/R); ditutup rekonsiliasi laba ↔ kas event dan anggaran vs realisasi.
- **Impor Mutasi Rekening** (Rekonsiliasi → Impor Mutasi): unggah CSV/TSV/HTML mutasi rekening koran yang sudah rapi (tajuk Tanggal, Keterangan, Referensi, Debit/Kredit atau Jumlah bertanda, Saldo; pembatas, format angka, dan tanggal dideteksi otomatis; pemetaan kolom manual bila perlu), pratinjau, lalu simpan — baris yang sama tidak diimpor dua kali (sidik jari). **Debit/Kredit dibalik otomatis ke sudut buku**: di rekening koran uang masuk ada di kolom Kredit (sudut bank), sedangkan di buku uang masuk = Debit akun kas/bank; sistem menebak sudut pandang berkas dari pergerakan kolom Saldo (bisa dipaksa "rekening koran" atau "sudut buku") dan pratinjau menampilkan Dr/Cr akun kas/bank yang akan dicocokkan.
- **Rekonsiliasi Kas/Bank**: per akun kas/bank & periode, mutasi rekening dicocokkan dengan baris jurnal (otomatis: nominal & arah sama, tanggal ±n hari; manual: pilih pasangan; lepas). Mutasi yang nominal dan tanggalnya sama berstatus **Cocok** tanpa perlu apa-apa lagi; bila tanggalnya beda, statusnya **Perlu perhatian** dengan kotak centang untuk menandai sudah dicek orang. Ringkasan: saldo buku, "belum di rekening", "belum di buku", saldo rekening seharusnya vs saldo rekening koran (selisih 0 = tuntas). Mutasi yang belum ada di buku punya tautan cepat ke Kas Masuk/Keluar.

## Tutup buku & arus kas

**Buku Besar → Tutup Buku**: menutup tahun membuat jurnal JU-TUTUP bertanggal 31 Desember yang menolkan semua akun pendapatan & beban tahun itu ke *Laba Ditahan* (peran pemetaan `labaDitahan`, standar 3-2000), memajukan tahun buku aktif, dan mengunci tahun itu: jurnal baru (dokumen, kas, penyusutan) maupun penghapusan dokumen bertanggal tahun yang ditutup ditolak sampai tahun dibuka kembali (jurnal penutupnya dihapus). Laba Rugi mengabaikan jurnal penutup, Neraca memuat labanya di akun Laba Ditahan, Neraca Saldo menampilkan saldo sebelum penutupan.

**Buku Besar → Arus Kas**: metode langsung dari jurnal — setiap jurnal yang menyentuh akun kas/bank dipecah per akun lawan (operasi / investasi 1-2xxx & 1-3xxx / pendanaan modal & 2-2xxx); totalnya selalu = perubahan saldo kas/bank dan dicek ke buku besar.

## Hapus / ubah dokumen

Setiap daftar transaksi punya tombol **Hapus** (hak `dokumen.hapus`, hanya Pemilik & Admin). Menghapus = **membalik seluruh efek** dalam satu transaksi (`src/lib/aksi/hapusDokumen.ts`): stok fisik & harga pokok rata-rata, jurnal otomatis (dihapus lewat tautan `jurnalId`), progres pesanan (terkirim/difaktur/diterima), dan status faktur/pesanan. Dokumen yang sudah punya turunan ditolak dengan pesan apa yang harus dihapus dulu (mis. faktur yang sudah diterima bayarannya, surat jalan yang fakturnya dibuat setelahnya, aset yang sudah disusutkan). Setiap penghapusan tercatat di **Pengaturan → Log Aktivitas**. Mengubah dokumen = hapus lalu buat ulang, supaya jejak stok/jurnal selalu konsisten. Data induk tetap bisa diubah langsung.

## Pajak

Pengaturan → **Perusahaan & Pajak** menyimpan nama perusahaan, status **PKP**, tarif PPN (bawaan 11%), termin jatuh tempo, dan empat akun pajak. Bila PKP aktif, komposer faktur menampilkan pilihan PPN (0% atau tarif) dan total = DPP + PPN; jurnalnya menambah baris PPN Keluaran (penjualan) / PPN Masukan (pembelian), retur membalik PPN proporsional. Non-PKP tidak bisa memungut PPN (ditolak server). **PPh 23**: di Penerimaan isi potongan yang dilakukan klien (Dr Pajak Dibayar Dimuka), di Pembayaran isi potongan yang kita lakukan ke vendor (Cr Hutang PPh 23); piutang/hutang berkurang sebesar bayar + potongan. Belum otomatis: PPh Final UMKM/badan dan pelaporan SPT.

## Data contoh

- `npx tsx prisma/reset.ts` — hapus semua data (transaksi, data induk, pengguna & sesi)
- `npx tsx prisma/seed.ts` — 4 pengguna + bagan akun standar EO/WO + satu alur cerita berlatar usaha event (klien PT Cahaya Nusantara, vendor CV Sinar Dekorasi, merchandise lanyard/stiker/goodie bag, jasa dekorasi & sound engineer, aset sound system) yang **memanggil aksi server sungguhan** — modal awal, saldo awal stok, Penawaran → Pesanan → 2× Surat Jalan → Faktur → cicilan → retur → pelunasan; Pesanan Pembelian → 2× Terima Barang → Faktur → bayar → retur → lunas; sewa kantor; aset dibeli dari bank → penyusutan — lalu memverifikasi buku besar sinkron (gagal = seed berhenti).

**Penting:** setiap kali `prisma/schema.prisma` berubah dan kamu migrate, **restart dev server** (`npm run dev`) — Turbopack tidak otomatis memuat ulang Prisma Client yang di-generate ulang; gejalanya "Cannot read properties of undefined (reading 'findMany')".

## Pola yang wajib diikuti saat menambah fitur

- **Hak akses di dua tempat.** Halaman memanggil `await wajibHak("modul.lihat")` (mengalihkan ke `/masuk` atau `/tanpa-akses`); aksi server memanggil `await wajibHakAksi("modul.tulis")` sebagai pernyataan pertama (melempar galat yang tampil di formulir). Sidebar/menu hanya *menyembunyikan* tautan lewat `punyaHak` — bukan pengaman. Semua di `src/lib/otentikasi.ts` & `src/lib/hakAkses.ts`.
- **Akun kelompok tidak boleh dijurnal.** Setiap pembuatan jurnal memanggil `pastikanAkunRinci` (`src/lib/baganAkun.ts`); pilihan akun di formulir memakai `where: { kelompok: false }` dan pilihan kas/bank memakai `daftarAkunKasBank()`.
- **Form → `<FormulirAksi aksi={xxxFormulir}>`**, bukan `<form action={xxx}>`. Setiap aksi server punya dua versi: `xxx(dataFormulir)` (melempar galat, dipakai skrip regresi) dan `xxxFormulir(sebelumnya, dataFormulir)` (membungkus dengan `jalankanFormulir`, mengembalikan `{ galat }`). Alasannya: di produksi Next.js menyamarkan galat yang di-throw dari aksi server, jadi pesan validasi hanya sampai ke pengguna kalau **dikembalikan** sebagai status. Lihat `src/lib/statusFormulir.ts`, `src/komponen/FormulirAksi.tsx`.
- **Halaman daftar → `bacaParamDaftar(searchParams)` + `<KontrolDaftar>`** (`src/lib/daftar.ts`, `src/komponen/ui/KontrolDaftar.tsx`): pencarian `?q=` dan paginasi `?hal=` 25 baris, tanpa JavaScript klien. Kueri memakai `count` + `findMany({ where, skip, take })`.
- **Nomor dokumen → `nomorDokumenBerikutnya(db.model, "PREFIX")`** (`src/lib/penomoran.ts`), jangan `count()+1`.
- **Uang & kuantitas → `Prisma.Decimal`** lewat `src/lib/uang.ts` (`uang()`, `jumlahkan()`, `kali()`, `bacaUang()`), jangan `Number()` untuk nilai yang disimpan/dibandingkan.
- **Mengurangi stok → `kurangiStok()`** (`src/lib/stok.ts`), yang mengecek ketersediaan; DB juga punya `CHECK ("jumlah" >= 0)`. Baris **JASA** tidak pernah menyentuh stok/HPP (`jenisBarang`). Barang masuk selalu lewat `perbaruiHargaRata` (rata-rata bergerak).
- **Dokumen yang mengubah uang/stok wajib menjurnal** lewat fungsi di `src/lib/akuntansi.ts` di dalam `$transaction` yang sama, dengan nomor dokumen di keterangan jurnal. Tambahkan pemeriksaan ke `src/lib/sinkron.ts` bila memperkenalkan saldo baru yang harus cocok dengan dokumen.
- **Label formulir** selalu `htmlFor` + `id` pada isiannya (bisa diklik, ramah pembaca layar).
- Skrip regresi: 20 suite di `skrip/uji-*.ts` (+ `uji-sinkron` dijalankan terakhir) — jalankan semua sebelum commit:
  `for s in skrip/uji-*.ts; do npx tsx $s; done`
- **Tabel** dalam `.kartu.kartu-tabel > .bungkus-tabel`, form `grid-cols-1 md:grid-cols-2`, elemen lebar penuh `md:col-span-2`.
- Hasil audit lengkap & daftar pekerjaan yang masih terbuka: `AUDIT.md`.

## Desain (Precision Ledger)

**Identitas merek Produksia**: navy `#0B2141` (utama; tombol utama, item menu aktif, fokus isian), navy terang `#17417A`, oranye `#F86E18` (aksen tindakan, `.tombol-aksen`). Token ada di `src/app/globals.css` (`--color-navy`, `--color-oranye`, dst., dipakai sebagai kelas Tailwind `bg-navy`, `text-oranye`). Logo: lettermark "P" dengan aksen diagonal oranye + wordmark Poppins Bold (OFL) yang sudah dijadikan path. Berkas di `public/logo/` (`produksia-logo.svg`, `-gelap`, `-putih`, `-mono`, `-lettermark`, `-lettermark-putih`, `-ikon-aplikasi`, PNG 192/512), favicon `src/app/icon.svg` (navy di tab terang, putih di tab gelap) + `favicon.ico`, `apple-icon.png`, manifest `src/app/manifest.ts`. Di aplikasi dipakai lewat komponen `src/komponen/ui/Logo.tsx` (`<Logo tinggi={..} varian="terang|gelap" />`, `<Lettermark />`).

Kedalaman visual (bagian *Kedalaman* di `globals.css`): kanvas dengan dua blob aurora navy/oranye yang hanyut perlahan (transform di kompositor) di atas pola titik halus (`.aurora`), kartu berlapis (gradasi putih tipis, sorot dalam, dua bayangan navy), kartu statistik bergaris aksen gradasi + ubin ikon gradasi (`.kartu-statistik`, `.ubin-ikon`), panel navy bertekstur grid + cahaya oranye (`.panel-navy`), bilah samping/atas berlapis kaca (`.kaca`), item menu aktif bergradasi (`.menu-aktif`), tombol utama/aksen bergradasi dengan kilatan saat hover. Halaman masuk berbagi dua panel: panel merek navy beraurora + tiga poin fitur, dan formulir. Beranda punya angka yang berjalan naik (`AngkaBergerak.tsx`) dan grafik tren pendapatan vs beban 12 bulan tanpa pustaka (`GrafikTren.tsx`, SVG dengan garis yang menggambar diri dan tooltip bawaan).

Gerak halus (`src/app/globals.css`, bagian *Gerak*): halaman dan kartu muncul dengan fade-up bertahap (`.animasi-masuk`), tombol/kartu/isian punya transisi hover & tekan, kerangka pemuatan berkilau (`.kerlip`, `src/app/(aplikasi)/loading.tsx`). Semua dimatikan otomatis bila sistem pengguna menyetel *kurangi gerakan* (`prefers-reduced-motion`).

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
- `src/lib/baganAkunStandar.ts` (data 111 akun + keputusan kurasi), `src/lib/baganAkun.ts` (terapkan, `pastikanAkunRinci`, `daftarAkunKasBank`), halaman `pengaturan/bagan-akun`
- `src/lib/akuntansi.ts` (semua aturan posting), `src/lib/sinkron.ts` (pencocokan buku besar ↔ dokumen/stok), `src/lib/aksi/persediaan.ts` + `persediaan/` (stok per gudang, penyesuaian)
- `src/lib/laporan.ts` (Laba Rugi & Neraca dari jurnal, periode ?dari&sampai), halaman `buku-besar/laba-rugi`, `buku-besar/neraca`; `src/lib/laporanPrive.ts` + `src/lib/aksi/prive.ts` (prive & laporannya)
- `src/lib/aksi/pengaturan.ts` — pemetaan akun standar (`PemetaanAkun`) dan **pemetaan akun tambahan** (`PemetaanAkunTambahan`: nama peran bebas → akun, dibaca modul lewat `akunPemetaanTambahan(db, kunci)`); halaman `pengaturan/pemetaan-akun` (hak `pemetaan.tulis`, termasuk Admin)
- `src/lib/pengaturanPerusahaan.ts` (PKP, tarif PPN, termin, akun pajak), halaman `pengaturan/perusahaan`
- `src/lib/aksi/hapusDokumen.ts` (hapus dokumen dengan pembalikan efek), `pengaturan/log-aktivitas` (jejak audit)
- `skrip/uji-{sinkron,uang-muka,pindah-barang,tutup-buku,pph-final,hak-akses,lupa-kata-sandi,pelepasan-aset,proyek,rekonsiliasi,prive,hapus,laporan,pajak,persediaan,bagan-akun,penjualan,pembelian,buku-besar,aset-tetap,pengaman}.ts` — regresi (`npm run uji`; `UJI_PERAN=KASIR` dsb. meniru peran lain; pembantu bersama di `skrip/bantuan.ts`); `skrip/subset-font-ikon.sh` — pangkas font ikon; `skrip/cetak-bagan-akun.ts` — tabel bagan akun untuk BAGAN-AKUN.md
- `.github/workflows/ci.yml` — CI: tsc, eslint, migrasi + seed di PostgreSQL, 21 suite regresi, `next build`

Peta lengkap, model data, dan alur tiap modul: `ARCHITECTURE.md`.

## Deploy & kinerja

Panduan lengkap VPS (skrip pasang sekali jalan, systemd, Caddy HTTPS, backup harian, deploy otomatis dari GitHub) ada di **`DEPLOY.md`** dan folder `deploy/`.

- **Build**: `npm run build` (menjalankan migrasi + generate lebih dulu) menghasilkan `.next/standalone` (`output: "standalone"`): jalankan `node .next/standalone/server.js` (salin `.next/static` dan `public` ke sebelahnya) atau cukup `npm start`. Untuk beberapa proses/instance, pasang di belakang reverse proxy (nginx/Caddy) dengan HTTPS.
- **Basis data**: PostgreSQL 14+. Semua kolom relasi (FK) dan kolom yang sering difilter (`tanggal`, `status`, `kedaluwarsa`) sudah berindeks (107 indeks). Pool koneksi per proses bawaan 10, atur lewat `DB_POOL_MAX`; pastikan `max_connections` PostgreSQL ≥ jumlah proses × pool + cadangan.
- **Beban ringan per permintaan**: halaman tidak memuat baris jurnal ke memori. Saldo akun, laporan, tren bulanan, dan pemeriksaan integritas dihitung dengan `GROUP BY`/`SUM` di PostgreSQL (`saldoAkunPeriode`, `hitungLabaRugiBulanan`, `periksaSinkron`, kartu beranda). Rentang tahun di sidebar memakai MIN/MAX berindeks. Kartu tren beranda dialirkan lewat `<Suspense>` sehingga kerangka halaman tampil lebih dulu. Pengaturan perusahaan di-`cache()` per permintaan; sesi kedaluwarsa dibersihkan saat ada yang masuk.
- **Zona waktu**: pengelompokan per bulan di SQL memakai `ZONA_WAKTU` (bawaan `Asia/Jakarta`); samakan `TZ` server dengannya.
- **Uji beban lokal**: `npx tsx skrip/beban.ts` terhadap `npm start` (port 3100); angka terakhir ada di AUDIT.md bagian kesiapan deploy.

## Alur kerja

1. Masuk sebagai Pemilik/Admin, terapkan **Pengaturan → Bagan Akun Standar** (sekaligus mengisi Pemetaan Akun; keduanya wajib sebelum faktur/penerimaan/pembayaran/retur bisa dibuat). Ganti nama rekening bank 1-1210 sesuai kenyataan.
2. Buat **Pelanggan**, **Barang & Jasa**, **Gudang** di Data Induk; stok awal lewat **Persediaan → Penyesuaian Stok** (akun lawan Modal) atau lewat pembelian (Pesanan Pembelian → Terima Barang).
3. Buat **Penawaran Penjualan** (opsional) → konversi jadi **Pesanan Penjualan**, atau langsung buat Pesanan.
4. Dari daftar Pesanan, **Kirim** untuk membuat Surat Jalan (stok berkurang; bisa parsial), lalu **Fakturkan**.
5. Dari daftar Faktur, **Terima Bayar** (bisa dicicil) atau **Retur** (stok bertambah).
6. Ulangi cermin-nya di Pembelian; Buku Besar & Neraca Saldo terisi otomatis dari jurnal tiap dokumen.

## Keputusan & batasan yang perlu diketahui

- **Jurnal otomatis** untuk Faktur/Penerimaan/Pembayaran/Retur via `src/lib/akuntansi.ts` memakai pemetaan akun (Piutang, Persediaan, HPP, Pendapatan, Utang). Aturan: Faktur Penjualan → Dr Piutang/Cr Pendapatan + Dr HPP/Cr Persediaan; Penerimaan → Dr Kas-Bank/Cr Piutang; Retur Penjualan → kebalikannya; Faktur Pembelian → Dr Persediaan/Cr Utang; Pembayaran → Dr Utang/Cr Kas-Bank; Retur Pembelian → Dr Utang/Cr Persediaan.
- **Aset Tetap: hanya garis lurus.** Perolehan aset dijurnal (Dr Aset / Cr Kas-Bank atau Hutang) bila akun pembayaran dipilih. Pelepasan (tombol **Lepas** di daftar aset): Dr Kas/Bank harga jual · Dr Akumulasi Penyusutan · Cr Aset harga perolehan · selisih ke akun laba/rugi pelepasan (bawaan 4-9200); aset yang dilepas tidak ikut penyusutan; pelepasan bisa dibatalkan (Hapus). Belum ada: metode penyusutan lain, penjualan sebagian.
- **Pajak**: PPN, PPh 23, dan PPh Final UMKM dihitung dari dokumen; PPh badan (tarif umum), ambang omzet UMKM, dan e-Faktur/e-Bupot belum dihitung/terhubung otomatis.
- **Tutup buku** hanya memindahkan laba ke Laba Ditahan; belum ada jurnal penyesuaian akhir tahun otomatis (akrual, prive ke modal).
- **Otentikasi buatan sendiri, tanpa pustaka luar**: kata sandi di-hash scrypt (Node `crypto`) + garam per pengguna; sesi disimpan di tabel `Sesi` (cookie hanya token acak, tabel menyimpan SHA-256-nya), umur 30 hari; ganti kata sandi / nonaktifkan akun mencabut semua sesi. Lupa kata sandi ditangani lewat tautan sekali pakai dari Superadmin/Pemilik/Admin (tanpa email). Belum ada: pengiriman tautan via email (butuh SMTP), 2FA, pembatasan percobaan login.
- **Hak akses per dokumen & per peran**, belum per gudang/per pelanggan. Bawaan Gudang bisa *melihat* daftar penjualan/pembelian (perlu untuk membuat SJ/TB) — bisa dicabut di Pengaturan → Hak Akses.
- **Dokumen transaksi dihapus dengan pembalikan penuh; ubah = hapus lalu buat ulang** (data induk bisa diubah langsung; yang masih dipakai transaksi ditolak DB dengan pesan jelas).
- **Laporan Laba Rugi & Neraca dihitung langsung dari jurnal** (belum ada jurnal penutup tahun: laba tahun-tahun lalu & tahun berjalan tampil sebagai baris hitungan di ekuitas). Belum ada Pindah Barang antar gudang dan arus kas.
- **Skrip regresi** memakai basis data yang sama dengan data contoh (bersih-bersih berbasis waktu mulai uji) dan menyetel `UJI_TANPA_SESI=1` agar aksi server bisa dipanggil tanpa HTTP — pintu ini hanya terbuka di luar `NODE_ENV=production`.
- **Prisma 7.10.0** dipakai sengaja (bukan 8.0 rc yang merupakan CLI platform Prisma).
