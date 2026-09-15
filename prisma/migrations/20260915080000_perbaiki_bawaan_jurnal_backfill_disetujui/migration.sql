-- Perbaikan pasca-migrasi alur persetujuan (20260914200000_persetujuan_mata_uang):
--
-- 1) Bawaan kolom Jurnal.statusPersetujuan di migrasi sebelumnya ikut memakai DEFAULT 'DRAFT'
--    (ikut pola tabel dokumen lain), padahal skema (lihat komentarnya) menetapkan bawaan
--    DISETUJUI: keberadaan satu baris Jurnal selalu berarti sudah final/tercatat di buku besar.
--    Prisma Client selalu mengirim nilai default secara eksplisit saat INSERT (bukan mengandalkan
--    default di basis data), jadi ini tidak pernah jadi bug aktif untuk baris baru; diperbaiki di
--    sini murni supaya definisi kolom di basis data konsisten dengan skema.
ALTER TABLE "Jurnal" ALTER COLUMN "statusPersetujuan" SET DEFAULT 'DISETUJUI';

-- 2) Backfill wajib untuk basis data yang SUDAH berisi data sebelum alur persetujuan ada
--    (mis. basis data produksi). Migrasi sebelumnya menambah kolom statusPersetujuan dengan
--    DEFAULT 'DRAFT' ke 21 tabel dokumen; nilai default itu otomatis diterapkan basis data ke
--    SEMUA baris yang sudah ada, padahal dokumen-dokumen itu sudah nyata terjadi (kalau punya
--    jurnal, jurnalnya sudah tercatat di buku besar). Karena laporan (Piutang, Hutang, dsb.)
--    sekarang memfilter hanya statusPersetujuan = 'DISETUJUI', tanpa backfill ini seluruh
--    riwayat dokumen lama akan hilang dari laporan walau uangnya tetap ada di buku besar.
--
--    Di basis data yang baru diseed/kosong (dev, CI), UPDATE ini tidak mengubah apa pun
--    (tidak ada baris) sehingga aman dijalankan di semua environment.
UPDATE "Jurnal" SET "statusPersetujuan" = 'DISETUJUI' WHERE "statusPersetujuan" = 'DRAFT';
UPDATE "AsetTetap" SET "statusPersetujuan" = 'DISETUJUI' WHERE "statusPersetujuan" = 'DRAFT';
UPDATE "FakturPembelian" SET "statusPersetujuan" = 'DISETUJUI' WHERE "statusPersetujuan" = 'DRAFT';
UPDATE "FakturPenjualan" SET "statusPersetujuan" = 'DISETUJUI' WHERE "statusPersetujuan" = 'DRAFT';
UPDATE "PelepasanAset" SET "statusPersetujuan" = 'DISETUJUI' WHERE "statusPersetujuan" = 'DRAFT';
UPDATE "PembayaranPembelian" SET "statusPersetujuan" = 'DISETUJUI' WHERE "statusPersetujuan" = 'DRAFT';
UPDATE "PenawaranPenjualan" SET "statusPersetujuan" = 'DISETUJUI' WHERE "statusPersetujuan" = 'DRAFT';
UPDATE "PenerimaanBarang" SET "statusPersetujuan" = 'DISETUJUI' WHERE "statusPersetujuan" = 'DRAFT';
UPDATE "PenerimaanPenjualan" SET "statusPersetujuan" = 'DISETUJUI' WHERE "statusPersetujuan" = 'DRAFT';
UPDATE "Penggajian" SET "statusPersetujuan" = 'DISETUJUI' WHERE "statusPersetujuan" = 'DRAFT';
UPDATE "PengirimanPesanan" SET "statusPersetujuan" = 'DISETUJUI' WHERE "statusPersetujuan" = 'DRAFT';
UPDATE "PenyesuaianPersediaan" SET "statusPersetujuan" = 'DISETUJUI' WHERE "statusPersetujuan" = 'DRAFT';
UPDATE "PesananPembelian" SET "statusPersetujuan" = 'DISETUJUI' WHERE "statusPersetujuan" = 'DRAFT';
UPDATE "PesananPenjualan" SET "statusPersetujuan" = 'DISETUJUI' WHERE "statusPersetujuan" = 'DRAFT';
UPDATE "PindahBarang" SET "statusPersetujuan" = 'DISETUJUI' WHERE "statusPersetujuan" = 'DRAFT';
UPDATE "PphFinalBulanan" SET "statusPersetujuan" = 'DISETUJUI' WHERE "statusPersetujuan" = 'DRAFT';
UPDATE "Prive" SET "statusPersetujuan" = 'DISETUJUI' WHERE "statusPersetujuan" = 'DRAFT';
UPDATE "ReturPembelian" SET "statusPersetujuan" = 'DISETUJUI' WHERE "statusPersetujuan" = 'DRAFT';
UPDATE "ReturPenjualan" SET "statusPersetujuan" = 'DISETUJUI' WHERE "statusPersetujuan" = 'DRAFT';
UPDATE "TutupBuku" SET "statusPersetujuan" = 'DISETUJUI' WHERE "statusPersetujuan" = 'DRAFT';
UPDATE "UangMukaPelanggan" SET "statusPersetujuan" = 'DISETUJUI' WHERE "statusPersetujuan" = 'DRAFT';
