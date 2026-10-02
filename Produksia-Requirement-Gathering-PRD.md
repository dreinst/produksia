# Produksia — Requirement Gathering & PRD

Disusun mengikuti kerangka **Prompt & Checklist Requirement Gathering** (perspektif Senior Fullstack Developer, Bagian 1–3) yang diberikan pemilik proyek, diterapkan pada Produksia: sistem informasi akuntansi internal untuk D'Production Event Organizer.

Status: dokumen hidup. Setiap kali ada penyesuaian requirement, perbarui bagian yang relevan di sini, lalu turunkan ke `README.md`, `ARCHITECTURE.md`, dan `KEBIJAKAN-AKUNTANSI.md` di repo `~/Cooking/Projects/Produksia`.

---

## Bagian 1 — Hasil "Wawancara" (ringkasan konteks)

**Produk/jasa yang dijual lewat sistem ini:** Produksia bukan produk yang dijual ke publik. Ini alat internal: sistem akuntansi untuk mencatat jasa dan barang yang dijual D'Production Event Organizer ke kliennya (dekorasi, dokumentasi, MC/sound, merchandise event, dan program flagship berbayar seperti tiket dan sponsorship).

**Target pengguna utama:** enam peran internal — Superadmin (admin IT, setara Pemilik), Pemilik (dua orang, setara), Admin, Kasir, Gudang. Tidak ada akun publik/klien yang login ke sistem ini.

**Bisnis baru atau migrasi:** migrasi dari pencatatan tradisional (manual/semi-manual) ke sistem digital berbasis siklus akuntansi baku, sambil tetap mengikuti kebiasaan pencatatan pemilik yang sudah berjalan (nomor dokumen, istilah, alur kerja EO).

---

## Bagian 2 — Checklist Requirement (terisi)

### A. Model Bisnis & Produk

| Pertanyaan | Jawaban |
|---|---|
| Apa yang dijual? | Kombinasi jasa (dekorasi, dokumentasi, sound/MC, koordinasi lapangan) dan barang fisik kecil (lanyard, stiker, goodie bag) yang dipakai dalam satu paket event; ditambah program flagship (tiket, sponsorship, sewa booth/tenant). |
| Target pasar | B2C untuk klien perorangan/keluarga (wedding, gathering), B2B untuk sponsor dan tenant program flagship. |
| Proses transaksi | Penawaran → Pesanan (kontrak) → Uang Muka/DP bertahap → pengiriman barang (bila ada) → Faktur setelah acara selesai (pengakuan pendapatan mengikuti PSAK 72) → Pelunasan. Bukan checkout instan seperti e-commerce. |
| Referensi kompetitor | Bukan aplikasi publik; desain mengacu pola software akuntansi umum (Accurate Online, Mekari Jurnal) untuk alur dokumen, disesuaikan dengan kebiasaan pencatatan pemilik EO. |
| Baru atau migrasi | Migrasi dari pencatatan tradisional; bagan akun dikurasi dari catatan tangan pemilik (108 akun awal, sekarang 117 setelah penambahan akun flagship). |

### B. Fitur Fungsional

| Pertanyaan | Jawaban |
|---|---|
| Sistem akun & login | Ya. Login dengan nama pengguna (bukan email), lima peran dengan hak akses granular per jenis dokumen (lihat/buat/hapus), diatur di Pengaturan → Hak Akses. |
| Keranjang & checkout | Tidak relevan (bukan toko online). Yang ada: komposer Faktur dengan pratinjau jurnal otomatis sebelum diterbitkan. |
| Metode pembayaran | Internal saja: transfer/tunai dicatat manual lewat Penerimaan, Pembayaran, Kas Masuk/Keluar. Tidak ada payment gateway (Midtrans/Xendit dll) karena sistem tidak menerima pembayaran dari publik. |
| Dashboard admin | Ya, Beranda menampilkan ringkasan keuangan & operasional real-time, tren kas 12 bulan, peringatan stok minimum, status integritas buku besar. |
| Notifikasi | Belum ada (email/WhatsApp/push); tautan lupa kata sandi sekali pakai diberikan manual oleh admin lewat WhatsApp/telepon. |
| Multi-bahasa / multi-currency | Tidak. Seluruh sistem berbahasa Indonesia (termasuk kode & skema database), mata uang tunggal Rupiah. |
| Role berbeda | Ya — Superadmin, Pemilik, Admin, Kasir, Gudang, masing-masing dengan cakupan modul berbeda (lihat tabel hak akses di `src/lib/hakAkses.ts`). |

### C. Teknis & Integrasi

| Pertanyaan | Jawaban |
|---|---|
| Sistem lama yang diintegrasikan | Tidak ada ERP/CRM/POS eksternal; data lama (bila ada) dimasukkan manual via data induk. |
| Preferensi hosting | Aplikasi di Vercel (region Singapura); basis data PostgreSQL di VPS sendiri (dreinst, Kuala Lumpur/Jakarta), dijangkau lewat PgBouncer dengan TLS wajib dan sertifikat pinned. |
| Integrasi API pihak ketiga | Belum ada (ongkir, payment gateway, maps). Rencana ke depan: e-Faktur/e-Bupot untuk pelaporan pajak (belum terhubung otomatis). |
| Tech stack | Next.js 16 (App Router) + Prisma 7 + PostgreSQL 16, TypeScript penuh, tanpa framework CSS pihak ketiga besar (Tailwind utility + desain sistem sendiri "Precision Ledger"). |
| Aplikasi mobile | Tidak ada rencana; web responsif (diuji desktop 1440px & HP 390px) dianggap cukup untuk penggunaan internal. |

### D. Non-Fungsional

| Pertanyaan | Jawaban |
|---|---|
| Estimasi traffic | Kecil: puluhan pengguna internal, bukan sistem publik ber-traffic tinggi. |
| Kebutuhan keamanan khusus | Ya — data keuangan & data pribadi klien/karyawan. Sudah diterapkan: rate-limit percobaan login, header keamanan HTTP (HSTS, nosniff, frame-DENY), kata sandi di-hash (scrypt+garam), sesi lewat token acak, kunci pemasangan awal (`KUNCI_PEMASANGAN`) untuk mencegah perebutan akun Pemilik pertama, firewall (ufw + ufw-docker), fail2ban untuk PgBouncer/SSH. |
| Kepatuhan regulasi | Perpajakan Indonesia: PPh Final UMKM 0,5% (PP 55/2022), PPN (UU PPN Pasal 1 angka 18), PPh 23; batas omzet UMKM Rp 4,8 miliar/tahun belum dihitung otomatis (harus dipantau manual). Belum ada modul PPh 21 karyawan otomatis. |
| Rancangan untuk scale up | Cukup untuk skala EO menengah; belum dirancang untuk multi-tenant/multi-perusahaan. Bisa ditambah bertahap (mis. modul SDM/penggajian baru ditambahkan 14 Sep 2026 tanpa mengubah arsitektur inti). |

### E. Proyek & Deliverable

| Pertanyaan | Jawaban |
|---|---|
| Timeline | Iteratif, dikembangkan bertahap per kebutuhan yang muncul (bukan proyek waterfall dengan tanggal rilis tunggal). |
| Budget | Internal, dikerjakan sendiri oleh pemilik bersama asisten AI; tidak ada kontrak vendor eksternal. |
| Maintenance setelah selesai | Dipegang pemilik (Donny) bersama Andrew Steine (Superadmin/admin IT) sebagai operator teknis paling dipercaya. |
| Dokumentasi yang dibutuhkan | `README.md` (ringkasan fitur & cara jalan), `ARCHITECTURE.md` (arsitektur & model data), `KEBIJAKAN-AKUNTANSI.md` (kebijakan akuntansi & pajak), `BAGAN-AKUN.md` (bagan akun standar), `DEPLOY.md` (prosedur deploy), `AUDIT.md` (riwayat temuan & perbaikan) — semua sudah ada dan dipelihara di repo. |

---

## Bagian 1 (lanjutan) — Draft PRD

### Latar Belakang
D'Production Event Organizer sebelumnya mencatat keuangan secara tradisional. Produksia dibangun untuk memindahkan pencatatan itu ke sistem akuntansi digital yang mengikuti siklus SIA (Sistem Informasi Akuntansi) standar — Pendapatan, Pengeluaran, Produksi (aset & perlengkapan), SDM, dan Pelaporan Keuangan — sekaligus menjaga kebiasaan dan istilah kerja EO yang sudah dipakai pemilik.

### Tujuan
- Mencatat seluruh siklus transaksi (penjualan, pembelian, kas/bank, persediaan, aset tetap, SDM) dengan jurnal otomatis yang selalu seimbang.
- Menjaga kepatuhan pajak dasar (PPh Final UMKM, PPN, PPh 23) tanpa proses manual berulang.
- Memberi visibilitas kas nyata kepada pemilik (basis kas), terpisah dari laporan akrual untuk kebutuhan pajak.
- Melacak profitabilitas per event/proyek (Laba Rugi per event, LPJ/Rekonsiliasi Event).
- Menjaga integritas data lewat sinkronisasi otomatis (buku besar selalu cocok dengan dokumen & stok fisik).

### Target User
Internal only, lima peran: Superadmin, Pemilik (2 orang setara), Admin, Kasir, Gudang. Tidak ada user publik/klien.

### Daftar Fitur

**Must-have (sudah dibangun & berjalan):**
- Siklus Penjualan: Penawaran → Pesanan → Uang Muka → Pengiriman → Faktur → Penerimaan → Retur.
- Siklus Pembelian: Pesanan → Terima Barang → Faktur → Pembayaran → Retur.
- Kas & Bank: Kas Masuk/Keluar, Prive (pengambilan pemilik).
- Buku Besar & Pelaporan: Jurnal Umum, Neraca Saldo, Neraca, Laba Rugi (akrual & basis kas), Ringkasan Pendapatan, Perubahan Modal, Arus Kas, Pajak & SPT, Tutup Buku tahunan.
- Persediaan: stok per gudang, penyesuaian, pindah barang, harga pokok rata-rata bergerak.
- Aset Tetap: perolehan, penyusutan otomatis bulanan, pelepasan aset.
- SDM & Penggajian: data induk karyawan (gaji pokok, tunjangan, jabatan, status), Proses Gaji bulanan dengan jurnal otomatis.
- Rekonsiliasi: Rekonsiliasi Event (LPJ), Rekonsiliasi Kas/Bank, impor mutasi rekening.
- Hak akses per dokumen & per peran, Log Aktivitas, dialog verifikasi sebelum simpan.
- Bagan akun standar EO/WO (117 akun) siap terap satu klik, termasuk akun program flagship (tiket, sponsor, tenant).
- Diskon faktur (kontra-pendapatan), omzet pajak dari buku besar (bukan sekadar dari faktur).

**Nice-to-have (sengaja belum dibangun, tercatat sebagai gap):**
- Diskon di tahap Penawaran/Pesanan (saat ini hanya di Faktur).
- PPN atas Uang Muka untuk skenario PKP.
- Pilihan basis kas untuk perhitungan omzet PPh Final (saat ini selalu basis akrual/buku besar).
- Faktur tanpa pesanan sama sekali (saat ini selalu berangkat dari Pesanan, dengan jalan pintas "Simpan & Buat Faktur").
- Perhitungan PPh 21 karyawan otomatis (Proses Gaji saat ini memakai input potongan manual per baris).
- Notifikasi email/WhatsApp otomatis.
- Integrasi e-Faktur/e-Bupot dan perhitungan otomatis batas omzet UMKM Rp 4,8 miliar/tahun.

### Batasan Teknis
- Next.js 16 + Prisma 7 + PostgreSQL 16, TypeScript, seluruh kode & UI berbahasa Indonesia.
- Hosting: aplikasi di Vercel, basis data di VPS sendiri (Docker, PgBouncer TLS dengan sertifikat pinned).
- Tidak ada integrasi payment gateway atau ERP/CRM eksternal.
- Tidak dirancang multi-tenant; satu instance untuk satu perusahaan (D'Production Event Organizer).

### Asumsi
- Pengguna sistem adalah staf internal terlatih, bukan publik — sehingga UX bisa sedetail istilah akuntansi tanpa perlu penyederhanaan ala aplikasi konsumen.
- Volume transaksi kecil-menengah (puluhan dokumen per hari), tidak butuh optimasi untuk traffic tinggi.
- Kebijakan akuntansi (basis kas untuk laporan manajemen, basis akrual untuk pajak) sudah disetujui pemilik per 14 September 2026 dan didokumentasikan di `KEBIJAKAN-AKUNTANSI.md`.
- Setiap perubahan skema database harus lewat migrasi Prisma dan diterapkan manual ke server produksi (build Vercel sengaja tidak menjalankan migrasi otomatis).

---

## Bagian 3 — Catatan untuk Diskusi Lanjutan (gaya "ke mentor")

```
Konteks: Melanjutkan pengembangan Produksia, sistem akuntansi internal
D'Production Event Organizer (Next.js + Prisma + PostgreSQL).

Requirement yang sudah terkumpul: lihat Bagian 1–2 dokumen ini.

Gap yang masih terbuka (dari daftar "nice-to-have" di atas):
- PPh 21 karyawan otomatis — perlu diputuskan apakah dihitung dengan
  tabel PTKP/tarif progresif, atau tetap manual per baris seperti sekarang.
- Basis kas untuk omzet PPh Final — apakah relevan untuk WP Badan
  (D'Production berbentuk apa secara hukum?), karena stelsel kas murni
  hanya relevan untuk WP OP yang memakai pencatatan.
- Integrasi e-Faktur/e-Bupot — prioritas rendah sampai omzet mendekati
  ambang PKP wajib atau pemilik memintanya.

Rencana: setiap requirement baru dicatat dulu di dokumen ini (mengikuti
kerangka checklist A–E), baru diturunkan ke kode dan dokumentasi teknis
(README/ARCHITECTURE/KEBIJAKAN-AKUNTANSI) di repo.
```

---

### Catatan penggunaan dokumen ini
Kerangka checklist (Bagian 2, kategori A–E) dipakai ulang untuk setiap permintaan fitur baru di Produksia sebelum masuk ke tahap desain/kode, supaya requirement selalu digali terstruktur dan tidak berasumsi. Sesuaikan pertanyaan bila requirement gathering dilakukan untuk proyek lain di luar Produksia (marketplace, company profile, SaaS, dll punya prioritas berbeda).
