-- AlterTable
ALTER TABLE "Akun" ADD COLUMN     "kasBank" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "kelompok" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "keterangan" TEXT;
