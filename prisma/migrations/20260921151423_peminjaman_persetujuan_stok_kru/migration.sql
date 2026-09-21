-- AlterEnum
ALTER TYPE "PeranPengguna" ADD VALUE 'KRU';

-- AlterTable
ALTER TABLE "BarisPeminjamanBarang" ADD COLUMN     "jumlahDiajukanKembali" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- Pengaman kondisi balapan saat ajukan kembali (pola sama dengan BarisPeminjamanBarang_kembali_tidak_melebihi):
-- tidak boleh mengajukan kembali melebihi jumlah yang dipinjam.
ALTER TABLE "BarisPeminjamanBarang" ADD CONSTRAINT "BarisPeminjamanBarang_diajukan_kembali_tidak_melebihi" CHECK ("jumlahDiajukanKembali" <= "jumlah");

-- AlterTable
ALTER TABLE "PeminjamanBarang" ADD COLUMN     "catatanPenolakan" TEXT,
ADD COLUMN     "diajukanOlehId" TEXT,
ADD COLUMN     "diajukanPada" TIMESTAMP(3),
ADD COLUMN     "disetujuiOlehId" TEXT,
ADD COLUMN     "disetujuiPada" TIMESTAMP(3),
ADD COLUMN     "ditolakOlehId" TEXT,
ADD COLUMN     "ditolakPada" TIMESTAMP(3),
ADD COLUMN     "statusPersetujuan" "StatusPersetujuan" NOT NULL DEFAULT 'DRAFT';

-- CreateIndex
CREATE INDEX "PeminjamanBarang_statusPersetujuan_idx" ON "PeminjamanBarang"("statusPersetujuan");

-- AddForeignKey
ALTER TABLE "PeminjamanBarang" ADD CONSTRAINT "PeminjamanBarang_diajukanOlehId_fkey" FOREIGN KEY ("diajukanOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeminjamanBarang" ADD CONSTRAINT "PeminjamanBarang_disetujuiOlehId_fkey" FOREIGN KEY ("disetujuiOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeminjamanBarang" ADD CONSTRAINT "PeminjamanBarang_ditolakOlehId_fkey" FOREIGN KEY ("ditolakOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;
