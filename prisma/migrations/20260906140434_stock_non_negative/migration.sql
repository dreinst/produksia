-- Stok tidak boleh negatif. Aplikasi sudah mengecek sebelum mengurangi stok,
-- constraint ini pengaman terakhir untuk kondisi balapan (dua pengiriman bersamaan).
ALTER TABLE "ItemStock" ADD CONSTRAINT "ItemStock_qty_non_negative" CHECK ("qty" >= 0);
