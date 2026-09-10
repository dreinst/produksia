import "dotenv/config";
import { db } from "../src/lib/db";

async function main() {
  console.log("=== Menghapus semua data transaksi & master data ===");
  await db.logAktivitas.deleteMany();
  await db.hakAksesPeran.deleteMany();
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
  await db.karyawan.deleteMany();
  await db.departemen.deleteMany();
  await db.gudang.deleteMany();
  await db.pphFinalBulanan.deleteMany();
  await db.tutupBuku.deleteMany();
  await db.barisJurnal.deleteMany();
  await db.jurnal.deleteMany();
  await db.pemetaanAkun.deleteMany();
  await db.pengaturanPerusahaan.deleteMany();
  await db.akun.deleteMany();
  await db.sesi.deleteMany();
  await db.permintaanAturUlang.deleteMany();
  await db.pengguna.deleteMany();
  console.log("=== Selesai, database bersih ===");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("RESET FAILED", err);
    process.exit(1);
  });
