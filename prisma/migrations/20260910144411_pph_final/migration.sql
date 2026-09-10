-- AlterTable
ALTER TABLE "PengaturanPerusahaan" ADD COLUMN     "akunBebanPphFinalId" TEXT,
ADD COLUMN     "akunHutangPphFinalId" TEXT,
ADD COLUMN     "pphFinalPersen" DECIMAL(5,2) NOT NULL DEFAULT 0.5;

-- CreateTable
CREATE TABLE "PphFinalBulanan" (
    "id" TEXT NOT NULL,
    "periode" TEXT NOT NULL,
    "omzet" DECIMAL(18,2) NOT NULL,
    "tarifPersen" DECIMAL(5,2) NOT NULL,
    "jumlah" DECIMAL(18,2) NOT NULL,
    "jurnalId" TEXT,
    "dibuatPada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PphFinalBulanan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PphFinalBulanan_periode_key" ON "PphFinalBulanan"("periode");

-- CreateIndex
CREATE UNIQUE INDEX "PphFinalBulanan_jurnalId_key" ON "PphFinalBulanan"("jurnalId");

-- CreateIndex
CREATE UNIQUE INDEX "PengaturanPerusahaan_akunBebanPphFinalId_key" ON "PengaturanPerusahaan"("akunBebanPphFinalId");

-- CreateIndex
CREATE UNIQUE INDEX "PengaturanPerusahaan_akunHutangPphFinalId_key" ON "PengaturanPerusahaan"("akunHutangPphFinalId");

-- AddForeignKey
ALTER TABLE "PengaturanPerusahaan" ADD CONSTRAINT "PengaturanPerusahaan_akunBebanPphFinalId_fkey" FOREIGN KEY ("akunBebanPphFinalId") REFERENCES "Akun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PengaturanPerusahaan" ADD CONSTRAINT "PengaturanPerusahaan_akunHutangPphFinalId_fkey" FOREIGN KEY ("akunHutangPphFinalId") REFERENCES "Akun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PphFinalBulanan" ADD CONSTRAINT "PphFinalBulanan_jurnalId_fkey" FOREIGN KEY ("jurnalId") REFERENCES "Jurnal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

