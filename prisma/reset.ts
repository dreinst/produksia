import "dotenv/config";
import { db } from "../src/lib/db";

// Enam perusahaan standar dibuat migrasi 20261109160000_lebur_hka dan menjadi nilai bawaan FK, jadi tidak dihapus.
// Sama dengan ID_PERUSAHAAN_STANDAR rancangan D1 §2.7; ganti dengan impor dari src/lib/perusahaan.ts bila berkas itu sudah ada.
const ID_PERUSAHAAN_STANDAR = ["utama", "tapussa", "smara", "bonanova", "sahara", "nawasena"];

async function main() {
  console.log("=== Menghapus semua data transaksi & master data ===");
  await db.logAktivitas.deleteMany();
  // ---- tabel peleburan HKA (urutan aman FK, diperiksa terhadap basis data) ----
  await db.notifikasi.deleteMany();
  await db.transaksiAntarPerusahaan.deleteMany();
  await db.metrikIklan.deleteMany();
  await db.iklan.deleteMany();
  await db.setIklan.deleteMany();
  await db.revisiDesain.deleteMany();
  await db.tugasDesain.deleteMany();
  await db.riwayatPersetujuanKonten.deleteMany();
  await db.konten.deleteMany();
  await db.kampanye.deleteMany();
  await db.pengaturanPemasaran.deleteMany();
  await db.aktivitasLead.deleteMany();
  await db.tindakLanjut.deleteMany();
  await db.lead.deleteMany();
  await db.tahapLead.deleteMany();
  await db.sumberLead.deleteMany();
  await db.pembayaranMitra.deleteMany();
  await db.talanganMitra.deleteMany();
  await db.mitraProyek.deleteMany();
  await db.barisAnggaranProyek.deleteMany();
  await db.akunKategoriAnggaran.deleteMany();
  await db.kategoriAnggaran.deleteMany();
  await db.templateCetak.deleteMany();
  await db.asetKopSurat.deleteMany();
  await db.tautanBagiBerkas.deleteMany();
  await db.isiBerkas.deleteMany();
  await db.berkas.deleteMany();
  await db.aksesBerkasProyekPengguna.deleteMany();
  await db.aksesBerkasProyek.deleteMany();
  await db.hakAksesPeran.deleteMany();
  await db.dokumenKas.deleteMany();
  await db.mutasiBank.deleteMany();
  await db.prive.deleteMany();
  await db.pemetaanAkunTambahan.deleteMany();
  await db.barisPindahBarang.deleteMany();
  await db.pindahBarang.deleteMany();
  await db.barisPenyesuaianPersediaan.deleteMany();
  await db.penyesuaianPersediaan.deleteMany();
  await db.pelepasanAset.deleteMany();
  await db.penyusutanAset.deleteMany();
  await db.asetTetap.deleteMany();
  await db.barisReturPembelian.deleteMany();
  await db.returPembelian.deleteMany();
  await db.pembayaranPembelian.deleteMany();
  await db.barisFakturPembelian.deleteMany();
  await db.fakturPembelian.deleteMany();
  await db.barisPenerimaanBarang.deleteMany();
  await db.penerimaanBarang.deleteMany();
  await db.barisPesananPembelian.deleteMany();
  await db.pesananPembelian.deleteMany();
  await db.pemakaianUangMuka.deleteMany();
  await db.barisReturPenjualan.deleteMany();
  await db.returPenjualan.deleteMany();
  await db.penerimaanPenjualan.deleteMany();
  await db.barisFakturPenjualan.deleteMany();
  await db.fakturPenjualan.deleteMany();
  await db.uangMukaPelanggan.deleteMany();
  await db.rencanaTermin.deleteMany();
  await db.barisPengiriman.deleteMany();
  await db.pengirimanPesanan.deleteMany();
  await db.barisPesananPenjualan.deleteMany();
  await db.pesananPenjualan.deleteMany();
  await db.barisPenawaranPenjualan.deleteMany();
  await db.penawaranPenjualan.deleteMany();
  await db.stokBarang.deleteMany();
  await db.proyek.deleteMany();
  await db.barang.deleteMany();
  await db.kelompokBarang.deleteMany();
  await db.pelanggan.deleteMany();
  await db.pemasok.deleteMany();
  await db.barisPenggajian.deleteMany();
  await db.penggajian.deleteMany();
  await db.karyawan.deleteMany();
  await db.departemen.deleteMany();
  await db.gudang.deleteMany();
  await db.pphFinalBulanan.deleteMany();
  await db.penghitungNomor.deleteMany();
  await db.formatNomor.deleteMany();
  await db.pengaturanDokumenPenjualan.deleteMany();
  await db.kopSurat.deleteMany();
  await db.tutupBuku.deleteMany();
  await db.barisJurnal.deleteMany();
  await db.jurnal.deleteMany();
  await db.pemetaanAkun.deleteMany();
  await db.pengaturanPerusahaan.deleteMany();
  await db.mataUang.deleteMany();
  await db.akun.deleteMany();
  await db.sesi.deleteMany();
  await db.permintaanAturUlang.deleteMany();
  await db.pengguna.deleteMany();
  // TutupBukuPerusahaan ikut terhapus kaskade dari tutupBuku; FolderBerkas sengaja dipertahankan (folder sistem dari migrasi).
  await db.perusahaan.deleteMany({ where: { id: { notIn: ID_PERUSAHAAN_STANDAR } } });
  console.log("=== Selesai, database bersih ===");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("RESET FAILED", err);
    process.exit(1);
  });
