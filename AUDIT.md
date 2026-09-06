# Audit Proyek — Accurate Copy

Tanggal: 6 September 2026. Cakupan: seluruh `src/` (33 halaman, 7 file action, 8 komponen), skema Prisma, skrip seed & regresi.

Status tiap temuan: **[FIXED]** sudah diperbaiki di audit ini · **[OPEN]** sengaja belum, dengan alasan.

## A. Bug / risiko fungsional

1. **[FIXED] Pesan error validasi hilang di production.** Semua server action melempar `throw new Error("...")`. Di mode dev pesannya tampil, tapi Next.js **menyamarkan** error dari server action di production menjadi pesan generik (kebijakan anti-bocor data). Artinya user tidak akan pernah melihat "Jurnal tidak balance", "Pemasok wajib dipilih", dst — cuma layar error.
   Perbaikan: `src/lib/formState.ts` (`runForm`) mengubah error jadi *state* yang dikembalikan; komponen `ActionForm` (`useActionState`) menampilkannya di dalam form. Semua 20 form dimigrasi. `redirect()`/`notFound()` tetap diteruskan via `unstable_rethrow`. Error Prisma umum (P2002 unik, P2003 masih dipakai relasi, P2025 tidak ditemukan) diterjemahkan ke bahasa manusia.
2. **[FIXED] Penomoran dokumen `count()+1` bisa bentrok.** Setelah ada data yang dihapus, `count` turun dan nomor berikutnya menabrak nomor yang masih ada → gagal `unique constraint`. Perbaikan: `src/lib/numbering.ts` mengambil nomor terakhir per prefix per tahun lalu +1 (dipakai di 20 titik: sales, purchasing, journal, accounting, fixedAssets). Sisa risiko: dua submit di milidetik yang sama — ditolak DB (bukan duplikat diam-diam). Batas 9999 dokumen/prefix/tahun karena zero-padding 4 digit.
3. **[FIXED] Skrip regresi ledger bisa menghapus data seed.** Cleanup `e2e-test-ledger.ts` mencocokkan `memo` ("Setoran modal", "Setor tunai") yang juga dipakai seed. Untungnya gagal karena FK, tapi meninggalkan 3 jurnal yatim + 4 akun test. Diganti ke pola berbasis waktu mulai test (sama seperti 3 skrip lain), sisa data dibersihkan manual, data seed diverifikasi utuh (Rp 13.650.000 debit = kredit, 4 jurnal).
4. **[FIXED] Variabel `order` tidak terpakai di `createDelivery`** (query penuh dengan `include` hanya untuk cek keberadaan). Disederhanakan.
5. **[FIXED] Uang dihitung sebagai `Number` (float) di aplikasi.** Semua perhitungan uang/qty di server sekarang memakai `Prisma.Decimal` lewat `src/lib/money.ts` (`D`, `money`, `sum`, `mul`, `parseMoney`) — di sales, purchasing, journal, accounting, fixedAssets. Bukti: pesanan 3 × 0,1 tersimpan persis `0.3`. Tampilan di komponen client tetap `Number` (hanya untuk preview).
6. **[OPEN] Tidak ada pembatasan hapus/ubah dokumen yang sudah diproses** — belum relevan karena memang belum ada fitur hapus/edit dokumen transaksi. Master data yang masih direferensikan ditolak DB dengan pesan jelas.
7. **[OPEN] Belum ada login/otorisasi** — `User`/`UserRole` ada di skema tapi tidak dipakai. Ini fitur (bukan bug) dan wajib sebelum multi-user sungguhan.
8. **[FIXED] Stok bisa negatif / race condition.** Dua lapis: (a) `src/lib/stock.ts` mengecek ketersediaan di dalam transaksi dan menolak dengan pesan "Stok X tidak cukup (tersedia…, diminta…)"; (b) migrasi `stock_non_negative` menambah `CHECK ("qty" >= 0)` di `ItemStock` sebagai pengaman balapan — transaksi kedua yang lolos cek aplikasi ditolak DB dan di-rollback, pesannya diterjemahkan di `formState.ts`.
8b. **[FIXED] Validasi kuantitas & pembayaran yang sebelumnya tidak ada:** kirim/terima tidak boleh melebihi sisa pesanan; faktur tidak boleh melebihi sisa yang belum ditagih; retur tidak boleh melebihi qty faktur dikurangi retur sebelumnya; pembayaran tidak boleh melebihi sisa tagihan/utang dan ditolak jika faktur sudah lunas. Semua diuji di `scripts/e2e-test-guards.ts`.

## B. UI/UX & responsivitas

9. **[FIXED] Tidak responsive.** Sidebar 256px permanen, form dipaksa 2 kolom, tabel meluber ke luar layar. Perbaikan: sidebar jadi *drawer* di mobile (tombol ☰, overlay, tutup otomatis saat navigasi) dan tetap *sticky* di desktop; semua form `grid-cols-1 md:grid-cols-2`; 25 tabel dibungkus `overflow-x-auto` (scroll horizontal di HP, halaman tidak ikut melebar); dashboard 2→4 kolom; padding halaman `p-4 md:p-8`; `min-w-0` di `<main>` agar tabel scroll bekerja dalam flex.
10. **[FIXED] Tidak ada penanda menu aktif; 31 link ditampilkan sekaligus.** Sidebar sekarang accordion 7 menu utama (Penjualan, Pembelian, Kas & Bank, Buku Besar, Aset Tetap, Persediaan, Daftar) + Dashboard; sub-menu hanya muncul saat menu utamanya diklik, dan menu yang memuat halaman aktif terbuka otomatis. Halaman aktif disorot (`aria-current="page"`), tombol accordion punya `aria-expanded`/`aria-controls`.
11. **[FIXED] Tidak ada indikator loading & pencegah dobel-klik.** `ActionForm` menonaktifkan seluruh input saat submit (`fieldset disabled`, `aria-busy`); `loading.tsx` skeleton untuk navigasi.
12. **[FIXED] Hapus tanpa konfirmasi.** Tombol Hapus (master data) dan Konversi Penawaran kini minta konfirmasi.
13. **[FIXED] Dark mode "setengah jadi".** CSS bawaan create-next-app mengganti latar jadi hitam saat OS dark-mode, sementara komponen (hover `bg-zinc-100`, border, tombol) didesain untuk terang → teks tak terbaca. Dipaksa `color-scheme: light` sampai ada desain dark yang utuh.
14. **[FIXED] Tidak ada `error.tsx` / `not-found.tsx`.** `notFound()` di `/master/[entity]` jatuh ke halaman default Next; sekarang ada halaman ramah + tombol kembali.
15. **[FIXED] Nama prop menyesatkan** `sellPrice` di `LineItemsEditor` (diisi `costPrice` untuk PO) → `defaultPrice`.
16. **[OPEN] `<label>` belum terhubung ke input (`htmlFor`/`id`)** — aksesibilitas & klik-label. Skala: ~60 field. Layak dibuat komponen `Field` sekaligus merapikan duplikasi markup.
17. **[OPEN] Tabel di mobile masih perlu scroll** (bukan kartu). Untuk tabel transaksi dengan 6–7 kolom ini keputusan yang wajar; kalau mau lebih ramah HP, ubah baris jadi kartu di `< md`.
18. **[OPEN] Belum ada halaman edit** untuk master data & dokumen; belum ada pencarian/filter/pagination di daftar (masalah begitu data > ratusan baris).
19. **[OPEN] Tiga komponen picker (`OrderLinesPicker`, `ReceiptLinesPicker`, `InvoiceLinesPicker`) hampir identik** — bisa dijadikan satu komponen dengan prop label. Ditunda: duplikasinya kecil dan jelas.

## C. Teknis / operasional

20. **[FIXED] Lint bersih.** 2 error React Compiler (setState dalam effect di Sidebar; mutasi variabel luar di Buku Besar) diperbaiki; `tsc --noEmit` dan `eslint` lulus tanpa error.
21. **[OPEN] Belum ada CI/commit.** Repo git ada (init dari create-next-app) tapi semua perubahan belum di-commit. Saran: commit sekarang sebagai baseline, lalu jalankan `tsc`, `eslint`, dan 4 skrip regresi di CI.
22. **[OPEN] Skrip regresi memakai database yang sama dengan data seed.** Sudah aman (cleanup berbasis waktu), tapi idealnya `DATABASE_URL` terpisah untuk test.
23. **[OPEN] Turbopack tidak me-reload Prisma Client setelah `prisma generate`** — restart `npm run dev` setiap ganti skema (sudah dicatat di README).

## Verifikasi yang dilakukan

- `npx tsc --noEmit` ✔ · `npx eslint src` ✔ (0 error)
- 4 skrip regresi (`e2e-test`, `-purchasing`, `-ledger`, `-assets`) lulus setelah refactor penomoran & form
- Smoke test HTTP semua rute utama 200, rute asing 404 (halaman not-found kustom)
- HTML hasil render dicek: meta viewport, tombol menu mobile, `aria-current`, pembungkus tabel, grid responsive, `fieldset.contents` semuanya ada
- Integritas data seed pasca-test: total debit = kredit = Rp 13.650.000, 4 jurnal, 0 akun test tersisa
