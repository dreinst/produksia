-- Slot gambar kop dicatat di berkasnya, supaya berkas kop yang sudah dilepas ke Sampah masih bisa dinilai: tanda tangan
-- dan stempel tetap tertutup tanpa tanda-tangan-cetak.buat, gambar kop lain terbuka bagi pemegang pengaturan.tulis.
-- Aditif: satu kolom nullable. Baris yang slotnya tidak bisa dipulihkan tetap null, dan null diperlakukan tertutup.
ALTER TABLE "Berkas" ADD COLUMN "slotKop" "JenisAsetKop";

-- Gambar yang sedang terpasang: slotnya ada di AsetKopSurat.
UPDATE "Berkas" b SET "slotKop" = a."jenis" FROM "AsetKopSurat" a WHERE a."berkasId" = b."id";

-- Gambar yang sudah dilepas: unggah dan hapus gambar kop mencatat jenis slot dan id berkasnya di meta log kop.
UPDATE "Berkas" b
SET "slotKop" = l."slot"::"JenisAsetKop"
FROM (
  SELECT DISTINCT ON ("meta"->>'berkasId') "meta"->>'berkasId' AS "berkasId", "meta"->>'jenis' AS "slot"
  FROM "LogAktivitas"
  WHERE "jenis" = 'Kop Surat'
    AND "modul" = 'pengaturan'
    AND "meta"->>'berkasId' IS NOT NULL
    AND "meta"->>'jenis' = ANY (enum_range(NULL::"JenisAsetKop")::text[])
  ORDER BY "meta"->>'berkasId', "waktu" DESC
) l
WHERE b."id" = l."berkasId" AND b."jenisEntitas" = 'kop-surat' AND b."slotKop" IS NULL;
