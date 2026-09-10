-- CreateTable
CREATE TABLE "PindahBarang" (
    "id" TEXT NOT NULL,
    "nomor" TEXT NOT NULL,
    "tanggal" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "gudangAsalId" TEXT NOT NULL,
    "gudangTujuanId" TEXT NOT NULL,
    "keterangan" TEXT,
    "dibuatPada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PindahBarang_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BarisPindahBarang" (
    "id" TEXT NOT NULL,
    "pindahId" TEXT NOT NULL,
    "barangId" TEXT NOT NULL,
    "jumlah" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "BarisPindahBarang_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PindahBarang_nomor_key" ON "PindahBarang"("nomor");

-- AddForeignKey
ALTER TABLE "PindahBarang" ADD CONSTRAINT "PindahBarang_gudangAsalId_fkey" FOREIGN KEY ("gudangAsalId") REFERENCES "Gudang"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PindahBarang" ADD CONSTRAINT "PindahBarang_gudangTujuanId_fkey" FOREIGN KEY ("gudangTujuanId") REFERENCES "Gudang"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarisPindahBarang" ADD CONSTRAINT "BarisPindahBarang_pindahId_fkey" FOREIGN KEY ("pindahId") REFERENCES "PindahBarang"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarisPindahBarang" ADD CONSTRAINT "BarisPindahBarang_barangId_fkey" FOREIGN KEY ("barangId") REFERENCES "Barang"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

