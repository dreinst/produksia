-- AlterTable
ALTER TABLE "FakturPenjualan" ADD COLUMN     "uangMuka" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PemetaanAkun" ADD COLUMN     "uangMukaPelangganId" TEXT;

-- CreateTable
CREATE TABLE "UangMukaPelanggan" (
    "id" TEXT NOT NULL,
    "nomor" TEXT NOT NULL,
    "tanggal" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pelangganId" TEXT NOT NULL,
    "pesananId" TEXT NOT NULL,
    "akunId" TEXT NOT NULL,
    "jumlah" DECIMAL(18,2) NOT NULL,
    "jumlahDipakai" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "metodeBayar" TEXT NOT NULL DEFAULT 'TRANSFER',
    "keterangan" TEXT,
    "jurnalId" TEXT,

    CONSTRAINT "UangMukaPelanggan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PemakaianUangMuka" (
    "id" TEXT NOT NULL,
    "uangMukaId" TEXT NOT NULL,
    "fakturId" TEXT NOT NULL,
    "jumlah" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "PemakaianUangMuka_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UangMukaPelanggan_nomor_key" ON "UangMukaPelanggan"("nomor");

-- CreateIndex
CREATE UNIQUE INDEX "UangMukaPelanggan_jurnalId_key" ON "UangMukaPelanggan"("jurnalId");

-- CreateIndex
CREATE INDEX "PemakaianUangMuka_fakturId_idx" ON "PemakaianUangMuka"("fakturId");

-- CreateIndex
CREATE UNIQUE INDEX "PemetaanAkun_uangMukaPelangganId_key" ON "PemetaanAkun"("uangMukaPelangganId");

-- AddForeignKey
ALTER TABLE "UangMukaPelanggan" ADD CONSTRAINT "UangMukaPelanggan_pelangganId_fkey" FOREIGN KEY ("pelangganId") REFERENCES "Pelanggan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UangMukaPelanggan" ADD CONSTRAINT "UangMukaPelanggan_pesananId_fkey" FOREIGN KEY ("pesananId") REFERENCES "PesananPenjualan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UangMukaPelanggan" ADD CONSTRAINT "UangMukaPelanggan_akunId_fkey" FOREIGN KEY ("akunId") REFERENCES "Akun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UangMukaPelanggan" ADD CONSTRAINT "UangMukaPelanggan_jurnalId_fkey" FOREIGN KEY ("jurnalId") REFERENCES "Jurnal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PemakaianUangMuka" ADD CONSTRAINT "PemakaianUangMuka_uangMukaId_fkey" FOREIGN KEY ("uangMukaId") REFERENCES "UangMukaPelanggan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PemakaianUangMuka" ADD CONSTRAINT "PemakaianUangMuka_fakturId_fkey" FOREIGN KEY ("fakturId") REFERENCES "FakturPenjualan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PemetaanAkun" ADD CONSTRAINT "PemetaanAkun_uangMukaPelangganId_fkey" FOREIGN KEY ("uangMukaPelangganId") REFERENCES "Akun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

