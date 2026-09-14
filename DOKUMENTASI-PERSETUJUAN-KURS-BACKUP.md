# Persetujuan Dokumen, Multi Mata Uang, dan Cadangan Basis Data

Berlaku sejak 14 September 2026 untuk D'Production Event Organizer. Dokumen ini melengkapi
[KEBIJAKAN-AKUNTANSI.md](KEBIJAKAN-AKUNTANSI.md) dengan tiga hal yang sebelumnya belum ada di
Produksia: alur persetujuan dokumen (maker-checker), akuntansi multi mata uang, dan mekanisme
cadangan basis data yang sudah diuji pulih. Urutannya sama seperti kebijakan akuntansi: kalau ada
penyesuaian, ubah di sini dulu, lalu di kode, lalu catat di bagian Riwayat.

---

## 1. Alur persetujuan dokumen (maker-checker)

### 1.1 Masalah yang diselesaikan

Sebelumnya pengendalian Produksia hanya hak akses: siapa pun yang punya hak `buat` bisa membuat
dokumen, dan jurnalnya langsung masuk buku besar dalam transaksi yang sama. Satu orang karena itu
bisa mencatat pengeluaran kas, penggajian, atau penyesuaian stok tanpa diperiksa siapa pun. Dalam
kerangka pengendalian internal (COSO, dan pembahasan *segregation of duties* di literatur SIA),
pencatatan transaksi dan otorisasinya harus dipegang orang yang berbeda.

Sekarang dokumen tidak langsung membentuk jurnal. Dokumen baru lahir sebagai draf, pembuatnya
mengajukan, dan pengguna lain yang berhak yang memutuskan. Jurnal dicatat pada saat persetujuan
diberikan, di dalam transaksi basis data yang sama dengan perubahan statusnya.

### 1.2 Daur hidup status

```
                  ajukan                     setujui
   [ DRAFT ] ---------------> [ MENUNGGU ] -------------> [ DISETUJUI ]
       |                          |                        jurnal dicatat,
       |                          |                        saldo buku besar berubah
       |         tolak            | tolak
       +------------> [ DITOLAK ] <+
                           |
                           | ajukan ulang (setelah diperbaiki)
                           +----------------> [ MENUNGGU ]

   DRAFT / MENUNGGU / DITOLAK : belum ada jurnal sama sekali
   DISETUJUI                  : jurnalnya ada; koreksi dilakukan dengan menghapus dokumen
```

Aturan transisinya ada di `ASAL_SAH` pada `src/lib/persetujuan.ts`:

| Tujuan | Status asal yang sah | Catatan |
|---|---|---|
| MENUNGGU | DRAFT, DITOLAK | dokumen yang ditolak boleh diajukan ulang setelah diperbaiki; catatan penolakan dibersihkan |
| DISETUJUI | MENUNGGU | satu-satunya jalan masuk ke buku besar |
| DITOLAK | DRAFT, MENUNGGU | menolak draf dipakai membatalkan draf lama yang tidak akan dipakai |

Dokumen yang sudah DISETUJUI tidak bisa dikembalikan ke status lain. Koreksinya memakai jalan yang
sudah ada di Produksia sejak awal: hapus dokumen (seluruh efek stok dan jurnalnya dibalik dalam satu
transaksi, dicatat di log aktivitas), lalu buat ulang.

### 1.3 Pemisahan tugas: pengaju tidak boleh menyetujui dokumennya sendiri

Ini pengendalian intinya, dan diperiksa di server, bukan sekadar disembunyikan dari tampilan.
Fungsinya `pastikanBukanPengaju` di `src/lib/persetujuan.ts`, dipanggil di aksi `setujuiDokumen`
dan `tolakDokumen` sebelum apa pun ditulis:

```
Faktur Penjualan FJ-2026-0002 diajukan oleh Anda sendiri. Pemisahan tugas: pembuat dokumen
tidak boleh menyetujui dokumennya sendiri, minta pengguna lain yang berhak menyetujui
```

Pemeriksaannya membandingkan `diajukanOlehId` dengan id pengguna sesi. Tombol "Setujui" juga
disembunyikan untuk pengaju, tetapi itu hanya kenyamanan; permintaan yang dikirim langsung ke aksi
server tetap ditolak.

Kenapa ini penting untuk SIA: tanpa pemisahan pencatatan dan otorisasi, satu orang bisa menciptakan
transaksi fiktif dan mengesahkannya sendiri, dan jejak auditnya tetap terlihat "wajar" karena semua
tahap dikerjakan oleh akun yang memang berhak. Dengan aturan ini, setiap nilai yang masuk buku besar
punya minimal dua nama di belakangnya, tercatat di kolom `diajukanOleh`/`disetujuiOleh` dokumen dan
di `LogAktivitas`.

### 1.4 Hak akses

`AksiDokumen` di `src/lib/hakAkses.ts` bertambah satu tindakan: `setujui`. Jadi setiap jenis dokumen
sekarang punya hak `lihat`, `buat`, `setujui`, `hapus`.

| Peran | `buat` | `setujui` | Akibatnya |
|---|---|---|---|
| Superadmin, Pemilik | ya | ya | bisa keduanya, tetapi tetap tidak pada dokumen yang sama |
| Admin | ya | ya | sama; dua admin bisa saling memeriksa |
| Kasir | ya (penjualan, pembelian, kas) | tidak | pembuat dokumen |
| Gudang | ya (surat jalan, terima barang, stok) | tidak | pembuat dokumen |

Bawaan ini bisa diubah Pemilik di Pengaturan › Hak Akses seperti hak lainnya. Susunan bawaannya
sudah membentuk pemisahan yang wajar untuk EO kecil: Kasir dan Gudang mencatat, Admin dan Pemilik
memeriksa.

### 1.5 Jenis dokumen yang sudah tersambung

Kolom persetujuan (`statusPersetujuan`, `diajukanOleh/Pada`, `disetujuiOleh/Pada`,
`ditolakOleh/Pada`, `catatanPenolakan`) ditambahkan ke **21 model dokumen transaksi** plus model baru
`DokumenKas`, jadi datanya lengkap untuk semua jenis dokumen. Yang **alur kerjanya** sudah jalan
penuh (draf, ajukan, setujui/tolak, jurnal dicatat saat disetujui) ada enam, satu dari tiap siklus:

| Dokumen | Modul | Yang ditahan sampai disetujui |
|---|---|---|
| Faktur Penjualan (FJ) | Penjualan | jurnal piutang, pendapatan, PPN, diskon, HPP |
| Faktur Pembelian (FB) | Pembelian | jurnal hutang, PPN masukan, beban/persediaan |
| Kas Masuk (KM) & Kas Keluar (KK) | Kas & Bank | seluruh jurnal kasnya |
| Penyesuaian Stok (PS) | Persediaan | jurnal **dan** mutasi stok fisiknya |
| Aset Tetap (perolehan) | Aset Tetap | jurnal perolehan; aset juga belum ikut penyusutan dan belum bisa dilepas |
| Penggajian (GJ) | SDM | jurnal beban gaji, potongan, dan kas keluar |

Jenis dokumen berikut **belum** tersambung dan perilakunya sama persis seperti sebelumnya
(hak akses `buat` saja, jurnal langsung dicatat, statusnya diisi DISETUJUI supaya datanya jujur):
Penawaran, Pesanan Penjualan, Uang Muka, Surat Jalan, Penerimaan Penjualan, Retur Penjualan,
Pesanan Pembelian, Terima Barang, Pembayaran Pembelian, Retur Pembelian, Jurnal Umum manual,
Pindah Barang, Penyusutan, Pelepasan Aset, Prive, PPh Final Bulanan, Tutup Buku.

Menyambungkannya tinggal menambah satu entri di `BERKAS` pada `src/lib/persetujuan.ts` (cara membaca
statusnya, menulis statusnya, dan mencatat jurnalnya) lalu memindahkan panggilan jurnal di aksi
pembuatannya ke belakang saklar `perluPersetujuan`. Logika transisi, pemisahan tugas, dan log
aktivitas tidak perlu ditulis ulang.

### 1.6 Kas Masuk / Kas Keluar dan model `DokumenKas`

Di Produksia berlaku aturan tetap: **adanya satu baris `Jurnal` berarti transaksinya sudah masuk
buku besar.** Semua laporan (Neraca, Laba Rugi, Arus Kas, Pajak, basis kas, rekonsiliasi) membaca
`Jurnal` tanpa menyaring status. Kas Masuk dan Kas Keluar dulu langsung berupa baris `Jurnal` tanpa
dokumen induk, jadi drafnya tidak bisa disimpan sebagai `Jurnal` tanpa ikut mengubah semua laporan.

Karena itu ada model `DokumenKas`: niat transaksi kas disimpan di sana sebagai draf, dan jurnal KM/KK
baru dibuat lalu ditautkan (`DokumenKas.jurnalId`) pada saat dokumen disetujui. Halaman Kas Masuk dan
Kas Keluar menampilkan tabel "Menunggu persetujuan" di atas tabel jurnal yang sudah dibukukan.

Konsekuensi dari aturan yang sama: `Jurnal.statusPersetujuan` bawaannya DISETUJUI, bukan DRAFT.
Kolomnya tetap ada supaya jejak siapa yang menyetujui bisa disimpan, tetapi nilainya tidak pernah
selain DISETUJUI.

### 1.7 Penyesuaian Stok menahan mutasi fisik juga

Penyesuaian Stok satu-satunya dokumen yang efek non-jurnalnya juga ditahan. Kalau stok dipindah saat
draf, jumlah barang di gudang akan berbeda dari saldo akun Persediaan selama dokumen menunggu, dan
pemeriksaan sinkronisasi (`skrip/uji-sinkron.ts`) akan menganggapnya tidak konsisten.

`jumlahSebelum` pada baris penyesuaian adalah potret stok saat draf dibuat. Pada saat disetujui,
stoknya dibaca ulang dan dibandingkan; kalau sudah berubah karena transaksi lain, persetujuannya
ditolak dengan pesan yang menyebut angka lama dan angka sekarang, dan dokumennya harus ditolak lalu
dibuat ulang. Itu lebih aman daripada menerapkan potret yang sudah usang.

Untuk lima jenis lainnya, efek operasional (progres pesanan, pemakaian uang muka, konsumsi baris
surat jalan, penyesuaian harga pokok rata-rata) tetap terjadi saat draf dibuat, karena efek itu
mengunci kuantitas supaya tidak dipakai dua dokumen sekaligus. Yang ditahan adalah jurnalnya.

Satu akibat teknisnya: Faktur Penjualan mengonsumsi baris Surat Jalan saat draf dibuat, sedangkan
jurnal HPP-nya baru dicatat saat disetujui. Nilai konsumsi itu disimpan per baris faktur di kolom
`BarisFakturPenjualan.nilaiTransit`, jadi jurnalnya bisa dicatat belakangan tanpa menghitung ulang
harga pokok yang mungkin sudah berubah.

### 1.8 Tahun buku yang sudah ditutup

`pastikanTahunTerbuka` di `src/lib/tutupBuku.ts` tidak diubah. Yang berubah adalah kapan ia dipanggil:

- **Menyetujui** memanggilnya dengan **tanggal dokumen**, sebelum jurnalnya dicatat. Draf lama yang
  bertanggal tahun yang sudah ditutup karena itu tidak bisa disetujui.
- **Menolak** tidak memanggilnya sama sekali, jadi draf tertinggal dari tahun yang sudah ditutup
  tetap bisa dibersihkan.
- Jurnal hasil persetujuan memakai **tanggal dokumen**, bukan tanggal saat disetujui, supaya laporan
  tidak bergeser periode hanya karena pemeriksa menyetujui terlambat.

### 1.9 Jejak audit

Setiap perpindahan status dicatat di `LogAktivitas` dengan pola yang sama seperti 18 pemanggilan yang
sudah ada (`penggunaId` null untuk pengguna semu skrip uji, `penggunaNama`, `aksi`, `jenis`, `nomor`,
`keterangan`):

| `aksi` | `keterangan` |
|---|---|
| AJUKAN | `Diajukan untuk persetujuan; <ringkasan dokumen>` |
| SETUJUI | `Disetujui, jurnal dicatat; <ringkasan dokumen>` |
| TOLAK | `Ditolak: <alasan yang diisi pemeriksa>` |

Alasan penolakan wajib diisi (maksimal 500 karakter) supaya pembuat dokumen tahu apa yang harus
diperbaiki, dan alasannya ikut tersimpan di kolom `catatanPenolakan` dokumen.

### 1.10 Saklar `wajibPersetujuan`

Pengaturan › Perusahaan & Pajak punya satu kotak centang, "Wajib persetujuan (maker-checker)", yang
bawaannya menyala (`PengaturanPerusahaan.wajibPersetujuan`, bawaan kolom `true`). Mematikannya
membuat keenam jenis dokumen itu kembali ke perilaku lama: dibuat oleh satu orang, jurnalnya langsung
dicatat, statusnya diisi DISETUJUI dengan pembuatnya sebagai penyetuju.

Saklar ini ada karena usaha yang stafnya dua orang memang tidak bisa memisahkan tugas, dan ini pola
yang dipakai ERP lain (Accurate, Odoo) untuk hal yang sama. Kalimat peringatannya ditulis apa adanya
di halaman pengaturan: mematikannya menghapus pengendalian pemisahan tugas.

Di dalam skrip regresi (`skrip/uji-*.ts`) alur persetujuan MATI secara bawaan, karena skrip lama
memeriksa "buat dokumen, jurnalnya langsung ada". Skrip yang memang menguji alur persetujuan
menyalakannya sendiri lewat `aturPersetujuan(true)`. Pintu ini hanya terbuka di luar produksi dan
hanya bila `UJI_TANPA_SESI=1`, sama seperti pintu uji yang sudah ada di `src/lib/otentikasi.ts`.

### 1.11 Tampilan

- **Persetujuan** (`/persetujuan`): kotak masuk berisi semua dokumen yang masih DRAFT, MENUNGGU, atau
  DITOLAK dari jenis yang sudah tersambung, diurutkan dengan MENUNGGU di atas, plus tombol tindakannya.
  Tautannya ada di sidebar di bawah Beranda, dan hanya tampil bagi yang berhak membuat atau menyetujui.
- Daftar Faktur Penjualan, Faktur Pembelian, Penyesuaian Stok, Aset Tetap, dan Penggajian mendapat
  kolom "Persetujuan" berisi lencana status dan tombol Ajukan / Setujui / Tolak.
- Tindakan lanjutan disembunyikan sampai dokumennya disetujui: Terima Bayar dan Retur pada faktur
  penjualan, Bayar dan Retur pada faktur pembelian, Lepas pada aset tetap.
- Komponennya `src/komponen/KontrolPersetujuan.tsx` (`KontrolPersetujuan` dan `SelPersetujuan`),
  memakai `FormulirAksi` dan kelas gaya yang sudah ada. Alasan penolakan diisi di `<details>` berisi
  textarea, jadi tidak ada sistem dialog baru.

### 1.12 Laporan yang membaca tabel dokumen

Sebagian besar laporan membaca `BarisJurnal`, jadi dokumen yang belum disetujui otomatis tidak ikut
karena jurnalnya belum ada. Tetapi ada beberapa tempat yang membaca tabel dokumen langsung, dan itu
harus ikut menyaring status, kalau tidak angka dokumen akan berbeda dari saldo buku besar selama
dokumen menunggu:

| Berkas | Yang disaring |
|---|---|
| `src/lib/sinkron.ts` | Σ total faktur penjualan & pembelian pembanding saldo Piutang/Hutang |
| `src/lib/laporanRekanan.ts` | Laporan Piutang & Laporan Hutang (umur piutang) |
| `src/lib/pajak.ts` | DPP & PPN keluaran/masukan di Pajak & SPT |
| `src/app/(aplikasi)/page.tsx` | KPI piutang, KPI hutang, dan nilai buku aset tetap di Beranda |

Daftar dokumen per modul sengaja **tidak** disaring: di situ draf memang harus terlihat, dan ada
kolom status beserta tombol tindakannya.

Dua pemeriksaan di `skrip/uji-persetujuan.ts` mengunci perilaku ini: saat ada faktur DRAFT,
`periksaSinkron` tetap cocok dan Laporan Piutang belum memuat fakturnya; setelah disetujui, keduanya
ikut naik dengan nilai yang sama.

### 1.13 Berkas terkait

| Berkas | Isi |
|---|---|
| `src/lib/persetujuan.ts` | penjaga transisi, pemeriksaan pengaju, log aktivitas, dan `BERKAS` (cara menangani tiap jenis dokumen) |
| `src/lib/aksi/persetujuan.ts` | aksi server `ajukanDokumen`, `setujuiDokumen`, `tolakDokumen` untuk semua jenis, pola sama dengan `hapusDokumen.ts` |
| `src/komponen/KontrolPersetujuan.tsx` | tombol & lencana per dokumen |
| `src/app/(aplikasi)/persetujuan/page.tsx` | kotak masuk persetujuan |
| `skrip/uji-persetujuan.ts` | uji regresi alur persetujuan keenam jenis dokumen |

---

## 2. Multi mata uang

### 2.1 Mata uang transaksi dan mata uang fungsional

Rupiah adalah **mata uang fungsional** (mata uang pelaporan): seluruh buku besar dicatat dalam IDR,
jadi Neraca, Laba Rugi, Arus Kas, dan perhitungan pajak tidak pernah mencampur satuan. Mata uang
asing hanya melekat pada **dokumen** dan pada **saldo piutang/hutang** yang dokumen itu bentuk. Ini
pola yang sama dengan Accurate, Xero, dan QuickBooks, dan sejalan dengan PSAK 10 (mata uang
fungsional dipakai untuk pelaporan; transaksi mata uang asing dijabarkan ke mata uang fungsional
dengan kurs saat transaksi).

| Model | Kolom baru | Arti |
|---|---|---|
| `MataUang` | `kode`, `nama`, `simbol`, `desimal`, `aktif`, `fungsional` | daftar mata uang; tepat satu baris `fungsional = true` (IDR) |
| `KursMataUang` | `mataUangId`, `tanggal`, `kurs`, `sumber`, `dicatatOleh` | riwayat kurs, unik per (mata uang, tanggal); 1 unit = `kurs` rupiah |
| `Pelanggan`, `Pemasok` | `mataUangId` | mata uang bawaan rekanan (kosong = IDR) |
| `FakturPenjualan`, `FakturPembelian` | `mataUangId`, `kurs`, `nilaiAsli`, `kursRevaluasi`, `revaluasiPada` | mata uang transaksi, kurs yang dipakai, nilai dalam mata uang itu, dan kurs yang saldo terbukanya sedang dibawa |
| `PenerimaanPenjualan`, `PembayaranPembelian` | `mataUangId`, `kurs`, `nilaiAsli` | informasional (lihat 2.6) |
| `BarisJurnal` | `mataUangAsliId`, `kursAsli`, `nilaiAsli` | jejak nilai dokumen dalam mata uang asalnya; kolom `debit`/`kredit` tetap IDR |
| `PemetaanAkun` | `selisihKursId` | akun penampung laba/rugi kurs (bagan akun standar: 5-8530 Selisih Kurs) |

Pemetaan Selisih Kurs ditaruh di `PemetaanAkun`, bukan di `PengaturanPerusahaan`, karena `PemetaanAkun`
memang tempat pemetaan akuntansi umum (Piutang, Persediaan, HPP, Selisih Persediaan, Diskon
Penjualan), sedangkan `PengaturanPerusahaan` memuat akun pajak. Selisih kurs sejenis Selisih
Persediaan.

### 2.2 Kurs disimpan di dokumen (snapshot)

Kurs yang dipakai sebuah dokumen disimpan di dokumennya. Kurs baru yang dimasukkan belakangan karena
itu tidak pernah menggeser jurnal yang sudah tercatat. Ini diuji langsung di `skrip/uji-mata-uang.ts`
bagian 3.

Urutan penentuan kurs saat dokumen dibuat: nilai yang diisi di formulir (kurs kontrak atau kurs bank
hari itu), kalau kosong memakai kurs terakhir yang tercatat sampai tanggal dokumen. Kalau mata uangnya
belum punya satu pun kurs, transaksinya ditolak dengan pesan yang menyebut apa yang harus diisi, dan
tidak pernah diam-diam memakai kurs 1.

### 2.3 Buku besar tetap rupiah

`catatJurnal` di `src/lib/akuntansi.ts` menerima pilihan `asli: { mataUangId, kurs }`. Kalau diisi,
setiap baris jurnal ikut menyimpan `mataUangAsliId`, `kursAsli`, dan `nilaiAsli` (nilai rupiah baris
itu dibagi kurs). Kolom `debit` dan `kredit` tetap rupiah. Jadi nilai asli dokumen tetap bisa
ditelusuri dari buku besar tanpa laporan apa pun harus tahu soal mata uang.

### 2.4 Penilaian kembali (revaluasi) piutang & hutang

`src/lib/selisihKurs.ts` menyediakan `hitungRevaluasi` (pratinjau, tanpa menulis) dan
`jalankanRevaluasi` (mencatat jurnal). Bisa dijalankan kapan saja dari Pengaturan › Mata Uang & Kurs,
biasanya per akhir bulan atau akhir tahun buku.

Hitungannya per faktur mata uang asing yang statusnya DISETUJUI dan saldonya masih terbuka:

```
saldo terbuka (rupiah, kurs dokumen) = total − uang muka − penerimaan/pembayaran − retur
saldo terbuka (mata uang asing)      = saldo terbuka rupiah / kurs dokumen
kurs yang sedang dibawa              = kursRevaluasi bila pernah dinilai, kalau belum = kurs dokumen
selisih                              = saldo terbuka (asing) × (kurs baru − kurs yang dibawa)
```

Arah jurnalnya:

| Keadaan | Jurnal | Artinya |
|---|---|---|
| nilai rupiah piutang naik | Dr Piutang Usaha / Cr Selisih Kurs | laba kurs |
| nilai rupiah piutang turun | Dr Selisih Kurs / Cr Piutang Usaha | rugi kurs |
| nilai rupiah hutang naik | Dr Selisih Kurs / Cr Hutang Usaha | rugi kurs |
| nilai rupiah hutang turun | Dr Hutang Usaha / Cr Selisih Kurs | laba kurs |

Satu kali jalan menghasilkan satu jurnal JU-SK yang seimbang, bertanggal tanggal penilaian, dengan
sumber `SELISIH_KURS`, lalu `kursRevaluasi` tiap faktur yang ikut dinilai diperbarui. Karena kurs
yang dibawa disimpan di dokumen, menjalankan penilaian dua kali pada kurs yang sama tidak membuat
jurnal baru, dan penilaian periode berikutnya hanya mencatat perubahan sejak penilaian terakhir.
Tidak perlu jurnal pembalik di awal periode. Sifat idempoten ini diuji di `skrip/uji-mata-uang.ts`
bagian 5.

Contoh yang dipakai di uji regresi: faktur 2.000 unit mata uang asing pada kurs 15.000 (Rp 30.000.000),
kurs akhir periode 16.000, selisih 2.000 × 1.000 = Rp 2.000.000 laba kurs, jurnalnya Dr Piutang
Rp 2.000.000 / Cr Selisih Kurs Rp 2.000.000.

### 2.5 Pemeriksaan terhadap `src/lib/laporan.ts`

Diperiksa, dan tidak ada yang perlu diubah. `saldoAkunPeriode` dan `hitungLabaRugiBulanan` menjumlahkan
`BarisJurnal.debit` dan `BarisJurnal.kredit`, dan kedua kolom itu selalu rupiah. Kolom
`mataUangAsliId`/`kursAsli`/`nilaiAsli` tidak pernah dibaca laporan. Dokumen mata uang asing karena
itu tidak bisa mencemari total rupiah: yang masuk laporan sudah dijabarkan ke rupiah pada saat
jurnalnya dicatat. Hal yang sama berlaku untuk `arusKas.ts`, `pajak.ts`, dan `basisKas.ts` yang
sama-sama membaca dari `BarisJurnal`.

### 2.6 Pertanyaan desain yang masih terbuka

Tiga hal berikut sengaja tidak dikerjakan karena aturannya belum jelas untuk usaha ini, dan menebak
akan menghasilkan akuntansi yang salah. Ketiganya perlu keputusan pemilik dulu.

**a. Arah pengisian nilai baris.** Sekarang baris faktur diisi dalam rupiah, dan nilai dalam mata uang
transaksi (`nilaiAsli`) dihitung dari total dibagi kurs. Di sistem multi mata uang penuh, harga per
baris diisi dalam mata uang transaksi dan rupiahnya yang dihitung. Mengubah arahnya menyentuh harga
jual/harga minimum di data induk barang (keduanya rupiah), pemeriksaan hak nego harga, dan penilaian
persediaan, jadi belum dikerjakan. Yang perlu diputuskan: apakah kontrak mata uang asing D'Production
memang dinegosiasikan per baris dalam mata uang asing, atau totalnya saja.

**b. Laba/rugi kurs terealisasi saat pelunasan.** Yang sudah ada baru laba/rugi kurs belum terealisasi
(penilaian kembali saldo terbuka). Kalau piutang USD dilunasi pada kurs yang berbeda dari kurs faktur,
selisihnya adalah laba/rugi kurs terealisasi dan seharusnya diakui saat itu. Sekarang pelunasan diisi
dalam rupiah dan penjaga "jumlah bayar melebihi sisa tagihan" akan menolak pembayaran yang nilai
rupiahnya lebih besar dari sisa faktur. Kolom `mataUangId`/`kurs`/`nilaiAsli` sudah ada di
`PenerimaanPenjualan` dan `PembayaranPembelian` untuk menampung datanya, tetapi jurnal selisihnya
belum dibuat. Yang perlu diputuskan: apakah sisa tagihan dibandingkan dalam mata uang asing (sehingga
pelunasan penuh selalu diterima berapa pun kursnya, dan selisih rupiahnya jadi laba/rugi kurs), dan
apakah selisih itu masuk akun Selisih Kurs yang sama.

**c. Kas/bank dalam mata uang asing.** Rekening bank valuta asing berarti akun kas/bank itu sendiri
punya mata uang dan ikut dinilai kembali. Sekarang akun kas/bank tidak punya mata uang, jadi penilaian
kembali hanya menyentuh piutang dan hutang usaha. Perlu diputuskan lebih dulu apakah D'Production
memang punya rekening valuta asing.

Selain itu: PPN atas transaksi mata uang asing memakai kurs pajak (Kurs Menteri Keuangan), yang bisa
berbeda dari kurs yang dipakai dokumen. Karena perusahaan saat ini non-PKP, hal ini belum relevan;
begitu jadi PKP, `kurs` dokumen dan kurs pajak perlu dipisah.

---

## 3. Cadangan & pemulihan basis data

### 3.1 Cakupan

Skrip di bagian ini **hanya untuk basis data pengembangan lokal**. Skripnya menolak berjalan bila
`DATABASE_URL` menunjuk host non-lokal, kecuali dipaksa dengan `IZINKAN_NON_LOKAL=1`. Cadangan basis
data produksi di VPS adalah pekerjaan terpisah yang butuh persetujuan pemilik lebih dulu; lihat 3.6.

### 3.2 Tiga skrip

Ditaruh di `skrip/` mengikuti susunan repositori ini (semua skrip ada di `skrip/`, penamaannya bahasa
Indonesia).

| Skrip | Tugas |
|---|---|
| `skrip/cadangkan-basis-data.sh` | `pg_dump` format custom (`-Fc`) ke `cadangan/produksia-<db>-<stempel waktu>.dump` |
| `skrip/pulihkan-basis-data.sh` | memulihkan sebuah dump ke basis data uji TERPISAH (bawaan `produksia_restore_test`), yang dibuat ulang dari nol |
| `skrip/verifikasi-cadangan.sh` | memulihkan lalu MEMBANDINGKAN hasilnya dengan basis data sumber |
| `skrip/lib-basis-data.sh` | pembantu bersama: mencari biner PostgreSQL, membaca `DATABASE_URL` dari `.env`, menyusun URL basis data lain |

Cara memakai:

```bash
# cadangkan basis data pengembangan
skrip/cadangkan-basis-data.sh

# cadangkan lalu buang cadangan yang sudah kedaluwarsa
skrip/cadangkan-basis-data.sh --pangkas

# pulihkan cadangan terakhir ke produksia_restore_test
skrip/pulihkan-basis-data.sh

# pulihkan + periksa keutuhan datanya (ini yang membuktikan cadangannya sah)
skrip/verifikasi-cadangan.sh
skrip/verifikasi-cadangan.sh cadangan/produksia-produksia-20260914-204018.dump

# mencadangkan basis data lokal lain
DATABASE_URL="postgresql://mcdonny@localhost:5432/produksia?schema=public" skrip/verifikasi-cadangan.sh

# kalau pg_dump tidak ada di PATH (mis. Postgres.app di macOS)
BIN_PG=/Applications/Postgres.app/Contents/Versions/latest/bin skrip/cadangkan-basis-data.sh
```

Catatan teknis:

- Format custom (`-Fc`) dipilih karena terkompresi, bisa dipulihkan sebagian (`--table`/`--schema`),
  dan `pg_restore` bisa memulihkannya paralel.
- `DATABASE_URL` dibaca dengan cara yang sama seperti aplikasi (`.env` di akar repositori, kolom
  `DATABASE_URL`), lalu parameter khusus Prisma yang tidak dipahami libpq (`schema`,
  `connection_limit`, `pgbouncer`, dan sejenisnya) dibuang sebelum diserahkan ke `pg_dump`/`psql`.
- Biner PostgreSQL dicari di `PATH` lebih dulu, lalu di lokasi lazim (Postgres.app, Homebrew,
  `/usr/lib/postgresql/*`).
- Basis data tujuan pemulihan dibuat ulang setiap kali, dan skripnya menolak kalau nama tujuannya sama
  dengan basis data pengembangan. Uji pemulihan karena itu aman dijalankan kapan saja.
- Direktori `cadangan/` sudah masuk `.gitignore`, jadi berkas dump tidak pernah ikut ke repositori.

### 3.3 Yang dibuktikan verifikasi

"Perintah selesai tanpa galat" tidak dianggap bukti. Yang dianggap bukti adalah angka-angkanya cocok,
dan angkanya dicetak apa adanya supaya bisa dibaca orang:

1. Jumlah baris tabel kunci sama antara sumber dan hasil pemulihan: `Pengguna`, `Akun`, `Jurnal`,
   `BarisJurnal`, `FakturPenjualan`, `FakturPembelian`, `StokBarang`, `LogAktivitas`.
2. Total debit sama dengan total kredit di `BarisJurnal` hasil pemulihan, jadi buku besar salinannya
   tetap seimbang.
3. Setiap `Jurnal` punya minimal satu `BarisJurnal` (tidak ada jurnal yang barisnya hilang).
4. Tidak ada `BarisJurnal` yatim (`jurnalId` dan `akunId`-nya ada semua).
5. Tidak ada nilai debit/kredit negatif.
6. Jumlah tabel di skema `public` sama.

Keluaran sungguhan dari basis data pengembangan `produksia` pada 14 September 2026:

```
== Verifikasi cadangan ==
Sumber : produksia
Salinan: produksia_restore_test

1. Jumlah baris tabel kunci
  TABEL                      SUMBER      PULIHAN
  Pengguna                        6            6  cocok
  Akun                          117          117  cocok
  Jurnal                         23           23  cocok
  BarisJurnal                    55           55  cocok
  FakturPenjualan                 1            1  cocok
  FakturPembelian                 1            1  cocok
  StokBarang                      4            4  cocok
  LogAktivitas                    3            3  cocok

2. Keseimbangan buku besar di salinan hasil pemulihan
  debit  = 70094555.00
  kredit = 70094555.00
  [ok]   debit = kredit (selisih 0.00)

3. Keutuhan relasi di salinan hasil pemulihan
  [ok]   setiap Jurnal punya baris (0 jurnal kosong)
  [ok]   tidak ada BarisJurnal yatim (jurnal & akunnya ada semua)
  [ok]   tidak ada nilai debit/kredit negatif
  [ok]   jumlah tabel sama (57)

== CADANGAN TERVERIFIKASI: cadangan/produksia-produksia-20260914-204018.dump bisa dipulihkan dan datanya utuh ==
```

### 3.4 Retensi

Cadangan harian disimpan 14 hari. Cadangan yang dibuat hari Minggu diberi akhiran `-mingguan` dan
disimpan 8 minggu. Pemangkasan hanya berjalan bila skrip dipanggil dengan `--pangkas`, jadi
menjalankan cadangan biasa tidak pernah menghapus apa pun.

### 3.5 Jadwal yang disarankan (sengaja TIDAK dipasang)

Tidak ada cron yang dipasang oleh pekerjaan ini. Berikut entri yang disarankan, untuk dipasang sendiri
setelah disetujui:

```cron
# cadangan harian 02:00, sekaligus memangkas yang kedaluwarsa
0 2 * * * cd /path/ke/produksia && skrip/cadangkan-basis-data.sh --pangkas >> cadangan/cadangan.log 2>&1

# verifikasi cadangan terakhir tiap Senin 03:00 (pulihkan ke basis data uji lalu cek keutuhannya)
0 3 * * 1 cd /path/ke/produksia && skrip/verifikasi-cadangan.sh >> cadangan/verifikasi.log 2>&1
```

Langkah verifikasi terjadwal itu bukan tambahan: cadangan yang tidak pernah diuji pulih tidak bisa
disebut cadangan.

### 3.6 Basis data produksi (VPS)

Belum dikerjakan dan sengaja tidak disentuh. Basis data produksi ada di VPS dan dijalankan lewat
Docker Compose (lihat `docker-compose.yml` dan `DEPLOY.md`), jadi cadangannya perlu keputusan
tersendiri soal beberapa hal: dijalankan di dalam kontainer `db` atau dari host, disimpan di mana
(NAS, penyimpanan objek), berapa lama disimpan, apakah dienkripsi, dan siapa yang boleh
memulihkannya. Ketiga skrip di atas bisa dipakai di server dengan `DATABASE_URL` dan `DIR_CADANGAN`
yang sesuai, tetapi menjalankannya di produksi butuh persetujuan pemilik lebih dulu.

---

## 4. Apa yang belum selesai

Alur persetujuan:

- 17 jenis dokumen belum tersambung ke alur persetujuan (daftarnya di 1.5). Kolom datanya sudah ada,
  perilakunya masih seperti sebelumnya.
- Jurnal Umum manual belum bisa berstatus draf, karena barisnya bebas dan draf-nya perlu tempat
  penyimpanan sendiri seperti `DokumenKas`.
- Belum ada batas nilai persetujuan (misalnya pengeluaran di atas Rp 10 juta harus disetujui Pemilik)
  maupun persetujuan berjenjang. Sekarang satu persetujuan dari siapa pun yang punya hak `setujui`
  sudah cukup.
- Belum ada pemberitahuan (surel atau pesan) saat dokumen menunggu persetujuan; pemeriksa perlu
  membuka halaman Persetujuan.
- Tidak ada tenggat otomatis; dokumen bisa menunggu tanpa batas waktu.
- Mengubah isi dokumen yang ditolak belum bisa dilakukan langsung. Caranya masih seperti aturan lama
  Produksia: hapus lalu buat ulang. Tombol "Ajukan Ulang" berguna bila yang ditolak hanya perlu
  penjelasan tambahan, bukan perubahan angka.

Multi mata uang:

- Tiga pertanyaan desain di 2.6 (arah pengisian nilai baris, laba/rugi kurs terealisasi, rekening
  valuta asing) belum diputuskan dan belum dikerjakan.
- Kurs tidak diambil otomatis dari sumber mana pun (BI, kurs pajak). Kurs diisi tangan di
  Pengaturan › Mata Uang & Kurs, dan kolom `sumber` dipakai mencatat asalnya.
- Laporan Piutang dan Laporan Hutang belum menampilkan kolom mata uang atau saldo dalam mata uang
  asing; keduanya masih murni rupiah.
- Pesanan, penawaran, surat jalan, dan retur belum punya mata uang. Yang punya baru faktur penjualan,
  faktur pembelian, penerimaan, dan pembayaran.
- Penilaian kembali hanya menyentuh Piutang Usaha dan Hutang Usaha lewat pemetaan akun, jadi piutang
  atau hutang mata uang asing yang dicatat lewat jurnal manual ke akun lain tidak ikut dinilai.

Cadangan:

- Cadangan produksi belum ada (3.6).
- Tidak ada cron yang dipasang (3.5).
- Tidak ada penyalinan otomatis dump ke luar mesin. Dump masih di disk yang sama dengan basis datanya,
  jadi belum melindungi dari kerusakan disk.
- Dump tidak dienkripsi. Isinya memuat data pengguna dan hash kata sandi, jadi kalau nanti disimpan di
  luar mesin, enkripsinya perlu diputuskan lebih dulu.

---

## 5. Riwayat

- 14 Sep 2026: dokumen pertama, bersama alur persetujuan maker-checker (6 jenis dokumen tersambung
  penuh, kolom data di 21 model + `DokumenKas`), akuntansi multi mata uang (mata uang transaksi, kurs
  yang disimpan per dokumen, penilaian kembali piutang/hutang), dan cadangan basis data lokal yang
  sudah diuji pulih beserta pemeriksaan keutuhan datanya.
