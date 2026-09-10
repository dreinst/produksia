-- AlterTable
ALTER TABLE "BarisJurnal" ADD COLUMN     "rekonsiliasiPada" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Jurnal" ADD COLUMN     "proyekId" TEXT;

-- AlterTable
ALTER TABLE "PenawaranPenjualan" ADD COLUMN     "proyekId" TEXT;

-- AlterTable
ALTER TABLE "PesananPembelian" ADD COLUMN     "proyekId" TEXT;

-- AlterTable
ALTER TABLE "PesananPenjualan" ADD COLUMN     "proyekId" TEXT;

-- AlterTable
ALTER TABLE "Proyek" ADD COLUMN     "anggaranBiaya" DECIMAL(18,2),
ADD COLUMN     "keterangan" TEXT,
ADD COLUMN     "nilaiKontrak" DECIMAL(18,2),
ADD COLUMN     "tanggalMulai" TIMESTAMP(3),
ADD COLUMN     "tanggalSelesai" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "MutasiBank" (
    "id" TEXT NOT NULL,
    "akunId" TEXT NOT NULL,
    "tanggal" TIMESTAMP(3) NOT NULL,
    "keterangan" TEXT NOT NULL,
    "referensi" TEXT,
    "masuk" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "keluar" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "saldo" DECIMAL(18,2),
    "sidik" TEXT NOT NULL,
    "berkas" TEXT NOT NULL,
    "diimporPada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "penggunaNama" TEXT NOT NULL,
    "barisJurnalId" TEXT,

    CONSTRAINT "MutasiBank_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MutasiBank_sidik_key" ON "MutasiBank"("sidik");

-- CreateIndex
CREATE UNIQUE INDEX "MutasiBank_barisJurnalId_key" ON "MutasiBank"("barisJurnalId");

-- CreateIndex
CREATE INDEX "MutasiBank_akunId_tanggal_idx" ON "MutasiBank"("akunId", "tanggal");

-- AddForeignKey
ALTER TABLE "PenawaranPenjualan" ADD CONSTRAINT "PenawaranPenjualan_proyekId_fkey" FOREIGN KEY ("proyekId") REFERENCES "Proyek"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PesananPenjualan" ADD CONSTRAINT "PesananPenjualan_proyekId_fkey" FOREIGN KEY ("proyekId") REFERENCES "Proyek"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PesananPembelian" ADD CONSTRAINT "PesananPembelian_proyekId_fkey" FOREIGN KEY ("proyekId") REFERENCES "Proyek"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Jurnal" ADD CONSTRAINT "Jurnal_proyekId_fkey" FOREIGN KEY ("proyekId") REFERENCES "Proyek"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MutasiBank" ADD CONSTRAINT "MutasiBank_akunId_fkey" FOREIGN KEY ("akunId") REFERENCES "Akun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MutasiBank" ADD CONSTRAINT "MutasiBank_barisJurnalId_fkey" FOREIGN KEY ("barisJurnalId") REFERENCES "BarisJurnal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

