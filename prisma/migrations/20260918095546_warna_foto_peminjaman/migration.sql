-- CreateEnum
CREATE TYPE "TahapFoto" AS ENUM ('KELUAR', 'KEMBALI');

-- AlterTable
ALTER TABLE "Barang" ADD COLUMN     "warna" TEXT;

-- CreateTable
CREATE TABLE "Foto" (
    "id" TEXT NOT NULL,
    "barangId" TEXT,
    "peminjamanId" TEXT,
    "tahap" "TahapFoto",
    "urutan" INTEGER NOT NULL DEFAULT 0,
    "tipe" TEXT NOT NULL,
    "ukuran" INTEGER NOT NULL,
    "isi" BYTEA NOT NULL,
    "dibuatPada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Foto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PeminjamanBarang" (
    "id" TEXT NOT NULL,
    "nomor" TEXT NOT NULL,
    "gudangId" TEXT NOT NULL,
    "proyekId" TEXT,
    "namaPengambil" TEXT NOT NULL,
    "keterangan" TEXT,
    "waktuKeluar" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rencanaKembali" TIMESTAMP(3),
    "ditutupPada" TIMESTAMP(3),
    "catatanKembali" TEXT,
    "penyesuaianId" TEXT,
    "dicatatOlehId" TEXT,
    "dicatatOlehNama" TEXT NOT NULL,

    CONSTRAINT "PeminjamanBarang_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BarisPeminjamanBarang" (
    "id" TEXT NOT NULL,
    "peminjamanId" TEXT NOT NULL,
    "barangId" TEXT NOT NULL,
    "jumlah" DECIMAL(18,2) NOT NULL,
    "jumlahKembali" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "BarisPeminjamanBarang_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Foto_barangId_idx" ON "Foto"("barangId");

-- CreateIndex
CREATE INDEX "Foto_peminjamanId_idx" ON "Foto"("peminjamanId");

-- CreateIndex
CREATE UNIQUE INDEX "PeminjamanBarang_nomor_key" ON "PeminjamanBarang"("nomor");

-- CreateIndex
CREATE INDEX "PeminjamanBarang_gudangId_idx" ON "PeminjamanBarang"("gudangId");

-- CreateIndex
CREATE INDEX "PeminjamanBarang_proyekId_idx" ON "PeminjamanBarang"("proyekId");

-- CreateIndex
CREATE INDEX "PeminjamanBarang_penyesuaianId_idx" ON "PeminjamanBarang"("penyesuaianId");

-- CreateIndex
CREATE INDEX "PeminjamanBarang_ditutupPada_idx" ON "PeminjamanBarang"("ditutupPada");

-- CreateIndex
CREATE INDEX "PeminjamanBarang_dicatatOlehId_idx" ON "PeminjamanBarang"("dicatatOlehId");

-- CreateIndex
CREATE INDEX "BarisPeminjamanBarang_barangId_idx" ON "BarisPeminjamanBarang"("barangId");

-- CreateIndex
CREATE UNIQUE INDEX "BarisPeminjamanBarang_peminjamanId_barangId_key" ON "BarisPeminjamanBarang"("peminjamanId", "barangId");

-- AddForeignKey
ALTER TABLE "Foto" ADD CONSTRAINT "Foto_barangId_fkey" FOREIGN KEY ("barangId") REFERENCES "Barang"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Foto" ADD CONSTRAINT "Foto_peminjamanId_fkey" FOREIGN KEY ("peminjamanId") REFERENCES "PeminjamanBarang"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeminjamanBarang" ADD CONSTRAINT "PeminjamanBarang_gudangId_fkey" FOREIGN KEY ("gudangId") REFERENCES "Gudang"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeminjamanBarang" ADD CONSTRAINT "PeminjamanBarang_proyekId_fkey" FOREIGN KEY ("proyekId") REFERENCES "Proyek"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeminjamanBarang" ADD CONSTRAINT "PeminjamanBarang_penyesuaianId_fkey" FOREIGN KEY ("penyesuaianId") REFERENCES "PenyesuaianPersediaan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeminjamanBarang" ADD CONSTRAINT "PeminjamanBarang_dicatatOlehId_fkey" FOREIGN KEY ("dicatatOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarisPeminjamanBarang" ADD CONSTRAINT "BarisPeminjamanBarang_peminjamanId_fkey" FOREIGN KEY ("peminjamanId") REFERENCES "PeminjamanBarang"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarisPeminjamanBarang" ADD CONSTRAINT "BarisPeminjamanBarang_barangId_fkey" FOREIGN KEY ("barangId") REFERENCES "Barang"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Pengaman terakhir untuk kondisi balapan saat Kembalikan (pola sama dengan StokBarang_jumlah_tidak_negatif):
-- yang sudah kembali tidak boleh melebihi yang dibawa keluar.
ALTER TABLE "BarisPeminjamanBarang" ADD CONSTRAINT "BarisPeminjamanBarang_kembali_tidak_melebihi" CHECK ("jumlahKembali" <= "jumlah");
