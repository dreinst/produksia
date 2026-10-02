# Produksia: Requirement Gathering & PRD Modul Peminjaman Barang (Loading In/Out), Warna & Foto Barang

Disusun mengikuti kerangka **Prompt & Checklist Requirement Gathering** (perspektif Senior Fullstack Developer, Bagian 1 sampai 3) yang diberikan pemilik proyek. Dokumen ini turunan dari `Produksia-Requirement-Gathering-PRD.md` (PRD induk) dan hanya membahas penambahan modul baru yang disepakati pada diskusi 18 September 2026.

Status: disetujui pemilik (Donny) 18 September 2026. Implementasi berjalan di lokal, deploy menunggu laporan audit.

---

## Bagian 1: Hasil "Wawancara" (ringkasan konteks)

**Masalah yang mau diselesaikan:** peralatan event (traffic cone, kabel tray, kursi kuliah, velbed, dan seterusnya) keluar gudang dibawa kru ke lokasi acara lalu kembali. Sampai sekarang tidak ada catatan siapa yang membawa, kapan, berapa, dan bukti fotonya. Data barang juga belum punya warna dan foto, padahal kru sering perlu memastikan barang yang benar.

**Yang diminta pemilik (verbatim, diringkas):** di halaman Barang & Jasa tambah kolom warna dan tombol unggah foto (butuh tabel foto baru). Tambah satu halaman form loading in dan loading out (timestamp, siapa yang ambil, barang apa, foto bukti), keduanya di satu halaman sebagai form pengambilan/peminjaman barang.

**Target pengguna utama:** peran Gudang (kru yang mencatat di lapangan lewat HP), Admin ke atas (koreksi, hapus, menutup selisih lewat Penyesuaian Stok).

**Bisnis baru atau migrasi:** penambahan modul di sistem yang sudah berjalan (Produksia di Vercel, basis data PostgreSQL di VPS). Bukan migrasi data lama; riwayat pengambilan sebelum modul ini tidak dimasukkan.

---

## Bagian 2: Checklist Requirement (terisi)

### A. Model Bisnis & Produk

| Pertanyaan | Jawaban |
|---|---|
| Apa yang dicatat? | Peminjaman (custody) peralatan milik sendiri ke lokasi event. Bukan penjualan, bukan pembelian, bukan pindah antar gudang. Kepemilikan tidak berubah, hanya lokasi fisik. |
| Siapa pelakunya? | Kru tetap dan kru lepas (freelance, sopir, vendor) yang namanya tidak selalu ada di data induk Karyawan. |
| Proses di lapangan | Kru ambil barang di gudang, foto bukti, catat. Barang kembali (bisa sebagian, bisa bertahap), foto bukti kembali, catat. Kalau ada yang hilang atau rusak total, dokumen ditutup dengan selisih dan Admin membereskan nilai persediaan lewat Penyesuaian Stok. |
| Hubungan dengan modul lain | Opsional dikaitkan ke Proyek (event) untuk penelusuran alat per acara. Tidak menyentuh jurnal dan tidak mengubah angka stok akuntansi. |
| Baru atau migrasi | Modul baru di atas skema yang ada; satu migrasi aditif. |

### B. Fitur Fungsional

| Pertanyaan | Jawaban |
|---|---|
| Kolom warna barang | Ya. Teks bebas di data induk Barang, tampil di daftar, form, dan baris pemilihan barang di form peminjaman. Warna hanya keterangan, bukan varian stok (kursi merah dan kursi biru yang stoknya perlu dipisah dibuat sebagai dua barang). |
| Foto barang | Ya. Satu barang boleh punya beberapa foto. Daftar Barang & Jasa menampilkan kolom "Foto" berisi jumlah foto atau tombol Unggah; galeri, unggah, dan hapus ada di halaman Ubah barang. Barang harus tersimpan dulu sebelum difoto. |
| Form peminjaman (loading out) | Satu halaman `/persediaan/peminjaman`. Kartu "Ambil barang": nama pengambil (teks bebas dengan saran nama yang pernah dipakai), event (opsional), gudang (hanya tampil bila gudang lebih dari satu), daftar barang + jumlah (menampilkan warna dan jumlah tersedia), tanggal rencana kembali (opsional), keterangan, foto bukti (wajib 1, maksimal 3), tombol "Catat keluar". Waktu keluar diisi server. Dokumen langsung sah tanpa persetujuan. |
| Pengembalian (loading in) | Bukan dokumen baru. Di kartu "Sedang di luar", tiap dokumen terbuka punya form "Kembalikan": jumlah kembali per baris (boleh sebagian dan bertahap), foto bukti kembali (wajib 1), catatan kondisi, centang "Tutup dengan selisih" bila sisa dinyatakan hilang/rusak total (catatan wajib). Dokumen tertutup otomatis saat semua sisa nol. |
| Riwayat | Kartu "Riwayat": dokumen yang sudah ditutup, pencarian nomor/pengambil/keterangan, paginasi, lencana status SELESAI / SELISIH / DISESUAIKAN, tautan foto keluar dan kembali, aksi "Tautkan Penyesuaian Stok" untuk status SELISIH, tombol hapus untuk Admin ke atas. |
| Status dokumen | Diturunkan dari data, bukan kolom enum: TERBUKA (belum ditutup), SELESAI (ditutup, semua sisa nol), SELISIH (ditutup dengan sisa, belum ditautkan ke Penyesuaian Stok), DISESUAIKAN (sudah ditautkan). |
| Ketersediaan | Tersedia = jumlah stok gudang dikurangi "sedang di luar" (jumlah keluar dikurangi jumlah kembali dari semua dokumen yang belum ditautkan ke Penyesuaian Stok). Form menolak pengambilan melebihi tersedia dengan pesan yang menyebut angka stok, di luar, dan diminta. |
| Kolom "Di lokasi" | Halaman Stok per Gudang mendapat kolom turunan "Di lokasi"; kolom Jumlah dan kartu nilai persediaan tidak berubah. |
| Koreksi | Selama dokumen masih terbuka, pemegang hak buat boleh mengubah nama pengambil, event, keterangan, rencana kembali (tercatat di Log Aktivitas). Jumlah dan foto tidak bisa diubah; koreksi jumlah = hapus lalu buat ulang oleh Admin ke atas. |
| Foto bukti salah | Admin ke atas boleh menghapus atau menambah foto bukti tanpa menghapus dokumen. |
| Terlambat | Bila rencana kembali diisi dan lewat, dokumen terbuka diberi lencana "Terlambat". Tanpa notifikasi. |
| Hak akses | Hak baru `peminjaman.lihat`, `peminjaman.buat`, `peminjaman.hapus`. Gudang bawaan: lihat + buat. Hapus: Admin ke atas. Menautkan Penyesuaian Stok: pemegang `penyesuaian.setujui`. Unggah/hapus foto barang: `stok-induk.tulis`. |
| Siapa boleh lihat foto | Foto barang: semua peran yang boleh melihat barang. Foto bukti: hanya pemegang `peminjaman.lihat` (Gudang, Admin ke atas); Kasir tidak. Semua foto wajib login. |
| Notifikasi | Tidak ada. |

### C. Teknis & Integrasi

| Pertanyaan | Jawaban |
|---|---|
| Penyimpanan foto | Kolom `Bytes` di PostgreSQL, satu tabel `Foto` untuk foto barang dan foto bukti. Alasan: aplikasi berjalan di Vercel (tanpa disk) dan di Docker VPS (tanpa volume aplikasi); tidak ada SDK storage; foto otomatis ikut backup harian. |
| Ukuran foto | Dikompres di browser sebelum kirim: sisi terpanjang 1280 px, JPEG kualitas 0,8, orientasi EXIF dibetulkan, hasil sekitar 200 KB. Server menolak foto di atas 1 MB, lebih dari 3 foto per kirim, dan tipe di luar JPEG/PNG/WebP (dicek dari magic bytes). |
| Batas body | `experimental.serverActions.bodySizeLimit` dinaikkan ke 3 MB (bawaan Next 1 MB; batas fungsi Vercel sekitar 4,5 MB). |
| Penyajian foto | `GET /api/foto/[id]`, wajib sesi login, hak sesuai jenis foto, `Cache-Control: private, max-age=31536000, immutable` (isi per id tidak pernah berubah; ganti foto = id baru). |
| Kamera HP | `<input type="file" accept="image/*" capture="environment">` (pemilih kamera OS). Header `Permissions-Policy: camera=()` yang sudah ada tidak diubah karena hanya memblokir pratinjau kamera live (getUserMedia). Wajib diuji di Android Chrome dan iOS Safari sebelum rilis. |
| Zona waktu | Timestamp disimpan UTC (`@default(now())` server), ditampilkan dengan `timeZone` eksplisit dari `ZONA_WAKTU` (Vercel tidak menerima env `TZ`). |
| Migrasi skema | Satu migrasi aditif `warna_foto_peminjaman` (kolom `Barang.warna`, enum `TahapFoto`, tabel `Foto`, `PeminjamanBarang`, `BarisPeminjamanBarang`, CHECK `jumlahKembali <= jumlah`). Migrasi produksi dijalankan lebih dulu, baru kode di-deploy. |
| Dependensi baru | Tidak ada. Kompresi memakai `createImageBitmap` + canvas bawaan browser. |

### D. Non-Fungsional

| Pertanyaan | Jawaban |
|---|---|
| Skala | Puluhan hingga ratusan barang, puluhan peminjaman per bulan. Halaman peminjaman memuat semua barang jenis BARANG sekaligus (nyaman sampai ratusan). |
| Pertumbuhan basis data | Perkiraan 75 MB sekali untuk foto barang (100 barang × 3 foto × 250 KB) ditambah 10 sampai 15 MB per bulan untuk foto bukti. Backup harian ikut membesar; perlu dipantau. Kalau melewati beberapa ratus MB, kolom isi bisa diganti lokasi eksternal tanpa mengubah tabel induk. |
| Keamanan & privasi | Foto bukti memuat wajah kru dan freelance (data pribadi). Hanya bisa diakses pemegang hak peminjaman setelah login. Belum ada penghapusan otomatis (retensi); Admin ke atas dapat menghapus foto bukti secara manual. |
| Integritas akuntansi | Kartu Sinkronisasi (nilai stok vs saldo akun Persediaan) harus tetap hijau di setiap langkah; modul ini tidak memanggil fungsi mutasi stok maupun jurnal. Skrip uji baru memverifikasinya. |
| Ketahanan di sinyal lemah | Foto terkompresi dipegang di state form; bila kirim gagal, kru cukup menekan tombol lagi tanpa memotret ulang. Tidak ada mode offline. |
| Aksesibilitas HP | Kontrol tinggi minimal 44 px, satu kolom, tombol kirim lebar penuh, tombol "Ambil foto" besar. |

### E. Proyek & Deliverable

| Pertanyaan | Jawaban |
|---|---|
| Timeline | Perkiraan 3 hari kerja termasuk uji di HP. Dikerjakan iteratif di lokal dulu. |
| Budget | Internal, pemilik bersama asisten AI. |
| Maintenance | Pemilik (Donny) bersama Andrew Steine (Superadmin). |
| Deliverable | Kode di repo `~/Cooking/Projects/Produksia` (branch `main` setelah audit disetujui), migrasi skema, skrip uji `skrip/uji-peminjaman.ts`, pembaruan `ARCHITECTURE.md`, `KEBIJAKAN-AKUNTANSI.md`, `DEPLOY.md`, laporan audit (screenshot desktop 1440 px dan HP 390 px, hasil uji). |

---

## Draft PRD

### Latar Belakang

Peralatan event D'Production keluar masuk gudang tanpa catatan siapa yang membawa, kapan, berapa, dan buktinya. Data induk barang juga belum punya warna dan foto, sehingga kru sulit memastikan barang yang benar. Produksia sudah punya modul persediaan dengan integritas akuntansi yang dijaga ketat (nilai stok harus sama dengan saldo akun Persediaan), jadi modul baru harus berdiri di samping stok, bukan memutasinya.

### Tujuan

1. Setiap barang yang keluar gudang tercatat: nomor dokumen, waktu, pengambil, event, barang dan jumlah, foto bukti.
2. Setiap pengembalian tercatat terhadap dokumen keluarnya, boleh sebagian dan bertahap, dengan foto bukti.
3. Ketersediaan barang untuk pengambilan berikutnya terlihat (stok dikurangi yang sedang di luar).
4. Barang hilang/rusak total ditutup lewat satu pintu yang sudah ada (Penyesuaian Stok) sehingga buku besar tetap benar.
5. Data induk barang punya warna dan foto.

### Target User

- Gudang: mencatat keluar dan kembali dari HP di gudang atau venue.
- Admin, Pemilik, Superadmin: koreksi, hapus, menutup selisih, mengelola foto.
- Kasir: tidak memakai modul ini (tidak melihat foto bukti).

### Daftar Fitur

**Must-have**
- Kolom `warna` di Barang (daftar, form tambah/ubah, pencarian).
- Tabel `Foto` bersama; galeri + unggah + hapus foto barang di halaman Ubah; kolom Foto di daftar.
- Halaman `/persediaan/peminjaman` tiga bagian: Ambil barang, Sedang di luar (dengan form Kembalikan inline), Riwayat.
- Nomor dokumen `PJ-TAHUN-NNNN`.
- Validasi tersedia, pengembalian sebagian/bertahap, CHECK di basis data untuk jumlah kembali.
- Tutup dengan selisih + tautkan ke Penyesuaian Stok.
- Lencana Terlambat berdasarkan rencana kembali.
- Ubah terbatas pada dokumen terbuka (nama pengambil, event, keterangan, rencana kembali) dengan Log Aktivitas.
- Hapus dokumen lewat mekanisme `hapusDokumen` yang ada (ditolak bila sudah ditautkan ke Penyesuaian Stok).
- Hapus/tambah foto bukti oleh Admin ke atas.
- Kolom "Di lokasi" di Stok per Gudang.
- Hak akses baru dan bawaan peran Gudang.
- Komponen unggah foto dengan kompresi di browser, pratinjau, dan retensi saat gagal kirim.
- Skrip uji `uji-peminjaman.ts` termasuk pemeriksaan Sinkronisasi tetap hijau.

**Nice-to-have (tahap berikut, bila terbukti perlu)**
- Aksi "Alihkan ke event lain" untuk barang yang langsung pindah venue.
- Kolom jumlah rusak per baris dan penandaan "perlu perbaikan".
- Thumbnail kecil di daftar barang dan pemilihan barang lewat gambar.
- Filter riwayat per event/per barang/per pengambil, ekspor CSV.
- Cetak tanda terima.
- Retensi otomatis foto bukti.

**Di luar cakupan**
- Reservasi alat berdasarkan tanggal event.
- Notifikasi WhatsApp/email.
- Mode offline.
- Pelacakan per unit / nomor seri.
- Alur persetujuan (maker-checker) untuk peminjaman.

### Batasan Teknis

- Tidak ada disk persisten di Vercel maupun container VPS; foto disimpan di PostgreSQL.
- Batas body Server Action dinaikkan ke 3 MB; foto tetap harus dikompres di klien.
- `Permissions-Policy: camera=()` tetap; hanya pemilih kamera OS yang dipakai.
- Tidak ada dependensi npm baru.
- Migrasi produksi dijalankan dari VPS sebelum kode di-deploy ke Vercel.

### Asumsi

- Lokasi event umumnya bersinyal saat kru mencatat.
- Empat jenis barang saat ini cukup dilacak per kuantitas, bukan per unit.
- Satu akun Gudang mungkin dipakai bergantian; karena itu nama pengambil dicatat terpisah dari akun pencatat.
- iOS Safari mengonversi HEIC ke JPEG otomatis untuk input file gambar; bila tidak, server menolak dengan pesan ramah.

---

## Keputusan Desain yang Disepakati (18 September 2026)

1. Angka stok akuntansi tidak berubah saat barang di event; ada kolom turunan "Di lokasi".
2. Hilang/rusak total: tutup dengan selisih, Admin membuat Penyesuaian Stok lalu menautkannya.
3. Nama pengambil teks bebas dengan saran nama yang pernah dipakai.
4. Foto di PostgreSQL, terkompres, hanya untuk pengguna login, tanpa tautan publik.
5. Pengambilan boleh ditandai event; Gudang boleh melihat nama event.
6. Dokumen langsung sah tanpa persetujuan; hapus hanya Admin ke atas.
7. Menu "Peminjaman Barang", nomor PJ, subjudul menyebut loading in/out.
8. Tanggal rencana kembali opsional dengan lencana Terlambat.
9. Tanpa kolom rusak; rusak ringan di catatan, rusak total = selisih.
10. Pindah antar event lewat proses kembalikan lalu ambil lagi.
11. Kru boleh mengoreksi nama pengambil, event, keterangan, rencana kembali selama dokumen terbuka.
12. Tanpa cetak tanda terima.
13. Foto bukti hanya untuk pemegang hak peminjaman; Admin ke atas boleh hapus/tambah foto bukti; belum ada retensi otomatis.

## Model Data

| Model | Bidang utama |
|---|---|
| `Barang` (ubah) | `warna String?` |
| `Foto` (baru) | `id`, `barangId?`, `peminjamanId?`, `tahap TahapFoto?` (KELUAR/KEMBALI), `urutan Int`, `tipe String`, `ukuran Int`, `isi Bytes`, `dibuatPada`; cascade saat induk dihapus |
| `PeminjamanBarang` (baru) | `id`, `nomor` (unik), `gudangId`, `proyekId?`, `namaPengambil`, `keterangan?`, `waktuKeluar`, `rencanaKembali?`, `ditutupPada?`, `catatanKembali?`, `penyesuaianId?`, `dicatatOlehId?` (SetNull), `dicatatOlehNama` |
| `BarisPeminjamanBarang` (baru) | `id`, `peminjamanId`, `barangId`, `jumlah`, `jumlahKembali`; unik (peminjaman, barang); CHECK `jumlahKembali <= jumlah` |

---

## Bagian 3: Catatan untuk Diskusi Lanjutan (gaya "ke mentor")

- Modul ini sengaja tidak memakai kolom persetujuan (maker-checker) yang dipakai semua dokumen lain. Kalau dalam setahun dibutuhkan tanda tangan digital atau persetujuan, perlu migrasi tambahan.
- Ada jeda yang disengaja antara "tutup dengan selisih" dan Penyesuaian Stok: selama Admin belum menautkan, nilai persediaan di buku besar lebih tinggi dari fisik. Jeda ini terlihat sebagai lencana SELISIH, bukan disembunyikan.
- Surat Jalan dan Pindah Barang masih membaca angka stok, bukan tersedia, jadi secara teori bisa memindah barang yang fisiknya sedang di event. Ditunda sampai kasusnya nyata.
- Temuan sampingan: di Vercel hanya `ZONA_WAKTU` yang dikirim, bukan `TZ`, sehingga jam di Log Aktivitas produksi kemungkinan tampil UTC. Modul ini memakai `timeZone` eksplisit; halaman lain sebaiknya disamakan.
- Secara bagan akun, cone/kabel tray/kursi/velbed lebih dekat ke Peralatan Event (aset tetap) daripada Persediaan, tetapi Aset Tetap tidak punya kuantitas dan gudang. Dibiarkan sebagai Barang; klasifikasi tetap terbuka untuk dibahas.

### Catatan penggunaan dokumen ini

Perbarui dokumen ini bila ada keputusan baru, lalu turunkan ke `ARCHITECTURE.md`, `KEBIJAKAN-AKUNTANSI.md`, dan `DEPLOY.md` di repo.
