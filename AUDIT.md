# Audit Proyek — Accurate Copy

Tanggal: 6 September 2026. Cakupan: seluruh `src/` (33 halaman, 7 file action, 8 komponen), skema Prisma, skrip seed & regresi.

Status tiap temuan: **[FIXED]** sudah diperbaiki di audit ini · **[OPEN]** sengaja belum, dengan alasan.

## A. Bug / risiko fungsional

1. **[FIXED] Pesan error validasi hilang di production.** Semua server action melempar `throw new Error("...")`. Di mode dev pesannya tampil, tapi Next.js **menyamarkan** error dari server action di production menjadi pesan generik (kebijakan anti-bocor data). Artinya user tidak akan pernah melihat "Jurnal tidak seimbang", "Pemasok wajib dipilih", dst — cuma layar error.
   Perbaikan: `src/lib/statusFormulir.ts` (`jalankanFormulir`) mengubah error jadi *keadaan* yang dikembalikan; komponen `FormulirAksi` (`useActionState`) menampilkannya di dalam form. Semua 20 form dimigrasi. `redirect()`/`notFound()` tetap diteruskan via `unstable_rethrow`. Error Prisma umum (P2002 unik, P2003 masih dipakai relasi, P2025 tidak ditemukan) diterjemahkan ke bahasa manusia.
2. **[FIXED] Penomoran dokumen `count()+1` bisa bentrok.** Setelah ada data yang dihapus, `count` turun dan nomor berikutnya menabrak nomor yang masih ada → gagal `unique constraint`. Perbaikan: `src/lib/penomoran.ts` mengambil nomor terakhir per prefix per tahun lalu +1 (dipakai di 20 titik: penjual, purchasing, jurnal, accounting, fixedAssets). Sisa risiko: dua submit di milidetik yang sama — ditolak DB (bukan duplikat diam-diam). Batas 9999 dokumen/prefix/tahun karena zero-padding 4 digit.
3. **[FIXED] Skrip regresi ledger bisa menghapus data seed.** Cleanup `uji-*-ledger.ts` mencocokkan `memo` ("Setoran modal", "Setor tunai") yang juga dipakai seed. Untungnya gagal karena FK, tapi meninggalkan 3 jurnal yatim + 4 akun test. Diganti ke pola berbasis waktu mulai test (sama seperti 3 skrip lain), sisa data dibersihkan manual, data seed diverifikasi utuh (Rp 13.650.000 debit = kredit, 4 jurnal).
4. **[FIXED] Variabel `pesanan` tidak terpakai di `buatPengiriman`** (query penuh dengan `include` hanya untuk cek keberadaan). Disederhanakan.
5. **[FIXED] Uang dihitung sebagai `Number` (float) di aplikasi.** Semua perhitungan uang/qty di server sekarang memakai `Prisma.Decimal` lewat `src/lib/uang.ts` (`D`, `uang`, `jumlahkan`, `kali`, `bacaUang`) — di penjual, purchasing, jurnal, accounting, fixedAssets. Bukti: pesanan 3 × 0,1 tersimpan persis `0.3`. Tampilan di komponen client tetap `Number` (hanya untuk preview).
6. **[OPEN] Tidak ada pembatasan hapus/ubah dokumen yang sudah diproses** — belum relevan karena memang belum ada fitur hapus/edit dokumen transaksi. Master data yang masih direferensikan ditolak DB dengan pesan jelas.
7. **[OPEN] Belum ada login/otorisasi** — `Pengguna`/`PeranPengguna` ada di skema tapi tidak dipakai. Ini fitur (bukan bug) dan wajib sebelum multi-user sungguhan.
8. **[FIXED] Stok bisa negatif / race condition.** Dua lapis: (a) `src/lib/stok.ts` mengecek ketersediaan di dalam transaksi dan menolak dengan pesan "Stok X tidak cukup (tersedia…, diminta…)"; (b) migrasi `stock_non_negative` menambah `CHECK ("jumlah" >= 0)` di `StokBarang` sebagai pengaman balapan — transaksi kedua yang lolos cek aplikasi ditolak DB dan di-rollback, pesannya diterjemahkan di `statusFormulir.ts`.
8b. **[FIXED] Validasi kuantitas & pembayaran yang sebelumnya tidak ada:** kirim/terima tidak boleh melebihi sisa pesanan; faktur tidak boleh melebihi sisa yang belum ditagih; retur tidak boleh melebihi qty faktur dikurangi retur sebelumnya; pembayaran tidak boleh melebihi sisa tagihan/utang dan ditolak jika faktur sudah lunas. Semua diuji di `skrip/uji-pengaman.ts`.

## B. UI/UX & responsivitas

9. **[FIXED] Tidak responsive.** BilahSamping 256px permanen, form dipaksa 2 kolom, tabel meluber ke luar layar. Perbaikan: sidebar jadi *drawer* di mobile (tombol ☰, overlay, tutup otomatis saat navigasi) dan tetap *sticky* di desktop; semua form `grid-cols-1 md:grid-cols-2`; 25 tabel dibungkus `overflow-x-auto` (scroll horizontal di HP, halaman tidak ikut melebar); dashboard 2→4 kolom; padding halaman `p-4 md:p-8`; `min-w-0` di `<main>` agar tabel scroll bekerja dalam flex.
10. **[FIXED] Tidak ada penanda menu aktif; 31 link ditampilkan sekaligus.** BilahSamping sekarang accordion 7 menu utama (Penjualan, Pembelian, Kas & Bank, Buku Besar, Aset Tetap, Persediaan, Daftar) + Beranda; sub-menu hanya muncul saat menu utamanya diklik, dan menu yang memuat halaman aktif terbuka otomatis. Halaman aktif disorot (`aria-current="page"`), tombol accordion punya `aria-expanded`/`aria-controls`.
11. **[FIXED] Tidak ada indikator loading & pencegah dobel-klik.** `FormulirAksi` menonaktifkan seluruh isian saat submit (`fieldset disabled`, `aria-busy`); `loading.tsx` skeleton untuk navigasi.
12. **[FIXED] Hapus tanpa konfirmasi.** Tombol Hapus (master data) dan Konversi Penawaran kini minta konfirmasi.
13. **[FIXED] Dark mode "setengah jadi".** CSS bawaan create-next-app mengganti latar jadi hitam saat OS dark-mode, sementara komponen (hover `bg-zinc-100`, border, tombol) didesain untuk terang → teks tak terbaca. Dipaksa `color-scheme: light` sampai ada desain dark yang utuh.
14. **[FIXED] Tidak ada `error.tsx` / `not-found.tsx`.** `notFound()` di `/data-induk/[entitas]` jatuh ke halaman default Next; sekarang ada halaman ramah + tombol kembali.
15. **[FIXED] Nama prop menyesatkan** `hargaJual` di `EditorBarisBarang` (diisi `hargaBeli` untuk PSB) → `hargaBawaan`.
16. **[OPEN] `<label>` belum terhubung ke isian (`htmlFor`/`id`)** — aksesibilitas & klik-label. Skala: ~60 bidang. Layak dibuat komponen `Field` sekaligus merapikan duplikasi markup.
17. **[OPEN] Tabel di mobile masih perlu scroll** (bukan kartu). Untuk tabel transaksi dengan 6–7 kolom ini keputusan yang wajar; kalau mau lebih ramah HP, ubah baris jadi kartu di `< md`.
18. **[OPEN] Belum ada halaman edit** untuk master data & dokumen; belum ada pencarian/filter/pagination di daftar (masalah begitu data > ratusan baris).
19. **[OPEN] Tiga komponen picker (`PemilihBarisPesanan`, `PemilihBarisPenerimaan`) hampir identik** — bisa dijadikan satu komponen dengan prop label. `PenyusunFaktur` sudah digantikan `PenyusunFaktur`. Ditunda: duplikasinya kecil dan jelas.
19b. **[FIXED] Tampilan tidak mengikuti design system.** Seluruh UI dipindah ke design system "Precision Ledger" (paket Stitch): token & kelas komponen global, sidebar/topbar baru, Beranda dan form Faktur dibangun ulang mengikuti layar contoh dengan data sungguhan; diverifikasi lewat screenshot headless (desktop 1440px & mobile 390px). Ditambah halaman `/cari` agar kotak pencarian di topbar benar-benar berfungsi.
19c. **[OPEN] File font ikon 3,9 MB** (`src/app/fonts/material-symbols-outlined.woff2`, variable font penuh). Dimuat sekali lalu di-cache browser, tapi bisa di-subset ke ±40 ikon yang dipakai (mis. dengan `pyftsubset`) untuk memangkasnya ke < 50 KB.
19d. **[OPEN] Kolom "Aksi" di tabel transaksi terbaru & tabel daftar hanya muncul bila ada aksi** — untuk konsistensi visual dengan desain, tombol aksi kontekstual (lihat, cetak) bisa ditambahkan setelah ada halaman detail dokumen.

19e. **[FIXED] Istilah Inggris di antarmuka.** Semua yang tampil ke pengguna kini Indonesia: kode dokumen (PNW, PSJ, SJ, FJ, TRM, RJ, PSB, TB, FB, BYR, RB), label status (Draf, Lunas, Sebagian, …), metode bayar (Tunai/Transfer/Kartu), sumber jurnal, serta kata seperti Beranda, Data Induk, Kelompok Barang, Kuantitas, Pratinjau, Pengaman, seimbang, dicatat. **Keputusan yang sengaja diambil:** nama pengenal di kode program dan database (`FakturPenjualan`, `pelangganId`, nilai enum `LUNAS`) tetap Inggris — tidak pernah terlihat pengguna, dan mengganti skema database berarti migrasi berisiko tanpa manfaat tampilan. Kalau diperlukan, bisa dilakukan sebagai pekerjaan terpisah.

19f. **[FIXED] Seluruh pengenal kode & skema basis data → Indonesia** (lanjutan 19e, atas permintaan). Skema Prisma ditulis ulang (36 model, 6 enum: `FakturPenjualan`, `pelangganId`, `jumlahTerkirim`, `StatusDokumen.LUNAS`, …), migrasi awal baru `awal` (data lama dummy, riwayat migrasi lama tetap ada di git), klien Prisma ke `src/prisma-klien`. Nama file/folder (`src/komponen`, `src/lib/aksi`, `skrip/uji-*.ts`), rute URL (`/penjualan/faktur/baru`, `/data-induk/pelanggan`, `/cari`), nama field formulir & parameter URL (`pesananId`, `fakturId`), fungsi (`buatFaktur`, `nomorDokumenBerikutnya`, `kurangiStok`), komponen (`FormulirAksi`, `PenyusunFaktur`, `BilahSamping`), kelas CSS milik sendiri (`kartu`, `tombol-utama`, `tabel`, `lencana`, `isian`) — semuanya Indonesia. Yang **tetap** Inggris karena bukan milik kita: API web/React/Next/Prisma (`useState`, `className`, `findMany`, `searchParams`), utilitas Tailwind (`flex`, `text-sm`), dan kata serapan yang sudah baku dalam bahasa Indonesia (status, total, data, label, debit, mono, subtotal).

## C. Teknis / operasional

20. **[FIXED] Lint bersih.** 2 error React Compiler (setKeadaan dalam effect di BilahSamping; mutasi variabel luar di Buku Besar) diperbaiki; `tsc --noEmit` dan `eslint` lulus tanpa error.
21. **[OPEN] Belum ada CI/commit.** Repo git ada (init dari create-next-app) tapi semua perubahan belum di-commit. Saran: commit sekarang sebagai baseline, lalu jalankan `tsc`, `eslint`, dan 4 skrip regresi di CI.
22. **[OPEN] Skrip regresi memakai database yang sama dengan data seed.** Sudah aman (cleanup berbasis waktu), tapi idealnya `DATABASE_URL` terpisah untuk test.
23. **[OPEN] Turbopack tidak me-reload Prisma Client setelah `prisma generate`** — restart `npm run dev` setiap ganti skema (sudah dicatat di README).

## Verifikasi yang dilakukan

- `npx tsc --noEmit` ✔ · `npx eslint src` ✔ (0 error)
- 4 skrip regresi (`uji-*`, `-purchasing`, `-ledger`, `-daftarAset`) lulus setelah refactor penomoran & form
- Smoke test HTTP semua rute utama 200, rute asing 404 (halaman not-found kustom)
- HTML hasil render dicek: meta viewport, tombol menu mobile, `aria-current`, pembungkus tabel, grid responsive, `fieldset.contents` semuanya ada
- Integritas data seed pasca-test: total debit = kredit = Rp 13.650.000, 4 jurnal, 0 akun test tersisa
