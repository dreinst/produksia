-- AlterEnum
ALTER TYPE "SumberJurnal" ADD VALUE 'PENUTUP';

-- AlterTable
ALTER TABLE "PemetaanAkun" ADD COLUMN     "labaDitahanId" TEXT;

-- CreateTable
CREATE TABLE "TutupBuku" (
    "id" TEXT NOT NULL,
    "tahun" INTEGER NOT NULL,
    "tanggal" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "labaBersih" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "penggunaNama" TEXT NOT NULL,
    "jurnalId" TEXT,

    CONSTRAINT "TutupBuku_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TutupBuku_tahun_key" ON "TutupBuku"("tahun");

-- CreateIndex
CREATE UNIQUE INDEX "TutupBuku_jurnalId_key" ON "TutupBuku"("jurnalId");

-- CreateIndex
CREATE UNIQUE INDEX "PemetaanAkun_labaDitahanId_key" ON "PemetaanAkun"("labaDitahanId");

-- AddForeignKey
ALTER TABLE "PemetaanAkun" ADD CONSTRAINT "PemetaanAkun_labaDitahanId_fkey" FOREIGN KEY ("labaDitahanId") REFERENCES "Akun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TutupBuku" ADD CONSTRAINT "TutupBuku_jurnalId_fkey" FOREIGN KEY ("jurnalId") REFERENCES "Jurnal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

