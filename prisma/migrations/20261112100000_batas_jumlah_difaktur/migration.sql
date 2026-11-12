-- Batas jumlah difaktur (perbaikan tinjauan perbaikan P27 S2): progres faktur baris pesanan penjualan dan konsumsi
-- baris surat jalan tidak boleh di bawah nol atau melebihi jumlah barisnya. Pembalik di hapus faktur sudah bersyarat;
-- CHECK ini penjaga terakhir supaya angka rusak tidak tersimpan diam-diam.
--
-- Data lama bug B-10 (D2 §10.5 no. 6, tinjauan perbaikan P27 tahap 2 T1): kode lama menaikkan jumlahDifaktur di satu
-- baris pesanan untuk barang yang muncul di beberapa baris. Contoh: A (X, 2) dan B (X, 3) yang difaktur 5 unit X
-- tersimpan A = 5, B = 0. Sebelum CHECK dipasang, jumlahDifaktur per (pesanan, barang) yang salah satu barisnya di luar
-- 0..jumlah dibagi ulang ke baris berbarang sama urut urutan lalu id, masing-masing sampai jumlahnya (A = 2, B = 3).
-- Total per barang tetap, jadi sisa tagih per barang dan semua angka uang tidak bergeser. Grup yang sudah di dalam batas
-- tidak disentuh. Hapus faktur lama (baris faktur tanpa barisPesananId) mengurangi baris berbarang sama urut terbalik,
-- jadi faktur lama atas data yang dibagi ulang tetap bisa dihapus.
--
-- Data yang tidak bisa dibagi ulang (total difaktur per barang di bawah nol atau di atas total dipesan, atau baris surat
-- jalan di luar 0..jumlah) menghentikan migrasi dengan pesan yang menyebut nomor dokumennya, sebelum ada yang diubah.
-- Kueri pra-deploy di CATATAN-DEPLOY menemukan data seperti itu lebih dulu.
DO $$
DECLARE
  rusak text;
BEGIN
  SELECT string_agg(format('%s barang %s (difaktur %s, dipesan %s)', p."nomor", b."kode", g.difaktur, g.dipesan), '; ' ORDER BY p."nomor", b."kode")
    INTO rusak
    FROM (
      SELECT "pesananId", "barangId", SUM("jumlahDifaktur") AS difaktur, SUM("jumlah") AS dipesan
        FROM "BarisPesananPenjualan"
       GROUP BY "pesananId", "barangId"
      HAVING BOOL_OR("jumlahDifaktur" < 0 OR "jumlahDifaktur" > "jumlah")
         AND (SUM("jumlahDifaktur") < 0 OR SUM("jumlahDifaktur") > SUM("jumlah"))
    ) g
    JOIN "PesananPenjualan" p ON p."id" = g."pesananId"
    JOIN "Barang" b ON b."id" = g."barangId";
  IF rusak IS NOT NULL THEN
    RAISE EXCEPTION 'Progres faktur pesanan penjualan tidak bisa dibagi ulang, total difaktur per barang di luar 0..dipesan: %. Betulkan datanya dulu (lihat CATATAN-DEPLOY), lalu jalankan migrasi lagi.', rusak;
  END IF;

  SELECT string_agg(format('%s barang %s (difaktur %s, jumlah %s)', s."nomor", b."kode", bp."jumlahDifaktur", bp."jumlah"), '; ' ORDER BY s."nomor", b."kode")
    INTO rusak
    FROM "BarisPengiriman" bp
    JOIN "PengirimanPesanan" s ON s."id" = bp."pengirimanId"
    JOIN "Barang" b ON b."id" = bp."barangId"
   WHERE bp."jumlahDifaktur" < 0 OR bp."jumlahDifaktur" > bp."jumlah";
  IF rusak IS NOT NULL THEN
    RAISE EXCEPTION 'Jumlah difaktur baris surat jalan di luar 0..jumlah: %. Betulkan datanya dulu (lihat CATATAN-DEPLOY), lalu jalankan migrasi lagi.', rusak;
  END IF;

  WITH grup AS (
    SELECT "pesananId", "barangId", SUM("jumlahDifaktur") AS total
      FROM "BarisPesananPenjualan"
     GROUP BY "pesananId", "barangId"
    HAVING BOOL_OR("jumlahDifaktur" < 0 OR "jumlahDifaktur" > "jumlah")
  ), urut AS (
    SELECT bp."id", bp."jumlah", g.total,
           COALESCE(SUM(bp."jumlah") OVER (PARTITION BY bp."pesananId", bp."barangId" ORDER BY bp."urutan", bp."id" ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS sebelum
      FROM "BarisPesananPenjualan" bp
      JOIN grup g ON g."pesananId" = bp."pesananId" AND g."barangId" = bp."barangId"
  )
  UPDATE "BarisPesananPenjualan" t
     SET "jumlahDifaktur" = LEAST(u."jumlah", GREATEST(u.total - u.sebelum, 0))
    FROM urut u
   WHERE t."id" = u."id";
END $$;

ALTER TABLE "BarisPesananPenjualan" ADD CONSTRAINT "BarisPesananPenjualan_jumlahDifaktur_batas" CHECK ("jumlahDifaktur" >= 0 AND "jumlahDifaktur" <= "jumlah");

ALTER TABLE "BarisPengiriman" ADD CONSTRAINT "BarisPengiriman_jumlahDifaktur_batas" CHECK ("jumlahDifaktur" >= 0 AND "jumlahDifaktur" <= "jumlah");
