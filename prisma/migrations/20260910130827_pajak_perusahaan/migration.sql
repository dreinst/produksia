-- AlterTable
ALTER TABLE "FakturPembelian" ADD COLUMN     "dpp" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "ppn" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "ppnPersen" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "FakturPenjualan" ADD COLUMN     "dpp" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "ppn" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "ppnPersen" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PembayaranPembelian" ADD COLUMN     "potonganPajak" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PenerimaanPenjualan" ADD COLUMN     "potonganPajak" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ReturPembelian" ADD COLUMN     "dpp" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "ppn" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ReturPenjualan" ADD COLUMN     "dpp" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "ppn" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PengaturanPerusahaan" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "nama" TEXT NOT NULL DEFAULT 'Accurate Copy',
    "pkp" BOOLEAN NOT NULL DEFAULT false,
    "tarifPpnPersen" DECIMAL(5,2) NOT NULL DEFAULT 11,
    "terminHari" INTEGER NOT NULL DEFAULT 14,
    "akunPpnKeluaranId" TEXT,
    "akunPpnMasukanId" TEXT,
    "akunPph23DimukaId" TEXT,
    "akunPph23DipotongId" TEXT,

    CONSTRAINT "PengaturanPerusahaan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PengaturanPerusahaan_akunPpnKeluaranId_key" ON "PengaturanPerusahaan"("akunPpnKeluaranId");

-- CreateIndex
CREATE UNIQUE INDEX "PengaturanPerusahaan_akunPpnMasukanId_key" ON "PengaturanPerusahaan"("akunPpnMasukanId");

-- CreateIndex
CREATE UNIQUE INDEX "PengaturanPerusahaan_akunPph23DimukaId_key" ON "PengaturanPerusahaan"("akunPph23DimukaId");

-- CreateIndex
CREATE UNIQUE INDEX "PengaturanPerusahaan_akunPph23DipotongId_key" ON "PengaturanPerusahaan"("akunPph23DipotongId");

-- AddForeignKey
ALTER TABLE "PengaturanPerusahaan" ADD CONSTRAINT "PengaturanPerusahaan_akunPpnKeluaranId_fkey" FOREIGN KEY ("akunPpnKeluaranId") REFERENCES "Akun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PengaturanPerusahaan" ADD CONSTRAINT "PengaturanPerusahaan_akunPpnMasukanId_fkey" FOREIGN KEY ("akunPpnMasukanId") REFERENCES "Akun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PengaturanPerusahaan" ADD CONSTRAINT "PengaturanPerusahaan_akunPph23DimukaId_fkey" FOREIGN KEY ("akunPph23DimukaId") REFERENCES "Akun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PengaturanPerusahaan" ADD CONSTRAINT "PengaturanPerusahaan_akunPph23DipotongId_fkey" FOREIGN KEY ("akunPph23DipotongId") REFERENCES "Akun"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Faktur & retur lama: dasar pengenaan pajak = total (belum ada PPN)
UPDATE "FakturPenjualan" SET "dpp" = "total" WHERE "dpp" = 0;
UPDATE "FakturPembelian" SET "dpp" = "total" WHERE "dpp" = 0;
UPDATE "ReturPenjualan" SET "dpp" = "total" WHERE "dpp" = 0;
UPDATE "ReturPembelian" SET "dpp" = "total" WHERE "dpp" = 0;
