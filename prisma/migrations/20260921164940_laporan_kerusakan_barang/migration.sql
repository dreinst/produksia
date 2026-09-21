-- AlterTable
ALTER TABLE "Foto" ADD COLUMN     "kerusakanId" TEXT;

-- CreateTable
CREATE TABLE "LaporanKerusakanBarang" (
    "id" TEXT NOT NULL,
    "nomor" TEXT NOT NULL,
    "gudangId" TEXT NOT NULL,
    "proyekId" TEXT,
    "namaPelapor" TEXT NOT NULL,
    "keterangan" TEXT,
    "waktuLapor" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "penyesuaianId" TEXT,
    "dicatatOlehId" TEXT,
    "dicatatOlehNama" TEXT NOT NULL,
    "statusPersetujuan" "StatusPersetujuan" NOT NULL DEFAULT 'DRAFT',
    "diajukanOlehId" TEXT,
    "diajukanPada" TIMESTAMP(3),
    "disetujuiOlehId" TEXT,
    "disetujuiPada" TIMESTAMP(3),
    "ditolakOlehId" TEXT,
    "ditolakPada" TIMESTAMP(3),
    "catatanPenolakan" TEXT,

    CONSTRAINT "LaporanKerusakanBarang_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BarisKerusakanBarang" (
    "id" TEXT NOT NULL,
    "laporanId" TEXT NOT NULL,
    "barangId" TEXT NOT NULL,
    "jumlah" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "BarisKerusakanBarang_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LaporanKerusakanBarang_nomor_key" ON "LaporanKerusakanBarang"("nomor");

-- CreateIndex
CREATE INDEX "LaporanKerusakanBarang_gudangId_idx" ON "LaporanKerusakanBarang"("gudangId");

-- CreateIndex
CREATE INDEX "LaporanKerusakanBarang_proyekId_idx" ON "LaporanKerusakanBarang"("proyekId");

-- CreateIndex
CREATE INDEX "LaporanKerusakanBarang_penyesuaianId_idx" ON "LaporanKerusakanBarang"("penyesuaianId");

-- CreateIndex
CREATE INDEX "LaporanKerusakanBarang_dicatatOlehId_idx" ON "LaporanKerusakanBarang"("dicatatOlehId");

-- CreateIndex
CREATE INDEX "LaporanKerusakanBarang_statusPersetujuan_idx" ON "LaporanKerusakanBarang"("statusPersetujuan");

-- CreateIndex
CREATE INDEX "BarisKerusakanBarang_barangId_idx" ON "BarisKerusakanBarang"("barangId");

-- CreateIndex
CREATE UNIQUE INDEX "BarisKerusakanBarang_laporanId_barangId_key" ON "BarisKerusakanBarang"("laporanId", "barangId");

-- CreateIndex
CREATE INDEX "Foto_kerusakanId_idx" ON "Foto"("kerusakanId");

-- AddForeignKey
ALTER TABLE "Foto" ADD CONSTRAINT "Foto_kerusakanId_fkey" FOREIGN KEY ("kerusakanId") REFERENCES "LaporanKerusakanBarang"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaporanKerusakanBarang" ADD CONSTRAINT "LaporanKerusakanBarang_gudangId_fkey" FOREIGN KEY ("gudangId") REFERENCES "Gudang"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaporanKerusakanBarang" ADD CONSTRAINT "LaporanKerusakanBarang_proyekId_fkey" FOREIGN KEY ("proyekId") REFERENCES "Proyek"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaporanKerusakanBarang" ADD CONSTRAINT "LaporanKerusakanBarang_penyesuaianId_fkey" FOREIGN KEY ("penyesuaianId") REFERENCES "PenyesuaianPersediaan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaporanKerusakanBarang" ADD CONSTRAINT "LaporanKerusakanBarang_dicatatOlehId_fkey" FOREIGN KEY ("dicatatOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaporanKerusakanBarang" ADD CONSTRAINT "LaporanKerusakanBarang_diajukanOlehId_fkey" FOREIGN KEY ("diajukanOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaporanKerusakanBarang" ADD CONSTRAINT "LaporanKerusakanBarang_disetujuiOlehId_fkey" FOREIGN KEY ("disetujuiOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaporanKerusakanBarang" ADD CONSTRAINT "LaporanKerusakanBarang_ditolakOlehId_fkey" FOREIGN KEY ("ditolakOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarisKerusakanBarang" ADD CONSTRAINT "BarisKerusakanBarang_laporanId_fkey" FOREIGN KEY ("laporanId") REFERENCES "LaporanKerusakanBarang"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarisKerusakanBarang" ADD CONSTRAINT "BarisKerusakanBarang_barangId_fkey" FOREIGN KEY ("barangId") REFERENCES "Barang"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
