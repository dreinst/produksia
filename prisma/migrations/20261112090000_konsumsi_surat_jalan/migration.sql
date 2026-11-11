-- Catatan konsumsi surat jalan per baris faktur penjualan (perbaikan tinjauan P27 T1, S1, S2). buatFaktur menulis satu
-- baris per baris SJ yang dikonsumsi, dan hapus faktur membalik persis catatan itu. Aditif: faktur yang sudah ada
-- mendapat konsumsiSjTercatat = false dan tetap dibalik dengan cara lama (per barang, SJ terbaru dulu).
-- AlterTable
ALTER TABLE "FakturPenjualan" ADD COLUMN     "konsumsiSjTercatat" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "KonsumsiSuratJalan" (
    "id" TEXT NOT NULL,
    "barisFakturId" TEXT NOT NULL,
    "barisPengirimanId" TEXT NOT NULL,
    "jumlah" DECIMAL(18,2) NOT NULL,
    "nilaiTransit" DECIMAL(18,2) NOT NULL,
    "dibuatPada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KonsumsiSuratJalan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KonsumsiSuratJalan_barisFakturId_idx" ON "KonsumsiSuratJalan"("barisFakturId");

-- CreateIndex
CREATE INDEX "KonsumsiSuratJalan_barisPengirimanId_idx" ON "KonsumsiSuratJalan"("barisPengirimanId");

-- AddForeignKey
ALTER TABLE "KonsumsiSuratJalan" ADD CONSTRAINT "KonsumsiSuratJalan_barisFakturId_fkey" FOREIGN KEY ("barisFakturId") REFERENCES "BarisFakturPenjualan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KonsumsiSuratJalan" ADD CONSTRAINT "KonsumsiSuratJalan_barisPengirimanId_fkey" FOREIGN KEY ("barisPengirimanId") REFERENCES "BarisPengiriman"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK manual (tidak dimodelkan Prisma): konsumsi selalu positif dan nilainya tidak negatif
ALTER TABLE "KonsumsiSuratJalan" ADD CONSTRAINT "KonsumsiSuratJalan_jumlah_positif" CHECK ("jumlah" > 0 AND "nilaiTransit" >= 0);
