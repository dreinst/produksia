-- AlterTable
ALTER TABLE "FakturPenjualan" ADD COLUMN     "diskon" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PemetaanAkun" ADD COLUMN     "diskonPenjualanId" TEXT,
ADD COLUMN     "pendapatanLainId" TEXT;

-- AlterTable
ALTER TABLE "ReturPenjualan" ADD COLUMN     "diskon" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "PemetaanAkun_diskonPenjualanId_key" ON "PemetaanAkun"("diskonPenjualanId");

-- CreateIndex
CREATE UNIQUE INDEX "PemetaanAkun_pendapatanLainId_key" ON "PemetaanAkun"("pendapatanLainId");

-- AddForeignKey
ALTER TABLE "PemetaanAkun" ADD CONSTRAINT "PemetaanAkun_diskonPenjualanId_fkey" FOREIGN KEY ("diskonPenjualanId") REFERENCES "Akun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PemetaanAkun" ADD CONSTRAINT "PemetaanAkun_pendapatanLainId_fkey" FOREIGN KEY ("pendapatanLainId") REFERENCES "Akun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
