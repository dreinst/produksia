-- AlterEnum
ALTER TYPE "SumberJurnal" ADD VALUE 'PENGGAJIAN';
-- AlterTable
ALTER TABLE "Karyawan" ADD COLUMN     "akunBebanId" TEXT,
ADD COLUMN     "gajiPokok" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "jabatan" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'AKTIF',
ADD COLUMN     "tanggalBergabung" TIMESTAMP(3),
ADD COLUMN     "tunjangan" DECIMAL(18,2) NOT NULL DEFAULT 0;
-- CreateTable
CREATE TABLE "Penggajian" (
    "id" TEXT NOT NULL,
    "nomor" TEXT NOT NULL,
    "periode" TEXT NOT NULL,
    "tanggal" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "akunKasId" TEXT NOT NULL,
    "proyekId" TEXT,
    "totalGajiPokok" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalTunjangan" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalPotongan" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalDibayar" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "keterangan" TEXT,
    "jurnalId" TEXT,
    "penggunaNama" TEXT NOT NULL,
    "dibuatPada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Penggajian_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "BarisPenggajian" (
    "id" TEXT NOT NULL,
    "penggajianId" TEXT NOT NULL,
    "karyawanId" TEXT NOT NULL,
    "gajiPokok" DECIMAL(18,2) NOT NULL,
    "tunjangan" DECIMAL(18,2) NOT NULL,
    "potongan" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "keteranganPotongan" TEXT,
    "diterima" DECIMAL(18,2) NOT NULL,
    CONSTRAINT "BarisPenggajian_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "Penggajian_nomor_key" ON "Penggajian"("nomor");
-- CreateIndex
CREATE UNIQUE INDEX "Penggajian_periode_key" ON "Penggajian"("periode");
-- CreateIndex
CREATE UNIQUE INDEX "Penggajian_jurnalId_key" ON "Penggajian"("jurnalId");
-- CreateIndex
CREATE INDEX "Penggajian_akunKasId_idx" ON "Penggajian"("akunKasId");
-- CreateIndex
CREATE INDEX "Penggajian_proyekId_idx" ON "Penggajian"("proyekId");
-- CreateIndex
CREATE INDEX "Penggajian_tanggal_idx" ON "Penggajian"("tanggal");
-- CreateIndex
CREATE INDEX "BarisPenggajian_penggajianId_idx" ON "BarisPenggajian"("penggajianId");
-- CreateIndex
CREATE INDEX "BarisPenggajian_karyawanId_idx" ON "BarisPenggajian"("karyawanId");
-- CreateIndex
CREATE INDEX "Karyawan_akunBebanId_idx" ON "Karyawan"("akunBebanId");
-- AddForeignKey
ALTER TABLE "Karyawan" ADD CONSTRAINT "Karyawan_akunBebanId_fkey" FOREIGN KEY ("akunBebanId") REFERENCES "Akun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "Penggajian" ADD CONSTRAINT "Penggajian_akunKasId_fkey" FOREIGN KEY ("akunKasId") REFERENCES "Akun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "Penggajian" ADD CONSTRAINT "Penggajian_proyekId_fkey" FOREIGN KEY ("proyekId") REFERENCES "Proyek"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "Penggajian" ADD CONSTRAINT "Penggajian_jurnalId_fkey" FOREIGN KEY ("jurnalId") REFERENCES "Jurnal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "BarisPenggajian" ADD CONSTRAINT "BarisPenggajian_penggajianId_fkey" FOREIGN KEY ("penggajianId") REFERENCES "Penggajian"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "BarisPenggajian" ADD CONSTRAINT "BarisPenggajian_karyawanId_fkey" FOREIGN KEY ("karyawanId") REFERENCES "Karyawan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
