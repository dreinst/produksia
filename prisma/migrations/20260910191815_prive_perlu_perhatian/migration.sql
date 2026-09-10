-- AlterEnum
ALTER TYPE "SumberJurnal" ADD VALUE 'PRIVE';

-- AlterTable
ALTER TABLE "MutasiBank" ADD COLUMN     "dikonfirmasiPada" TIMESTAMP(3),
ADD COLUMN     "perluPerhatian" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Prive" (
    "id" TEXT NOT NULL,
    "nomor" TEXT NOT NULL,
    "tanggal" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pemilikNama" TEXT NOT NULL,
    "akunKasId" TEXT NOT NULL,
    "akunPriveId" TEXT NOT NULL,
    "jumlah" DECIMAL(18,2) NOT NULL,
    "keterangan" TEXT,
    "jurnalId" TEXT,
    "penggunaNama" TEXT NOT NULL,
    "dibuatPada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Prive_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Prive_nomor_key" ON "Prive"("nomor");

-- CreateIndex
CREATE UNIQUE INDEX "Prive_jurnalId_key" ON "Prive"("jurnalId");

-- AddForeignKey
ALTER TABLE "Prive" ADD CONSTRAINT "Prive_akunKasId_fkey" FOREIGN KEY ("akunKasId") REFERENCES "Akun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prive" ADD CONSTRAINT "Prive_akunPriveId_fkey" FOREIGN KEY ("akunPriveId") REFERENCES "Akun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prive" ADD CONSTRAINT "Prive_jurnalId_fkey" FOREIGN KEY ("jurnalId") REFERENCES "Jurnal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

