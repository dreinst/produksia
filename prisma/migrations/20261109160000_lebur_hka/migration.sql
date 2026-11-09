-- Peleburan HKA Console ke Produksia: satu migrasi untuk skema gabungan D1-D7
-- (multi perusahaan, platform berkas/notifikasi/log, dokumen penjualan, cetak & kop, CRM,
-- keuangan proyek, pemasaran).
--
-- Dibangkitkan dengan `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`,
-- lalu disunting tangan pada titik bertanda [Dx ...]: enam baris Perusahaan, Penggajian.bulan,
-- NOT NULL peranTambahan, backfill data lama, CHECK, STORAGE EXTERNAL, dan folder berkas sistem.
--
-- Nilai enum baru (PeranPengguna SOSMED/IKLAN/DESAINER, SumberJurnal ANTAR_PERUSAHAAN/MITRA_PROYEK)
-- TIDAK dipakai di migrasi ini, jadi ALTER TYPE ... ADD VALUE aman di transaksi yang sama
-- (PostgreSQL >= 12; produksi postgres:16). Karena itu migrasi tidak dipecah.

-- CreateEnum
CREATE TYPE "JenisPerusahaan" AS ENUM ('AGENSI', 'MEREK', 'KLIEN');

-- CreateEnum
CREATE TYPE "JenisAntarPerusahaan" AS ENUM ('TAGIH', 'LUNAS');

-- CreateEnum
CREATE TYPE "TagBerkas" AS ENUM ('REFERENSI', 'HASIL', 'DOKUMEN');

-- CreateEnum
CREATE TYPE "JenisNotifikasi" AS ENUM ('PENUGASAN', 'STATUS', 'PERSETUJUAN', 'HASIL_PERSETUJUAN', 'REVISI', 'TINDAK_LANJUT', 'JATUH_TEMPO');

-- CreateEnum
CREATE TYPE "ModeDokumen" AS ENUM ('STANDAR', 'EVENT');

-- CreateEnum
CREATE TYPE "TampilanEvent" AS ENUM ('RINCI', 'RINGKAS');

-- CreateEnum
CREATE TYPE "JenisNilai" AS ENUM ('NOMINAL', 'PERSEN');

-- CreateEnum
CREATE TYPE "StatusKomersial" AS ENUM ('DRAF', 'TERKIRIM', 'DITERIMA', 'DITOLAK', 'KEDALUWARSA');

-- CreateEnum
CREATE TYPE "ResetNomor" AS ENUM ('TAHUNAN', 'BULANAN', 'TIDAK_PERNAH');

-- CreateEnum
CREATE TYPE "JenisDokumenCetak" AS ENUM ('PENAWARAN', 'TAGIHAN_TERMIN', 'FAKTUR', 'KWITANSI', 'KWITANSI_DP');

-- CreateEnum
CREATE TYPE "TataLetakCetak" AS ENUM ('HKA_STANDAR', 'HKA_BERMEREK', 'HKA_SURAT', 'HKA_MINIMAL', 'DPRO_INVOICE', 'DPRO_PROPOSAL', 'KWITANSI_ENTITAS', 'KWITANSI_POLOS');

-- CreateEnum
CREATE TYPE "UkuranKertas" AS ENUM ('A4', 'A5', 'A5_LANDSCAPE');

-- CreateEnum
CREATE TYPE "GayaAngka" AS ENUM ('TITIK', 'KOMA');

-- CreateEnum
CREATE TYPE "GayaEntitas" AS ENUM ('DPRO', 'TAPUSSA', 'BONANOVA', 'SAHARA', 'NAWASENA');

-- CreateEnum
CREATE TYPE "JenisAsetKop" AS ENUM ('KOP', 'KAKI', 'WATERMARK', 'LOGO', 'JUDUL_INVOICE', 'JUDUL_KWITANSI', 'LABEL_PEMBAYARAN', 'LABEL_SALAM', 'TANDA_TANGAN', 'STEMPEL');

-- CreateEnum
CREATE TYPE "JenisTahapLead" AS ENUM ('BERJALAN', 'MENANG', 'KALAH');

-- CreateEnum
CREATE TYPE "StatusTindakLanjut" AS ENUM ('MENUNGGU', 'SELESAI', 'DIBATALKAN');

-- CreateEnum
CREATE TYPE "JenisAktivitasLead" AS ENUM ('DIBUAT', 'DIUBAH', 'TAHAP_DIUBAH', 'MENANG', 'KALAH', 'CATATAN', 'TINDAK_LANJUT_DIJADWALKAN', 'TINDAK_LANJUT_STATUS', 'DIKONVERSI', 'PENAWARAN_DIBUAT', 'DIARSIPKAN', 'DIPULIHKAN');

-- CreateEnum
CREATE TYPE "ModeBagiHasil" AS ENUM ('PERSEN', 'NOMINAL');

-- CreateEnum
CREATE TYPE "JenisPembayaranMitra" AS ENUM ('MODAL', 'LABA');

-- CreateEnum
CREATE TYPE "PlatformKonten" AS ENUM ('INSTAGRAM', 'FACEBOOK', 'TIKTOK', 'THREADS');

-- CreateEnum
CREATE TYPE "StatusKonten" AS ENUM ('IDE', 'DRAF', 'DESAIN', 'DITINJAU', 'DISETUJUI', 'TERJADWAL', 'TERBIT');

-- CreateEnum
CREATE TYPE "StatusPersetujuanKonten" AS ENUM ('TIDAK_ADA', 'MENUNGGU', 'DISETUJUI', 'DITOLAK');

-- CreateEnum
CREATE TYPE "AksiRiwayatKonten" AS ENUM ('DIAJUKAN', 'DISETUJUI', 'DITOLAK', 'DITARIK');

-- CreateEnum
CREATE TYPE "StatusTugasDesain" AS ENUM ('PERMINTAAN', 'DITUGASKAN', 'DIKERJAKAN', 'DITINJAU', 'REVISI', 'DISETUJUI', 'SELESAI');

-- CreateEnum
CREATE TYPE "PrioritasDesain" AS ENUM ('RENDAH', 'SEDANG', 'TINGGI', 'MENDESAK');

-- CreateEnum
CREATE TYPE "SumberTugasDesain" AS ENUM ('MANUAL', 'KONTEN');

-- CreateEnum
CREATE TYPE "KeputusanRevisiDesain" AS ENUM ('DISETUJUI', 'MINTA_REVISI');

-- CreateEnum
CREATE TYPE "TujuanKampanye" AS ENUM ('KESADARAN', 'TRAFFIC', 'INTERAKSI', 'PROSPEK', 'PROMOSI_APLIKASI', 'PENJUALAN');

-- CreateEnum
CREATE TYPE "StatusKampanye" AS ENUM ('DIRENCANAKAN', 'AKTIF', 'DIJEDA', 'SELESAI');

-- CreateEnum
CREATE TYPE "GenderAudiens" AS ENUM ('SEMUA', 'PEREMPUAN', 'LAKI_LAKI');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PeranPengguna" ADD VALUE 'SOSMED';
ALTER TYPE "PeranPengguna" ADD VALUE 'IKLAN';
ALTER TYPE "PeranPengguna" ADD VALUE 'DESAINER';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SumberJurnal" ADD VALUE 'ANTAR_PERUSAHAAN';
ALTER TYPE "SumberJurnal" ADD VALUE 'MITRA_PROYEK';

-- CreateTable
CREATE TABLE "Perusahaan" (
    "id" TEXT NOT NULL,
    "kode" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "namaLegal" TEXT,
    "jenis" "JenisPerusahaan" NOT NULL DEFAULT 'AGENSI',
    "industri" TEXT,
    "alamat" TEXT,
    "kota" TEXT,
    "telepon" TEXT,
    "email" TEXT,
    "website" TEXT,
    "instagram" TEXT,
    "npwp" TEXT,
    "infoPajak" TEXT,
    "namaBank" TEXT,
    "cabangBank" TEXT,
    "nomorRekening" TEXT,
    "atasNamaRekening" TEXT,
    "penandaTangan" TEXT,
    "jabatanPenandaTangan" TEXT,
    "warna" TEXT,
    "catatan" TEXT,
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "urutan" INTEGER NOT NULL DEFAULT 0,
    "dibuatPada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "diubahPada" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Perusahaan_pkey" PRIMARY KEY ("id")
);

-- [D1 Sunting 1] Enam entitas D'Pro. "utama" = DPRO, pemilik semua data lama dan nilai bawaan kolom perusahaanId.
-- Disisipkan sebelum ALTER TABLE apa pun dan jauh sebelum FOREIGN KEY (yang butuh baris 'utama').
-- diubahPada wajib diisi NOW() karena kolom @updatedAt tidak punya bawaan basis data.
INSERT INTO "Perusahaan" ("id","kode","nama","namaLegal","jenis","alamat","kota","telepon","email","instagram","namaBank","cabangBank","nomorRekening","atasNamaRekening","penandaTangan","jabatanPenandaTangan","warna","aktif","urutan","dibuatPada","diubahPada") VALUES
('utama','DPRO',COALESCE((SELECT "nama" FROM "PengaturanPerusahaan" WHERE "id" = 'default'),'D''Production Event Organizer'),NULL,'AGENSI','Jl. Raya Pandanlandung No. 16 Malang','Malang','+6281938938800','dproductionorganizer@gmail.com','@dpro.duction','BCA','Malang Cab. Galunggung','440.008.0033','Donatus Purbandono','Donatus Purbandono',NULL,'#0B2144',true,0,NOW(),NOW()),
('tapussa','TAPUSSA','Tapussa Bhallika','CV Tapussa Bhallika','AGENSI','Jl. Simpang Raya Langsep 26 Malang','Malang','082132370811','cv.tapussabhallika@gmail.com',NULL,'BCA','Malang Cab. Kawi','385.199.9921','TAPUSSA BHALLIKA CV','Nadia Yuliana',NULL,'#F05B21',true,1,NOW(),NOW()),
('smara','SMARA','SMARA',NULL,'AGENSI',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'Nadia Yuliana',NULL,NULL,true,2,NOW(),NOW()),
('bonanova','BONANOVA','Bonanova Music',NULL,'MEREK',NULL,NULL,NULL,NULL,NULL,'BCA',NULL,'3851999921','CV Tapussa Bhallika','Bintang Wahyu','Manager','#AE0317',true,3,NOW(),NOW()),
('sahara','SAHARA','Sahara Food',NULL,'MEREK',NULL,NULL,'0881-0367-16645',NULL,NULL,'BCA',NULL,'385.097.2931','BINA KARISMA NEGARA','Bina Karisma Negara',NULL,'#A80503',true,4,NOW(),NOW()),
('nawasena','NAWASENA','Nawasena Production','DPRODUCTION NAWASENA CV','AGENSI',NULL,NULL,NULL,NULL,NULL,'BCA','Malang Cab. Galunggung','816-178-8228','DPRODUCTION NAWASENA CV','Firdaus Romanda Lumban Toruan',NULL,'#006699',true,5,NOW(),NOW())
ON CONFLICT ("id") DO NOTHING;

-- DropIndex
DROP INDEX "PengaturanPerusahaan_akunBebanPphFinalId_key";

-- DropIndex
DROP INDEX "PengaturanPerusahaan_akunHutangPphFinalId_key";

-- DropIndex
DROP INDEX "PengaturanPerusahaan_akunPph23DimukaId_key";

-- DropIndex
DROP INDEX "PengaturanPerusahaan_akunPph23DipotongId_key";

-- DropIndex
DROP INDEX "PengaturanPerusahaan_akunPpnKeluaranId_key";

-- DropIndex
DROP INDEX "PengaturanPerusahaan_akunPpnMasukanId_key";

-- DropIndex
DROP INDEX "PphFinalBulanan_periode_key";

-- AlterTable
ALTER TABLE "Akun" ADD COLUMN     "perusahaanId" TEXT;

-- AlterTable
ALTER TABLE "AsetTetap" ADD COLUMN     "perusahaanId" TEXT NOT NULL DEFAULT 'utama';

-- AlterTable
ALTER TABLE "Barang" ADD COLUMN     "deskripsi" TEXT,
ADD COLUMN     "perusahaanId" TEXT DEFAULT 'utama';

-- AlterTable
ALTER TABLE "BarisFakturPenjualan" ADD COLUMN     "bagian" TEXT,
ADD COLUMN     "barisPesananId" TEXT,
ADD COLUMN     "deskripsi" TEXT,
ADD COLUMN     "frekuensi" DECIMAL(18,2) NOT NULL DEFAULT 1,
ADD COLUMN     "keterangan" TEXT,
ADD COLUMN     "nama" TEXT,
ADD COLUMN     "satuan" TEXT,
ADD COLUMN     "satuanFrekuensi" TEXT,
ADD COLUMN     "urutan" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "BarisPenawaranPenjualan" ADD COLUMN     "bagian" TEXT,
ADD COLUMN     "deskripsi" TEXT,
ADD COLUMN     "frekuensi" DECIMAL(18,2) NOT NULL DEFAULT 1,
ADD COLUMN     "keterangan" TEXT,
ADD COLUMN     "nama" TEXT,
ADD COLUMN     "satuan" TEXT,
ADD COLUMN     "satuanFrekuensi" TEXT,
ADD COLUMN     "urutan" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "BarisPesananPenjualan" ADD COLUMN     "bagian" TEXT,
ADD COLUMN     "deskripsi" TEXT,
ADD COLUMN     "frekuensi" DECIMAL(18,2) NOT NULL DEFAULT 1,
ADD COLUMN     "keterangan" TEXT,
ADD COLUMN     "nama" TEXT,
ADD COLUMN     "satuan" TEXT,
ADD COLUMN     "satuanFrekuensi" TEXT,
ADD COLUMN     "urutan" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "BarisReturPenjualan" ADD COLUMN     "barisFakturId" TEXT;

-- AlterTable
ALTER TABLE "DokumenKas" ADD COLUMN     "perusahaanId" TEXT NOT NULL DEFAULT 'utama';

-- AlterTable
ALTER TABLE "FakturPembelian" ADD COLUMN     "perusahaanId" TEXT NOT NULL DEFAULT 'utama';

-- AlterTable
ALTER TABLE "FakturPenjualan" ADD COLUMN     "catatan" TEXT,
ADD COLUMN     "catatanKanan" TEXT,
ADD COLUMN     "fee" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "infoBank" TEXT,
ADD COLUMN     "jenisDiskon" "JenisNilai" NOT NULL DEFAULT 'NOMINAL',
ADD COLUMN     "jenisFee" "JenisNilai" NOT NULL DEFAULT 'PERSEN',
ADD COLUMN     "judulCetak" TEXT,
ADD COLUMN     "kepada" TEXT,
ADD COLUMN     "kepadaAlamat" TEXT,
ADD COLUMN     "kepadaEmail" TEXT,
ADD COLUMN     "kepadaTelepon" TEXT,
ADD COLUMN     "kepadaUp" TEXT,
ADD COLUMN     "kopSuratId" TEXT,
ADD COLUMN     "lampiran" TEXT,
ADD COLUMN     "mode" "ModeDokumen" NOT NULL DEFAULT 'STANDAR',
ADD COLUMN     "namaEvent" TEXT,
ADD COLUMN     "nilaiDiskon" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "nilaiFee" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "nomorCetak" TEXT,
ADD COLUMN     "perihal" TEXT,
ADD COLUMN     "perusahaanId" TEXT NOT NULL DEFAULT 'utama',
ADD COLUMN     "referensi" TEXT,
ADD COLUMN     "syaratPembayaran" TEXT,
ADD COLUMN     "tampilanEvent" "TampilanEvent" NOT NULL DEFAULT 'RINCI',
ADD COLUMN     "tanggalEvent" TEXT,
ADD COLUMN     "teksPembuka" TEXT,
ADD COLUMN     "teksPenutup" TEXT,
ADD COLUMN     "venue" TEXT;

-- AlterTable
ALTER TABLE "Gudang" ADD COLUMN     "perusahaanId" TEXT;

-- AlterTable
ALTER TABLE "Jurnal" ADD COLUMN     "perusahaanId" TEXT NOT NULL DEFAULT 'utama';

-- AlterTable
ALTER TABLE "Karyawan" ADD COLUMN     "perusahaanId" TEXT NOT NULL DEFAULT 'utama';

-- AlterTable
ALTER TABLE "LaporanKerusakanBarang" ADD COLUMN     "perusahaanId" TEXT NOT NULL DEFAULT 'utama';

-- AlterTable
ALTER TABLE "LogAktivitas" ADD COLUMN     "entitasId" TEXT,
ADD COLUMN     "meta" JSONB,
ADD COLUMN     "modul" TEXT,
ADD COLUMN     "perusahaanId" TEXT;

-- AlterTable
ALTER TABLE "Pelanggan" ADD COLUMN     "email" TEXT,
ADD COLUMN     "namaKontak" TEXT;

-- AlterTable
ALTER TABLE "PembayaranPembelian" ADD COLUMN     "perusahaanId" TEXT NOT NULL DEFAULT 'utama';

-- AlterTable
ALTER TABLE "PeminjamanBarang" ADD COLUMN     "perusahaanId" TEXT NOT NULL DEFAULT 'utama';

-- AlterTable
ALTER TABLE "PenawaranPenjualan" ADD COLUMN     "berlakuSampai" TIMESTAMP(3),
ADD COLUMN     "catatan" TEXT,
ADD COLUMN     "catatanKanan" TEXT,
ADD COLUMN     "diskon" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "fee" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "infoBank" TEXT,
ADD COLUMN     "jenisDiskon" "JenisNilai" NOT NULL DEFAULT 'NOMINAL',
ADD COLUMN     "jenisFee" "JenisNilai" NOT NULL DEFAULT 'PERSEN',
ADD COLUMN     "judulCetak" TEXT,
ADD COLUMN     "kepada" TEXT,
ADD COLUMN     "kepadaAlamat" TEXT,
ADD COLUMN     "kepadaEmail" TEXT,
ADD COLUMN     "kepadaTelepon" TEXT,
ADD COLUMN     "kepadaUp" TEXT,
ADD COLUMN     "keteranganAddOn" TEXT,
ADD COLUMN     "kopSuratId" TEXT,
ADD COLUMN     "lampiran" TEXT,
ADD COLUMN     "leadId" TEXT,
ADD COLUMN     "mode" "ModeDokumen" NOT NULL DEFAULT 'STANDAR',
ADD COLUMN     "namaEvent" TEXT,
ADD COLUMN     "nilaiAddOn" DECIMAL(18,2),
ADD COLUMN     "nilaiDiskon" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "nilaiFee" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "nomorCetak" TEXT,
ADD COLUMN     "perihal" TEXT,
ADD COLUMN     "perusahaanId" TEXT NOT NULL DEFAULT 'utama',
ADD COLUMN     "ppnPersen" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "referensi" TEXT,
ADD COLUMN     "statusKomersial" "StatusKomersial" NOT NULL DEFAULT 'DRAF',
ADD COLUMN     "statusKomersialPada" TIMESTAMP(3),
ADD COLUMN     "syaratPembayaran" TEXT,
ADD COLUMN     "tampilanEvent" "TampilanEvent" NOT NULL DEFAULT 'RINCI',
ADD COLUMN     "tanggalEvent" TEXT,
ADD COLUMN     "teksPembuka" TEXT,
ADD COLUMN     "teksPenutup" TEXT,
ADD COLUMN     "venue" TEXT;

-- AlterTable
ALTER TABLE "PenerimaanBarang" ADD COLUMN     "perusahaanId" TEXT NOT NULL DEFAULT 'utama';

-- AlterTable
ALTER TABLE "PenerimaanPenjualan" ADD COLUMN     "catatan" TEXT,
ADD COLUMN     "judulCetak" TEXT,
ADD COLUMN     "keperluan" TEXT,
ADD COLUMN     "kopSuratId" TEXT,
ADD COLUMN     "nomorCetak" TEXT,
ADD COLUMN     "perusahaanId" TEXT NOT NULL DEFAULT 'utama',
ADD COLUMN     "terimaDari" TEXT;

-- AlterTable
ALTER TABLE "PengaturanPerusahaan" ADD COLUMN     "perusahaanId" TEXT NOT NULL DEFAULT 'utama';

-- AlterTable
-- [D1 Sunting 2] Prisma membangkitkan "bulan" TEXT NOT NULL tanpa bawaan, yang gagal bila tabel berisi.
ALTER TABLE "Penggajian" ADD COLUMN     "bulan" TEXT,
ADD COLUMN     "perusahaanId" TEXT NOT NULL DEFAULT 'utama';
UPDATE "Penggajian" SET "bulan" = "periode";
ALTER TABLE "Penggajian" ALTER COLUMN "bulan" SET NOT NULL;

-- AlterTable
-- [D7 §2.7 A] NOT NULL: hak efektif membaca daftar ini; baris lama terisi bawaan larik kosong.
ALTER TABLE "Pengguna" ADD COLUMN     "peranTambahan" "PeranPengguna"[] NOT NULL DEFAULT ARRAY[]::"PeranPengguna"[];

-- AlterTable
ALTER TABLE "PengirimanPesanan" ADD COLUMN     "perusahaanId" TEXT NOT NULL DEFAULT 'utama';

-- AlterTable
ALTER TABLE "PenyesuaianPersediaan" ADD COLUMN     "perusahaanId" TEXT NOT NULL DEFAULT 'utama';

-- AlterTable
ALTER TABLE "PesananPembelian" ADD COLUMN     "perusahaanId" TEXT NOT NULL DEFAULT 'utama';

-- AlterTable
ALTER TABLE "PesananPenjualan" ADD COLUMN     "catatan" TEXT,
ADD COLUMN     "catatanKanan" TEXT,
ADD COLUMN     "diskon" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "fee" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "infoBank" TEXT,
ADD COLUMN     "jenisDiskon" "JenisNilai" NOT NULL DEFAULT 'NOMINAL',
ADD COLUMN     "jenisFee" "JenisNilai" NOT NULL DEFAULT 'PERSEN',
ADD COLUMN     "kepada" TEXT,
ADD COLUMN     "kepadaAlamat" TEXT,
ADD COLUMN     "kepadaEmail" TEXT,
ADD COLUMN     "kepadaTelepon" TEXT,
ADD COLUMN     "kepadaUp" TEXT,
ADD COLUMN     "kopSuratId" TEXT,
ADD COLUMN     "lampiran" TEXT,
ADD COLUMN     "leadId" TEXT,
ADD COLUMN     "mode" "ModeDokumen" NOT NULL DEFAULT 'STANDAR',
ADD COLUMN     "namaEvent" TEXT,
ADD COLUMN     "nilaiDiskon" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "nilaiFee" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "perihal" TEXT,
ADD COLUMN     "perusahaanId" TEXT NOT NULL DEFAULT 'utama',
ADD COLUMN     "ppnPersen" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "referensi" TEXT,
ADD COLUMN     "syaratPembayaran" TEXT,
ADD COLUMN     "tampilanEvent" "TampilanEvent" NOT NULL DEFAULT 'RINCI',
ADD COLUMN     "tanggalEvent" TEXT,
ADD COLUMN     "teksPembuka" TEXT,
ADD COLUMN     "teksPenutup" TEXT,
ADD COLUMN     "venue" TEXT;

-- AlterTable
ALTER TABLE "PindahBarang" ADD COLUMN     "perusahaanId" TEXT NOT NULL DEFAULT 'utama';

-- AlterTable
ALTER TABLE "PphFinalBulanan" ADD COLUMN     "perusahaanId" TEXT NOT NULL DEFAULT 'utama';

-- AlterTable
ALTER TABLE "Prive" ADD COLUMN     "perusahaanId" TEXT NOT NULL DEFAULT 'utama';

-- AlterTable
ALTER TABLE "Proyek" ADD COLUMN     "namaKlien" TEXT,
ADD COLUMN     "perusahaanId" TEXT NOT NULL DEFAULT 'utama',
ADD COLUMN     "warna" TEXT;

-- AlterTable
ALTER TABLE "ReturPembelian" ADD COLUMN     "perusahaanId" TEXT NOT NULL DEFAULT 'utama';

-- AlterTable
ALTER TABLE "ReturPenjualan" ADD COLUMN     "fee" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "perusahaanId" TEXT NOT NULL DEFAULT 'utama';

-- AlterTable
ALTER TABLE "Sesi" ADD COLUMN     "perusahaanAktifId" TEXT;

-- AlterTable
ALTER TABLE "UangMukaPelanggan" ADD COLUMN     "judulCetak" TEXT,
ADD COLUMN     "keperluan" TEXT,
ADD COLUMN     "kopSuratId" TEXT,
ADD COLUMN     "nomorCetak" TEXT,
ADD COLUMN     "perusahaanId" TEXT NOT NULL DEFAULT 'utama',
ADD COLUMN     "rencanaTerminId" TEXT,
ADD COLUMN     "terimaDari" TEXT;

-- CreateTable
CREATE TABLE "TutupBukuPerusahaan" (
    "id" TEXT NOT NULL,
    "tutupBukuId" TEXT NOT NULL,
    "perusahaanId" TEXT NOT NULL DEFAULT 'utama',
    "labaBersih" DECIMAL(18,2) NOT NULL,
    "jurnalId" TEXT,

    CONSTRAINT "TutupBukuPerusahaan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransaksiAntarPerusahaan" (
    "id" TEXT NOT NULL,
    "nomor" TEXT NOT NULL,
    "tanggal" TIMESTAMP(3) NOT NULL,
    "jenis" "JenisAntarPerusahaan" NOT NULL,
    "pemberiId" TEXT NOT NULL,
    "penerimaId" TEXT NOT NULL,
    "jumlah" DECIMAL(18,2) NOT NULL,
    "keterangan" TEXT NOT NULL,
    "akunPemberiId" TEXT NOT NULL,
    "akunPenerimaId" TEXT NOT NULL,
    "proyekPemberiId" TEXT,
    "proyekPenerimaId" TEXT,
    "jurnalPemberiId" TEXT,
    "jurnalPenerimaId" TEXT,
    "dicatatOlehId" TEXT,
    "dicatatOlehNama" TEXT NOT NULL,
    "dibuatPada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransaksiAntarPerusahaan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FolderBerkas" (
    "kode" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "urutan" INTEGER NOT NULL DEFAULT 0,
    "sistem" BOOLEAN NOT NULL DEFAULT false,
    "terbatas" BOOLEAN NOT NULL DEFAULT false,
    "peranBoleh" "PeranPengguna"[] DEFAULT ARRAY[]::"PeranPengguna"[],
    "diubahPada" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FolderBerkas_pkey" PRIMARY KEY ("kode")
);

-- CreateTable
CREATE TABLE "Berkas" (
    "id" TEXT NOT NULL,
    "perusahaanId" TEXT NOT NULL DEFAULT 'utama',
    "folderKode" TEXT NOT NULL DEFAULT 'LAINNYA',
    "namaBerkas" TEXT NOT NULL,
    "tipeMime" TEXT NOT NULL,
    "ukuran" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "jenisEntitas" TEXT,
    "entitasId" TEXT,
    "tag" "TagBerkas",
    "proyekId" TEXT,
    "diunggahOlehId" TEXT,
    "diunggahOlehNama" TEXT NOT NULL,
    "dibuatPada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "diubahPada" TIMESTAMP(3) NOT NULL,
    "dihapusPada" TIMESTAMP(3),
    "dihapusOlehId" TEXT,
    "dihapusOlehNama" TEXT,
    "isiDihapusPada" TIMESTAMP(3),

    CONSTRAINT "Berkas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IsiBerkas" (
    "berkasId" TEXT NOT NULL,
    "isi" BYTEA NOT NULL,

    CONSTRAINT "IsiBerkas_pkey" PRIMARY KEY ("berkasId")
);

-- CreateTable
CREATE TABLE "TautanBagiBerkas" (
    "id" TEXT NOT NULL,
    "berkasId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "kedaluwarsa" TIMESTAMP(3) NOT NULL,
    "dibuatOlehId" TEXT,
    "dibuatOlehNama" TEXT NOT NULL,
    "dibuatPada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dicabutPada" TIMESTAMP(3),
    "dicabutOlehId" TEXT,
    "jumlahUnduh" INTEGER NOT NULL DEFAULT 0,
    "terakhirDiunduh" TIMESTAMP(3),

    CONSTRAINT "TautanBagiBerkas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AksesBerkasProyek" (
    "proyekId" TEXT NOT NULL,
    "peranBoleh" "PeranPengguna"[] DEFAULT ARRAY[]::"PeranPengguna"[],
    "diubahOlehId" TEXT,
    "diubahPada" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AksesBerkasProyek_pkey" PRIMARY KEY ("proyekId")
);

-- CreateTable
CREATE TABLE "AksesBerkasProyekPengguna" (
    "proyekId" TEXT NOT NULL,
    "penggunaId" TEXT NOT NULL,

    CONSTRAINT "AksesBerkasProyekPengguna_pkey" PRIMARY KEY ("proyekId","penggunaId")
);

-- CreateTable
CREATE TABLE "Notifikasi" (
    "id" TEXT NOT NULL,
    "penggunaId" TEXT NOT NULL,
    "perusahaanId" TEXT,
    "jenis" "JenisNotifikasi" NOT NULL,
    "judul" TEXT NOT NULL,
    "isi" TEXT,
    "tautan" TEXT,
    "kunci" TEXT,
    "dibaca" BOOLEAN NOT NULL DEFAULT false,
    "dibacaPada" TIMESTAMP(3),
    "dibuatPada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notifikasi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RencanaTermin" (
    "id" TEXT NOT NULL,
    "perusahaanId" TEXT NOT NULL DEFAULT 'utama',
    "penawaranId" TEXT,
    "pesananId" TEXT,
    "no" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "mode" "JenisNilai" NOT NULL DEFAULT 'PERSEN',
    "nilai" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "jumlah" DECIMAL(18,2) NOT NULL,
    "persen" DECIMAL(7,2) NOT NULL,
    "jatuhTempo" TIMESTAMP(3),
    "nomorCetak" TEXT,
    "ditagihPada" TIMESTAMP(3),
    "dibuatPada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RencanaTermin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormatNomor" (
    "id" TEXT NOT NULL,
    "perusahaanId" TEXT NOT NULL DEFAULT 'utama',
    "jenis" TEXT NOT NULL,
    "pola" TEXT NOT NULL,
    "prefiks" TEXT NOT NULL DEFAULT '',
    "kode" TEXT NOT NULL DEFAULT '',
    "digit" INTEGER NOT NULL DEFAULT 4,
    "kunciDeret" TEXT NOT NULL,
    "reset" "ResetNomor" NOT NULL DEFAULT 'TAHUNAN',
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    "dibuatPada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "diubahPada" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FormatNomor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PenghitungNomor" (
    "perusahaanId" TEXT NOT NULL DEFAULT 'utama',
    "kunciDeret" TEXT NOT NULL,
    "periode" TEXT NOT NULL,
    "nilai" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PenghitungNomor_pkey" PRIMARY KEY ("perusahaanId","kunciDeret","periode")
);

-- CreateTable
CREATE TABLE "PengaturanDokumenPenjualan" (
    "id" TEXT NOT NULL,
    "perusahaanId" TEXT NOT NULL DEFAULT 'utama',
    "syaratPembayaran" TEXT,
    "tampilanEvent" "TampilanEvent" NOT NULL DEFAULT 'RINCI',
    "daftarSeksi" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "teksPembukaPenawaran" TEXT,
    "teksPenutupPenawaran" TEXT,
    "diubahPada" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PengaturanDokumenPenjualan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KopSurat" (
    "id" TEXT NOT NULL,
    "perusahaanId" TEXT NOT NULL DEFAULT 'utama',
    "nama" TEXT NOT NULL,
    "bawaan" BOOLEAN NOT NULL DEFAULT false,
    "gayaEntitas" "GayaEntitas",
    "tataLetakUmum" "TataLetakCetak" NOT NULL DEFAULT 'HKA_STANDAR',
    "judulMerek" TEXT,
    "teksKepala" TEXT,
    "facebook" TEXT,
    "alamatKaki" TEXT,
    "teksKaki" TEXT,
    "singkatanBank" TEXT,
    "catatanBank" TEXT,
    "teksSalam" TEXT NOT NULL DEFAULT 'Hormat kami,',
    "namaKontak" TEXT,
    "teleponKontak" TEXT,
    "namaLegal" TEXT,
    "alamat" TEXT,
    "kota" TEXT,
    "telepon" TEXT,
    "email" TEXT,
    "website" TEXT,
    "instagram" TEXT,
    "npwp" TEXT,
    "namaBank" TEXT,
    "cabangBank" TEXT,
    "nomorRekening" TEXT,
    "atasNamaRekening" TEXT,
    "penandaTangan" TEXT,
    "jabatanPenandaTangan" TEXT,
    "warnaAksen" TEXT NOT NULL DEFAULT '#111111',
    "warnaUtama" TEXT NOT NULL DEFAULT '#1F3550',
    "warnaSekunder" TEXT NOT NULL DEFAULT '#003E9F',
    "warnaLembut" TEXT NOT NULL DEFAULT '#DBE4F0',
    "warnaTinta" TEXT NOT NULL DEFAULT '#111111',
    "tampilLogo" BOOLEAN NOT NULL DEFAULT true,
    "tampilWatermark" BOOLEAN NOT NULL DEFAULT false,
    "dibuatPada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "diubahPada" TIMESTAMP(3) NOT NULL,
    "dihapusPada" TIMESTAMP(3),

    CONSTRAINT "KopSurat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateCetak" (
    "id" TEXT NOT NULL,
    "kopSuratId" TEXT NOT NULL,
    "jenis" "JenisDokumenCetak" NOT NULL,
    "tataLetak" "TataLetakCetak" NOT NULL,
    "ukuran" "UkuranKertas" NOT NULL DEFAULT 'A4',
    "gayaAngka" "GayaAngka",
    "judul" TEXT,
    "tandaTanganBawaan" BOOLEAN NOT NULL DEFAULT true,
    "diubahPada" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TemplateCetak_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AsetKopSurat" (
    "id" TEXT NOT NULL,
    "kopSuratId" TEXT NOT NULL,
    "jenis" "JenisAsetKop" NOT NULL,
    "berkasId" TEXT NOT NULL,
    "lebarPx" INTEGER NOT NULL,
    "tinggiPx" INTEGER NOT NULL,
    "dibuatPada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AsetKopSurat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TahapLead" (
    "id" TEXT NOT NULL,
    "perusahaanId" TEXT NOT NULL DEFAULT 'utama',
    "nama" TEXT NOT NULL,
    "jenis" "JenisTahapLead" NOT NULL DEFAULT 'BERJALAN',
    "urutan" INTEGER NOT NULL,
    "dibuatPada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TahapLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SumberLead" (
    "id" TEXT NOT NULL,
    "perusahaanId" TEXT NOT NULL DEFAULT 'utama',
    "nama" TEXT NOT NULL,
    "urutan" INTEGER NOT NULL DEFAULT 0,
    "dibuatPada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SumberLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "perusahaanId" TEXT NOT NULL DEFAULT 'utama',
    "nama" TEXT NOT NULL,
    "namaUsaha" TEXT NOT NULL,
    "telepon" TEXT NOT NULL,
    "whatsapp" TEXT NOT NULL,
    "email" TEXT,
    "instagram" TEXT,
    "website" TEXT,
    "industri" TEXT,
    "lokasi" TEXT,
    "sumber" TEXT NOT NULL,
    "picId" TEXT,
    "nilaiEstimasi" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "catatan" TEXT,
    "tag" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "fieldTambahan" JSONB NOT NULL DEFAULT '{}',
    "tahapId" TEXT NOT NULL,
    "alasanMenangKalah" TEXT,
    "ditutupPada" TIMESTAMP(3),
    "pelangganId" TEXT,
    "dikonversiPada" TIMESTAMP(3),
    "dibuatOlehId" TEXT,
    "dibuatOlehNama" TEXT NOT NULL,
    "dibuatPada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "diubahPada" TIMESTAMP(3) NOT NULL,
    "dihapusPada" TIMESTAMP(3),
    "dihapusOlehId" TEXT,
    "dihapusOlehNama" TEXT,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AktivitasLead" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "jenis" "JenisAktivitasLead" NOT NULL,
    "isi" TEXT,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "penggunaId" TEXT,
    "penggunaNama" TEXT NOT NULL,
    "dibuatPada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AktivitasLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TindakLanjut" (
    "id" TEXT NOT NULL,
    "perusahaanId" TEXT NOT NULL DEFAULT 'utama',
    "leadId" TEXT,
    "judul" TEXT NOT NULL,
    "jatuhTempo" TIMESTAMP(3) NOT NULL,
    "catatan" TEXT,
    "status" "StatusTindakLanjut" NOT NULL DEFAULT 'MENUNGGU',
    "ditugaskanKeId" TEXT,
    "diingatkanPada" TIMESTAMP(3),
    "selesaiPada" TIMESTAMP(3),
    "dibuatOlehId" TEXT,
    "dibuatOlehNama" TEXT NOT NULL,
    "dibuatPada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "diubahPada" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TindakLanjut_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KategoriAnggaran" (
    "id" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "namaKunci" TEXT NOT NULL,
    "urutan" INTEGER NOT NULL DEFAULT 1000,
    "bawaan" BOOLEAN NOT NULL DEFAULT false,
    "dibuatPada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KategoriAnggaran_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AkunKategoriAnggaran" (
    "akunId" TEXT NOT NULL,
    "kategoriId" TEXT NOT NULL,

    CONSTRAINT "AkunKategoriAnggaran_pkey" PRIMARY KEY ("akunId")
);

-- CreateTable
CREATE TABLE "BarisAnggaranProyek" (
    "id" TEXT NOT NULL,
    "proyekId" TEXT NOT NULL,
    "kategoriId" TEXT NOT NULL,
    "deskripsi" TEXT NOT NULL,
    "vendor" TEXT,
    "rencana" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "catatan" TEXT,
    "nilaiAcuan" DECIMAL(18,2),
    "sumberPenawaranId" TEXT,
    "sumberPesananId" TEXT,
    "kunciSumber" TEXT,
    "tandaSumber" TEXT,
    "disinkronPada" TIMESTAMP(3),
    "dihapusDariSumber" BOOLEAN NOT NULL DEFAULT false,
    "dibuatPada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "diubahPada" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BarisAnggaranProyek_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MitraProyek" (
    "id" TEXT NOT NULL,
    "proyekId" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "mode" "ModeBagiHasil" NOT NULL DEFAULT 'PERSEN',
    "nilai" DECIMAL(18,2) NOT NULL,
    "catatan" TEXT,
    "urutan" INTEGER NOT NULL DEFAULT 0,
    "dibuatPada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "diubahPada" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MitraProyek_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TalanganMitra" (
    "id" TEXT NOT NULL,
    "nomor" TEXT NOT NULL,
    "tanggal" TIMESTAMP(3) NOT NULL,
    "perusahaanId" TEXT NOT NULL DEFAULT 'utama',
    "proyekId" TEXT NOT NULL,
    "mitraId" TEXT NOT NULL,
    "akunBebanId" TEXT NOT NULL,
    "jumlah" DECIMAL(18,2) NOT NULL,
    "deskripsi" TEXT NOT NULL,
    "vendor" TEXT,
    "catatan" TEXT,
    "jurnalId" TEXT,
    "dicatatOlehId" TEXT,
    "dicatatOlehNama" TEXT NOT NULL,
    "dibuatPada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "statusPersetujuan" "StatusPersetujuan" NOT NULL DEFAULT 'DRAFT',
    "diajukanOlehId" TEXT,
    "diajukanPada" TIMESTAMP(3),
    "disetujuiOlehId" TEXT,
    "disetujuiPada" TIMESTAMP(3),
    "ditolakOlehId" TEXT,
    "ditolakPada" TIMESTAMP(3),
    "catatanPenolakan" TEXT,

    CONSTRAINT "TalanganMitra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PembayaranMitra" (
    "id" TEXT NOT NULL,
    "nomor" TEXT NOT NULL,
    "tanggal" TIMESTAMP(3) NOT NULL,
    "perusahaanId" TEXT NOT NULL DEFAULT 'utama',
    "proyekId" TEXT NOT NULL,
    "mitraId" TEXT NOT NULL,
    "jenis" "JenisPembayaranMitra" NOT NULL DEFAULT 'LABA',
    "jumlah" DECIMAL(18,2) NOT NULL,
    "akunKasId" TEXT NOT NULL,
    "catatan" TEXT,
    "jurnalId" TEXT,
    "dicatatOlehId" TEXT,
    "dicatatOlehNama" TEXT NOT NULL,
    "dibuatPada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "statusPersetujuan" "StatusPersetujuan" NOT NULL DEFAULT 'DRAFT',
    "diajukanOlehId" TEXT,
    "diajukanPada" TIMESTAMP(3),
    "disetujuiOlehId" TEXT,
    "disetujuiPada" TIMESTAMP(3),
    "ditolakOlehId" TEXT,
    "ditolakPada" TIMESTAMP(3),
    "catatanPenolakan" TEXT,

    CONSTRAINT "PembayaranMitra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Konten" (
    "id" TEXT NOT NULL,
    "perusahaanId" TEXT NOT NULL DEFAULT 'utama',
    "judul" TEXT NOT NULL,
    "platform" "PlatformKonten" NOT NULL DEFAULT 'INSTAGRAM',
    "jenisKonten" TEXT,
    "pilar" TEXT,
    "caption" TEXT,
    "cta" TEXT,
    "tagar" TEXT,
    "tanggalTerbit" TIMESTAMP(3),
    "jamTerbit" TEXT,
    "status" "StatusKonten" NOT NULL DEFAULT 'IDE',
    "statusPersetujuan" "StatusPersetujuanKonten" NOT NULL DEFAULT 'TIDAK_ADA',
    "smmId" TEXT,
    "desainerId" TEXT,
    "proyekId" TEXT,
    "briefDesain" TEXT,
    "catatan" TEXT,
    "dibuatOlehId" TEXT,
    "dibuatOlehNama" TEXT NOT NULL,
    "dibuatPada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "diubahPada" TIMESTAMP(3) NOT NULL,
    "diarsipkanPada" TIMESTAMP(3),
    "diarsipkanOlehNama" TEXT,

    CONSTRAINT "Konten_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiwayatPersetujuanKonten" (
    "id" TEXT NOT NULL,
    "kontenId" TEXT NOT NULL,
    "aksi" "AksiRiwayatKonten" NOT NULL,
    "masukan" TEXT,
    "penggunaId" TEXT,
    "penggunaNama" TEXT NOT NULL,
    "dibuatPada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiwayatPersetujuanKonten_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TugasDesain" (
    "id" TEXT NOT NULL,
    "perusahaanId" TEXT NOT NULL DEFAULT 'utama',
    "judul" TEXT NOT NULL,
    "deskripsi" TEXT,
    "prioritas" "PrioritasDesain" NOT NULL DEFAULT 'SEDANG',
    "tenggat" TIMESTAMP(3),
    "status" "StatusTugasDesain" NOT NULL DEFAULT 'PERMINTAAN',
    "desainerId" TEXT,
    "kontenId" TEXT,
    "kunciKontenAktif" TEXT,
    "kampanyeId" TEXT,
    "proyekId" TEXT,
    "jumlahRevisi" INTEGER NOT NULL DEFAULT 0,
    "catatanRevisi" TEXT,
    "sumber" "SumberTugasDesain" NOT NULL DEFAULT 'MANUAL',
    "dibuatOlehNama" TEXT NOT NULL,
    "dibuatPada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "diubahPada" TIMESTAMP(3) NOT NULL,
    "diarsipkanPada" TIMESTAMP(3),
    "diarsipkanOlehNama" TEXT,

    CONSTRAINT "TugasDesain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevisiDesain" (
    "id" TEXT NOT NULL,
    "tugasId" TEXT NOT NULL,
    "nomorRevisi" INTEGER NOT NULL,
    "keputusan" "KeputusanRevisiDesain" NOT NULL,
    "catatan" TEXT,
    "berkasSebelumnya" JSONB NOT NULL,
    "berkasBaru" JSONB NOT NULL,
    "peninjauId" TEXT,
    "peninjauNama" TEXT NOT NULL,
    "dibuatPada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RevisiDesain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Kampanye" (
    "id" TEXT NOT NULL,
    "perusahaanId" TEXT NOT NULL DEFAULT 'utama',
    "nama" TEXT NOT NULL,
    "tujuan" "TujuanKampanye" NOT NULL DEFAULT 'PROSPEK',
    "anggaran" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tanggalMulai" TIMESTAMP(3),
    "tanggalSelesai" TIMESTAMP(3),
    "status" "StatusKampanye" NOT NULL DEFAULT 'DIRENCANAKAN',
    "proyekId" TEXT,
    "catatan" TEXT,
    "dibuatOlehNama" TEXT NOT NULL,
    "dibuatPada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "diubahPada" TIMESTAMP(3) NOT NULL,
    "diarsipkanPada" TIMESTAMP(3),
    "diarsipkanOlehNama" TEXT,

    CONSTRAINT "Kampanye_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SetIklan" (
    "id" TEXT NOT NULL,
    "kampanyeId" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "audiens" TEXT,
    "lokasi" TEXT,
    "usia" TEXT,
    "gender" "GenderAudiens" NOT NULL DEFAULT 'SEMUA',
    "penempatan" TEXT,
    "anggaran" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "catatan" TEXT,
    "dibuatPada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "diubahPada" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SetIklan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Iklan" (
    "id" TEXT NOT NULL,
    "setIklanId" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "berkasKreatifId" TEXT,
    "teksUtama" TEXT,
    "judulIklan" TEXT,
    "cta" TEXT,
    "urlTujuan" TEXT,
    "catatan" TEXT,
    "dibuatPada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "diubahPada" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Iklan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetrikIklan" (
    "id" TEXT NOT NULL,
    "kampanyeId" TEXT NOT NULL,
    "tanggal" TIMESTAMP(3) NOT NULL,
    "belanja" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "jangkauan" INTEGER NOT NULL DEFAULT 0,
    "tayangan" INTEGER NOT NULL DEFAULT 0,
    "klik" INTEGER NOT NULL DEFAULT 0,
    "leads" INTEGER NOT NULL DEFAULT 0,
    "konversi" INTEGER NOT NULL DEFAULT 0,
    "hasil" INTEGER,
    "pendapatan" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "ctrManual" DECIMAL(18,2),
    "cpcManual" DECIMAL(18,2),
    "cpmManual" DECIMAL(18,2),
    "catatan" TEXT,
    "dicatatOlehNama" TEXT NOT NULL,
    "dibuatPada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "diubahPada" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetrikIklan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PengaturanPemasaran" (
    "perusahaanId" TEXT NOT NULL,
    "jenisKonten" TEXT[],
    "pilarKonten" TEXT[],
    "diubahOlehNama" TEXT,
    "diubahPada" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PengaturanPemasaran_pkey" PRIMARY KEY ("perusahaanId")
);

-- =====================================================================
-- Isi data lama (backfill). Setelah semua ADD COLUMN, sebelum indeks, CHECK, dan FOREIGN KEY.
-- =====================================================================

-- [D1 Sunting 3] Akun kas/bank lama milik perusahaan utama (rekonsiliasi per rekening, K2); akun lain tetap bersama (NULL)
UPDATE "Akun" SET "perusahaanId" = 'utama' WHERE "kasBank" = true AND "kelompok" = false;
-- [D1 Sunting 3] Jasa lama dijadikan jasa bersama (boleh dijual semua perusahaan); barang stok tetap milik utama (bawaan kolom)
UPDATE "Barang" SET "perusahaanId" = NULL WHERE "jenis" = 'JASA';

-- [D2 §2.5] Isi balik tautan baris yang TIDAK ambigu: barang hanya muncul sekali di induknya.
-- Baris yang ambigu dibiarkan NULL dan dilayani jalur cadangan per barangId (D2 §3.6).
UPDATE "BarisFakturPenjualan" bf
SET "barisPesananId" = bp."id"
FROM "FakturPenjualan" f, "BarisPesananPenjualan" bp
WHERE bf."fakturId" = f."id"
  AND bp."pesananId" = f."pesananId"
  AND bp."barangId" = bf."barangId"
  AND (SELECT COUNT(*) FROM "BarisPesananPenjualan" x WHERE x."pesananId" = f."pesananId" AND x."barangId" = bf."barangId") = 1;

UPDATE "BarisReturPenjualan" br
SET "barisFakturId" = bf."id"
FROM "ReturPenjualan" r, "BarisFakturPenjualan" bf
WHERE br."returId" = r."id"
  AND bf."fakturId" = r."fakturId"
  AND bf."barangId" = br."barangId"
  AND (SELECT COUNT(*) FROM "BarisFakturPenjualan" x WHERE x."fakturId" = r."fakturId" AND x."barangId" = br."barangId") = 1;

-- [D2 §2.5] Faktur lama: diskon nominal tercatat juga sebagai isian nilaiDiskon (jenisDiskon bawaan NOMINAL)
UPDATE "FakturPenjualan" SET "nilaiDiskon" = "diskon" WHERE "diskon" > 0;

-- CreateIndex
CREATE UNIQUE INDEX "Perusahaan_kode_key" ON "Perusahaan"("kode");

-- CreateIndex
CREATE INDEX "Perusahaan_aktif_urutan_idx" ON "Perusahaan"("aktif", "urutan");

-- CreateIndex
CREATE UNIQUE INDEX "TutupBukuPerusahaan_jurnalId_key" ON "TutupBukuPerusahaan"("jurnalId");

-- CreateIndex
CREATE INDEX "TutupBukuPerusahaan_perusahaanId_idx" ON "TutupBukuPerusahaan"("perusahaanId");

-- CreateIndex
CREATE UNIQUE INDEX "TutupBukuPerusahaan_tutupBukuId_perusahaanId_key" ON "TutupBukuPerusahaan"("tutupBukuId", "perusahaanId");

-- CreateIndex
CREATE UNIQUE INDEX "TransaksiAntarPerusahaan_nomor_key" ON "TransaksiAntarPerusahaan"("nomor");

-- CreateIndex
CREATE UNIQUE INDEX "TransaksiAntarPerusahaan_jurnalPemberiId_key" ON "TransaksiAntarPerusahaan"("jurnalPemberiId");

-- CreateIndex
CREATE UNIQUE INDEX "TransaksiAntarPerusahaan_jurnalPenerimaId_key" ON "TransaksiAntarPerusahaan"("jurnalPenerimaId");

-- CreateIndex
CREATE INDEX "TransaksiAntarPerusahaan_pemberiId_idx" ON "TransaksiAntarPerusahaan"("pemberiId");

-- CreateIndex
CREATE INDEX "TransaksiAntarPerusahaan_penerimaId_idx" ON "TransaksiAntarPerusahaan"("penerimaId");

-- CreateIndex
CREATE INDEX "TransaksiAntarPerusahaan_tanggal_idx" ON "TransaksiAntarPerusahaan"("tanggal");

-- CreateIndex
CREATE INDEX "TransaksiAntarPerusahaan_akunPemberiId_idx" ON "TransaksiAntarPerusahaan"("akunPemberiId");

-- CreateIndex
CREATE INDEX "TransaksiAntarPerusahaan_akunPenerimaId_idx" ON "TransaksiAntarPerusahaan"("akunPenerimaId");

-- CreateIndex
CREATE INDEX "TransaksiAntarPerusahaan_proyekPemberiId_idx" ON "TransaksiAntarPerusahaan"("proyekPemberiId");

-- CreateIndex
CREATE INDEX "TransaksiAntarPerusahaan_proyekPenerimaId_idx" ON "TransaksiAntarPerusahaan"("proyekPenerimaId");

-- CreateIndex
CREATE INDEX "TransaksiAntarPerusahaan_dicatatOlehId_idx" ON "TransaksiAntarPerusahaan"("dicatatOlehId");

-- CreateIndex
CREATE INDEX "FolderBerkas_urutan_idx" ON "FolderBerkas"("urutan");

-- CreateIndex
CREATE INDEX "Berkas_perusahaanId_folderKode_dihapusPada_idx" ON "Berkas"("perusahaanId", "folderKode", "dihapusPada");

-- CreateIndex
CREATE INDEX "Berkas_jenisEntitas_entitasId_idx" ON "Berkas"("jenisEntitas", "entitasId");

-- CreateIndex
CREATE INDEX "Berkas_proyekId_idx" ON "Berkas"("proyekId");

-- CreateIndex
CREATE INDEX "Berkas_diunggahOlehId_idx" ON "Berkas"("diunggahOlehId");

-- CreateIndex
CREATE INDEX "Berkas_dihapusOlehId_idx" ON "Berkas"("dihapusOlehId");

-- CreateIndex
CREATE INDEX "Berkas_dibuatPada_idx" ON "Berkas"("dibuatPada");

-- CreateIndex
CREATE UNIQUE INDEX "TautanBagiBerkas_tokenHash_key" ON "TautanBagiBerkas"("tokenHash");

-- CreateIndex
CREATE INDEX "TautanBagiBerkas_berkasId_idx" ON "TautanBagiBerkas"("berkasId");

-- CreateIndex
CREATE INDEX "TautanBagiBerkas_dibuatOlehId_idx" ON "TautanBagiBerkas"("dibuatOlehId");

-- CreateIndex
CREATE INDEX "TautanBagiBerkas_dicabutOlehId_idx" ON "TautanBagiBerkas"("dicabutOlehId");

-- CreateIndex
CREATE INDEX "AksesBerkasProyek_diubahOlehId_idx" ON "AksesBerkasProyek"("diubahOlehId");

-- CreateIndex
CREATE INDEX "AksesBerkasProyekPengguna_penggunaId_idx" ON "AksesBerkasProyekPengguna"("penggunaId");

-- CreateIndex
CREATE INDEX "Notifikasi_penggunaId_dibaca_dibuatPada_idx" ON "Notifikasi"("penggunaId", "dibaca", "dibuatPada");

-- CreateIndex
CREATE INDEX "Notifikasi_perusahaanId_idx" ON "Notifikasi"("perusahaanId");

-- CreateIndex
CREATE INDEX "Notifikasi_dibuatPada_idx" ON "Notifikasi"("dibuatPada");

-- CreateIndex
CREATE UNIQUE INDEX "Notifikasi_penggunaId_kunci_key" ON "Notifikasi"("penggunaId", "kunci");

-- CreateIndex
CREATE INDEX "RencanaTermin_pesananId_idx" ON "RencanaTermin"("pesananId");

-- CreateIndex
CREATE UNIQUE INDEX "RencanaTermin_penawaranId_no_key" ON "RencanaTermin"("penawaranId", "no");

-- CreateIndex
CREATE UNIQUE INDEX "RencanaTermin_pesananId_no_key" ON "RencanaTermin"("pesananId", "no");

-- CreateIndex
CREATE UNIQUE INDEX "RencanaTermin_perusahaanId_nomorCetak_key" ON "RencanaTermin"("perusahaanId", "nomorCetak");

-- CreateIndex
CREATE UNIQUE INDEX "FormatNomor_perusahaanId_jenis_key" ON "FormatNomor"("perusahaanId", "jenis");

-- CreateIndex
CREATE UNIQUE INDEX "PengaturanDokumenPenjualan_perusahaanId_key" ON "PengaturanDokumenPenjualan"("perusahaanId");

-- CreateIndex
CREATE INDEX "KopSurat_perusahaanId_dihapusPada_idx" ON "KopSurat"("perusahaanId", "dihapusPada");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateCetak_kopSuratId_jenis_key" ON "TemplateCetak"("kopSuratId", "jenis");

-- CreateIndex
CREATE UNIQUE INDEX "AsetKopSurat_berkasId_key" ON "AsetKopSurat"("berkasId");

-- CreateIndex
CREATE UNIQUE INDEX "AsetKopSurat_kopSuratId_jenis_key" ON "AsetKopSurat"("kopSuratId", "jenis");

-- CreateIndex
CREATE INDEX "TahapLead_perusahaanId_urutan_idx" ON "TahapLead"("perusahaanId", "urutan");

-- CreateIndex
CREATE UNIQUE INDEX "TahapLead_perusahaanId_nama_key" ON "TahapLead"("perusahaanId", "nama");

-- CreateIndex
CREATE INDEX "SumberLead_perusahaanId_urutan_idx" ON "SumberLead"("perusahaanId", "urutan");

-- CreateIndex
CREATE UNIQUE INDEX "SumberLead_perusahaanId_nama_key" ON "SumberLead"("perusahaanId", "nama");

-- CreateIndex
CREATE INDEX "Lead_perusahaanId_dihapusPada_dibuatPada_idx" ON "Lead"("perusahaanId", "dihapusPada", "dibuatPada");

-- CreateIndex
CREATE INDEX "Lead_tahapId_idx" ON "Lead"("tahapId");

-- CreateIndex
CREATE INDEX "Lead_picId_idx" ON "Lead"("picId");

-- CreateIndex
CREATE INDEX "Lead_pelangganId_idx" ON "Lead"("pelangganId");

-- CreateIndex
CREATE INDEX "Lead_dibuatOlehId_idx" ON "Lead"("dibuatOlehId");

-- CreateIndex
CREATE INDEX "Lead_dihapusOlehId_idx" ON "Lead"("dihapusOlehId");

-- CreateIndex
CREATE INDEX "AktivitasLead_leadId_dibuatPada_idx" ON "AktivitasLead"("leadId", "dibuatPada");

-- CreateIndex
CREATE INDEX "AktivitasLead_penggunaId_idx" ON "AktivitasLead"("penggunaId");

-- CreateIndex
CREATE INDEX "TindakLanjut_perusahaanId_status_jatuhTempo_idx" ON "TindakLanjut"("perusahaanId", "status", "jatuhTempo");

-- CreateIndex
CREATE INDEX "TindakLanjut_ditugaskanKeId_status_diingatkanPada_jatuhTemp_idx" ON "TindakLanjut"("ditugaskanKeId", "status", "diingatkanPada", "jatuhTempo");

-- CreateIndex
CREATE INDEX "TindakLanjut_leadId_jatuhTempo_idx" ON "TindakLanjut"("leadId", "jatuhTempo");

-- CreateIndex
CREATE INDEX "TindakLanjut_dibuatOlehId_idx" ON "TindakLanjut"("dibuatOlehId");

-- CreateIndex
CREATE UNIQUE INDEX "KategoriAnggaran_namaKunci_key" ON "KategoriAnggaran"("namaKunci");

-- CreateIndex
CREATE INDEX "KategoriAnggaran_urutan_idx" ON "KategoriAnggaran"("urutan");

-- CreateIndex
CREATE INDEX "AkunKategoriAnggaran_kategoriId_idx" ON "AkunKategoriAnggaran"("kategoriId");

-- CreateIndex
CREATE INDEX "BarisAnggaranProyek_proyekId_idx" ON "BarisAnggaranProyek"("proyekId");

-- CreateIndex
CREATE INDEX "BarisAnggaranProyek_kategoriId_idx" ON "BarisAnggaranProyek"("kategoriId");

-- CreateIndex
CREATE INDEX "BarisAnggaranProyek_sumberPenawaranId_idx" ON "BarisAnggaranProyek"("sumberPenawaranId");

-- CreateIndex
CREATE INDEX "BarisAnggaranProyek_sumberPesananId_idx" ON "BarisAnggaranProyek"("sumberPesananId");

-- CreateIndex
CREATE INDEX "MitraProyek_proyekId_urutan_idx" ON "MitraProyek"("proyekId", "urutan");

-- CreateIndex
CREATE UNIQUE INDEX "TalanganMitra_nomor_key" ON "TalanganMitra"("nomor");

-- CreateIndex
CREATE UNIQUE INDEX "TalanganMitra_jurnalId_key" ON "TalanganMitra"("jurnalId");

-- CreateIndex
CREATE INDEX "TalanganMitra_perusahaanId_idx" ON "TalanganMitra"("perusahaanId");

-- CreateIndex
CREATE INDEX "TalanganMitra_proyekId_idx" ON "TalanganMitra"("proyekId");

-- CreateIndex
CREATE INDEX "TalanganMitra_mitraId_idx" ON "TalanganMitra"("mitraId");

-- CreateIndex
CREATE INDEX "TalanganMitra_akunBebanId_idx" ON "TalanganMitra"("akunBebanId");

-- CreateIndex
CREATE INDEX "TalanganMitra_dicatatOlehId_idx" ON "TalanganMitra"("dicatatOlehId");

-- CreateIndex
CREATE INDEX "TalanganMitra_tanggal_idx" ON "TalanganMitra"("tanggal");

-- CreateIndex
CREATE INDEX "TalanganMitra_statusPersetujuan_idx" ON "TalanganMitra"("statusPersetujuan");

-- CreateIndex
CREATE UNIQUE INDEX "PembayaranMitra_nomor_key" ON "PembayaranMitra"("nomor");

-- CreateIndex
CREATE UNIQUE INDEX "PembayaranMitra_jurnalId_key" ON "PembayaranMitra"("jurnalId");

-- CreateIndex
CREATE INDEX "PembayaranMitra_perusahaanId_idx" ON "PembayaranMitra"("perusahaanId");

-- CreateIndex
CREATE INDEX "PembayaranMitra_proyekId_idx" ON "PembayaranMitra"("proyekId");

-- CreateIndex
CREATE INDEX "PembayaranMitra_mitraId_jenis_idx" ON "PembayaranMitra"("mitraId", "jenis");

-- CreateIndex
CREATE INDEX "PembayaranMitra_akunKasId_idx" ON "PembayaranMitra"("akunKasId");

-- CreateIndex
CREATE INDEX "PembayaranMitra_dicatatOlehId_idx" ON "PembayaranMitra"("dicatatOlehId");

-- CreateIndex
CREATE INDEX "PembayaranMitra_tanggal_idx" ON "PembayaranMitra"("tanggal");

-- CreateIndex
CREATE INDEX "PembayaranMitra_statusPersetujuan_idx" ON "PembayaranMitra"("statusPersetujuan");

-- CreateIndex
CREATE INDEX "Konten_perusahaanId_tanggalTerbit_idx" ON "Konten"("perusahaanId", "tanggalTerbit");

-- CreateIndex
CREATE INDEX "Konten_perusahaanId_status_idx" ON "Konten"("perusahaanId", "status");

-- CreateIndex
CREATE INDEX "Konten_proyekId_idx" ON "Konten"("proyekId");

-- CreateIndex
CREATE INDEX "Konten_smmId_idx" ON "Konten"("smmId");

-- CreateIndex
CREATE INDEX "Konten_desainerId_idx" ON "Konten"("desainerId");

-- CreateIndex
CREATE INDEX "Konten_dibuatOlehId_idx" ON "Konten"("dibuatOlehId");

-- CreateIndex
CREATE INDEX "Konten_diarsipkanPada_idx" ON "Konten"("diarsipkanPada");

-- CreateIndex
CREATE INDEX "RiwayatPersetujuanKonten_kontenId_dibuatPada_idx" ON "RiwayatPersetujuanKonten"("kontenId", "dibuatPada");

-- CreateIndex
CREATE UNIQUE INDEX "TugasDesain_kunciKontenAktif_key" ON "TugasDesain"("kunciKontenAktif");

-- CreateIndex
CREATE INDEX "TugasDesain_perusahaanId_status_idx" ON "TugasDesain"("perusahaanId", "status");

-- CreateIndex
CREATE INDEX "TugasDesain_desainerId_status_idx" ON "TugasDesain"("desainerId", "status");

-- CreateIndex
CREATE INDEX "TugasDesain_kontenId_idx" ON "TugasDesain"("kontenId");

-- CreateIndex
CREATE INDEX "TugasDesain_kampanyeId_idx" ON "TugasDesain"("kampanyeId");

-- CreateIndex
CREATE INDEX "TugasDesain_proyekId_idx" ON "TugasDesain"("proyekId");

-- CreateIndex
CREATE INDEX "TugasDesain_tenggat_idx" ON "TugasDesain"("tenggat");

-- CreateIndex
CREATE INDEX "TugasDesain_diarsipkanPada_idx" ON "TugasDesain"("diarsipkanPada");

-- CreateIndex
CREATE INDEX "RevisiDesain_tugasId_dibuatPada_idx" ON "RevisiDesain"("tugasId", "dibuatPada");

-- CreateIndex
CREATE INDEX "Kampanye_perusahaanId_status_idx" ON "Kampanye"("perusahaanId", "status");

-- CreateIndex
CREATE INDEX "Kampanye_proyekId_idx" ON "Kampanye"("proyekId");

-- CreateIndex
CREATE INDEX "Kampanye_diarsipkanPada_idx" ON "Kampanye"("diarsipkanPada");

-- CreateIndex
CREATE INDEX "SetIklan_kampanyeId_idx" ON "SetIklan"("kampanyeId");

-- CreateIndex
CREATE INDEX "Iklan_setIklanId_idx" ON "Iklan"("setIklanId");

-- CreateIndex
CREATE INDEX "Iklan_berkasKreatifId_idx" ON "Iklan"("berkasKreatifId");

-- CreateIndex
CREATE INDEX "MetrikIklan_tanggal_idx" ON "MetrikIklan"("tanggal");

-- CreateIndex
CREATE UNIQUE INDEX "MetrikIklan_kampanyeId_tanggal_key" ON "MetrikIklan"("kampanyeId", "tanggal");

-- CreateIndex
CREATE INDEX "Akun_perusahaanId_idx" ON "Akun"("perusahaanId");

-- CreateIndex
CREATE INDEX "AsetTetap_perusahaanId_idx" ON "AsetTetap"("perusahaanId");

-- CreateIndex
CREATE INDEX "Barang_perusahaanId_idx" ON "Barang"("perusahaanId");

-- CreateIndex
CREATE INDEX "BarisFakturPenjualan_barisPesananId_idx" ON "BarisFakturPenjualan"("barisPesananId");

-- CreateIndex
CREATE INDEX "BarisReturPenjualan_barisFakturId_idx" ON "BarisReturPenjualan"("barisFakturId");

-- CreateIndex
CREATE INDEX "DokumenKas_perusahaanId_idx" ON "DokumenKas"("perusahaanId");

-- CreateIndex
CREATE INDEX "FakturPembelian_perusahaanId_idx" ON "FakturPembelian"("perusahaanId");

-- CreateIndex
CREATE INDEX "FakturPenjualan_perusahaanId_idx" ON "FakturPenjualan"("perusahaanId");

-- CreateIndex
CREATE INDEX "FakturPenjualan_kopSuratId_idx" ON "FakturPenjualan"("kopSuratId");

-- CreateIndex
CREATE UNIQUE INDEX "FakturPenjualan_perusahaanId_nomorCetak_key" ON "FakturPenjualan"("perusahaanId", "nomorCetak");

-- CreateIndex
CREATE INDEX "Gudang_perusahaanId_idx" ON "Gudang"("perusahaanId");

-- CreateIndex
CREATE INDEX "Jurnal_perusahaanId_tanggal_idx" ON "Jurnal"("perusahaanId", "tanggal");

-- CreateIndex
CREATE INDEX "Karyawan_perusahaanId_idx" ON "Karyawan"("perusahaanId");

-- CreateIndex
CREATE INDEX "LaporanKerusakanBarang_perusahaanId_idx" ON "LaporanKerusakanBarang"("perusahaanId");

-- CreateIndex
CREATE INDEX "LogAktivitas_modul_waktu_idx" ON "LogAktivitas"("modul", "waktu");

-- CreateIndex
CREATE INDEX "LogAktivitas_aksi_waktu_idx" ON "LogAktivitas"("aksi", "waktu");

-- CreateIndex
CREATE INDEX "LogAktivitas_penggunaId_waktu_idx" ON "LogAktivitas"("penggunaId", "waktu");

-- CreateIndex
CREATE INDEX "LogAktivitas_perusahaanId_waktu_idx" ON "LogAktivitas"("perusahaanId", "waktu");

-- CreateIndex
CREATE INDEX "LogAktivitas_entitasId_idx" ON "LogAktivitas"("entitasId");

-- CreateIndex
CREATE INDEX "PembayaranPembelian_perusahaanId_idx" ON "PembayaranPembelian"("perusahaanId");

-- CreateIndex
CREATE INDEX "PeminjamanBarang_perusahaanId_idx" ON "PeminjamanBarang"("perusahaanId");

-- CreateIndex
CREATE INDEX "PenawaranPenjualan_perusahaanId_idx" ON "PenawaranPenjualan"("perusahaanId");

-- CreateIndex
CREATE INDEX "PenawaranPenjualan_kopSuratId_idx" ON "PenawaranPenjualan"("kopSuratId");

-- CreateIndex
CREATE INDEX "PenawaranPenjualan_leadId_idx" ON "PenawaranPenjualan"("leadId");

-- CreateIndex
CREATE INDEX "PenawaranPenjualan_statusKomersial_idx" ON "PenawaranPenjualan"("statusKomersial");

-- CreateIndex
CREATE UNIQUE INDEX "PenawaranPenjualan_perusahaanId_nomorCetak_key" ON "PenawaranPenjualan"("perusahaanId", "nomorCetak");

-- CreateIndex
CREATE INDEX "PenerimaanBarang_perusahaanId_idx" ON "PenerimaanBarang"("perusahaanId");

-- CreateIndex
CREATE INDEX "PenerimaanPenjualan_perusahaanId_idx" ON "PenerimaanPenjualan"("perusahaanId");

-- CreateIndex
CREATE INDEX "PenerimaanPenjualan_kopSuratId_idx" ON "PenerimaanPenjualan"("kopSuratId");

-- CreateIndex
CREATE UNIQUE INDEX "PenerimaanPenjualan_perusahaanId_nomorCetak_key" ON "PenerimaanPenjualan"("perusahaanId", "nomorCetak");

-- CreateIndex
CREATE UNIQUE INDEX "PengaturanPerusahaan_perusahaanId_key" ON "PengaturanPerusahaan"("perusahaanId");

-- CreateIndex
CREATE INDEX "PengaturanPerusahaan_akunPpnKeluaranId_idx" ON "PengaturanPerusahaan"("akunPpnKeluaranId");

-- CreateIndex
CREATE INDEX "PengaturanPerusahaan_akunPpnMasukanId_idx" ON "PengaturanPerusahaan"("akunPpnMasukanId");

-- CreateIndex
CREATE INDEX "PengaturanPerusahaan_akunPph23DimukaId_idx" ON "PengaturanPerusahaan"("akunPph23DimukaId");

-- CreateIndex
CREATE INDEX "PengaturanPerusahaan_akunPph23DipotongId_idx" ON "PengaturanPerusahaan"("akunPph23DipotongId");

-- CreateIndex
CREATE INDEX "PengaturanPerusahaan_akunBebanPphFinalId_idx" ON "PengaturanPerusahaan"("akunBebanPphFinalId");

-- CreateIndex
CREATE INDEX "PengaturanPerusahaan_akunHutangPphFinalId_idx" ON "PengaturanPerusahaan"("akunHutangPphFinalId");

-- CreateIndex
CREATE INDEX "Penggajian_perusahaanId_idx" ON "Penggajian"("perusahaanId");

-- CreateIndex
CREATE UNIQUE INDEX "Penggajian_perusahaanId_bulan_key" ON "Penggajian"("perusahaanId", "bulan");

-- CreateIndex
CREATE INDEX "PengirimanPesanan_perusahaanId_idx" ON "PengirimanPesanan"("perusahaanId");

-- CreateIndex
CREATE INDEX "PenyesuaianPersediaan_perusahaanId_idx" ON "PenyesuaianPersediaan"("perusahaanId");

-- CreateIndex
CREATE INDEX "PesananPembelian_perusahaanId_idx" ON "PesananPembelian"("perusahaanId");

-- CreateIndex
CREATE INDEX "PesananPenjualan_perusahaanId_idx" ON "PesananPenjualan"("perusahaanId");

-- CreateIndex
CREATE INDEX "PesananPenjualan_kopSuratId_idx" ON "PesananPenjualan"("kopSuratId");

-- CreateIndex
CREATE INDEX "PesananPenjualan_leadId_idx" ON "PesananPenjualan"("leadId");

-- CreateIndex
CREATE INDEX "PindahBarang_perusahaanId_idx" ON "PindahBarang"("perusahaanId");

-- CreateIndex
CREATE INDEX "PphFinalBulanan_perusahaanId_idx" ON "PphFinalBulanan"("perusahaanId");

-- CreateIndex
CREATE UNIQUE INDEX "PphFinalBulanan_perusahaanId_periode_key" ON "PphFinalBulanan"("perusahaanId", "periode");

-- CreateIndex
CREATE INDEX "Prive_perusahaanId_idx" ON "Prive"("perusahaanId");

-- CreateIndex
CREATE INDEX "Proyek_perusahaanId_idx" ON "Proyek"("perusahaanId");

-- CreateIndex
CREATE INDEX "Proyek_status_idx" ON "Proyek"("status");

-- CreateIndex
CREATE INDEX "ReturPembelian_perusahaanId_idx" ON "ReturPembelian"("perusahaanId");

-- CreateIndex
CREATE INDEX "ReturPenjualan_perusahaanId_idx" ON "ReturPenjualan"("perusahaanId");

-- CreateIndex
CREATE INDEX "Sesi_perusahaanAktifId_idx" ON "Sesi"("perusahaanAktifId");

-- CreateIndex
CREATE INDEX "UangMukaPelanggan_perusahaanId_idx" ON "UangMukaPelanggan"("perusahaanId");

-- CreateIndex
CREATE INDEX "UangMukaPelanggan_rencanaTerminId_idx" ON "UangMukaPelanggan"("rencanaTerminId");

-- CreateIndex
CREATE INDEX "UangMukaPelanggan_kopSuratId_idx" ON "UangMukaPelanggan"("kopSuratId");

-- CreateIndex
CREATE UNIQUE INDEX "UangMukaPelanggan_perusahaanId_nomorCetak_key" ON "UangMukaPelanggan"("perusahaanId", "nomorCetak");

-- AddForeignKey
ALTER TABLE "Sesi" ADD CONSTRAINT "Sesi_perusahaanAktifId_fkey" FOREIGN KEY ("perusahaanAktifId") REFERENCES "Perusahaan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TutupBukuPerusahaan" ADD CONSTRAINT "TutupBukuPerusahaan_tutupBukuId_fkey" FOREIGN KEY ("tutupBukuId") REFERENCES "TutupBuku"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TutupBukuPerusahaan" ADD CONSTRAINT "TutupBukuPerusahaan_perusahaanId_fkey" FOREIGN KEY ("perusahaanId") REFERENCES "Perusahaan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TutupBukuPerusahaan" ADD CONSTRAINT "TutupBukuPerusahaan_jurnalId_fkey" FOREIGN KEY ("jurnalId") REFERENCES "Jurnal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransaksiAntarPerusahaan" ADD CONSTRAINT "TransaksiAntarPerusahaan_pemberiId_fkey" FOREIGN KEY ("pemberiId") REFERENCES "Perusahaan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransaksiAntarPerusahaan" ADD CONSTRAINT "TransaksiAntarPerusahaan_penerimaId_fkey" FOREIGN KEY ("penerimaId") REFERENCES "Perusahaan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransaksiAntarPerusahaan" ADD CONSTRAINT "TransaksiAntarPerusahaan_akunPemberiId_fkey" FOREIGN KEY ("akunPemberiId") REFERENCES "Akun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransaksiAntarPerusahaan" ADD CONSTRAINT "TransaksiAntarPerusahaan_akunPenerimaId_fkey" FOREIGN KEY ("akunPenerimaId") REFERENCES "Akun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransaksiAntarPerusahaan" ADD CONSTRAINT "TransaksiAntarPerusahaan_proyekPemberiId_fkey" FOREIGN KEY ("proyekPemberiId") REFERENCES "Proyek"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransaksiAntarPerusahaan" ADD CONSTRAINT "TransaksiAntarPerusahaan_proyekPenerimaId_fkey" FOREIGN KEY ("proyekPenerimaId") REFERENCES "Proyek"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransaksiAntarPerusahaan" ADD CONSTRAINT "TransaksiAntarPerusahaan_jurnalPemberiId_fkey" FOREIGN KEY ("jurnalPemberiId") REFERENCES "Jurnal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransaksiAntarPerusahaan" ADD CONSTRAINT "TransaksiAntarPerusahaan_jurnalPenerimaId_fkey" FOREIGN KEY ("jurnalPenerimaId") REFERENCES "Jurnal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransaksiAntarPerusahaan" ADD CONSTRAINT "TransaksiAntarPerusahaan_dicatatOlehId_fkey" FOREIGN KEY ("dicatatOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Karyawan" ADD CONSTRAINT "Karyawan_perusahaanId_fkey" FOREIGN KEY ("perusahaanId") REFERENCES "Perusahaan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proyek" ADD CONSTRAINT "Proyek_perusahaanId_fkey" FOREIGN KEY ("perusahaanId") REFERENCES "Perusahaan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gudang" ADD CONSTRAINT "Gudang_perusahaanId_fkey" FOREIGN KEY ("perusahaanId") REFERENCES "Perusahaan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Barang" ADD CONSTRAINT "Barang_perusahaanId_fkey" FOREIGN KEY ("perusahaanId") REFERENCES "Perusahaan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PenawaranPenjualan" ADD CONSTRAINT "PenawaranPenjualan_perusahaanId_fkey" FOREIGN KEY ("perusahaanId") REFERENCES "Perusahaan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PenawaranPenjualan" ADD CONSTRAINT "PenawaranPenjualan_kopSuratId_fkey" FOREIGN KEY ("kopSuratId") REFERENCES "KopSurat"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PenawaranPenjualan" ADD CONSTRAINT "PenawaranPenjualan_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PesananPenjualan" ADD CONSTRAINT "PesananPenjualan_perusahaanId_fkey" FOREIGN KEY ("perusahaanId") REFERENCES "Perusahaan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PesananPenjualan" ADD CONSTRAINT "PesananPenjualan_kopSuratId_fkey" FOREIGN KEY ("kopSuratId") REFERENCES "KopSurat"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PesananPenjualan" ADD CONSTRAINT "PesananPenjualan_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PengirimanPesanan" ADD CONSTRAINT "PengirimanPesanan_perusahaanId_fkey" FOREIGN KEY ("perusahaanId") REFERENCES "Perusahaan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FakturPenjualan" ADD CONSTRAINT "FakturPenjualan_perusahaanId_fkey" FOREIGN KEY ("perusahaanId") REFERENCES "Perusahaan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FakturPenjualan" ADD CONSTRAINT "FakturPenjualan_kopSuratId_fkey" FOREIGN KEY ("kopSuratId") REFERENCES "KopSurat"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarisFakturPenjualan" ADD CONSTRAINT "BarisFakturPenjualan_barisPesananId_fkey" FOREIGN KEY ("barisPesananId") REFERENCES "BarisPesananPenjualan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UangMukaPelanggan" ADD CONSTRAINT "UangMukaPelanggan_perusahaanId_fkey" FOREIGN KEY ("perusahaanId") REFERENCES "Perusahaan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UangMukaPelanggan" ADD CONSTRAINT "UangMukaPelanggan_rencanaTerminId_fkey" FOREIGN KEY ("rencanaTerminId") REFERENCES "RencanaTermin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UangMukaPelanggan" ADD CONSTRAINT "UangMukaPelanggan_kopSuratId_fkey" FOREIGN KEY ("kopSuratId") REFERENCES "KopSurat"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PenerimaanPenjualan" ADD CONSTRAINT "PenerimaanPenjualan_perusahaanId_fkey" FOREIGN KEY ("perusahaanId") REFERENCES "Perusahaan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PenerimaanPenjualan" ADD CONSTRAINT "PenerimaanPenjualan_kopSuratId_fkey" FOREIGN KEY ("kopSuratId") REFERENCES "KopSurat"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturPenjualan" ADD CONSTRAINT "ReturPenjualan_perusahaanId_fkey" FOREIGN KEY ("perusahaanId") REFERENCES "Perusahaan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarisReturPenjualan" ADD CONSTRAINT "BarisReturPenjualan_barisFakturId_fkey" FOREIGN KEY ("barisFakturId") REFERENCES "BarisFakturPenjualan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PesananPembelian" ADD CONSTRAINT "PesananPembelian_perusahaanId_fkey" FOREIGN KEY ("perusahaanId") REFERENCES "Perusahaan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PenerimaanBarang" ADD CONSTRAINT "PenerimaanBarang_perusahaanId_fkey" FOREIGN KEY ("perusahaanId") REFERENCES "Perusahaan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FakturPembelian" ADD CONSTRAINT "FakturPembelian_perusahaanId_fkey" FOREIGN KEY ("perusahaanId") REFERENCES "Perusahaan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PembayaranPembelian" ADD CONSTRAINT "PembayaranPembelian_perusahaanId_fkey" FOREIGN KEY ("perusahaanId") REFERENCES "Perusahaan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturPembelian" ADD CONSTRAINT "ReturPembelian_perusahaanId_fkey" FOREIGN KEY ("perusahaanId") REFERENCES "Perusahaan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Akun" ADD CONSTRAINT "Akun_perusahaanId_fkey" FOREIGN KEY ("perusahaanId") REFERENCES "Perusahaan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Jurnal" ADD CONSTRAINT "Jurnal_perusahaanId_fkey" FOREIGN KEY ("perusahaanId") REFERENCES "Perusahaan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DokumenKas" ADD CONSTRAINT "DokumenKas_perusahaanId_fkey" FOREIGN KEY ("perusahaanId") REFERENCES "Perusahaan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AsetTetap" ADD CONSTRAINT "AsetTetap_perusahaanId_fkey" FOREIGN KEY ("perusahaanId") REFERENCES "Perusahaan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PindahBarang" ADD CONSTRAINT "PindahBarang_perusahaanId_fkey" FOREIGN KEY ("perusahaanId") REFERENCES "Perusahaan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PenyesuaianPersediaan" ADD CONSTRAINT "PenyesuaianPersediaan_perusahaanId_fkey" FOREIGN KEY ("perusahaanId") REFERENCES "Perusahaan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeminjamanBarang" ADD CONSTRAINT "PeminjamanBarang_perusahaanId_fkey" FOREIGN KEY ("perusahaanId") REFERENCES "Perusahaan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaporanKerusakanBarang" ADD CONSTRAINT "LaporanKerusakanBarang_perusahaanId_fkey" FOREIGN KEY ("perusahaanId") REFERENCES "Perusahaan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PengaturanPerusahaan" ADD CONSTRAINT "PengaturanPerusahaan_perusahaanId_fkey" FOREIGN KEY ("perusahaanId") REFERENCES "Perusahaan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PphFinalBulanan" ADD CONSTRAINT "PphFinalBulanan_perusahaanId_fkey" FOREIGN KEY ("perusahaanId") REFERENCES "Perusahaan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prive" ADD CONSTRAINT "Prive_perusahaanId_fkey" FOREIGN KEY ("perusahaanId") REFERENCES "Perusahaan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Penggajian" ADD CONSTRAINT "Penggajian_perusahaanId_fkey" FOREIGN KEY ("perusahaanId") REFERENCES "Perusahaan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Berkas" ADD CONSTRAINT "Berkas_perusahaanId_fkey" FOREIGN KEY ("perusahaanId") REFERENCES "Perusahaan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Berkas" ADD CONSTRAINT "Berkas_folderKode_fkey" FOREIGN KEY ("folderKode") REFERENCES "FolderBerkas"("kode") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Berkas" ADD CONSTRAINT "Berkas_proyekId_fkey" FOREIGN KEY ("proyekId") REFERENCES "Proyek"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Berkas" ADD CONSTRAINT "Berkas_diunggahOlehId_fkey" FOREIGN KEY ("diunggahOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Berkas" ADD CONSTRAINT "Berkas_dihapusOlehId_fkey" FOREIGN KEY ("dihapusOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IsiBerkas" ADD CONSTRAINT "IsiBerkas_berkasId_fkey" FOREIGN KEY ("berkasId") REFERENCES "Berkas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TautanBagiBerkas" ADD CONSTRAINT "TautanBagiBerkas_berkasId_fkey" FOREIGN KEY ("berkasId") REFERENCES "Berkas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TautanBagiBerkas" ADD CONSTRAINT "TautanBagiBerkas_dibuatOlehId_fkey" FOREIGN KEY ("dibuatOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TautanBagiBerkas" ADD CONSTRAINT "TautanBagiBerkas_dicabutOlehId_fkey" FOREIGN KEY ("dicabutOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AksesBerkasProyek" ADD CONSTRAINT "AksesBerkasProyek_proyekId_fkey" FOREIGN KEY ("proyekId") REFERENCES "Proyek"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AksesBerkasProyek" ADD CONSTRAINT "AksesBerkasProyek_diubahOlehId_fkey" FOREIGN KEY ("diubahOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AksesBerkasProyekPengguna" ADD CONSTRAINT "AksesBerkasProyekPengguna_proyekId_fkey" FOREIGN KEY ("proyekId") REFERENCES "AksesBerkasProyek"("proyekId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AksesBerkasProyekPengguna" ADD CONSTRAINT "AksesBerkasProyekPengguna_penggunaId_fkey" FOREIGN KEY ("penggunaId") REFERENCES "Pengguna"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notifikasi" ADD CONSTRAINT "Notifikasi_penggunaId_fkey" FOREIGN KEY ("penggunaId") REFERENCES "Pengguna"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notifikasi" ADD CONSTRAINT "Notifikasi_perusahaanId_fkey" FOREIGN KEY ("perusahaanId") REFERENCES "Perusahaan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RencanaTermin" ADD CONSTRAINT "RencanaTermin_perusahaanId_fkey" FOREIGN KEY ("perusahaanId") REFERENCES "Perusahaan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RencanaTermin" ADD CONSTRAINT "RencanaTermin_penawaranId_fkey" FOREIGN KEY ("penawaranId") REFERENCES "PenawaranPenjualan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RencanaTermin" ADD CONSTRAINT "RencanaTermin_pesananId_fkey" FOREIGN KEY ("pesananId") REFERENCES "PesananPenjualan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormatNomor" ADD CONSTRAINT "FormatNomor_perusahaanId_fkey" FOREIGN KEY ("perusahaanId") REFERENCES "Perusahaan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PenghitungNomor" ADD CONSTRAINT "PenghitungNomor_perusahaanId_fkey" FOREIGN KEY ("perusahaanId") REFERENCES "Perusahaan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PengaturanDokumenPenjualan" ADD CONSTRAINT "PengaturanDokumenPenjualan_perusahaanId_fkey" FOREIGN KEY ("perusahaanId") REFERENCES "Perusahaan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KopSurat" ADD CONSTRAINT "KopSurat_perusahaanId_fkey" FOREIGN KEY ("perusahaanId") REFERENCES "Perusahaan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateCetak" ADD CONSTRAINT "TemplateCetak_kopSuratId_fkey" FOREIGN KEY ("kopSuratId") REFERENCES "KopSurat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AsetKopSurat" ADD CONSTRAINT "AsetKopSurat_kopSuratId_fkey" FOREIGN KEY ("kopSuratId") REFERENCES "KopSurat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AsetKopSurat" ADD CONSTRAINT "AsetKopSurat_berkasId_fkey" FOREIGN KEY ("berkasId") REFERENCES "Berkas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TahapLead" ADD CONSTRAINT "TahapLead_perusahaanId_fkey" FOREIGN KEY ("perusahaanId") REFERENCES "Perusahaan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SumberLead" ADD CONSTRAINT "SumberLead_perusahaanId_fkey" FOREIGN KEY ("perusahaanId") REFERENCES "Perusahaan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_perusahaanId_fkey" FOREIGN KEY ("perusahaanId") REFERENCES "Perusahaan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_picId_fkey" FOREIGN KEY ("picId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_tahapId_fkey" FOREIGN KEY ("tahapId") REFERENCES "TahapLead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_pelangganId_fkey" FOREIGN KEY ("pelangganId") REFERENCES "Pelanggan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_dibuatOlehId_fkey" FOREIGN KEY ("dibuatOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_dihapusOlehId_fkey" FOREIGN KEY ("dihapusOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AktivitasLead" ADD CONSTRAINT "AktivitasLead_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AktivitasLead" ADD CONSTRAINT "AktivitasLead_penggunaId_fkey" FOREIGN KEY ("penggunaId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TindakLanjut" ADD CONSTRAINT "TindakLanjut_perusahaanId_fkey" FOREIGN KEY ("perusahaanId") REFERENCES "Perusahaan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TindakLanjut" ADD CONSTRAINT "TindakLanjut_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TindakLanjut" ADD CONSTRAINT "TindakLanjut_ditugaskanKeId_fkey" FOREIGN KEY ("ditugaskanKeId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TindakLanjut" ADD CONSTRAINT "TindakLanjut_dibuatOlehId_fkey" FOREIGN KEY ("dibuatOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AkunKategoriAnggaran" ADD CONSTRAINT "AkunKategoriAnggaran_akunId_fkey" FOREIGN KEY ("akunId") REFERENCES "Akun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AkunKategoriAnggaran" ADD CONSTRAINT "AkunKategoriAnggaran_kategoriId_fkey" FOREIGN KEY ("kategoriId") REFERENCES "KategoriAnggaran"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarisAnggaranProyek" ADD CONSTRAINT "BarisAnggaranProyek_proyekId_fkey" FOREIGN KEY ("proyekId") REFERENCES "Proyek"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarisAnggaranProyek" ADD CONSTRAINT "BarisAnggaranProyek_kategoriId_fkey" FOREIGN KEY ("kategoriId") REFERENCES "KategoriAnggaran"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarisAnggaranProyek" ADD CONSTRAINT "BarisAnggaranProyek_sumberPenawaranId_fkey" FOREIGN KEY ("sumberPenawaranId") REFERENCES "PenawaranPenjualan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarisAnggaranProyek" ADD CONSTRAINT "BarisAnggaranProyek_sumberPesananId_fkey" FOREIGN KEY ("sumberPesananId") REFERENCES "PesananPenjualan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MitraProyek" ADD CONSTRAINT "MitraProyek_proyekId_fkey" FOREIGN KEY ("proyekId") REFERENCES "Proyek"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalanganMitra" ADD CONSTRAINT "TalanganMitra_perusahaanId_fkey" FOREIGN KEY ("perusahaanId") REFERENCES "Perusahaan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalanganMitra" ADD CONSTRAINT "TalanganMitra_proyekId_fkey" FOREIGN KEY ("proyekId") REFERENCES "Proyek"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalanganMitra" ADD CONSTRAINT "TalanganMitra_mitraId_fkey" FOREIGN KEY ("mitraId") REFERENCES "MitraProyek"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalanganMitra" ADD CONSTRAINT "TalanganMitra_akunBebanId_fkey" FOREIGN KEY ("akunBebanId") REFERENCES "Akun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalanganMitra" ADD CONSTRAINT "TalanganMitra_jurnalId_fkey" FOREIGN KEY ("jurnalId") REFERENCES "Jurnal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalanganMitra" ADD CONSTRAINT "TalanganMitra_dicatatOlehId_fkey" FOREIGN KEY ("dicatatOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalanganMitra" ADD CONSTRAINT "TalanganMitra_diajukanOlehId_fkey" FOREIGN KEY ("diajukanOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalanganMitra" ADD CONSTRAINT "TalanganMitra_disetujuiOlehId_fkey" FOREIGN KEY ("disetujuiOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TalanganMitra" ADD CONSTRAINT "TalanganMitra_ditolakOlehId_fkey" FOREIGN KEY ("ditolakOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PembayaranMitra" ADD CONSTRAINT "PembayaranMitra_perusahaanId_fkey" FOREIGN KEY ("perusahaanId") REFERENCES "Perusahaan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PembayaranMitra" ADD CONSTRAINT "PembayaranMitra_proyekId_fkey" FOREIGN KEY ("proyekId") REFERENCES "Proyek"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PembayaranMitra" ADD CONSTRAINT "PembayaranMitra_mitraId_fkey" FOREIGN KEY ("mitraId") REFERENCES "MitraProyek"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PembayaranMitra" ADD CONSTRAINT "PembayaranMitra_akunKasId_fkey" FOREIGN KEY ("akunKasId") REFERENCES "Akun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PembayaranMitra" ADD CONSTRAINT "PembayaranMitra_jurnalId_fkey" FOREIGN KEY ("jurnalId") REFERENCES "Jurnal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PembayaranMitra" ADD CONSTRAINT "PembayaranMitra_dicatatOlehId_fkey" FOREIGN KEY ("dicatatOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PembayaranMitra" ADD CONSTRAINT "PembayaranMitra_diajukanOlehId_fkey" FOREIGN KEY ("diajukanOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PembayaranMitra" ADD CONSTRAINT "PembayaranMitra_disetujuiOlehId_fkey" FOREIGN KEY ("disetujuiOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PembayaranMitra" ADD CONSTRAINT "PembayaranMitra_ditolakOlehId_fkey" FOREIGN KEY ("ditolakOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Konten" ADD CONSTRAINT "Konten_perusahaanId_fkey" FOREIGN KEY ("perusahaanId") REFERENCES "Perusahaan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Konten" ADD CONSTRAINT "Konten_smmId_fkey" FOREIGN KEY ("smmId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Konten" ADD CONSTRAINT "Konten_desainerId_fkey" FOREIGN KEY ("desainerId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Konten" ADD CONSTRAINT "Konten_proyekId_fkey" FOREIGN KEY ("proyekId") REFERENCES "Proyek"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Konten" ADD CONSTRAINT "Konten_dibuatOlehId_fkey" FOREIGN KEY ("dibuatOlehId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiwayatPersetujuanKonten" ADD CONSTRAINT "RiwayatPersetujuanKonten_kontenId_fkey" FOREIGN KEY ("kontenId") REFERENCES "Konten"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TugasDesain" ADD CONSTRAINT "TugasDesain_perusahaanId_fkey" FOREIGN KEY ("perusahaanId") REFERENCES "Perusahaan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TugasDesain" ADD CONSTRAINT "TugasDesain_desainerId_fkey" FOREIGN KEY ("desainerId") REFERENCES "Pengguna"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TugasDesain" ADD CONSTRAINT "TugasDesain_kontenId_fkey" FOREIGN KEY ("kontenId") REFERENCES "Konten"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TugasDesain" ADD CONSTRAINT "TugasDesain_kampanyeId_fkey" FOREIGN KEY ("kampanyeId") REFERENCES "Kampanye"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TugasDesain" ADD CONSTRAINT "TugasDesain_proyekId_fkey" FOREIGN KEY ("proyekId") REFERENCES "Proyek"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevisiDesain" ADD CONSTRAINT "RevisiDesain_tugasId_fkey" FOREIGN KEY ("tugasId") REFERENCES "TugasDesain"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Kampanye" ADD CONSTRAINT "Kampanye_perusahaanId_fkey" FOREIGN KEY ("perusahaanId") REFERENCES "Perusahaan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Kampanye" ADD CONSTRAINT "Kampanye_proyekId_fkey" FOREIGN KEY ("proyekId") REFERENCES "Proyek"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetIklan" ADD CONSTRAINT "SetIklan_kampanyeId_fkey" FOREIGN KEY ("kampanyeId") REFERENCES "Kampanye"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Iklan" ADD CONSTRAINT "Iklan_setIklanId_fkey" FOREIGN KEY ("setIklanId") REFERENCES "SetIklan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Iklan" ADD CONSTRAINT "Iklan_berkasKreatifId_fkey" FOREIGN KEY ("berkasKreatifId") REFERENCES "Berkas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetrikIklan" ADD CONSTRAINT "MetrikIklan_kampanyeId_fkey" FOREIGN KEY ("kampanyeId") REFERENCES "Kampanye"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PengaturanPemasaran" ADD CONSTRAINT "PengaturanPemasaran_perusahaanId_fkey" FOREIGN KEY ("perusahaanId") REFERENCES "Perusahaan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =====================================================================
-- SQL tangan (tidak dikenal Prisma, jadi tidak muncul di `migrate diff` berikutnya)
-- =====================================================================

-- [D1 Sunting 4] Barang stok wajib milik satu perusahaan (harga pokok rata-rata per barang = per perusahaan, K3)
ALTER TABLE "Barang" ADD CONSTRAINT "Barang_barang_wajib_milik_perusahaan" CHECK ("jenis" <> 'BARANG' OR "perusahaanId" IS NOT NULL);

-- [D2] Rencana termin milik tepat satu dokumen (penawaran ATAU pesanan) dan bernomor 1..4
ALTER TABLE "RencanaTermin" ADD CONSTRAINT "RencanaTermin_satu_induk" CHECK (("penawaranId" IS NULL) <> ("pesananId" IS NULL));
ALTER TABLE "RencanaTermin" ADD CONSTRAINT "RencanaTermin_no_1_sampai_4" CHECK ("no" BETWEEN 1 AND 4);
ALTER TABLE "RencanaTermin" ADD CONSTRAINT "RencanaTermin_jumlah_positif" CHECK ("jumlah" > 0);
-- [D2] Frekuensi hanya pengali nilai uang; nol atau negatif selalu galat aplikasi
ALTER TABLE "BarisPenawaranPenjualan" ADD CONSTRAINT "BarisPenawaranPenjualan_frekuensi_positif" CHECK ("frekuensi" > 0);
ALTER TABLE "BarisPesananPenjualan" ADD CONSTRAINT "BarisPesananPenjualan_frekuensi_positif" CHECK ("frekuensi" > 0);
ALTER TABLE "BarisFakturPenjualan" ADD CONSTRAINT "BarisFakturPenjualan_frekuensi_positif" CHECK ("frekuensi" > 0);
ALTER TABLE "FormatNomor" ADD CONSTRAINT "FormatNomor_digit_3_sampai_8" CHECK ("digit" BETWEEN 3 AND 8);

-- [D4] Nilai estimasi lead tidak boleh negatif (aplikasi juga memeriksa sebelum menyimpan)
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_nilaiEstimasi_tidak_negatif" CHECK ("nilaiEstimasi" >= 0);
-- [D4] Urutan tahap pipeline dimulai dari 1
ALTER TABLE "TahapLead" ADD CONSTRAINT "TahapLead_urutan_positif" CHECK ("urutan" >= 1);

-- [D5] Rencana biaya tidak negatif; aplikasi juga memeriksa
ALTER TABLE "BarisAnggaranProyek" ADD CONSTRAINT "BarisAnggaranProyek_rencana_tidak_negatif" CHECK ("rencana" >= 0);
-- [D5] Satu baris anggaran paling banyak punya satu dokumen sumber
ALTER TABLE "BarisAnggaranProyek" ADD CONSTRAINT "BarisAnggaranProyek_satu_sumber" CHECK ("sumberPenawaranId" IS NULL OR "sumberPesananId" IS NULL);
-- [D5] Nilai mitra positif; persen paling besar 100
ALTER TABLE "MitraProyek" ADD CONSTRAINT "MitraProyek_nilai_positif" CHECK ("nilai" > 0);
ALTER TABLE "MitraProyek" ADD CONSTRAINT "MitraProyek_persen_maks_100" CHECK ("mode" <> 'PERSEN' OR "nilai" <= 100);
-- [D5] Dokumen mitra selalu bernilai positif
ALTER TABLE "TalanganMitra" ADD CONSTRAINT "TalanganMitra_jumlah_positif" CHECK ("jumlah" > 0);
ALTER TABLE "PembayaranMitra" ADD CONSTRAINT "PembayaranMitra_jumlah_positif" CHECK ("jumlah" > 0);
-- [D5] Warna proyek #rrggbb (kolom baru, semua baris lama NULL)
ALTER TABLE "Proyek" ADD CONSTRAINT "Proyek_warna_hex" CHECK ("warna" IS NULL OR "warna" ~ '^#[0-9a-f]{6}$');

-- [D6] Pengaman kunci "satu tugas aktif per konten": kunci hanya boleh kosong atau sama dengan kontenId
ALTER TABLE "TugasDesain" ADD CONSTRAINT "TugasDesain_kunci_konten_cocok" CHECK ("kunciKontenAktif" IS NULL OR "kunciKontenAktif" = "kontenId");
-- [D6] Jam terbit tanpa tanggal tidak bermakna
ALTER TABLE "Konten" ADD CONSTRAINT "Konten_jam_butuh_tanggal" CHECK ("jamTerbit" IS NULL OR "tanggalTerbit" IS NOT NULL);
-- [D6] Angka perencanaan iklan tidak boleh negatif
ALTER TABLE "Kampanye" ADD CONSTRAINT "Kampanye_anggaran_tidak_negatif" CHECK ("anggaran" >= 0);
ALTER TABLE "SetIklan" ADD CONSTRAINT "SetIklan_anggaran_tidak_negatif" CHECK ("anggaran" >= 0);
ALTER TABLE "MetrikIklan" ADD CONSTRAINT "MetrikIklan_angka_tidak_negatif" CHECK (
  "belanja" >= 0 AND "pendapatan" >= 0 AND "jangkauan" >= 0 AND "tayangan" >= 0 AND "klik" >= 0
  AND "leads" >= 0 AND "konversi" >= 0 AND ("hasil" IS NULL OR "hasil" >= 0)
  AND ("ctrManual" IS NULL OR "ctrManual" >= 0) AND ("cpcManual" IS NULL OR "cpcManual" >= 0) AND ("cpmManual" IS NULL OR "cpmManual" >= 0)
);
-- [D6] Riwayat revisi tidak pernah negatif
ALTER TABLE "TugasDesain" ADD CONSTRAINT "TugasDesain_jumlah_revisi_tidak_negatif" CHECK ("jumlahRevisi" >= 0);

-- [D7] Isi berkas sudah terkompresi (JPEG/PNG/PDF/MP4/ZIP): jangan coba kompres pglz, simpan apa adanya di TOAST
ALTER TABLE "IsiBerkas" ALTER COLUMN "isi" SET STORAGE EXTERNAL;

-- [D7] Pengaman lapisan basis data (aplikasi sudah memvalidasi lebih dulu dengan pesan ramah)
ALTER TABLE "Berkas" ADD CONSTRAINT "Berkas_ukuran_dalam_batas" CHECK ("ukuran" > 0 AND "ukuran" <= 26214400);
ALTER TABLE "FolderBerkas" ADD CONSTRAINT "FolderBerkas_kode_format" CHECK ("kode" ~ '^[A-Z][A-Z0-9_]{1,29}$');
ALTER TABLE "Notifikasi" ADD CONSTRAINT "Notifikasi_tautan_internal" CHECK ("tautan" IS NULL OR ("tautan" LIKE '/%' AND "tautan" NOT LIKE '//%'));

-- [D7] Folder sistem (S05 §11.1 + Keuangan yang dipakai HKA tapi tidak ada di daftarnya + Kop untuk aset D3).
-- Bawaan pembatasan meniru HKA {"Invoices": ["admin"], "Receipts": ["admin"]}; Kasir ikut karena Kasir Produksia membuat faktur dan penerimaan.
-- Berkas.folderKode berbawaan 'LAINNYA', jadi baris itu wajib ada sebelum berkas pertama disimpan.
INSERT INTO "FolderBerkas" ("kode", "nama", "urutan", "sistem", "terbatas", "peranBoleh", "diubahPada") VALUES
  ('DOKUMEN',  'Dokumen',        1,  true, false, '{}', NOW()),
  ('PENAWARAN','Penawaran',      2,  true, false, '{}', NOW()),
  ('FAKTUR',   'Faktur',         3,  true, true,  '{ADMIN,KASIR}', NOW()),
  ('KUITANSI', 'Kuitansi',       4,  true, true,  '{ADMIN,KASIR}', NOW()),
  ('KEUANGAN', 'Keuangan',       5,  true, false, '{}', NOW()),
  ('SOSMED',   'Media Sosial',   6,  true, false, '{}', NOW()),
  ('IKLAN',    'Iklan',          7,  true, false, '{}', NOW()),
  ('DESAIN',   'Desain',         8,  true, false, '{}', NOW()),
  ('KOP',      'Kop & Template', 9,  true, false, '{}', NOW()),
  ('LAINNYA',  'Lainnya',        10, true, false, '{}', NOW());
