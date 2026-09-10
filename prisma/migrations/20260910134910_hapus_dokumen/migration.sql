-- AlterTable
ALTER TABLE "BarisPenerimaanBarang" ADD COLUMN     "hargaSatuan" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "BarisPengiriman" ADD COLUMN     "hargaPokok" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "jumlahDifaktur" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "BarisReturPembelian" ADD COLUMN     "hargaPokok" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "BarisReturPenjualan" ADD COLUMN     "hargaPokok" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "FakturPembelian" ADD COLUMN     "jurnalId" TEXT;

-- AlterTable
ALTER TABLE "FakturPenjualan" ADD COLUMN     "jurnalId" TEXT;

-- AlterTable
ALTER TABLE "PembayaranPembelian" ADD COLUMN     "jurnalId" TEXT;

-- AlterTable
ALTER TABLE "PemetaanAkun" ADD COLUMN     "barangTerkirimId" TEXT;

-- AlterTable
ALTER TABLE "PenerimaanPenjualan" ADD COLUMN     "jurnalId" TEXT;

-- AlterTable
ALTER TABLE "PengirimanPesanan" ADD COLUMN     "jurnalId" TEXT;

-- AlterTable
ALTER TABLE "ReturPembelian" ADD COLUMN     "jurnalId" TEXT;

-- AlterTable
ALTER TABLE "ReturPenjualan" ADD COLUMN     "jurnalId" TEXT;

-- CreateTable
CREATE TABLE "LogAktivitas" (
    "id" TEXT NOT NULL,
    "waktu" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "penggunaId" TEXT,
    "penggunaNama" TEXT NOT NULL,
    "aksi" TEXT NOT NULL,
    "jenis" TEXT NOT NULL,
    "nomor" TEXT NOT NULL,
    "keterangan" TEXT,

    CONSTRAINT "LogAktivitas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LogAktivitas_waktu_idx" ON "LogAktivitas"("waktu");

-- CreateIndex
CREATE UNIQUE INDEX "FakturPembelian_jurnalId_key" ON "FakturPembelian"("jurnalId");

-- CreateIndex
CREATE UNIQUE INDEX "FakturPenjualan_jurnalId_key" ON "FakturPenjualan"("jurnalId");

-- CreateIndex
CREATE UNIQUE INDEX "PembayaranPembelian_jurnalId_key" ON "PembayaranPembelian"("jurnalId");

-- CreateIndex
CREATE UNIQUE INDEX "PemetaanAkun_barangTerkirimId_key" ON "PemetaanAkun"("barangTerkirimId");

-- CreateIndex
CREATE UNIQUE INDEX "PenerimaanPenjualan_jurnalId_key" ON "PenerimaanPenjualan"("jurnalId");

-- CreateIndex
CREATE UNIQUE INDEX "PengirimanPesanan_jurnalId_key" ON "PengirimanPesanan"("jurnalId");

-- CreateIndex
CREATE UNIQUE INDEX "ReturPembelian_jurnalId_key" ON "ReturPembelian"("jurnalId");

-- CreateIndex
CREATE UNIQUE INDEX "ReturPenjualan_jurnalId_key" ON "ReturPenjualan"("jurnalId");

-- AddForeignKey
ALTER TABLE "PengirimanPesanan" ADD CONSTRAINT "PengirimanPesanan_jurnalId_fkey" FOREIGN KEY ("jurnalId") REFERENCES "Jurnal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FakturPenjualan" ADD CONSTRAINT "FakturPenjualan_jurnalId_fkey" FOREIGN KEY ("jurnalId") REFERENCES "Jurnal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PenerimaanPenjualan" ADD CONSTRAINT "PenerimaanPenjualan_jurnalId_fkey" FOREIGN KEY ("jurnalId") REFERENCES "Jurnal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturPenjualan" ADD CONSTRAINT "ReturPenjualan_jurnalId_fkey" FOREIGN KEY ("jurnalId") REFERENCES "Jurnal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FakturPembelian" ADD CONSTRAINT "FakturPembelian_jurnalId_fkey" FOREIGN KEY ("jurnalId") REFERENCES "Jurnal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PembayaranPembelian" ADD CONSTRAINT "PembayaranPembelian_jurnalId_fkey" FOREIGN KEY ("jurnalId") REFERENCES "Jurnal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturPembelian" ADD CONSTRAINT "ReturPembelian_jurnalId_fkey" FOREIGN KEY ("jurnalId") REFERENCES "Jurnal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PemetaanAkun" ADD CONSTRAINT "PemetaanAkun_barangTerkirimId_fkey" FOREIGN KEY ("barangTerkirimId") REFERENCES "Akun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

