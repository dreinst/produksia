-- AlterEnum
ALTER TYPE "PeranPengguna" ADD VALUE 'GUEST';

-- AlterTable
ALTER TABLE "Foto" ADD COLUMN     "penggunaId" TEXT;

-- AlterTable
ALTER TABLE "PeminjamanBarang" ADD COLUMN     "nomorTelepon" TEXT,
ADD COLUMN     "nomorTeleponKembali" TEXT;

-- AlterTable
ALTER TABLE "Pengguna" ADD COLUMN     "nomorTelepon" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Foto_penggunaId_key" ON "Foto"("penggunaId");

-- AddForeignKey
ALTER TABLE "Foto" ADD CONSTRAINT "Foto_penggunaId_fkey" FOREIGN KEY ("penggunaId") REFERENCES "Pengguna"("id") ON DELETE CASCADE ON UPDATE CASCADE;
