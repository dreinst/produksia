-- CreateIndex
CREATE INDEX "Akun_indukId_idx" ON "Akun"("indukId");

-- CreateIndex
CREATE INDEX "AsetTetap_akunAsetId_idx" ON "AsetTetap"("akunAsetId");

-- CreateIndex
CREATE INDEX "AsetTetap_akunBebanPenyusutanId_idx" ON "AsetTetap"("akunBebanPenyusutanId");

-- CreateIndex
CREATE INDEX "AsetTetap_akunAkumulasiPenyusutanId_idx" ON "AsetTetap"("akunAkumulasiPenyusutanId");

-- CreateIndex
CREATE INDEX "AsetTetap_akunPembayaranId_idx" ON "AsetTetap"("akunPembayaranId");

-- CreateIndex
CREATE INDEX "Barang_kelompokId_idx" ON "Barang"("kelompokId");

-- CreateIndex
CREATE INDEX "Barang_akunPendapatanId_idx" ON "Barang"("akunPendapatanId");

-- CreateIndex
CREATE INDEX "Barang_akunHppId_idx" ON "Barang"("akunHppId");

-- CreateIndex
CREATE INDEX "Barang_akunPersediaanId_idx" ON "Barang"("akunPersediaanId");

-- CreateIndex
CREATE INDEX "Barang_akunBebanId_idx" ON "Barang"("akunBebanId");

-- CreateIndex
CREATE INDEX "BarisFakturPembelian_fakturId_idx" ON "BarisFakturPembelian"("fakturId");

-- CreateIndex
CREATE INDEX "BarisFakturPembelian_barangId_idx" ON "BarisFakturPembelian"("barangId");

-- CreateIndex
CREATE INDEX "BarisFakturPenjualan_fakturId_idx" ON "BarisFakturPenjualan"("fakturId");

-- CreateIndex
CREATE INDEX "BarisFakturPenjualan_barangId_idx" ON "BarisFakturPenjualan"("barangId");

-- CreateIndex
CREATE INDEX "BarisJurnal_jurnalId_idx" ON "BarisJurnal"("jurnalId");

-- CreateIndex
CREATE INDEX "BarisJurnal_akunId_idx" ON "BarisJurnal"("akunId");

-- CreateIndex
CREATE INDEX "BarisPenawaranPenjualan_penawaranId_idx" ON "BarisPenawaranPenjualan"("penawaranId");

-- CreateIndex
CREATE INDEX "BarisPenawaranPenjualan_barangId_idx" ON "BarisPenawaranPenjualan"("barangId");

-- CreateIndex
CREATE INDEX "BarisPenerimaanBarang_penerimaanId_idx" ON "BarisPenerimaanBarang"("penerimaanId");

-- CreateIndex
CREATE INDEX "BarisPenerimaanBarang_barisPesananId_idx" ON "BarisPenerimaanBarang"("barisPesananId");

-- CreateIndex
CREATE INDEX "BarisPenerimaanBarang_barangId_idx" ON "BarisPenerimaanBarang"("barangId");

-- CreateIndex
CREATE INDEX "BarisPengiriman_pengirimanId_idx" ON "BarisPengiriman"("pengirimanId");

-- CreateIndex
CREATE INDEX "BarisPengiriman_barisPesananId_idx" ON "BarisPengiriman"("barisPesananId");

-- CreateIndex
CREATE INDEX "BarisPengiriman_barangId_idx" ON "BarisPengiriman"("barangId");

-- CreateIndex
CREATE INDEX "BarisPenyesuaianPersediaan_penyesuaianId_idx" ON "BarisPenyesuaianPersediaan"("penyesuaianId");

-- CreateIndex
CREATE INDEX "BarisPenyesuaianPersediaan_barangId_idx" ON "BarisPenyesuaianPersediaan"("barangId");

-- CreateIndex
CREATE INDEX "BarisPesananPembelian_pesananId_idx" ON "BarisPesananPembelian"("pesananId");

-- CreateIndex
CREATE INDEX "BarisPesananPembelian_barangId_idx" ON "BarisPesananPembelian"("barangId");

-- CreateIndex
CREATE INDEX "BarisPesananPenjualan_pesananId_idx" ON "BarisPesananPenjualan"("pesananId");

-- CreateIndex
CREATE INDEX "BarisPesananPenjualan_barangId_idx" ON "BarisPesananPenjualan"("barangId");

-- CreateIndex
CREATE INDEX "BarisPindahBarang_pindahId_idx" ON "BarisPindahBarang"("pindahId");

-- CreateIndex
CREATE INDEX "BarisPindahBarang_barangId_idx" ON "BarisPindahBarang"("barangId");

-- CreateIndex
CREATE INDEX "BarisReturPembelian_returId_idx" ON "BarisReturPembelian"("returId");

-- CreateIndex
CREATE INDEX "BarisReturPembelian_barangId_idx" ON "BarisReturPembelian"("barangId");

-- CreateIndex
CREATE INDEX "BarisReturPenjualan_returId_idx" ON "BarisReturPenjualan"("returId");

-- CreateIndex
CREATE INDEX "BarisReturPenjualan_barangId_idx" ON "BarisReturPenjualan"("barangId");

-- CreateIndex
CREATE INDEX "FakturPembelian_pemasokId_idx" ON "FakturPembelian"("pemasokId");

-- CreateIndex
CREATE INDEX "FakturPembelian_pesananId_idx" ON "FakturPembelian"("pesananId");

-- CreateIndex
CREATE INDEX "FakturPembelian_penerimaanId_idx" ON "FakturPembelian"("penerimaanId");

-- CreateIndex
CREATE INDEX "FakturPembelian_status_idx" ON "FakturPembelian"("status");

-- CreateIndex
CREATE INDEX "FakturPembelian_tanggal_idx" ON "FakturPembelian"("tanggal");

-- CreateIndex
CREATE INDEX "FakturPenjualan_pelangganId_idx" ON "FakturPenjualan"("pelangganId");

-- CreateIndex
CREATE INDEX "FakturPenjualan_pesananId_idx" ON "FakturPenjualan"("pesananId");

-- CreateIndex
CREATE INDEX "FakturPenjualan_pengirimanId_idx" ON "FakturPenjualan"("pengirimanId");

-- CreateIndex
CREATE INDEX "FakturPenjualan_status_idx" ON "FakturPenjualan"("status");

-- CreateIndex
CREATE INDEX "FakturPenjualan_tanggal_idx" ON "FakturPenjualan"("tanggal");

-- CreateIndex
CREATE INDEX "Jurnal_proyekId_idx" ON "Jurnal"("proyekId");

-- CreateIndex
CREATE INDEX "Jurnal_tanggal_idx" ON "Jurnal"("tanggal");

-- CreateIndex
CREATE INDEX "Karyawan_departemenId_idx" ON "Karyawan"("departemenId");

-- CreateIndex
CREATE INDEX "KelompokBarang_indukId_idx" ON "KelompokBarang"("indukId");

-- CreateIndex
CREATE INDEX "Pelanggan_penjualId_idx" ON "Pelanggan"("penjualId");

-- CreateIndex
CREATE INDEX "PelepasanAset_akunPenerimaanId_idx" ON "PelepasanAset"("akunPenerimaanId");

-- CreateIndex
CREATE INDEX "PelepasanAset_akunLabaRugiId_idx" ON "PelepasanAset"("akunLabaRugiId");

-- CreateIndex
CREATE INDEX "PemakaianUangMuka_uangMukaId_idx" ON "PemakaianUangMuka"("uangMukaId");

-- CreateIndex
CREATE INDEX "PembayaranPembelian_pemasokId_idx" ON "PembayaranPembelian"("pemasokId");

-- CreateIndex
CREATE INDEX "PembayaranPembelian_fakturId_idx" ON "PembayaranPembelian"("fakturId");

-- CreateIndex
CREATE INDEX "PembayaranPembelian_akunId_idx" ON "PembayaranPembelian"("akunId");

-- CreateIndex
CREATE INDEX "PembayaranPembelian_tanggal_idx" ON "PembayaranPembelian"("tanggal");

-- CreateIndex
CREATE INDEX "PemetaanAkunTambahan_akunId_idx" ON "PemetaanAkunTambahan"("akunId");

-- CreateIndex
CREATE INDEX "PenawaranPenjualan_pelangganId_idx" ON "PenawaranPenjualan"("pelangganId");

-- CreateIndex
CREATE INDEX "PenawaranPenjualan_proyekId_idx" ON "PenawaranPenjualan"("proyekId");

-- CreateIndex
CREATE INDEX "PenawaranPenjualan_status_idx" ON "PenawaranPenjualan"("status");

-- CreateIndex
CREATE INDEX "PenawaranPenjualan_tanggal_idx" ON "PenawaranPenjualan"("tanggal");

-- CreateIndex
CREATE INDEX "PenerimaanBarang_pesananId_idx" ON "PenerimaanBarang"("pesananId");

-- CreateIndex
CREATE INDEX "PenerimaanBarang_gudangId_idx" ON "PenerimaanBarang"("gudangId");

-- CreateIndex
CREATE INDEX "PenerimaanBarang_tanggal_idx" ON "PenerimaanBarang"("tanggal");

-- CreateIndex
CREATE INDEX "PenerimaanPenjualan_pelangganId_idx" ON "PenerimaanPenjualan"("pelangganId");

-- CreateIndex
CREATE INDEX "PenerimaanPenjualan_fakturId_idx" ON "PenerimaanPenjualan"("fakturId");

-- CreateIndex
CREATE INDEX "PenerimaanPenjualan_akunId_idx" ON "PenerimaanPenjualan"("akunId");

-- CreateIndex
CREATE INDEX "PenerimaanPenjualan_tanggal_idx" ON "PenerimaanPenjualan"("tanggal");

-- CreateIndex
CREATE INDEX "PengirimanPesanan_pesananId_idx" ON "PengirimanPesanan"("pesananId");

-- CreateIndex
CREATE INDEX "PengirimanPesanan_gudangId_idx" ON "PengirimanPesanan"("gudangId");

-- CreateIndex
CREATE INDEX "PengirimanPesanan_tanggal_idx" ON "PengirimanPesanan"("tanggal");

-- CreateIndex
CREATE INDEX "PenyesuaianPersediaan_gudangId_idx" ON "PenyesuaianPersediaan"("gudangId");

-- CreateIndex
CREATE INDEX "PenyesuaianPersediaan_akunLawanId_idx" ON "PenyesuaianPersediaan"("akunLawanId");

-- CreateIndex
CREATE INDEX "PenyusutanAset_jurnalId_idx" ON "PenyusutanAset"("jurnalId");

-- CreateIndex
CREATE INDEX "PermintaanAturUlang_penggunaId_idx" ON "PermintaanAturUlang"("penggunaId");

-- CreateIndex
CREATE INDEX "PesananPembelian_pemasokId_idx" ON "PesananPembelian"("pemasokId");

-- CreateIndex
CREATE INDEX "PesananPembelian_proyekId_idx" ON "PesananPembelian"("proyekId");

-- CreateIndex
CREATE INDEX "PesananPembelian_status_idx" ON "PesananPembelian"("status");

-- CreateIndex
CREATE INDEX "PesananPembelian_tanggal_idx" ON "PesananPembelian"("tanggal");

-- CreateIndex
CREATE INDEX "PesananPenjualan_pelangganId_idx" ON "PesananPenjualan"("pelangganId");

-- CreateIndex
CREATE INDEX "PesananPenjualan_proyekId_idx" ON "PesananPenjualan"("proyekId");

-- CreateIndex
CREATE INDEX "PesananPenjualan_status_idx" ON "PesananPenjualan"("status");

-- CreateIndex
CREATE INDEX "PesananPenjualan_tanggal_idx" ON "PesananPenjualan"("tanggal");

-- CreateIndex
CREATE INDEX "PindahBarang_gudangAsalId_idx" ON "PindahBarang"("gudangAsalId");

-- CreateIndex
CREATE INDEX "PindahBarang_gudangTujuanId_idx" ON "PindahBarang"("gudangTujuanId");

-- CreateIndex
CREATE INDEX "Prive_akunKasId_idx" ON "Prive"("akunKasId");

-- CreateIndex
CREATE INDEX "Prive_akunPriveId_idx" ON "Prive"("akunPriveId");

-- CreateIndex
CREATE INDEX "Prive_tanggal_idx" ON "Prive"("tanggal");

-- CreateIndex
CREATE INDEX "Proyek_pelangganId_idx" ON "Proyek"("pelangganId");

-- CreateIndex
CREATE INDEX "ReturPembelian_fakturId_idx" ON "ReturPembelian"("fakturId");

-- CreateIndex
CREATE INDEX "ReturPembelian_gudangId_idx" ON "ReturPembelian"("gudangId");

-- CreateIndex
CREATE INDEX "ReturPenjualan_fakturId_idx" ON "ReturPenjualan"("fakturId");

-- CreateIndex
CREATE INDEX "ReturPenjualan_gudangId_idx" ON "ReturPenjualan"("gudangId");

-- CreateIndex
CREATE INDEX "Sesi_kedaluwarsa_idx" ON "Sesi"("kedaluwarsa");

-- CreateIndex
CREATE INDEX "StokBarang_barangId_idx" ON "StokBarang"("barangId");

-- CreateIndex
CREATE INDEX "StokBarang_gudangId_idx" ON "StokBarang"("gudangId");

-- CreateIndex
CREATE INDEX "UangMukaPelanggan_pelangganId_idx" ON "UangMukaPelanggan"("pelangganId");

-- CreateIndex
CREATE INDEX "UangMukaPelanggan_pesananId_idx" ON "UangMukaPelanggan"("pesananId");

-- CreateIndex
CREATE INDEX "UangMukaPelanggan_akunId_idx" ON "UangMukaPelanggan"("akunId");

-- CreateIndex
CREATE INDEX "UangMukaPelanggan_tanggal_idx" ON "UangMukaPelanggan"("tanggal");

