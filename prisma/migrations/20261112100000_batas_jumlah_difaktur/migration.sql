-- Batas jumlah difaktur (perbaikan tinjauan perbaikan P27 S2): progres faktur baris pesanan penjualan dan konsumsi
-- baris surat jalan tidak boleh di bawah nol atau melebihi jumlah barisnya. Pembalik di hapus faktur sudah bersyarat;
-- CHECK ini penjaga terakhir supaya angka rusak tidak tersimpan diam-diam. Aditif. Sebelum deploy, kueri baca saja di
-- CATATAN-DEPLOY harus kosong, karena ADD CONSTRAINT memeriksa semua baris yang sudah ada.
ALTER TABLE "BarisPesananPenjualan" ADD CONSTRAINT "BarisPesananPenjualan_jumlahDifaktur_batas" CHECK ("jumlahDifaktur" >= 0 AND "jumlahDifaktur" <= "jumlah");

ALTER TABLE "BarisPengiriman" ADD CONSTRAINT "BarisPengiriman_jumlahDifaktur_batas" CHECK ("jumlahDifaktur" >= 0 AND "jumlahDifaktur" <= "jumlah");
