-- AlterEnum
ALTER TYPE "SumberJurnal" ADD VALUE 'SELISIH_KURS';

-- AlterTable
ALTER TABLE "FakturPembelian" ADD COLUMN     "kursRevaluasi" DECIMAL(18,6),
ADD COLUMN     "revaluasiPada" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "FakturPenjualan" ADD COLUMN     "kursRevaluasi" DECIMAL(18,6),
ADD COLUMN     "revaluasiPada" TIMESTAMP(3);
