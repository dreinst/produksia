-- CreateEnum
CREATE TYPE "StatusDokumen" AS ENUM ('DRAF', 'DIKONVERSI', 'DIPROSES', 'LUNAS', 'SEBAGIAN', 'DIBATALKAN');

-- CreateEnum
CREATE TYPE "JenisBarang" AS ENUM ('BARANG', 'JASA');

-- CreateEnum
CREATE TYPE "PeranPengguna" AS ENUM ('PEMILIK', 'ADMIN', 'KASIR', 'GUDANG');

-- CreateEnum
CREATE TYPE "JenisAkun" AS ENUM ('ASET', 'KEWAJIBAN', 'MODAL', 'PENDAPATAN', 'BEBAN');

-- CreateEnum
CREATE TYPE "SumberJurnal" AS ENUM ('MANUAL', 'KAS_MASUK', 'KAS_KELUAR', 'PENJUALAN', 'PEMBELIAN', 'PENYUSUTAN');

-- CreateEnum
CREATE TYPE "StatusAset" AS ENUM ('AKTIF', 'DIJUAL', 'DIHAPUS');

-- CreateTable
CREATE TABLE "Pengguna" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "kataSandiHash" TEXT NOT NULL,
    "peran" "PeranPengguna" NOT NULL DEFAULT 'KASIR',
    "dibuatPada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Pengguna_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Departemen" (
    "id" TEXT NOT NULL,
    "nama" TEXT NOT NULL,

    CONSTRAINT "Departemen_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Karyawan" (
    "id" TEXT NOT NULL,
    "kode" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "departemenId" TEXT,
    "penggunaId" TEXT,
    "dibuatPada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Karyawan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pelanggan" (
    "id" TEXT NOT NULL,
    "kode" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "alamat" TEXT,
    "telepon" TEXT,
    "npwp" TEXT,
    "penjualId" TEXT,
    "dibuatPada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Pelanggan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pemasok" (
    "id" TEXT NOT NULL,
    "kode" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "alamat" TEXT,
    "telepon" TEXT,
    "dibuatPada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Pemasok_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Proyek" (
    "id" TEXT NOT NULL,
    "kode" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "pelangganId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'BERJALAN',

    CONSTRAINT "Proyek_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Gudang" (
    "id" TEXT NOT NULL,
    "kode" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "alamat" TEXT,

    CONSTRAINT "Gudang_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KelompokBarang" (
    "id" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "indukId" TEXT,

    CONSTRAINT "KelompokBarang_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Barang" (
    "id" TEXT NOT NULL,
    "kode" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "jenis" "JenisBarang" NOT NULL DEFAULT 'BARANG',
    "kelompokId" TEXT,
    "satuan" TEXT NOT NULL DEFAULT 'pcs',
    "hargaBeli" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "hargaJual" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "stokMinimum" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "dibuatPada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Barang_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StokBarang" (
    "barangId" TEXT NOT NULL,
    "gudangId" TEXT NOT NULL,
    "jumlah" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "StokBarang_pkey" PRIMARY KEY ("barangId","gudangId")
);

-- CreateTable
CREATE TABLE "PenawaranPenjualan" (
    "id" TEXT NOT NULL,
    "nomor" TEXT NOT NULL,
    "tanggal" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pelangganId" TEXT NOT NULL,
    "status" "StatusDokumen" NOT NULL DEFAULT 'DRAF',
    "total" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "PenawaranPenjualan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BarisPenawaranPenjualan" (
    "id" TEXT NOT NULL,
    "penawaranId" TEXT NOT NULL,
    "barangId" TEXT NOT NULL,
    "jumlah" DECIMAL(18,2) NOT NULL,
    "harga" DECIMAL(18,2) NOT NULL,
    "subtotal" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "BarisPenawaranPenjualan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PesananPenjualan" (
    "id" TEXT NOT NULL,
    "nomor" TEXT NOT NULL,
    "tanggal" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pelangganId" TEXT NOT NULL,
    "penawaranId" TEXT,
    "status" "StatusDokumen" NOT NULL DEFAULT 'DRAF',
    "total" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "PesananPenjualan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BarisPesananPenjualan" (
    "id" TEXT NOT NULL,
    "pesananId" TEXT NOT NULL,
    "barangId" TEXT NOT NULL,
    "jumlah" DECIMAL(18,2) NOT NULL,
    "harga" DECIMAL(18,2) NOT NULL,
    "jumlahTerkirim" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "jumlahDifaktur" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "BarisPesananPenjualan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PengirimanPesanan" (
    "id" TEXT NOT NULL,
    "nomor" TEXT NOT NULL,
    "tanggal" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pesananId" TEXT NOT NULL,
    "gudangId" TEXT NOT NULL,
    "status" "StatusDokumen" NOT NULL DEFAULT 'DRAF',

    CONSTRAINT "PengirimanPesanan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BarisPengiriman" (
    "id" TEXT NOT NULL,
    "pengirimanId" TEXT NOT NULL,
    "barisPesananId" TEXT NOT NULL,
    "barangId" TEXT NOT NULL,
    "jumlah" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "BarisPengiriman_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FakturPenjualan" (
    "id" TEXT NOT NULL,
    "nomor" TEXT NOT NULL,
    "tanggal" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jatuhTempo" TIMESTAMP(3),
    "pelangganId" TEXT NOT NULL,
    "pesananId" TEXT,
    "pengirimanId" TEXT,
    "status" "StatusDokumen" NOT NULL DEFAULT 'DRAF',
    "total" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "FakturPenjualan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BarisFakturPenjualan" (
    "id" TEXT NOT NULL,
    "fakturId" TEXT NOT NULL,
    "barangId" TEXT NOT NULL,
    "jumlah" DECIMAL(18,2) NOT NULL,
    "harga" DECIMAL(18,2) NOT NULL,
    "subtotal" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "BarisFakturPenjualan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PenerimaanPenjualan" (
    "id" TEXT NOT NULL,
    "nomor" TEXT NOT NULL,
    "tanggal" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pelangganId" TEXT NOT NULL,
    "fakturId" TEXT NOT NULL,
    "akunId" TEXT NOT NULL,
    "jumlah" DECIMAL(18,2) NOT NULL,
    "metodeBayar" TEXT NOT NULL DEFAULT 'TUNAI',

    CONSTRAINT "PenerimaanPenjualan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturPenjualan" (
    "id" TEXT NOT NULL,
    "nomor" TEXT NOT NULL,
    "tanggal" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fakturId" TEXT NOT NULL,
    "gudangId" TEXT NOT NULL,
    "alasan" TEXT,

    CONSTRAINT "ReturPenjualan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BarisReturPenjualan" (
    "id" TEXT NOT NULL,
    "returId" TEXT NOT NULL,
    "barangId" TEXT NOT NULL,
    "jumlah" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "BarisReturPenjualan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PesananPembelian" (
    "id" TEXT NOT NULL,
    "nomor" TEXT NOT NULL,
    "tanggal" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pemasokId" TEXT NOT NULL,
    "status" "StatusDokumen" NOT NULL DEFAULT 'DRAF',
    "total" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "PesananPembelian_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BarisPesananPembelian" (
    "id" TEXT NOT NULL,
    "pesananId" TEXT NOT NULL,
    "barangId" TEXT NOT NULL,
    "jumlah" DECIMAL(18,2) NOT NULL,
    "harga" DECIMAL(18,2) NOT NULL,
    "jumlahDiterima" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "jumlahDifaktur" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "BarisPesananPembelian_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PenerimaanBarang" (
    "id" TEXT NOT NULL,
    "nomor" TEXT NOT NULL,
    "tanggal" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pesananId" TEXT NOT NULL,
    "gudangId" TEXT NOT NULL,
    "status" "StatusDokumen" NOT NULL DEFAULT 'DRAF',

    CONSTRAINT "PenerimaanBarang_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BarisPenerimaanBarang" (
    "id" TEXT NOT NULL,
    "penerimaanId" TEXT NOT NULL,
    "barisPesananId" TEXT NOT NULL,
    "barangId" TEXT NOT NULL,
    "jumlah" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "BarisPenerimaanBarang_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FakturPembelian" (
    "id" TEXT NOT NULL,
    "nomor" TEXT NOT NULL,
    "tanggal" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jatuhTempo" TIMESTAMP(3),
    "pemasokId" TEXT NOT NULL,
    "pesananId" TEXT,
    "penerimaanId" TEXT,
    "status" "StatusDokumen" NOT NULL DEFAULT 'DRAF',
    "total" DECIMAL(18,2) NOT NULL DEFAULT 0,

    CONSTRAINT "FakturPembelian_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BarisFakturPembelian" (
    "id" TEXT NOT NULL,
    "fakturId" TEXT NOT NULL,
    "barangId" TEXT NOT NULL,
    "jumlah" DECIMAL(18,2) NOT NULL,
    "harga" DECIMAL(18,2) NOT NULL,
    "subtotal" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "BarisFakturPembelian_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PembayaranPembelian" (
    "id" TEXT NOT NULL,
    "nomor" TEXT NOT NULL,
    "tanggal" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pemasokId" TEXT NOT NULL,
    "fakturId" TEXT NOT NULL,
    "akunId" TEXT NOT NULL,
    "jumlah" DECIMAL(18,2) NOT NULL,
    "metodeBayar" TEXT NOT NULL DEFAULT 'TRANSFER',

    CONSTRAINT "PembayaranPembelian_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturPembelian" (
    "id" TEXT NOT NULL,
    "nomor" TEXT NOT NULL,
    "tanggal" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fakturId" TEXT NOT NULL,
    "gudangId" TEXT NOT NULL,
    "alasan" TEXT,

    CONSTRAINT "ReturPembelian_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BarisReturPembelian" (
    "id" TEXT NOT NULL,
    "returId" TEXT NOT NULL,
    "barangId" TEXT NOT NULL,
    "jumlah" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "BarisReturPembelian_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Akun" (
    "id" TEXT NOT NULL,
    "kode" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "jenis" "JenisAkun" NOT NULL,
    "indukId" TEXT,

    CONSTRAINT "Akun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PemetaanAkun" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "piutangUsahaId" TEXT NOT NULL,
    "persediaanId" TEXT NOT NULL,
    "hppId" TEXT NOT NULL,
    "pendapatanPenjualanId" TEXT NOT NULL,
    "utangUsahaId" TEXT NOT NULL,

    CONSTRAINT "PemetaanAkun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Jurnal" (
    "id" TEXT NOT NULL,
    "nomor" TEXT NOT NULL,
    "tanggal" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "keterangan" TEXT,
    "sumber" "SumberJurnal" NOT NULL DEFAULT 'MANUAL',

    CONSTRAINT "Jurnal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BarisJurnal" (
    "id" TEXT NOT NULL,
    "jurnalId" TEXT NOT NULL,
    "akunId" TEXT NOT NULL,
    "debit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "kredit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "keterangan" TEXT,

    CONSTRAINT "BarisJurnal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AsetTetap" (
    "id" TEXT NOT NULL,
    "kode" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "tanggalPerolehan" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hargaPerolehan" DECIMAL(18,2) NOT NULL,
    "nilaiSisa" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "umurBulan" INTEGER NOT NULL,
    "status" "StatusAset" NOT NULL DEFAULT 'AKTIF',
    "akunAsetId" TEXT NOT NULL,
    "akunBebanPenyusutanId" TEXT NOT NULL,
    "akunAkumulasiPenyusutanId" TEXT NOT NULL,

    CONSTRAINT "AsetTetap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PenyusutanAset" (
    "id" TEXT NOT NULL,
    "asetId" TEXT NOT NULL,
    "periode" TIMESTAMP(3) NOT NULL,
    "jumlah" DECIMAL(18,2) NOT NULL,
    "jurnalId" TEXT,

    CONSTRAINT "PenyusutanAset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Pengguna_email_key" ON "Pengguna"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Karyawan_kode_key" ON "Karyawan"("kode");

-- CreateIndex
CREATE UNIQUE INDEX "Karyawan_penggunaId_key" ON "Karyawan"("penggunaId");

-- CreateIndex
CREATE UNIQUE INDEX "Pelanggan_kode_key" ON "Pelanggan"("kode");

-- CreateIndex
CREATE UNIQUE INDEX "Pemasok_kode_key" ON "Pemasok"("kode");

-- CreateIndex
CREATE UNIQUE INDEX "Proyek_kode_key" ON "Proyek"("kode");

-- CreateIndex
CREATE UNIQUE INDEX "Gudang_kode_key" ON "Gudang"("kode");

-- CreateIndex
CREATE UNIQUE INDEX "Barang_kode_key" ON "Barang"("kode");

-- CreateIndex
CREATE UNIQUE INDEX "PenawaranPenjualan_nomor_key" ON "PenawaranPenjualan"("nomor");

-- CreateIndex
CREATE UNIQUE INDEX "PesananPenjualan_nomor_key" ON "PesananPenjualan"("nomor");

-- CreateIndex
CREATE UNIQUE INDEX "PesananPenjualan_penawaranId_key" ON "PesananPenjualan"("penawaranId");

-- CreateIndex
CREATE UNIQUE INDEX "PengirimanPesanan_nomor_key" ON "PengirimanPesanan"("nomor");

-- CreateIndex
CREATE UNIQUE INDEX "FakturPenjualan_nomor_key" ON "FakturPenjualan"("nomor");

-- CreateIndex
CREATE UNIQUE INDEX "PenerimaanPenjualan_nomor_key" ON "PenerimaanPenjualan"("nomor");

-- CreateIndex
CREATE UNIQUE INDEX "ReturPenjualan_nomor_key" ON "ReturPenjualan"("nomor");

-- CreateIndex
CREATE UNIQUE INDEX "PesananPembelian_nomor_key" ON "PesananPembelian"("nomor");

-- CreateIndex
CREATE UNIQUE INDEX "PenerimaanBarang_nomor_key" ON "PenerimaanBarang"("nomor");

-- CreateIndex
CREATE UNIQUE INDEX "FakturPembelian_nomor_key" ON "FakturPembelian"("nomor");

-- CreateIndex
CREATE UNIQUE INDEX "PembayaranPembelian_nomor_key" ON "PembayaranPembelian"("nomor");

-- CreateIndex
CREATE UNIQUE INDEX "ReturPembelian_nomor_key" ON "ReturPembelian"("nomor");

-- CreateIndex
CREATE UNIQUE INDEX "Akun_kode_key" ON "Akun"("kode");

-- CreateIndex
CREATE UNIQUE INDEX "PemetaanAkun_piutangUsahaId_key" ON "PemetaanAkun"("piutangUsahaId");

-- CreateIndex
CREATE UNIQUE INDEX "PemetaanAkun_persediaanId_key" ON "PemetaanAkun"("persediaanId");

-- CreateIndex
CREATE UNIQUE INDEX "PemetaanAkun_hppId_key" ON "PemetaanAkun"("hppId");

-- CreateIndex
CREATE UNIQUE INDEX "PemetaanAkun_pendapatanPenjualanId_key" ON "PemetaanAkun"("pendapatanPenjualanId");

-- CreateIndex
CREATE UNIQUE INDEX "PemetaanAkun_utangUsahaId_key" ON "PemetaanAkun"("utangUsahaId");

-- CreateIndex
CREATE UNIQUE INDEX "Jurnal_nomor_key" ON "Jurnal"("nomor");

-- CreateIndex
CREATE UNIQUE INDEX "AsetTetap_kode_key" ON "AsetTetap"("kode");

-- CreateIndex
CREATE UNIQUE INDEX "PenyusutanAset_asetId_periode_key" ON "PenyusutanAset"("asetId", "periode");

-- AddForeignKey
ALTER TABLE "Karyawan" ADD CONSTRAINT "Karyawan_departemenId_fkey" FOREIGN KEY ("departemenId") REFERENCES "Departemen"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Karyawan" ADD CONSTRAINT "Karyawan_penggunaId_fkey" FOREIGN KEY ("penggunaId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pelanggan" ADD CONSTRAINT "Pelanggan_penjualId_fkey" FOREIGN KEY ("penjualId") REFERENCES "Karyawan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proyek" ADD CONSTRAINT "Proyek_pelangganId_fkey" FOREIGN KEY ("pelangganId") REFERENCES "Pelanggan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KelompokBarang" ADD CONSTRAINT "KelompokBarang_indukId_fkey" FOREIGN KEY ("indukId") REFERENCES "KelompokBarang"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Barang" ADD CONSTRAINT "Barang_kelompokId_fkey" FOREIGN KEY ("kelompokId") REFERENCES "KelompokBarang"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StokBarang" ADD CONSTRAINT "StokBarang_barangId_fkey" FOREIGN KEY ("barangId") REFERENCES "Barang"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StokBarang" ADD CONSTRAINT "StokBarang_gudangId_fkey" FOREIGN KEY ("gudangId") REFERENCES "Gudang"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PenawaranPenjualan" ADD CONSTRAINT "PenawaranPenjualan_pelangganId_fkey" FOREIGN KEY ("pelangganId") REFERENCES "Pelanggan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarisPenawaranPenjualan" ADD CONSTRAINT "BarisPenawaranPenjualan_penawaranId_fkey" FOREIGN KEY ("penawaranId") REFERENCES "PenawaranPenjualan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarisPenawaranPenjualan" ADD CONSTRAINT "BarisPenawaranPenjualan_barangId_fkey" FOREIGN KEY ("barangId") REFERENCES "Barang"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PesananPenjualan" ADD CONSTRAINT "PesananPenjualan_pelangganId_fkey" FOREIGN KEY ("pelangganId") REFERENCES "Pelanggan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PesananPenjualan" ADD CONSTRAINT "PesananPenjualan_penawaranId_fkey" FOREIGN KEY ("penawaranId") REFERENCES "PenawaranPenjualan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarisPesananPenjualan" ADD CONSTRAINT "BarisPesananPenjualan_pesananId_fkey" FOREIGN KEY ("pesananId") REFERENCES "PesananPenjualan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarisPesananPenjualan" ADD CONSTRAINT "BarisPesananPenjualan_barangId_fkey" FOREIGN KEY ("barangId") REFERENCES "Barang"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PengirimanPesanan" ADD CONSTRAINT "PengirimanPesanan_pesananId_fkey" FOREIGN KEY ("pesananId") REFERENCES "PesananPenjualan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PengirimanPesanan" ADD CONSTRAINT "PengirimanPesanan_gudangId_fkey" FOREIGN KEY ("gudangId") REFERENCES "Gudang"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarisPengiriman" ADD CONSTRAINT "BarisPengiriman_pengirimanId_fkey" FOREIGN KEY ("pengirimanId") REFERENCES "PengirimanPesanan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarisPengiriman" ADD CONSTRAINT "BarisPengiriman_barisPesananId_fkey" FOREIGN KEY ("barisPesananId") REFERENCES "BarisPesananPenjualan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarisPengiriman" ADD CONSTRAINT "BarisPengiriman_barangId_fkey" FOREIGN KEY ("barangId") REFERENCES "Barang"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FakturPenjualan" ADD CONSTRAINT "FakturPenjualan_pelangganId_fkey" FOREIGN KEY ("pelangganId") REFERENCES "Pelanggan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FakturPenjualan" ADD CONSTRAINT "FakturPenjualan_pesananId_fkey" FOREIGN KEY ("pesananId") REFERENCES "PesananPenjualan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FakturPenjualan" ADD CONSTRAINT "FakturPenjualan_pengirimanId_fkey" FOREIGN KEY ("pengirimanId") REFERENCES "PengirimanPesanan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarisFakturPenjualan" ADD CONSTRAINT "BarisFakturPenjualan_fakturId_fkey" FOREIGN KEY ("fakturId") REFERENCES "FakturPenjualan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarisFakturPenjualan" ADD CONSTRAINT "BarisFakturPenjualan_barangId_fkey" FOREIGN KEY ("barangId") REFERENCES "Barang"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PenerimaanPenjualan" ADD CONSTRAINT "PenerimaanPenjualan_pelangganId_fkey" FOREIGN KEY ("pelangganId") REFERENCES "Pelanggan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PenerimaanPenjualan" ADD CONSTRAINT "PenerimaanPenjualan_fakturId_fkey" FOREIGN KEY ("fakturId") REFERENCES "FakturPenjualan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PenerimaanPenjualan" ADD CONSTRAINT "PenerimaanPenjualan_akunId_fkey" FOREIGN KEY ("akunId") REFERENCES "Akun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturPenjualan" ADD CONSTRAINT "ReturPenjualan_fakturId_fkey" FOREIGN KEY ("fakturId") REFERENCES "FakturPenjualan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturPenjualan" ADD CONSTRAINT "ReturPenjualan_gudangId_fkey" FOREIGN KEY ("gudangId") REFERENCES "Gudang"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarisReturPenjualan" ADD CONSTRAINT "BarisReturPenjualan_returId_fkey" FOREIGN KEY ("returId") REFERENCES "ReturPenjualan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarisReturPenjualan" ADD CONSTRAINT "BarisReturPenjualan_barangId_fkey" FOREIGN KEY ("barangId") REFERENCES "Barang"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PesananPembelian" ADD CONSTRAINT "PesananPembelian_pemasokId_fkey" FOREIGN KEY ("pemasokId") REFERENCES "Pemasok"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarisPesananPembelian" ADD CONSTRAINT "BarisPesananPembelian_pesananId_fkey" FOREIGN KEY ("pesananId") REFERENCES "PesananPembelian"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarisPesananPembelian" ADD CONSTRAINT "BarisPesananPembelian_barangId_fkey" FOREIGN KEY ("barangId") REFERENCES "Barang"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PenerimaanBarang" ADD CONSTRAINT "PenerimaanBarang_pesananId_fkey" FOREIGN KEY ("pesananId") REFERENCES "PesananPembelian"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PenerimaanBarang" ADD CONSTRAINT "PenerimaanBarang_gudangId_fkey" FOREIGN KEY ("gudangId") REFERENCES "Gudang"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarisPenerimaanBarang" ADD CONSTRAINT "BarisPenerimaanBarang_penerimaanId_fkey" FOREIGN KEY ("penerimaanId") REFERENCES "PenerimaanBarang"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarisPenerimaanBarang" ADD CONSTRAINT "BarisPenerimaanBarang_barisPesananId_fkey" FOREIGN KEY ("barisPesananId") REFERENCES "BarisPesananPembelian"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarisPenerimaanBarang" ADD CONSTRAINT "BarisPenerimaanBarang_barangId_fkey" FOREIGN KEY ("barangId") REFERENCES "Barang"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FakturPembelian" ADD CONSTRAINT "FakturPembelian_pemasokId_fkey" FOREIGN KEY ("pemasokId") REFERENCES "Pemasok"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FakturPembelian" ADD CONSTRAINT "FakturPembelian_pesananId_fkey" FOREIGN KEY ("pesananId") REFERENCES "PesananPembelian"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FakturPembelian" ADD CONSTRAINT "FakturPembelian_penerimaanId_fkey" FOREIGN KEY ("penerimaanId") REFERENCES "PenerimaanBarang"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarisFakturPembelian" ADD CONSTRAINT "BarisFakturPembelian_fakturId_fkey" FOREIGN KEY ("fakturId") REFERENCES "FakturPembelian"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarisFakturPembelian" ADD CONSTRAINT "BarisFakturPembelian_barangId_fkey" FOREIGN KEY ("barangId") REFERENCES "Barang"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PembayaranPembelian" ADD CONSTRAINT "PembayaranPembelian_pemasokId_fkey" FOREIGN KEY ("pemasokId") REFERENCES "Pemasok"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PembayaranPembelian" ADD CONSTRAINT "PembayaranPembelian_fakturId_fkey" FOREIGN KEY ("fakturId") REFERENCES "FakturPembelian"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PembayaranPembelian" ADD CONSTRAINT "PembayaranPembelian_akunId_fkey" FOREIGN KEY ("akunId") REFERENCES "Akun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturPembelian" ADD CONSTRAINT "ReturPembelian_fakturId_fkey" FOREIGN KEY ("fakturId") REFERENCES "FakturPembelian"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturPembelian" ADD CONSTRAINT "ReturPembelian_gudangId_fkey" FOREIGN KEY ("gudangId") REFERENCES "Gudang"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarisReturPembelian" ADD CONSTRAINT "BarisReturPembelian_returId_fkey" FOREIGN KEY ("returId") REFERENCES "ReturPembelian"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarisReturPembelian" ADD CONSTRAINT "BarisReturPembelian_barangId_fkey" FOREIGN KEY ("barangId") REFERENCES "Barang"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Akun" ADD CONSTRAINT "Akun_indukId_fkey" FOREIGN KEY ("indukId") REFERENCES "Akun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PemetaanAkun" ADD CONSTRAINT "PemetaanAkun_piutangUsahaId_fkey" FOREIGN KEY ("piutangUsahaId") REFERENCES "Akun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PemetaanAkun" ADD CONSTRAINT "PemetaanAkun_persediaanId_fkey" FOREIGN KEY ("persediaanId") REFERENCES "Akun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PemetaanAkun" ADD CONSTRAINT "PemetaanAkun_hppId_fkey" FOREIGN KEY ("hppId") REFERENCES "Akun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PemetaanAkun" ADD CONSTRAINT "PemetaanAkun_pendapatanPenjualanId_fkey" FOREIGN KEY ("pendapatanPenjualanId") REFERENCES "Akun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PemetaanAkun" ADD CONSTRAINT "PemetaanAkun_utangUsahaId_fkey" FOREIGN KEY ("utangUsahaId") REFERENCES "Akun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarisJurnal" ADD CONSTRAINT "BarisJurnal_jurnalId_fkey" FOREIGN KEY ("jurnalId") REFERENCES "Jurnal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarisJurnal" ADD CONSTRAINT "BarisJurnal_akunId_fkey" FOREIGN KEY ("akunId") REFERENCES "Akun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AsetTetap" ADD CONSTRAINT "AsetTetap_akunAsetId_fkey" FOREIGN KEY ("akunAsetId") REFERENCES "Akun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AsetTetap" ADD CONSTRAINT "AsetTetap_akunBebanPenyusutanId_fkey" FOREIGN KEY ("akunBebanPenyusutanId") REFERENCES "Akun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AsetTetap" ADD CONSTRAINT "AsetTetap_akunAkumulasiPenyusutanId_fkey" FOREIGN KEY ("akunAkumulasiPenyusutanId") REFERENCES "Akun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PenyusutanAset" ADD CONSTRAINT "PenyusutanAset_asetId_fkey" FOREIGN KEY ("asetId") REFERENCES "AsetTetap"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PenyusutanAset" ADD CONSTRAINT "PenyusutanAset_jurnalId_fkey" FOREIGN KEY ("jurnalId") REFERENCES "Jurnal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Stok tidak boleh negatif (pengaman kondisi balapan; aplikasi juga mengecek sebelum mengurangi stok)
ALTER TABLE "StokBarang" ADD CONSTRAINT "StokBarang_jumlah_tidak_negatif" CHECK ("jumlah" >= 0);
