# Bagan Akun Standar — Event Organizer / Wedding Organizer

Kurasi dari `coa-draft-eo-wo.md` (catatan tangan, 10 September 2026). Sumber datanya ada di `src/lib/baganAkunStandar.ts`; tabel di bawah dihasilkan oleh `npx tsx skrip/cetak-bagan-akun.ts` — ubah data di kode, lalu cetak ulang, jangan edit tabel ini secara manual.

**Ringkasan:** 108 akun — 23 akun kelompok (induk) dan 85 akun rinci; 41 persis dari catatan asli, 52 usulan sesuai standar akuntansi (SAK EMKM), 15 keputusan atas butir yang semula pending.

## Cara pakai di sistem

1. Masuk sebagai Pemilik/Admin → **Pengaturan → Bagan Akun Standar** → tombol **Buat … akun**. Idempoten: akun yang sudah ada tidak diubah, hanya yang belum ada dibuat (lengkap dengan induk, tanda *kelompok*, tanda *kas/bank*). Pemetaan akun otomatis diisi bila belum ada.
2. Ganti nama `1-1210 Bank – Rekening Operasional` sesuai bank & nomor rekening; tambah rekening lain sebagai anak `1-1200` (dan akun biaya adminnya sebagai anak `5-8500`) lewat **Data Induk → Bagan Akun**.
3. **Akun kelompok tidak bisa dijurnal** — jurnal umum, kas masuk/keluar, jurnal otomatis penjualan/pembelian, penyusutan, dan pemetaan akun menolaknya dengan pesan jelas. Pilihan akun di formulir hanya menampilkan akun rinci; pilihan Kas/Bank hanya akun bertanda kas/bank.
4. **Neraca Saldo** menampilkan subtotal per kelompok (baris tebal); total bawah hanya menjumlahkan akun rinci.

## Penomoran

Format Accurate `X-YZWW`: `X` jenis (1 Aset, 2 Kewajiban, 3 Ekuitas, 4 Pendapatan, 5 Beban), `Y` kelompok, `Z` akun rinci, `WW` anak tingkat ketiga (rekening bank, akumulasi penyusutan per kelas aset, hutang pajak per jenis). Celah nomor sengaja disisakan agar akun baru bisa disisipkan tanpa menomori ulang.

## Pemetaan ke modul sistem

| Kebutuhan sistem | Akun standar |
|---|---|
| Piutang usaha (Faktur Penjualan, Penerimaan, Retur Penjualan) | `1-1300` |
| Persediaan (stok barang produksi/merchandise) | `1-1600` |
| Harga pokok penjualan | `5-1100` |
| Pendapatan bawaan Faktur Penjualan | `4-1100` Pendapatan Event Reguler — ganti di Pemetaan Akun bila mayoritas faktur adalah produksi/sewa |
| Hutang usaha (Faktur Pembelian, Pembayaran, Retur Pembelian) | `2-1100` |
| Akun Kas/Bank (Penerimaan, Pembayaran, Kas Masuk/Keluar) | `1-1100` Kas, `1-1210` Bank (dan rekening lain yang ditandai kas/bank) |
| Aset tetap → beban & akumulasi penyusutan | `1-2200…1-2500` ↔ `5-9520…5-9550` ↔ `1-2920…1-2950` |
| Uang muka pelanggan (DP) | `2-1200` — dicatat lewat Kas Masuk (Kas/Bank ↔ 2-1200); belum ada fitur DP pada pesanan |

## Alur rekonsiliasi (bagian 6 catatan) → modul

| Catatan | Modul di Accurate Copy |
|---|---|
| Proposal ter-ACC / Pesanan | Penawaran (PNW) → Konversi ke Pesanan Penjualan (PSJ) |
| LPJ (laporan pertanggungjawaban event) | Faktur Penjualan (FJ) setelah event selesai; Surat Jalan (SJ) bila ada barang fisik |
| Keluar/Masuk Kas/Bank | Penerimaan (TRM) untuk pelunasan klien; Kas Masuk/Keluar (KM/KK) untuk non-piutang |
| TOP (Term of Payment) | Tanggal jatuh tempo faktur (bawaan 14 hari) & status Sebagian/Lunas |
| Laba/Rugi | Neraca Saldo (laporan laba-rugi resmi masih terbuka di AUDIT.md) |
| Pengadaan / Pembelian / Beban | Pesanan Pembelian (PSB) → Terima Barang (TB); beban langsung lewat Kas Keluar ke akun 5-xxxx |
| Nota | Faktur Pembelian (FB) |
| Cash flow tunai / TF | Pembayaran (BYR) dengan akun Kas atau Bank |
| Neraca & Laba/Rugi | Buku Besar Mutasi & Neraca Saldo |

## Batasan yang sengaja dibiarkan

- Satu akun pendapatan untuk seluruh Faktur Penjualan (per barang/jasa belum bisa dipetakan ke akun berbeda) — kandidat pengembangan berikutnya.
- `5-7300 Diskon Penjualan` mengikuti catatan (di Beban Pemasaran); standar akuntansi memperlakukannya sebagai kontra-pendapatan. Kalau ingin standar, pindahkan ke kelompok `4-xxxx` dengan jenis Pendapatan.
- Akun pajak (`2-13xx`, `5-9xxx`) disediakan tapi sistem belum menghitung pajak otomatis (belum ada PPN/PPh di dokumen).
## Keputusan atas butir pending

| Butir | Keputusan |
|---|---|
| Struktur Pendapatan (Reguler/Flagship × Event/Produksi/Sewa) | Dibaca sebagai matriks: tiga kelompok layanan (Event 4-1000, Produksi 4-2000, Sewa 4-3000), masing-masing punya anak Reguler dan Flagship. Reguler = pesanan klien; Flagship = program unggulan milik sendiri. Faktur Penjualan memakai 4-1100 sebagai bawaan. |
| Arti "Adm. Permit Udf." | Administrasi Perizinan (5-3600): biaya pengurusan izin keramaian, izin venue, kepolisian, dan surat-surat event. |
| Arti "TOP" | Term of Payment — di sistem ini terwujud sebagai tanggal jatuh tempo Faktur Penjualan (bawaan 14 hari) dan status Sebagian/Lunas dari Penerimaan. |
| Coretan di bawah "Kas" | Dibaca 'Bank' (1-1200), dibuat sebagai kelompok dengan satu rekening contoh (1-1210) supaya tiap rekening bank bisa punya akun sendiri. |
| Redaksi "Claim/Gagal Produksi" | Klaim & Gagal Produksi (5-7100): ganti rugi atau pengerjaan ulang akibat komplain klien / produksi gagal. Tetap di Beban Pemasaran sesuai catatan. |
| Beban Lain-lain (1) & (2) | Tetap dipisah, diberi nama tegas: Beban Sosial & Sponsorship (5-8000) dan Beban Administrasi Bank (5-8500). |
| Penomoran kode akun | Format Accurate X-YZWW: digit pertama jenis, ratusan kelompok, puluhan akun rinci; celah nomor disisakan untuk penambahan. |
| Obligasi & Investasi | Dipindah ke kelompok baru Investasi Jangka Panjang (1-3000) sesuai usulan draft. |

## Daftar akun

| Kode | Nama akun | Jenis | Tanda | Asal | Keterangan |
|---|---|---|---|---|---|
| `1-1000` | **Aset Lancar** | Aset | kelompok | asli |  |
| `1-1100` | &nbsp;&nbsp;&nbsp;Kas | Aset | kas/bank | asli | Uang tunai di brankas / kas kecil |
| `1-1200` | &nbsp;&nbsp;&nbsp;**Bank** | Aset | kelompok | **keputusan** | Coretan di bawah 'Kas' dibaca sebagai 'Bank'; dibuat kelompok agar tiap rekening jadi anak sendiri |
| `1-1210` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Bank – Rekening Operasional | Aset | kas/bank | **usul** | Ganti nama sesuai bank & nomor rekening; tambah 1-1220 dst. untuk rekening lain |
| `1-1300` | &nbsp;&nbsp;&nbsp;Piutang Usaha | Aset | pemetaan | **usul** | Tagihan ke klien yang belum dibayar (dipakai otomatis oleh Faktur Penjualan) |
| `1-1400` | &nbsp;&nbsp;&nbsp;Uang Muka ke Vendor / Supplier | Aset |  | **usul** |  |
| `1-1500` | &nbsp;&nbsp;&nbsp;Biaya Dibayar Dimuka | Aset |  | **usul** | Sewa/asuransi yang dibayar di depan, dibebankan bertahap |
| `1-1600` | &nbsp;&nbsp;&nbsp;Persediaan | Aset | pemetaan | **usul** | Barang produksi & merchandise yang dijual (dipakai otomatis oleh modul stok) |
| `1-1700` | &nbsp;&nbsp;&nbsp;Piutang Lain-lain | Aset |  | **usul** | Kasbon karyawan/crew, piutang non-usaha |
| `1-2000` | **Aset Tetap** | Aset | kelompok | asli |  |
| `1-2100` | &nbsp;&nbsp;&nbsp;Tanah | Aset |  | asli |  |
| `1-2200` | &nbsp;&nbsp;&nbsp;Bangunan | Aset |  | asli |  |
| `1-2300` | &nbsp;&nbsp;&nbsp;Kendaraan | Aset |  | **usul** |  |
| `1-2400` | &nbsp;&nbsp;&nbsp;Peralatan Event | Aset |  | **usul** | Sound system, lighting, tenda, panggung, genset |
| `1-2500` | &nbsp;&nbsp;&nbsp;Inventaris Kantor | Aset |  | **usul** | Komputer, mebel, AC |
| `1-2900` | &nbsp;&nbsp;&nbsp;**Akumulasi Penyusutan** | Aset | kelompok | **usul** | Saldo normal kredit (pengurang aset tetap) |
| `1-2920` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Akumulasi Penyusutan Bangunan | Aset |  | **usul** |  |
| `1-2930` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Akumulasi Penyusutan Kendaraan | Aset |  | **usul** |  |
| `1-2940` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Akumulasi Penyusutan Peralatan Event | Aset |  | **usul** |  |
| `1-2950` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Akumulasi Penyusutan Inventaris Kantor | Aset |  | **usul** |  |
| `1-3000` | **Investasi Jangka Panjang** | Aset | kelompok | **usul** | Obligasi & investasi dipindah dari Aset Tetap — bukan aset operasional |
| `1-3100` | &nbsp;&nbsp;&nbsp;Obligasi | Aset |  | asli |  |
| `1-3200` | &nbsp;&nbsp;&nbsp;Investasi Lainnya | Aset |  | asli | Saham, reksa dana, deposito > 1 tahun |
| `2-1000` | **Kewajiban Lancar** | Kewajiban | kelompok | asli |  |
| `2-1100` | &nbsp;&nbsp;&nbsp;Hutang Usaha | Kewajiban | pemetaan | asli | Tagihan vendor yang belum dibayar (dipakai otomatis oleh Faktur Pembelian) |
| `2-1200` | &nbsp;&nbsp;&nbsp;Uang Muka Pelanggan / DP Klien | Kewajiban |  | **usul** | DP yang diterima sebelum event; dicatat lewat Kas Masuk |
| `2-1300` | &nbsp;&nbsp;&nbsp;**Hutang Pajak** | Kewajiban | kelompok | **usul** |  |
| `2-1310` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Hutang PPh 21 | Kewajiban |  | **usul** | Potongan pajak gaji/honor yang belum disetor |
| `2-1320` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Hutang PPh 23 / Final | Kewajiban |  | **usul** |  |
| `2-1330` | &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Hutang PPN | Kewajiban |  | **usul** | Hanya bila sudah PKP |
| `2-1400` | &nbsp;&nbsp;&nbsp;Beban yang Masih Harus Dibayar | Kewajiban |  | **usul** | Gaji/listrik/vendor yang sudah jadi beban tapi belum ditagih |
| `2-1500` | &nbsp;&nbsp;&nbsp;Hutang Lain-lain | Kewajiban |  | **usul** |  |
| `2-2000` | **Kewajiban Jangka Panjang** | Kewajiban | kelompok | **usul** |  |
| `2-2100` | &nbsp;&nbsp;&nbsp;Hutang Bank | Kewajiban |  | **usul** |  |
| `2-2200` | &nbsp;&nbsp;&nbsp;Hutang Pihak Berelasi | Kewajiban |  | **usul** | Pinjaman dari pemilik/keluarga/afiliasi |
| `2-2300` | &nbsp;&nbsp;&nbsp;Hutang Leasing / Pembiayaan Kendaraan | Kewajiban |  | **usul** |  |
| `3-1000` | Modal Disetor / Modal Pemilik | Ekuitas |  | **usul** |  |
| `3-2000` | Laba Ditahan | Ekuitas |  | **usul** | Akumulasi laba tahun-tahun sebelumnya |
| `3-3000` | Laba / Rugi Tahun Berjalan | Ekuitas |  | **usul** |  |
| `3-4000` | Prive | Ekuitas |  | **usul** | Pengambilan pribadi pemilik (saldo normal debit) |
| `4-1000` | **Pendapatan Event** | Pendapatan | kelompok | **keputusan** | Matriks catatan: Reguler/Flagship × Event/Produksi/Sewa → tiap jenis layanan punya anak Reguler & Flagship |
| `4-1100` | &nbsp;&nbsp;&nbsp;Pendapatan Event Reguler | Pendapatan | pemetaan | **keputusan** | Event pesanan klien (wedding, gathering, launching). Akun bawaan Faktur Penjualan |
| `4-1200` | &nbsp;&nbsp;&nbsp;Pendapatan Event Flagship | Pendapatan |  | **keputusan** | Program unggulan milik sendiri (festival/konser tahunan), pendapatan tiket & sponsor |
| `4-2000` | **Pendapatan Produksi** | Pendapatan | kelompok | **keputusan** | Dekorasi, dokumentasi, konten, cetak & merchandise |
| `4-2100` | &nbsp;&nbsp;&nbsp;Pendapatan Produksi Reguler | Pendapatan |  | **keputusan** |  |
| `4-2200` | &nbsp;&nbsp;&nbsp;Pendapatan Produksi Flagship | Pendapatan |  | **keputusan** |  |
| `4-3000` | **Pendapatan Sewa** | Pendapatan | kelompok | **keputusan** | Sewa peralatan event & venue |
| `4-3100` | &nbsp;&nbsp;&nbsp;Pendapatan Sewa Reguler | Pendapatan |  | **keputusan** |  |
| `4-3200` | &nbsp;&nbsp;&nbsp;Pendapatan Sewa Flagship | Pendapatan |  | **keputusan** |  |
| `4-9000` | **Pendapatan Lain-lain** | Pendapatan | kelompok | **usul** |  |
| `4-9100` | &nbsp;&nbsp;&nbsp;Pendapatan Bunga Bank | Pendapatan |  | **usul** |  |
| `4-9200` | &nbsp;&nbsp;&nbsp;Pendapatan Lainnya | Pendapatan |  | **usul** | Selisih kurs, penjualan aset, dll. |
| `5-1000` | **Beban Pokok Pendapatan** | Beban | kelompok | **usul** | Biaya yang melekat langsung pada pendapatan; menghasilkan laba kotor |
| `5-1100` | &nbsp;&nbsp;&nbsp;Harga Pokok Penjualan | Beban | pemetaan | **usul** | Nilai persediaan barang yang terjual (dipakai otomatis oleh modul stok) |
| `5-1200` | &nbsp;&nbsp;&nbsp;Biaya Langsung Event | Beban |  | **usul** | Vendor, crew lepas, sewa venue per event |
| `5-1300` | &nbsp;&nbsp;&nbsp;Biaya Langsung Produksi | Beban |  | **usul** | Bahan dekor, cetak, jasa dokumentasi per pesanan |
| `5-2000` | **Beban Gaji & Honor** | Beban | kelompok | asli |  |
| `5-2100` | &nbsp;&nbsp;&nbsp;Gaji Pokok | Beban |  | asli |  |
| `5-2200` | &nbsp;&nbsp;&nbsp;Upah Harian | Beban |  | asli |  |
| `5-2300` | &nbsp;&nbsp;&nbsp;Honor Volunteer | Beban |  | asli |  |
| `5-2400` | &nbsp;&nbsp;&nbsp;THR & Bonus | Beban |  | **usul** |  |
| `5-2500` | &nbsp;&nbsp;&nbsp;BPJS & Tunjangan | Beban |  | **usul** |  |
| `5-3000` | **Beban Operasional** | Beban | kelompok | asli |  |
| `5-3100` | &nbsp;&nbsp;&nbsp;Transport | Beban |  | asli |  |
| `5-3200` | &nbsp;&nbsp;&nbsp;BBM | Beban |  | asli |  |
| `5-3300` | &nbsp;&nbsp;&nbsp;E-Toll & Parkir | Beban |  | asli |  |
| `5-3400` | &nbsp;&nbsp;&nbsp;Akomodasi | Beban |  | asli |  |
| `5-3500` | &nbsp;&nbsp;&nbsp;Perjalanan Dinas | Beban |  | asli |  |
| `5-3600` | &nbsp;&nbsp;&nbsp;Administrasi Perizinan (Permit) | Beban |  | **keputusan** | 'Adm. Permit Udf.' dibaca sebagai biaya pengurusan izin keramaian/venue/kepolisian |
| `5-3700` | &nbsp;&nbsp;&nbsp;Konsumsi | Beban |  | asli |  |
| `5-3900` | &nbsp;&nbsp;&nbsp;Operasional Lainnya | Beban |  | asli |  |
| `5-4000` | **Beban Utilitas & Kantor** | Beban | kelompok | **keputusan** | Nama baru untuk 'Beban Harian' agar isinya (PLN, air, internet, sewa kantor) tergambar |
| `5-4100` | &nbsp;&nbsp;&nbsp;Listrik (PLN) | Beban |  | asli |  |
| `5-4200` | &nbsp;&nbsp;&nbsp;Air | Beban |  | asli |  |
| `5-4300` | &nbsp;&nbsp;&nbsp;Internet / Wifi | Beban |  | asli |  |
| `5-4400` | &nbsp;&nbsp;&nbsp;Paket Data | Beban |  | asli |  |
| `5-4500` | &nbsp;&nbsp;&nbsp;Sewa Tempat / Kantor | Beban |  | **usul** |  |
| `5-4600` | &nbsp;&nbsp;&nbsp;Kebersihan & Sampah | Beban |  | **usul** |  |
| `5-4700` | &nbsp;&nbsp;&nbsp;ATK & Perlengkapan Kantor | Beban |  | **usul** |  |
| `5-5000` | **Beban Entertainment** | Beban | kelompok | asli |  |
| `5-5100` | &nbsp;&nbsp;&nbsp;Jamuan Klien & Relasi | Beban |  | **usul** | Catatan asli belum punya sub-item |
| `5-6000` | **Beban Pemeliharaan** | Beban | kelompok | asli |  |
| `5-6100` | &nbsp;&nbsp;&nbsp;Service Sound System | Beban |  | asli |  |
| `5-6200` | &nbsp;&nbsp;&nbsp;Service Peralatan Event | Beban |  | asli | 'Service Persediaan Aset' pada catatan asli |
| `5-6300` | &nbsp;&nbsp;&nbsp;Renovasi | Beban |  | asli |  |
| `5-6400` | &nbsp;&nbsp;&nbsp;Service Kendaraan | Beban |  | asli |  |
| `5-6900` | &nbsp;&nbsp;&nbsp;Pemeliharaan Lainnya | Beban |  | asli |  |
| `5-7000` | **Beban Pemasaran** | Beban | kelompok | asli |  |
| `5-7100` | &nbsp;&nbsp;&nbsp;Klaim & Gagal Produksi | Beban |  | **keputusan** | Ganti rugi/pengerjaan ulang karena komplain klien atau produksi gagal |
| `5-7200` | &nbsp;&nbsp;&nbsp;Cashback Pelanggan | Beban |  | asli |  |
| `5-7300` | &nbsp;&nbsp;&nbsp;Diskon Penjualan | Beban |  | asli | Mengikuti catatan asli (di pemasaran); alternatif standar: kontra-pendapatan |
| `5-7400` | &nbsp;&nbsp;&nbsp;Iklan & Promosi | Beban |  | **usul** | Iklan media sosial, cetak brosur, endorsement |
| `5-8000` | **Beban Sosial & Sponsorship** | Beban | kelompok | **keputusan** | 'Beban Lain-lain (1)' — tetap dipisah dari (2), diberi nama sesuai isinya |
| `5-8100` | &nbsp;&nbsp;&nbsp;Sumbangan | Beban |  | asli |  |
| `5-8200` | &nbsp;&nbsp;&nbsp;Keperluan Rumah Tangga Kantor | Beban |  | asli |  |
| `5-8300` | &nbsp;&nbsp;&nbsp;Sponsorship (Diberikan) | Beban |  | asli |  |
| `5-8500` | **Beban Administrasi Bank** | Beban | kelompok | **keputusan** | 'Beban Lain-lain (2)' — dipisah karena sifatnya biaya keuangan, bukan sosial |
| `5-8510` | &nbsp;&nbsp;&nbsp;Administrasi Bank – Rekening Operasional | Beban |  | asli | Satu akun per rekening, sejajar dengan 1-12x0 |
| `5-8520` | &nbsp;&nbsp;&nbsp;Pajak Bunga Bank | Beban |  | asli |  |
| `5-9000` | **Beban Pajak** | Beban | kelompok | asli |  |
| `5-9100` | &nbsp;&nbsp;&nbsp;PPh Final UMKM (0,5%) | Beban |  | **usul** | Catatan asli belum punya sub-item |
| `5-9200` | &nbsp;&nbsp;&nbsp;PBB & Pajak Kendaraan | Beban |  | **usul** |  |
| `5-9300` | &nbsp;&nbsp;&nbsp;Denda & Bunga Pajak | Beban |  | **usul** |  |
| `5-9500` | **Beban Penyusutan** | Beban | kelompok | **usul** | Dibutuhkan modul Aset Tetap; satu akun per kelas aset, sejajar dengan 1-29x0 |
| `5-9520` | &nbsp;&nbsp;&nbsp;Penyusutan Bangunan | Beban |  | **usul** |  |
| `5-9530` | &nbsp;&nbsp;&nbsp;Penyusutan Kendaraan | Beban |  | **usul** |  |
| `5-9540` | &nbsp;&nbsp;&nbsp;Penyusutan Peralatan Event | Beban |  | **usul** |  |
| `5-9550` | &nbsp;&nbsp;&nbsp;Penyusutan Inventaris Kantor | Beban |  | **usul** |  |
