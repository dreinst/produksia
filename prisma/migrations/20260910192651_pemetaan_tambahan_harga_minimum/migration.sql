-- AlterTable
ALTER TABLE "Barang" ADD COLUMN     "hargaMinimum" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PemetaanAkunTambahan" (
    "id" TEXT NOT NULL,
    "kunci" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "akunId" TEXT NOT NULL,
    "keterangan" TEXT,
    "dibuatOleh" TEXT NOT NULL,
    "dibuatPada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PemetaanAkunTambahan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PemetaanAkunTambahan_kunci_key" ON "PemetaanAkunTambahan"("kunci");

-- AddForeignKey
ALTER TABLE "PemetaanAkunTambahan" ADD CONSTRAINT "PemetaanAkunTambahan_akunId_fkey" FOREIGN KEY ("akunId") REFERENCES "Akun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

