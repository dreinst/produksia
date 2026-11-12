-- Email DPRO yang dicetak diganti menjadi office@dpro.events (keputusan pengguna P-3). Migrasi 20261109160000_lebur_hka
-- mengisi perusahaan utama dengan dproductionorganizer@gmail.com dan tidak boleh diubah karena checksum-nya sudah
-- tercatat. Syarat email lama menjaga email yang sudah diganti pengguna lewat Pengaturan supaya tidak tertimpa.
UPDATE "Perusahaan" SET "email" = 'office@dpro.events' WHERE "id" = 'utama' AND "email" = 'dproductionorganizer@gmail.com';
