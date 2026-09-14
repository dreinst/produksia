-- CreateEnum
CREATE TYPE "StatusPersetujuan" AS ENUM ('DRAFT', 'MENUNGGU', 'DISETUJUI', 'DITOLAK');

-- CreateEnum
CREATE TYPE "JenisDokumenKas" AS ENUM ('MASUK', 'KELUAR');

-- AlterTable
ALTER TABLE "AsetTetap" ADD COLUMN     "catatanPenolakan" TEXT,
ADD COLUMN     "diajukanOlehId" TEXT,
ADD COLUMN     "diajukanPada" TIMESTAMP(3),
ADD COLUMN     "disetujuiOlehId" TEXT,
ADD COLUMN     "disetujuiPada" TIMESTAMP(3),
ADD COLUMN     "ditolakOlehId" TEXT,
ADD COLUMN     "ditolakPada" TIMESTAMP(3),
ADD COLUMN     "statusPersetujuan" "StatusPersetujuan" NOT NULL DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE "BarisFakturPenjualan" ADD COLUMN     "nilaiTransit" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "BarisJurnal" ADD COLUMN     "kursAsli" DECIMAL(18,6),
ADD COLUMN     "mataUangAsliId" TEXT,
ADD COLUMN     "nilaiAsli" DECIMAL(18,2);

-- AlterTable
ALTER TABLE "FakturPembelian" ADD COLUMN     "catatanPenolakan" TEXT,
ADD COLUMN     "diajukanOlehId" TEXT,
ADD COLUMN     "diajukanPada" TIMESTAMP(3),
ADD COLUMN     "disetujuiOlehId" TEXT,
ADD COLUMN     "disetujuiPada" TIMESTAMP(3),
ADD COLUMN     "ditolakOlehId" TEXT,
ADD COLUMN     "ditolakPada" TIMESTAMP(3),
ADD COLUMN     "kurs" DECIMAL(18,6) NOT NULL DEFAULT 1,
ADD COLUMN     "mataUangId" TEXT,
ADD COLUMN     "nilaiAsli" DECIMAL(18,2),
ADD COLUMN     "statusPersetujuan" "StatusPersetujuan" NOT NULL DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE "FakturPenjualan" ADD COLUMN     "catatanPenolakan" TEXT,
ADD COLUMN     "diajukanOlehId" TEXT,
ADD COLUMN     "diajukanPada" TIMESTAMP(3),
ADD COLUMN     "disetujuiOlehId" TEXT,
ADD COLUMN     "disetujuiPada" TIMESTAMP(3),
ADD COLUMN     "ditolakOlehId" TEXT,
ADD COLUMN     "ditolakPada" TIMESTAMP(3),
ADD COLUMN     "kurs" DECIMAL(18,6) NOT NULL DEFAULT 1,
ADD COLUMN     "mataUangId" TEXT,
ADD COLUMN     "nilaiAsli" DECIMAL(18,2),
ADD COLUMN     "statusPersetujuan" "StatusPersetujuan" NOT NULL DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE "Jurnal" ADD COLUMN     "catatanPenolakan" TEXT,
ADD COLUMN     "diajukanOlehId" TEXT,
ADD COLUMN     "diajukanPada" TIMESTAMP(3),
ADD COLUMN     "disetujuiOlehId" TEXT,
ADD COLUMN     "disetujuiPada" TIMESTAMP(3),
ADD COLUMN     "ditolakOlehId" TEXT,
ADD COLUMN     "ditolakPada" TIMESTAMP(3),
ADD COLUMN     "statusPersetujuan" "StatusPersetujuan" NOT NULL DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE "Pelanggan" ADD COLUMN     "mataUangId" TEXT;

-- AlterTable
ALTER TABLE "PelepasanAset" ADD COLUMN     "catatanPenolakan" TEXT,
ADD COLUMN     "diajukanOlehId" TEXT,
ADD COLUMN     "diajukanPada" TIMESTAMP(3),
ADD COLUMN     "disetujuiOlehId" TEXT,
ADD COLUMN     "disetujuiPada" TIMESTAMP(3),
ADD COLUMN     "ditolakOlehId" TEXT,
ADD COLUMN     "ditolakPada" TIMESTAMP(3),
ADD COLUMN     "statusPersetujuan" "StatusPersetujuan" NOT NULL DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE "Pemasok" ADD COLUMN     "mataUangId" TEXT;

-- AlterTable
ALTER TABLE "PembayaranPembelian" ADD COLUMN     "catatanPenolakan" TEXT,
ADD COLUMN     "diajukanOlehId" TEXT,
ADD COLUMN     "diajukanPada" TIMESTAMP(3),
ADD COLUMN     "disetujuiOlehId" TEXT,
ADD COLUMN     "disetujuiPada" TIMESTAMP(3),
ADD COLUMN     "ditolakOlehId" TEXT,
ADD COLUMN     "ditolakPada" TIMESTAMP(3),
ADD COLUMN     "kurs" DECIMAL(18,6) NOT NULL DEFAULT 1,
ADD COLUMN     "mataUangId" TEXT,
ADD COLUMN     "nilaiAsli" DECIMAL(18,2),
ADD COLUMN     "statusPersetujuan" "StatusPersetujuan" NOT NULL DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE "PemetaanAkun" ADD COLUMN     "selisihKursId" TEXT;

-- AlterTable
ALTER TABLE "PenawaranPenjualan" ADD COLUMN     "catatanPenolakan" TEXT,
ADD COLUMN     "diajukanOlehId" TEXT,
ADD COLUMN     "diajukanPada" TIMESTAMP(3),
ADD COLUMN     "disetujuiOlehId" TEXT,
ADD COLUMN     "disetujuiPada" TIMESTAMP(3),
ADD COLUMN     "ditolakOlehId" TEXT,
ADD COLUMN     "ditolakPada" TIMESTAMP(3),
ADD COLUMN     "statusPersetujuan" "StatusPersetujuan" NOT NULL DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE "PenerimaanBarang" ADD COLUMN     "catatanPenolakan" TEXT,
ADD COLUMN     "diajukanOlehId" TEXT,
ADD COLUMN     "diajukanPada" TIMESTAMP(3),
ADD COLUMN     "disetujuiOlehId" TEXT,
ADD COLUMN     "disetujuiPada" TIMESTAMP(3),
ADD COLUMN     "ditolakOlehId" TEXT,
ADD COLUMN     "ditolakPada" TIMESTAMP(3),
ADD COLUMN     "statusPersetujuan" "StatusPersetujuan" NOT NULL DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE "PenerimaanPenjualan" ADD COLUMN     "catatanPenolakan" TEXT,
ADD COLUMN     "diajukanOlehId" TEXT,
ADD COLUMN     "diajukanPada" TIMESTAMP(3),
ADD COLUMN     "disetujuiOlehId" TEXT,
ADD COLUMN     "disetujuiPada" TIMESTAMP(3),
ADD COLUMN     "ditolakOlehId" TEXT,
ADD COLUMN     "ditolakPada" TIMESTAMP(3),
ADD COLUMN     "kurs" DECIMAL(18,6) NOT NULL DEFAULT 1,
ADD COLUMN     "mataUangId" TEXT,
ADD COLUMN     "nilaiAsli" DECIMAL(18,2),
ADD COLUMN     "statusPersetujuan" "StatusPersetujuan" NOT NULL DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE "PengaturanPerusahaan" ADD COLUMN     "wajibPersetujuan" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Penggajian" ADD COLUMN     "catatanPenolakan" TEXT,
ADD COLUMN     "diajukanOlehId" TEXT,
ADD COLUMN     "diajukanPada" TIMESTAMP(3),
ADD COLUMN     "disetujuiOlehId" TEXT,
ADD COLUMN     "disetujuiPada" TIMESTAMP(3),
ADD COLUMN     "ditolakOlehId" TEXT,
ADD COLUMN     "ditolakPada" TIMESTAMP(3),
ADD COLUMN     "statusPersetujuan" "StatusPersetujuan" NOT NULL DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE "PengirimanPesanan" ADD COLUMN     "catatanPenolakan" TEXT,
ADD COLUMN     "diajukanOlehId" TEXT,
ADD COLUMN     "diajukanPada" TIMESTAMP(3),
ADD COLUMN     "disetujuiOlehId" TEXT,
ADD COLUMN     "disetujuiPada" TIMESTAMP(3),
ADD COLUMN     "ditolakOlehId" TEXT,
ADD COLUMN     "ditolakPada" TIMESTAMP(3),
ADD COLUMN     "statusPersetujuan" "StatusPersetujuan" NOT NULL DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE "PenyesuaianPersediaan" ADD COLUMN     "catatanPenolakan" TEXT,
ADD COLUMN     "diajukanOlehId" TEXT,
ADD COLUMN     "diajukanPada" TIMESTAMP(3),
ADD COLUMN     "disetujuiOlehId" TEXT,
ADD COLUMN     "disetujuiPada" TIMESTAMP(3),
ADD COLUMN     "ditolakOlehId" TEXT,
ADD COLUMN     "ditolakPada" TIMESTAMP(3),
ADD COLUMN     "statusPersetujuan" "StatusPersetujuan" NOT NULL DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE "PesananPembelian" ADD COLUMN     "catatanPenolakan" TEXT,
ADD COLUMN     "diajukanOlehId" TEXT,
ADD COLUMN     "diajukanPada" TIMESTAMP(3),
ADD COLUMN     "disetujuiOlehId" TEXT,
ADD COLUMN     "disetujuiPada" TIMESTAMP(3),
ADD COLUMN     "ditolakOlehId" TEXT,
ADD COLUMN     "ditolakPada" TIMESTAMP(3),
ADD COLUMN     "statusPersetujuan" "StatusPersetujuan" NOT NULL DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE "PesananPenjualan" ADD COLUMN     "catatanPenolakan" TEXT,
ADD COLUMN     "diajukanOlehId" TEXT,
ADD COLUMN     "diajukanPada" TIMESTAMP(3),
ADD COLUMN     "disetujuiOlehId" TEXT,
ADD COLUMN     "disetujuiPada" TIMESTAMP(3),
ADD COLUMN     "ditolakOlehId" TEXT,
ADD COLUMN     "ditolakPada" TIMESTAMP(3),
ADD COLUMN     "statusPersetujuan" "StatusPersetujuan" NOT NULL DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE "PindahBarang" ADD COLUMN     "catatanPenolakan" TEXT,
ADD COLUMN     "diajukanOlehId" TEXT,
ADD COLUMN     "diajukanPada" TIMESTAMP(3),
ADD COLUMN     "disetujuiOlehId" TEXT,
ADD COLUMN     "disetujuiPada" TIMESTAMP(3),
ADD COLUMN     "ditolakOlehId" TEXT,
ADD COLUMN     "ditolakPada" TIMESTAMP(3),
ADD COLUMN     "statusPersetujuan" "StatusPersetujuan" NOT NULL DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE "PphFinalBulanan" ADD COLUMN     "catatanPenolakan" TEXT,
ADD COLUMN     "diajukanOlehId" TEXT,
ADD COLUMN     "diajukanPada" TIMESTAMP(3),
ADD COLUMN     "disetujuiOlehId" TEXT,
ADD COLUMN     "disetujuiPada" TIMESTAMP(3),
ADD COLUMN     "ditolakOlehId" TEXT,
ADD COLUMN     "ditolakPada" TIMESTAMP(3),
ADD COLUMN     "statusPersetujuan" "StatusPersetujuan" NOT NULL DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE "Prive" ADD COLUMN     "catatanPenolakan" TEXT,
ADD COLUMN     "diajukanOlehId" TEXT,
ADD COLUMN     "diajukanPada" TIMESTAMP(3),
ADD COLUMN     "disetujuiOlehId" TEXT,
ADD COLUMN     "disetujuiPada" TIMESTAMP(3),
ADD COLUMN     "ditolakOlehId" TEXT,
ADD COLUMN     "ditolakPada" TIMESTAMP(3),
ADD COLUMN     "statusPersetujuan" "StatusPersetujuan" NOT NULL DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE "ReturPembelian" ADD COLUMN     "catatanPenolakan" TEXT,
ADD COLUMN     "diajukanOlehId" TEXT,
ADD COLUMN     "diajukanPada" TIMESTAMP(3),
ADD COLUMN     "disetujuiOlehId" TEXT,
ADD COLUMN     "disetujuiPada" TIMESTAMP(3),
ADD COLUMN     "ditolakOlehId" TEXT,
ADD COLUMN     "ditolakPada" TIMESTAMP(3),
ADD COLUMN     "statusPersetujuan" "StatusPersetujuan" NOT NULL DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE "ReturPenjualan" ADD COLUMN     "catatanPenolakan" TEXT,
ADD COLUMN     "diajukanOlehId" TEXT,
ADD COLUMN     "diajukanPada" TIMESTAMP(3),
ADD COLUMN     "disetujuiOlehId" TEXT,
ADD COLUMN     "disetujuiPada" TIMESTAMP(3),
ADD COLUMN     "ditolakOlehId" TEXT,
ADD COLUMN     "ditolakPada" TIMESTAMP(3),
ADD COLUMN     "statusPersetujuan" "StatusPersetujuan" NOT NULL DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE "TutupBuku" ADD COLUMN     "catatanPenolakan" TEXT,
ADD COLUMN     "diajukanOlehId" TEXT,
ADD COLUMN     "diajukanPada" TIMESTAMP(3),
ADD COLUMN     "disetujuiOlehId" TEXT,
ADD COLUMN     "disetujuiPada" TIMESTAMP(3),
ADD COLUMN     "ditolakOlehId" TEXT,
ADD COLUMN     "ditolakPada" TIMESTAMP(3),
ADD COLUMN     "statusPersetujuan" "StatusPersetujuan" NOT NULL DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE "UangMukaPelanggan" ADD COLUMN     "catatanPenolakan" TEXT,
ADD COLUMN     "diajukanOlehId" TEXT,
ADD COLUMN     "diajukanPada" TIMESTAMP(3),
ADD COLUMN     "disetujuiOlehId" TEXT,
ADD COLUMN     "disetujuiPada" TIMESTAMP(3),
ADD COLUMN     "ditolakOlehId" TEXT,
ADD COLUMN     "ditolakPada" TIMESTAMP(3),
ADD COLUMN     "statusPersetujuan" "StatusPersetujuan" NOT NULL DEFAULT 'DRAFT';

-- CreateTable
CREATE TABLE "MataUang" (
    "id" TEXT NOT NULL,
    "kode" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "simbol" TEXT NOT NULL DEFAULT '',
    "desimal" INTEGER NOT NULL DEFAULT 2,
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "fungsional" BOOLEAN NOT NULL DEFAULT false,
    "dibuatPada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MataUang_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KursMataUang" (
    "id" TEXT NOT NULL,
    "mataUangId" TEXT NOT NULL,
    "tanggal" TIMESTAMP(3) NOT NULL,
    "kurs" DECIMAL(18,6) NOT NULL,
    "sumber" TEXT,
    "dicatatOleh" TEXT,
    "dibuatPada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KursMataUang_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DokumenKas" (
    "id" TEXT NOT NULL,
    "nomor" TEXT NOT NULL,
    "jenis" "JenisDokumenKas" NOT NULL,
    "tanggal" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "akunKasId" TEXT NOT NULL,
    "akunLawanId" TEXT NOT NULL,
    "jumlah" DECIMAL(18,2) NOT NULL,
    "keterangan" TEXT,
    "proyekId" TEXT,
    "jurnalId" TEXT,
    "dibuatOleh" TEXT NOT NULL,
    "dibuatPada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "statusPersetujuan" "StatusPersetujuan" NOT NULL DEFAULT 'DRAFT',
    "diajukanOlehId" TEXT,
    "diajukanPada" TIMESTAMP(3),
    "disetujuiOlehId" TEXT,
    "disetujuiPada" TIMESTAMP(3),
    "ditolakOlehId" TEXT,
    "ditolakPada" TIMESTAMP(3),
    "catatanPenolakan" TEXT,

    CONSTRAINT "DokumenKas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MataUang_kode_key" ON "MataUang"("kode");

-- CreateIndex
CREATE INDEX "KursMataUang_mataUangId_tanggal_idx" ON "KursMataUang"("mataUangId", "tanggal");

-- CreateIndex
CREATE UNIQUE INDEX "KursMataUang_mataUangId_tanggal_key" ON "KursMataUang"("mataUangId", "tanggal");

-- CreateIndex
CREATE UNIQUE INDEX "DokumenKas_nomor_key" ON "DokumenKas"("nomor");

-- CreateIndex
CREATE UNIQUE INDEX "DokumenKas_jurnalId_key" ON "DokumenKas"("jurnalId");

-- CreateIndex
CREATE INDEX "DokumenKas_statusPersetujuan_idx" ON "DokumenKas"("statusPersetujuan");

-- CreateIndex
CREATE INDEX "DokumenKas_jenis_idx" ON "DokumenKas"("jenis");

-- CreateIndex
CREATE INDEX "DokumenKas_tanggal_idx" ON "DokumenKas"("tanggal");

-- CreateIndex
CREATE INDEX "DokumenKas_akunKasId_idx" ON "DokumenKas"("akunKasId");

-- CreateIndex
CREATE INDEX "DokumenKas_akunLawanId_idx" ON "DokumenKas"("akunLawanId");

-- CreateIndex
CREATE INDEX "DokumenKas_proyekId_idx" ON "DokumenKas"("proyekId");

-- CreateIndex
CREATE INDEX "AsetTetap_statusPersetujuan_idx" ON "AsetTetap"("statusPersetujuan");

-- CreateIndex
CREATE INDEX "FakturPembelian_statusPersetujuan_idx" ON "FakturPembelian"("statusPersetujuan");

-- CreateIndex
CREATE INDEX "FakturPenjualan_statusPersetujuan_idx" ON "FakturPenjualan"("statusPersetujuan");

-- CreateIndex
CREATE INDEX "Jurnal_statusPersetujuan_idx" ON "Jurnal"("statusPersetujuan");

-- CreateIndex
CREATE INDEX "PelepasanAset_statusPersetujuan_idx" ON "PelepasanAset"("statusPersetujuan");

-- CreateIndex
CREATE INDEX "PembayaranPembelian_statusPersetujuan_idx" ON "PembayaranPembelian"("statusPersetujuan");

-- CreateIndex
CREATE UNIQUE INDEX "PemetaanAkun_selisihKursId_key" ON "PemetaanAkun"("selisihKursId");

-- CreateIndex
CREATE INDEX "PenawaranPenjualan_statusPersetujuan_idx" ON "PenawaranPenjualan"("statusPersetujuan");

-- CreateIndex
CREATE INDEX "PenerimaanBarang_statusPersetujuan_idx" ON "PenerimaanBarang"("statusPersetujuan");

-- CreateIndex
CREATE INDEX "PenerimaanPenjualan_statusPersetujuan_idx" ON "PenerimaanPenjualan"("statusPersetujuan");

-- CreateIndex
CREATE INDEX "Penggajian_statusPersetujuan_idx" ON "Penggajian"("statusPersetujuan");

-- CreateIndex
CREATE INDEX "PengirimanPesanan_statusPersetujuan_idx" ON "PengirimanPesanan"("statusPersetujuan");

-- CreateIndex
CREATE INDEX "PenyesuaianPersediaan_statusPersetujuan_idx" ON "PenyesuaianPersediaan"("statusPersetujuan");

-- CreateIndex
CREATE INDEX "PesananPembelian_statusPersetujuan_idx" ON "PesananPembelian"("statusPersetujuan");

-- CreateIndex
CREATE INDEX "PesananPenjualan_statusPersetujuan_idx" ON "PesananPenjualan"("statusPersetujuan");

-- CreateIndex
CREATE INDEX "PindahBarang_statusPersetujuan_idx" ON "PindahBarang"("statusPersetujuan");

-- CreateIndex
CREATE INDEX "PphFinalBulanan_statusPersetujuan_idx" ON "PphFinalBulanan"("statusPersetujuan");

-- CreateIndex
CREATE INDEX "Prive_statusPersetujuan_idx" ON "Prive"("statusPersetujuan");

-- CreateIndex
CREATE INDEX "ReturPembelian_statusPersetujuan_idx" ON "ReturPembelian"("statusPersetujuan");

-- CreateIndex
CREATE INDEX "ReturPenjualan_statusPersetujuan_idx" ON "ReturPenjualan"("statusPersetujuan");

-- CreateIndex
CREATE INDEX "TutupBuku_statusPersetujuan_idx" ON "TutupBuku"("statusPersetujuan");

-- CreateIndex
CREATE INDEX "UangMukaPelanggan_statusPersetujuan_idx" ON "UangMukaPelanggan"("statusPersetujuan");

-- AddForeignKey
ALTER TABLE "KursMataUang" ADD CONSTRAINT "KursMataUang_mataUangId_fkey" FOREIGN KEY ("mataUangId") REFERENCES "MataUang"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pelanggan" ADD CONSTRAINT "Pelanggan_mataUangId_fkey" FOREIGN KEY ("mataUangId") REFERENCES "MataUang"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pemasok" ADD CONSTRAINT "Pemasok_mataUangId_fkey" FOREIGN KEY ("mataUangId") REFERENCES "MataUang"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PenawaranPenjualan" ADD CONSTRAINT "PenawaranPenjualan_diajukanOlehId_fkey" FOREIGN KEY ("diajukanOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PenawaranPenjualan" ADD CONSTRAINT "PenawaranPenjualan_disetujuiOlehId_fkey" FOREIGN KEY ("disetujuiOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PenawaranPenjualan" ADD CONSTRAINT "PenawaranPenjualan_ditolakOlehId_fkey" FOREIGN KEY ("ditolakOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PesananPenjualan" ADD CONSTRAINT "PesananPenjualan_diajukanOlehId_fkey" FOREIGN KEY ("diajukanOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PesananPenjualan" ADD CONSTRAINT "PesananPenjualan_disetujuiOlehId_fkey" FOREIGN KEY ("disetujuiOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PesananPenjualan" ADD CONSTRAINT "PesananPenjualan_ditolakOlehId_fkey" FOREIGN KEY ("ditolakOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PengirimanPesanan" ADD CONSTRAINT "PengirimanPesanan_diajukanOlehId_fkey" FOREIGN KEY ("diajukanOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PengirimanPesanan" ADD CONSTRAINT "PengirimanPesanan_disetujuiOlehId_fkey" FOREIGN KEY ("disetujuiOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PengirimanPesanan" ADD CONSTRAINT "PengirimanPesanan_ditolakOlehId_fkey" FOREIGN KEY ("ditolakOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FakturPenjualan" ADD CONSTRAINT "FakturPenjualan_mataUangId_fkey" FOREIGN KEY ("mataUangId") REFERENCES "MataUang"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FakturPenjualan" ADD CONSTRAINT "FakturPenjualan_diajukanOlehId_fkey" FOREIGN KEY ("diajukanOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FakturPenjualan" ADD CONSTRAINT "FakturPenjualan_disetujuiOlehId_fkey" FOREIGN KEY ("disetujuiOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FakturPenjualan" ADD CONSTRAINT "FakturPenjualan_ditolakOlehId_fkey" FOREIGN KEY ("ditolakOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UangMukaPelanggan" ADD CONSTRAINT "UangMukaPelanggan_diajukanOlehId_fkey" FOREIGN KEY ("diajukanOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UangMukaPelanggan" ADD CONSTRAINT "UangMukaPelanggan_disetujuiOlehId_fkey" FOREIGN KEY ("disetujuiOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UangMukaPelanggan" ADD CONSTRAINT "UangMukaPelanggan_ditolakOlehId_fkey" FOREIGN KEY ("ditolakOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PenerimaanPenjualan" ADD CONSTRAINT "PenerimaanPenjualan_mataUangId_fkey" FOREIGN KEY ("mataUangId") REFERENCES "MataUang"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PenerimaanPenjualan" ADD CONSTRAINT "PenerimaanPenjualan_diajukanOlehId_fkey" FOREIGN KEY ("diajukanOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PenerimaanPenjualan" ADD CONSTRAINT "PenerimaanPenjualan_disetujuiOlehId_fkey" FOREIGN KEY ("disetujuiOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PenerimaanPenjualan" ADD CONSTRAINT "PenerimaanPenjualan_ditolakOlehId_fkey" FOREIGN KEY ("ditolakOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturPenjualan" ADD CONSTRAINT "ReturPenjualan_diajukanOlehId_fkey" FOREIGN KEY ("diajukanOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturPenjualan" ADD CONSTRAINT "ReturPenjualan_disetujuiOlehId_fkey" FOREIGN KEY ("disetujuiOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturPenjualan" ADD CONSTRAINT "ReturPenjualan_ditolakOlehId_fkey" FOREIGN KEY ("ditolakOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PesananPembelian" ADD CONSTRAINT "PesananPembelian_diajukanOlehId_fkey" FOREIGN KEY ("diajukanOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PesananPembelian" ADD CONSTRAINT "PesananPembelian_disetujuiOlehId_fkey" FOREIGN KEY ("disetujuiOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PesananPembelian" ADD CONSTRAINT "PesananPembelian_ditolakOlehId_fkey" FOREIGN KEY ("ditolakOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PenerimaanBarang" ADD CONSTRAINT "PenerimaanBarang_diajukanOlehId_fkey" FOREIGN KEY ("diajukanOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PenerimaanBarang" ADD CONSTRAINT "PenerimaanBarang_disetujuiOlehId_fkey" FOREIGN KEY ("disetujuiOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PenerimaanBarang" ADD CONSTRAINT "PenerimaanBarang_ditolakOlehId_fkey" FOREIGN KEY ("ditolakOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FakturPembelian" ADD CONSTRAINT "FakturPembelian_mataUangId_fkey" FOREIGN KEY ("mataUangId") REFERENCES "MataUang"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FakturPembelian" ADD CONSTRAINT "FakturPembelian_diajukanOlehId_fkey" FOREIGN KEY ("diajukanOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FakturPembelian" ADD CONSTRAINT "FakturPembelian_disetujuiOlehId_fkey" FOREIGN KEY ("disetujuiOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FakturPembelian" ADD CONSTRAINT "FakturPembelian_ditolakOlehId_fkey" FOREIGN KEY ("ditolakOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PembayaranPembelian" ADD CONSTRAINT "PembayaranPembelian_mataUangId_fkey" FOREIGN KEY ("mataUangId") REFERENCES "MataUang"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PembayaranPembelian" ADD CONSTRAINT "PembayaranPembelian_diajukanOlehId_fkey" FOREIGN KEY ("diajukanOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PembayaranPembelian" ADD CONSTRAINT "PembayaranPembelian_disetujuiOlehId_fkey" FOREIGN KEY ("disetujuiOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PembayaranPembelian" ADD CONSTRAINT "PembayaranPembelian_ditolakOlehId_fkey" FOREIGN KEY ("ditolakOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturPembelian" ADD CONSTRAINT "ReturPembelian_diajukanOlehId_fkey" FOREIGN KEY ("diajukanOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturPembelian" ADD CONSTRAINT "ReturPembelian_disetujuiOlehId_fkey" FOREIGN KEY ("disetujuiOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturPembelian" ADD CONSTRAINT "ReturPembelian_ditolakOlehId_fkey" FOREIGN KEY ("ditolakOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PemetaanAkun" ADD CONSTRAINT "PemetaanAkun_selisihKursId_fkey" FOREIGN KEY ("selisihKursId") REFERENCES "Akun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Jurnal" ADD CONSTRAINT "Jurnal_diajukanOlehId_fkey" FOREIGN KEY ("diajukanOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Jurnal" ADD CONSTRAINT "Jurnal_disetujuiOlehId_fkey" FOREIGN KEY ("disetujuiOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Jurnal" ADD CONSTRAINT "Jurnal_ditolakOlehId_fkey" FOREIGN KEY ("ditolakOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarisJurnal" ADD CONSTRAINT "BarisJurnal_mataUangAsliId_fkey" FOREIGN KEY ("mataUangAsliId") REFERENCES "MataUang"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DokumenKas" ADD CONSTRAINT "DokumenKas_akunKasId_fkey" FOREIGN KEY ("akunKasId") REFERENCES "Akun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DokumenKas" ADD CONSTRAINT "DokumenKas_akunLawanId_fkey" FOREIGN KEY ("akunLawanId") REFERENCES "Akun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DokumenKas" ADD CONSTRAINT "DokumenKas_proyekId_fkey" FOREIGN KEY ("proyekId") REFERENCES "Proyek"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DokumenKas" ADD CONSTRAINT "DokumenKas_jurnalId_fkey" FOREIGN KEY ("jurnalId") REFERENCES "Jurnal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DokumenKas" ADD CONSTRAINT "DokumenKas_diajukanOlehId_fkey" FOREIGN KEY ("diajukanOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DokumenKas" ADD CONSTRAINT "DokumenKas_disetujuiOlehId_fkey" FOREIGN KEY ("disetujuiOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DokumenKas" ADD CONSTRAINT "DokumenKas_ditolakOlehId_fkey" FOREIGN KEY ("ditolakOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AsetTetap" ADD CONSTRAINT "AsetTetap_diajukanOlehId_fkey" FOREIGN KEY ("diajukanOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AsetTetap" ADD CONSTRAINT "AsetTetap_disetujuiOlehId_fkey" FOREIGN KEY ("disetujuiOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AsetTetap" ADD CONSTRAINT "AsetTetap_ditolakOlehId_fkey" FOREIGN KEY ("ditolakOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PelepasanAset" ADD CONSTRAINT "PelepasanAset_diajukanOlehId_fkey" FOREIGN KEY ("diajukanOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PelepasanAset" ADD CONSTRAINT "PelepasanAset_disetujuiOlehId_fkey" FOREIGN KEY ("disetujuiOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PelepasanAset" ADD CONSTRAINT "PelepasanAset_ditolakOlehId_fkey" FOREIGN KEY ("ditolakOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PindahBarang" ADD CONSTRAINT "PindahBarang_diajukanOlehId_fkey" FOREIGN KEY ("diajukanOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PindahBarang" ADD CONSTRAINT "PindahBarang_disetujuiOlehId_fkey" FOREIGN KEY ("disetujuiOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PindahBarang" ADD CONSTRAINT "PindahBarang_ditolakOlehId_fkey" FOREIGN KEY ("ditolakOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PenyesuaianPersediaan" ADD CONSTRAINT "PenyesuaianPersediaan_diajukanOlehId_fkey" FOREIGN KEY ("diajukanOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PenyesuaianPersediaan" ADD CONSTRAINT "PenyesuaianPersediaan_disetujuiOlehId_fkey" FOREIGN KEY ("disetujuiOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PenyesuaianPersediaan" ADD CONSTRAINT "PenyesuaianPersediaan_ditolakOlehId_fkey" FOREIGN KEY ("ditolakOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TutupBuku" ADD CONSTRAINT "TutupBuku_diajukanOlehId_fkey" FOREIGN KEY ("diajukanOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TutupBuku" ADD CONSTRAINT "TutupBuku_disetujuiOlehId_fkey" FOREIGN KEY ("disetujuiOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TutupBuku" ADD CONSTRAINT "TutupBuku_ditolakOlehId_fkey" FOREIGN KEY ("ditolakOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PphFinalBulanan" ADD CONSTRAINT "PphFinalBulanan_diajukanOlehId_fkey" FOREIGN KEY ("diajukanOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PphFinalBulanan" ADD CONSTRAINT "PphFinalBulanan_disetujuiOlehId_fkey" FOREIGN KEY ("disetujuiOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PphFinalBulanan" ADD CONSTRAINT "PphFinalBulanan_ditolakOlehId_fkey" FOREIGN KEY ("ditolakOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prive" ADD CONSTRAINT "Prive_diajukanOlehId_fkey" FOREIGN KEY ("diajukanOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prive" ADD CONSTRAINT "Prive_disetujuiOlehId_fkey" FOREIGN KEY ("disetujuiOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prive" ADD CONSTRAINT "Prive_ditolakOlehId_fkey" FOREIGN KEY ("ditolakOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Penggajian" ADD CONSTRAINT "Penggajian_diajukanOlehId_fkey" FOREIGN KEY ("diajukanOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Penggajian" ADD CONSTRAINT "Penggajian_disetujuiOlehId_fkey" FOREIGN KEY ("disetujuiOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Penggajian" ADD CONSTRAINT "Penggajian_ditolakOlehId_fkey" FOREIGN KEY ("ditolakOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Data lama: seluruh dokumen yang sudah ada dibuat SEBELUM alur persetujuan ada dan jurnalnya
-- sudah masuk buku besar, jadi statusnya harus DISETUJUI (bukan DRAFT, yang berarti belum dibukukan).
-- Kolom "oleh"/"pada" sengaja dibiarkan kosong: tidak ada data historis siapa yang menyetujui.
UPDATE "PenawaranPenjualan"    SET "statusPersetujuan" = 'DISETUJUI';
UPDATE "PesananPenjualan"      SET "statusPersetujuan" = 'DISETUJUI';
UPDATE "UangMukaPelanggan"     SET "statusPersetujuan" = 'DISETUJUI';
UPDATE "PengirimanPesanan"     SET "statusPersetujuan" = 'DISETUJUI';
UPDATE "FakturPenjualan"       SET "statusPersetujuan" = 'DISETUJUI';
UPDATE "PenerimaanPenjualan"   SET "statusPersetujuan" = 'DISETUJUI';
UPDATE "ReturPenjualan"        SET "statusPersetujuan" = 'DISETUJUI';
UPDATE "PesananPembelian"      SET "statusPersetujuan" = 'DISETUJUI';
UPDATE "PenerimaanBarang"      SET "statusPersetujuan" = 'DISETUJUI';
UPDATE "FakturPembelian"       SET "statusPersetujuan" = 'DISETUJUI';
UPDATE "PembayaranPembelian"   SET "statusPersetujuan" = 'DISETUJUI';
UPDATE "ReturPembelian"        SET "statusPersetujuan" = 'DISETUJUI';
UPDATE "Jurnal"                SET "statusPersetujuan" = 'DISETUJUI';
UPDATE "PenyesuaianPersediaan" SET "statusPersetujuan" = 'DISETUJUI';
UPDATE "PindahBarang"          SET "statusPersetujuan" = 'DISETUJUI';
UPDATE "AsetTetap"             SET "statusPersetujuan" = 'DISETUJUI';
UPDATE "PelepasanAset"         SET "statusPersetujuan" = 'DISETUJUI';
UPDATE "Prive"                 SET "statusPersetujuan" = 'DISETUJUI';
UPDATE "Penggajian"            SET "statusPersetujuan" = 'DISETUJUI';
UPDATE "TutupBuku"             SET "statusPersetujuan" = 'DISETUJUI';
UPDATE "PphFinalBulanan"       SET "statusPersetujuan" = 'DISETUJUI';

-- Mata uang fungsional (mata uang pelaporan). Seluruh buku besar dicatat dalam mata uang ini.
INSERT INTO "MataUang" ("id", "kode", "nama", "simbol", "desimal", "aktif", "fungsional", "dibuatPada")
VALUES ('mu-idr', 'IDR', 'Rupiah Indonesia', 'Rp', 0, true, true, NOW())
ON CONFLICT ("kode") DO NOTHING;
