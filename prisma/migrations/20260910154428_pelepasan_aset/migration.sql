-- CreateTable
CREATE TABLE "PelepasanAset" (
    "id" TEXT NOT NULL,
    "asetId" TEXT NOT NULL,
    "tanggal" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jenis" "StatusAset" NOT NULL,
    "hargaJual" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "akunPenerimaanId" TEXT,
    "akunLabaRugiId" TEXT NOT NULL,
    "nilaiBuku" DECIMAL(18,2) NOT NULL,
    "labaRugi" DECIMAL(18,2) NOT NULL,
    "keterangan" TEXT,
    "jurnalId" TEXT,
    "penggunaNama" TEXT NOT NULL,
    "dibuatPada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PelepasanAset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PelepasanAset_asetId_key" ON "PelepasanAset"("asetId");

-- CreateIndex
CREATE UNIQUE INDEX "PelepasanAset_jurnalId_key" ON "PelepasanAset"("jurnalId");

-- AddForeignKey
ALTER TABLE "PelepasanAset" ADD CONSTRAINT "PelepasanAset_asetId_fkey" FOREIGN KEY ("asetId") REFERENCES "AsetTetap"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PelepasanAset" ADD CONSTRAINT "PelepasanAset_akunPenerimaanId_fkey" FOREIGN KEY ("akunPenerimaanId") REFERENCES "Akun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PelepasanAset" ADD CONSTRAINT "PelepasanAset_akunLabaRugiId_fkey" FOREIGN KEY ("akunLabaRugiId") REFERENCES "Akun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PelepasanAset" ADD CONSTRAINT "PelepasanAset_jurnalId_fkey" FOREIGN KEY ("jurnalId") REFERENCES "Jurnal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

