# Kebijakan Akuntansi Produksia

Berlaku sejak 14 September 2026 untuk D'Production Event Organizer. Dokumen ini menetapkan cara sistem mencatat dan melaporkan, hasil riset praktik terbaik (peraturan pajak Indonesia, PSAK 72, beberapa software akuntansi komersial, Jurnal.id, Xero, QuickBooks, praktik EO/WO) yang sudah dibakukan ke dalam aplikasi. Kalau ada penyesuaian, ubah di sini dulu, lalu di kode, lalu catat di bagian Riwayat.

## 1. Dua sudut pandang: buku akrual, laporan kas

Buku besar tetap dicatat secara akrual. Alasannya: Pasal 28 ayat (5) UU KUP membolehkan stelsel kas, tetapi Penjelasannya (dan PMK 54/PMK.03/2021) mewajibkan penjualan tetap mencakup penjualan kredit, HPP memperhitungkan persediaan, dan aset dibebankan lewat penyusutan. Artinya stelsel kas untuk pajak pada dasarnya tetap akrual ("stelsel campuran"). Wajib pajak badan (PT/CV) wajib pembukuan; orang pribadi yang memakai PPh Final 0,5% cukup pencatatan omzet.

Laporan manajemen memakai sudut pandang kas, karena itu yang dipakai pemilik sehari-hari:

| Halaman | Bawaan | Pilihan lain |
|---|---|---|
| Laporan → Laba Rugi | Basis kas: uang masuk dari pelanggan, penerimaan lain, uang keluar operasi, surplus kas operasi | Akrual (fiskal) |
| Laporan → Ringkasan Pendapatan | Basis kas: uang diterima per pelanggan (DP, pelunasan) dan per jenis layanan | Basis faktur (akrual) |
| Beranda → tren 12 bulan | Kas masuk dan kas keluar | |
| Buku Besar → Arus Kas | Metode langsung (selalu kas) | |
| Neraca, Neraca Saldo, Pajak & SPT, Tutup Buku | Akrual (tidak ada pilihan) | |

Definisi basis kas di sistem: hanya jurnal yang menyentuh akun kas/bank yang dibaca. Kas dari pelanggan (Piutang Usaha, Uang Muka Pelanggan, akun pendapatan, PPh 23 dibayar dimuka) dialokasikan ke akun pendapatan menurut baris faktur (Penerimaan) atau baris pesanan (Uang Muka); bagian PPN dipisah sebagai titipan. Kas operasi lainnya dikelompokkan per akun lawan. Pembelian aset tetap, prive, setoran modal, dan pinjaman tidak ikut (sama seperti Laba Rugi). Surplus kas operasi selalu sama dengan arus kas operasi di Laporan Arus Kas.

## 2. Alur penjualan standar (order-to-cash) untuk EO

Semua software akuntansi yang diteliti (beberapa software akuntansi komersial, Jurnal.id, Xero, QuickBooks) membolehkan faktur langsung; penawaran, pesanan, dan pengiriman opsional. Praktik EO/WO Indonesia: DP 20 sampai 50 persen saat kontrak, termin, pelunasan H-7/H-14 atau setelah acara; DP dicatat sebagai kewajiban dan pendapatan diakui setelah acara terlaksana (PSAK 72).

Alur yang dibakukan di Produksia:

| Tahap | Dokumen | Jurnal | Kapan |
|---|---|---|---|
| Proposal | Penawaran (PNW) | tidak ada | saat proposal dikirim |
| Kontrak | Pesanan Penjualan (PSJ), wajib pilih event | tidak ada | saat klien setuju |
| DP / termin | Uang Muka (UM) | Dr Kas / Cr Uang Muka Pelanggan | tiap kali uang klien masuk sebelum faktur |
| Barang fisik keluar | Surat Jalan (SJ), hanya bila ada barang | Dr Barang Terkirim / Cr Persediaan | saat barang dikirim |
| Acara selesai | Faktur Penjualan (FJ) | Dr Piutang, Dr Uang Muka, Dr Diskon / Cr Pendapatan, Cr PPN | setelah acara (pengakuan pendapatan) |
| Pelunasan | Penerimaan (TRM) | Dr Kas / Cr Piutang | saat uang masuk |
| Koreksi | Retur (RJ) | kebalikan faktur, diskon dibalik prorata | bila ada |

Jalan pintas untuk jasa yang sudah selesai: di formulir Pesanan tekan "Simpan & Buat Faktur" (pesanan tetap tercatat sebagai kontrak, langsung ke komposer faktur). Komposer faktur menampilkan peringatan bila tanggal selesai event masih di depan: uang klien sebaiknya dicatat sebagai Uang Muka dulu.

Beberapa termin sebelum acara = beberapa dokumen Uang Muka pada pesanan yang sama; faktur akhir otomatis memakai semua DP (FIFO). Faktur lebih dari satu per pesanan boleh (per barang/jasa yang belum ditagih).

## 3. Pendapatan flagship: tiket, sponsor, tenant

Praktik terbaik (IFRS 15/PSAK 72, panduan akuntansi event): tiket yang dijual sebelum acara dan sponsorship adalah pendapatan ditangguhkan (kewajiban) sampai acara berlangsung; penjualan tiket ritel yang banyak direkap per hari/per kanal menjadi satu dokumen atas nama pelanggan umum (cara QuickBooks "daily sales").

Yang dibakukan:

- Akun: 4-1300 Pendapatan Tiket (Flagship), 4-1400 Pendapatan Sponsor (Flagship), 4-1500 Pendapatan Tenant & Booth (Flagship); 4-1200 untuk pendapatan flagship lainnya.
- Data induk standar (diterapkan bersama bagan akun): jasa Tiket Presale/Reguler/VIP, Paket Sponsor Platinum/Gold/Silver, Sewa Booth / Tenant (harga diisi pemilik), pelanggan "Pelanggan Umum (tiket & ritel)".
- Setiap program flagship = satu Proyek/Event di data induk, supaya Laba Rugi per event dan LPJ-nya lengkap.
- Tiket: satu Pesanan per program atas Pelanggan Umum (baris tiket per jenis); uang tiket yang masuk sebelum acara dicatat sebagai Uang Muka pada pesanan itu (rekap harian per kanal: loket, online); pada tanggal acara buat Faktur dari pesanan tersebut, DP otomatis dipotong, pendapatan tiket diakui.
- Sponsor: pelanggan = sponsor; Penawaran → Pesanan (paket sponsor) → DP/termin sebagai Uang Muka → Faktur saat acara → Penerimaan sisa.
- Tenant/booth: sama seperti sponsor dengan jasa Sewa Booth / Tenant.

## 4. Diskon penjualan

- Diskon faktur dicatat ke akun kontra 4-8100 Diskon Penjualan (Dr Diskon / Cr Piutang), sehingga pendapatan bruto tetap terlihat.
- DPP PPN = subtotal dikurangi diskon yang tercantum di faktur (UU PPN Pasal 1 angka 18).
- Omzet PPh Final tetap bruto sebelum diskon (PP 55/2022 Pasal 60 ayat (1), PMK 164/2023 Pasal 6 ayat (2)).
- Retur atas faktur berdiskon membalik diskon secara prorata nilai baris yang diretur (cara alokasi diskon yang umum dipakai software akuntansi komersial).
- Nego harga per baris tetap ada untuk harga khusus per barang/jasa; diskon faktur untuk potongan atas keseluruhan tagihan.

## 5. Pajak

- Omzet bruto usaha (dasar PPh Final 0,5%) dibaca dari buku besar: semua akun pendapatan usaha, tidak termasuk kelompok Diskon Penjualan (4-8xxx) dan kelompok Pendapatan Lain-lain (4-9xxx: bunga bank sudah kena pajak final sendiri, laba pelepasan aset bukan penghasilan usaha). Kedua kelompok diatur di Pengaturan → Pemetaan Akun.
- Pendapatan yang dicatat lewat Kas Masuk atau jurnal umum (tanpa faktur) tetap ikut omzet; halaman Pajak & SPT menampilkannya di kolom "Di luar faktur" agar diperiksa. Bila perusahaan PKP, setiap penyerahan wajib faktur pajak, jadi kolom ini seharusnya nol.
- PPN keluaran/masukan dan PPh 23 tetap dari dokumen.
- Batas omzet UMKM Rp 4,8 miliar per tahun belum dihitung otomatis.

## 6. Kas masuk langsung ke akun pendapatan

Boleh dipakai untuk pemasukan yang memang tanpa pelanggan dan tanpa tagihan (bunga bank, pemasukan kecil non-klien). Untuk penjualan ke pelanggan pakai Pesanan → Faktur → Penerimaan (atau Uang Muka untuk DP) supaya ada piutang, nama pelanggan, dan faktur. Formulir Kas Masuk menampilkan peringatan di dialog verifikasi bila akun lawan berjenis pendapatan.

## 7. Tanda event pada dokumen

Penawaran, Pesanan Penjualan, Pesanan Pembelian, Kas Masuk/Keluar, dan Jurnal Umum wajib diberi tanda event bila memang milik sebuah event; dokumen turunannya mewarisi tanda itu. Dokumen tanpa event tidak muncul di Laba Rugi per event maupun LPJ. Dialog verifikasi sebelum simpan menampilkan peringatan bila event kosong.

## 8. Verifikasi singkat sebelum simpan

Formulir Penawaran, Pesanan Penjualan, Pesanan Pembelian, Kas Masuk, Kas Keluar, dan Jurnal Umum menampilkan dialog ringkasan isian (pelanggan, event, baris dan total, keterangan) dengan peringatan, lalu tombol "Ya, simpan" atau "Tetap simpan". Komposer Faktur sudah punya pratinjau jurnal dan daftar pengaman sendiri.

## 8b. Persetujuan dokumen, multi mata uang, dan cadangan

Tiga hal berikut diatur di dokumen terpisah, [DOKUMENTASI-PERSETUJUAN-KURS-BACKUP.md](DOKUMENTASI-PERSETUJUAN-KURS-BACKUP.md):

- Alur persetujuan dokumen (maker-checker). Faktur Penjualan, Faktur Pembelian, Kas Masuk/Keluar, Penyesuaian Stok, Aset Tetap, dan Penggajian dibuat sebagai draf lebih dulu; jurnalnya baru masuk buku besar setelah disetujui pengguna lain, dan pembuat dokumen tidak boleh menyetujui dokumennya sendiri. Saklarnya di Pengaturan → Perusahaan & Pajak, bawaannya menyala.
- Multi mata uang. Rupiah adalah mata uang fungsional (buku besar selalu rupiah); mata uang asing melekat pada dokumen dan saldo piutang/hutangnya, dengan kurs yang disimpan per dokumen dan penilaian kembali akhir periode ke akun 5-8530 Selisih Kurs.
- Cadangan basis data lokal beserta uji pulihnya (`skrip/cadangkan-basis-data.sh`, `skrip/pulihkan-basis-data.sh`, `skrip/verifikasi-cadangan.sh`).

## 9. Yang sengaja belum dibuat

- Diskon di Penawaran/Pesanan (baru di Faktur).
- PPN atas uang muka untuk PKP (perusahaan saat ini non-PKP).
- Omzet PPh Final basis kas (pilihan untuk WP orang pribadi yang memakai pencatatan); sekarang omzet mengikuti buku besar (akrual).
- Faktur tanpa pesanan sama sekali; jalan pintas "Simpan & Buat Faktur" menutupi kebutuhan itu.
- Tiket per transaksi/per pembeli; dipakai rekap harian.

## 10. Sumber

- UU KUP Pasal 28 dan Penjelasannya; PMK 54/PMK.03/2021 (stelsel kas); pajak.go.id tentang pencatatan WP OP UMKM.
- PP 55/2022 Pasal 60 ayat (1) dan PMK 164/2023 Pasal 6 ayat (2) (peredaran bruto sebelum potongan penjualan).
- UU PPN Pasal 1 angka 18 (harga jual tidak termasuk potongan harga yang dicantumkan dalam faktur pajak).
- PSAK 72 / IFRS 15 (kewajiban kontrak, pengakuan pendapatan saat kewajiban pelaksanaan terpenuhi); panduan akuntansi special events (tiket dan sponsorship ditangguhkan sampai acara).
- Dokumentasi software akuntansi komersial (faktur langsung, uang muka, alokasi diskon), Mekari Jurnal (penagihan langsung, uang muka), QuickBooks Online (retainer/deposit, progress invoicing, daily sales), Xero (deposit/prepayment).
- Praktik pembayaran EO/WO Indonesia (DP 20 sampai 50 persen, termin, pelunasan H-7/H-14).

## Riwayat

- 14 Sep 2026: persetujuan dokumen (maker-checker), multi mata uang, dan cadangan basis data terverifikasi; rinciannya di DOKUMENTASI-PERSETUJUAN-KURS-BACKUP.md.
- 14 Sep 2026: kebijakan pertama, bersama fitur Laba Rugi basis kas, Ringkasan Pendapatan basis kas, diskon faktur, omzet bruto dari buku besar, akun dan data induk flagship, dialog verifikasi, tanda event.
