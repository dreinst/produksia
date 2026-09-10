-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SumberJurnal" ADD VALUE 'PERSEDIAAN';
ALTER TYPE "SumberJurnal" ADD VALUE 'ASET_TETAP';

-- AlterTable
ALTER TABLE "AsetTetap" ADD COLUMN     "akunPembayaranId" TEXT,
ADD COLUMN     "jurnalPerolehanId" TEXT;

-- AlterTable
ALTER TABLE "Barang" ADD COLUMN     "akunBebanId" TEXT,
ADD COLUMN     "akunHppId" TEXT,
ADD COLUMN     "akunPendapatanId" TEXT,
ADD COLUMN     "akunPersediaanId" TEXT;

-- AlterTable
ALTER TABLE "PemetaanAkun" ADD COLUMN     "barangBelumDitagihId" TEXT,
ADD COLUMN     "bebanJasaId" TEXT,
ADD COLUMN     "selisihPersediaanId" TEXT;

-- AlterTable
ALTER TABLE "PenerimaanBarang" ADD COLUMN     "jurnalId" TEXT;

-- AlterTable
ALTER TABLE "ReturPembelian" ADD COLUMN     "total" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ReturPenjualan" ADD COLUMN     "total" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PenyesuaianPersediaan" (
    "id" TEXT NOT NULL,
    "nomor" TEXT NOT NULL,
    "tanggal" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "gudangId" TEXT NOT NULL,
    "keterangan" TEXT,
    "akunLawanId" TEXT NOT NULL,
    "jurnalId" TEXT,
    "dibuatPada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PenyesuaianPersediaan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BarisPenyesuaianPersediaan" (
    "id" TEXT NOT NULL,
    "penyesuaianId" TEXT NOT NULL,
    "barangId" TEXT NOT NULL,
    "jumlahSebelum" DECIMAL(18,2) NOT NULL,
    "jumlahSesudah" DECIMAL(18,2) NOT NULL,
    "hargaSatuan" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "BarisPenyesuaianPersediaan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PenyesuaianPersediaan_nomor_key" ON "PenyesuaianPersediaan"("nomor");

-- CreateIndex
CREATE UNIQUE INDEX "PenyesuaianPersediaan_jurnalId_key" ON "PenyesuaianPersediaan"("jurnalId");

-- CreateIndex
CREATE UNIQUE INDEX "AsetTetap_jurnalPerolehanId_key" ON "AsetTetap"("jurnalPerolehanId");

-- CreateIndex
CREATE UNIQUE INDEX "PemetaanAkun_bebanJasaId_key" ON "PemetaanAkun"("bebanJasaId");

-- CreateIndex
CREATE UNIQUE INDEX "PemetaanAkun_barangBelumDitagihId_key" ON "PemetaanAkun"("barangBelumDitagihId");

-- CreateIndex
CREATE UNIQUE INDEX "PemetaanAkun_selisihPersediaanId_key" ON "PemetaanAkun"("selisihPersediaanId");

-- CreateIndex
CREATE UNIQUE INDEX "PenerimaanBarang_jurnalId_key" ON "PenerimaanBarang"("jurnalId");

-- AddForeignKey
ALTER TABLE "Barang" ADD CONSTRAINT "Barang_akunPendapatanId_fkey" FOREIGN KEY ("akunPendapatanId") REFERENCES "Akun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Barang" ADD CONSTRAINT "Barang_akunHppId_fkey" FOREIGN KEY ("akunHppId") REFERENCES "Akun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Barang" ADD CONSTRAINT "Barang_akunPersediaanId_fkey" FOREIGN KEY ("akunPersediaanId") REFERENCES "Akun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Barang" ADD CONSTRAINT "Barang_akunBebanId_fkey" FOREIGN KEY ("akunBebanId") REFERENCES "Akun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PenerimaanBarang" ADD CONSTRAINT "PenerimaanBarang_jurnalId_fkey" FOREIGN KEY ("jurnalId") REFERENCES "Jurnal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PemetaanAkun" ADD CONSTRAINT "PemetaanAkun_bebanJasaId_fkey" FOREIGN KEY ("bebanJasaId") REFERENCES "Akun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PemetaanAkun" ADD CONSTRAINT "PemetaanAkun_barangBelumDitagihId_fkey" FOREIGN KEY ("barangBelumDitagihId") REFERENCES "Akun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PemetaanAkun" ADD CONSTRAINT "PemetaanAkun_selisihPersediaanId_fkey" FOREIGN KEY ("selisihPersediaanId") REFERENCES "Akun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AsetTetap" ADD CONSTRAINT "AsetTetap_akunPembayaranId_fkey" FOREIGN KEY ("akunPembayaranId") REFERENCES "Akun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AsetTetap" ADD CONSTRAINT "AsetTetap_jurnalPerolehanId_fkey" FOREIGN KEY ("jurnalPerolehanId") REFERENCES "Jurnal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PenyesuaianPersediaan" ADD CONSTRAINT "PenyesuaianPersediaan_gudangId_fkey" FOREIGN KEY ("gudangId") REFERENCES "Gudang"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PenyesuaianPersediaan" ADD CONSTRAINT "PenyesuaianPersediaan_akunLawanId_fkey" FOREIGN KEY ("akunLawanId") REFERENCES "Akun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PenyesuaianPersediaan" ADD CONSTRAINT "PenyesuaianPersediaan_jurnalId_fkey" FOREIGN KEY ("jurnalId") REFERENCES "Jurnal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarisPenyesuaianPersediaan" ADD CONSTRAINT "BarisPenyesuaianPersediaan_penyesuaianId_fkey" FOREIGN KEY ("penyesuaianId") REFERENCES "PenyesuaianPersediaan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarisPenyesuaianPersediaan" ADD CONSTRAINT "BarisPenyesuaianPersediaan_barangId_fkey" FOREIGN KEY ("barangId") REFERENCES "Barang"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

