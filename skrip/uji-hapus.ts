import "dotenv/config";
// Skrip ini memanggil aksi server di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { db } from "../src/lib/db";
import { periksaSinkron } from "../src/lib/sinkron";
import { hapusDokumen } from "../src/lib/aksi/hapusDokumen";
import { buatPesanan, buatPengiriman, buatFaktur, buatPenerimaan, buatRetur } from "../src/lib/aksi/penjualan";
import { buatPesananPembelian, buatPenerimaanBarang, buatFakturPembelian, buatPembayaranPembelian, buatReturPembelian } from "../src/lib/aksi/pembelian";
import { buatPenyesuaianPersediaan } from "../src/lib/aksi/persediaan";
import { buatKasMasuk } from "../src/lib/aksi/jurnal";
import { buatAsetTetap, jalankanPenyusutanBulanan } from "../src/lib/aksi/asetTetap";

async function jalankan(label: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (err) {
    const digest = (err as { digest?: string })?.digest ?? "";
    const pesan = (err as { message?: string })?.message ?? "";
    if (!digest.startsWith("NEXT_REDIRECT") && !pesan.includes("static generation store missing")) throw err;
  }
  console.log(`[ok] ${label}`);
}
function formulir(isian: Record<string, string | number | object>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(isian)) fd.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  return fd;
}
function pastikan(kondisi: unknown, pesan: string) {
  if (!kondisi) {
    console.error(`[FAIL] ${pesan}`);
    process.exit(1);
  }
  console.log(`[ok] ${pesan}`);
}
async function harusDitolak(label: string, fn: () => Promise<unknown>, potongan: string) {
  try {
    await fn();
  } catch (err) {
    const pesan = (err as { message?: string })?.message ?? String(err);
    pastikan(pesan.includes(potongan), `${label} ditolak: "${pesan}"`);
    return;
  }
  console.error(`[FAIL] ${label} TIDAK ditolak`);
  process.exit(1);
}
async function pastikanSinkron(label: string) {
  const s = await periksaSinkron(db);
  const ok = s.seimbang && s.persediaan.sinkron && s.piutang.sinkron && s.hutang.sinkron && s.barangBelumDitagih.sinkron && s.barangTerkirim.sinkron && s.uangMuka.sinkron;
  pastikan(ok, `sinkron setelah ${label} (persediaan ${Number(s.persediaan.bukuBesar)}/${Number(s.persediaan.dokumen)}; piutang ${Number(s.piutang.bukuBesar)}/${Number(s.piutang.dokumen)}; hutang ${Number(s.hutang.bukuBesar)}/${Number(s.hutang.dokumen)}; BBD ${Number(s.barangBelumDitagih.bukuBesar)}/${Number(s.barangBelumDitagih.dokumen)}; terkirim ${Number(s.barangTerkirim.bukuBesar)}/${Number(s.barangTerkirim.dokumen)})`);
}
const stok = async (barangId: string, gudangId: string) => Number((await db.stokBarang.findUnique({ where: { barangId_gudangId: { barangId, gudangId } } }))?.jumlah ?? 0);

async function main() {
  const mulaiUji = new Date();
  const jumlahJurnalAwal = await db.jurnal.count();
  const jumlahLogAwal = await db.logAktivitas.count();
  const pemetaan = await db.pemetaanAkun.findUniqueOrThrow({ where: { id: "default" } });
  pastikan(pemetaan.barangTerkirimId, "pemetaan punya akun Barang Terkirim Belum Ditagih");

  console.log("=== Data uji ===");
  const gudang = await db.gudang.create({ data: { kode: "WH-HPS", nama: "Gudang Uji Hapus" } });
  const pelanggan = await db.pelanggan.create({ data: { kode: "CUST-HPS", nama: "Pelanggan Uji Hapus" } });
  const pemasok = await db.pemasok.create({ data: { kode: "SUP-HPS", nama: "Vendor Uji Hapus" } });
  const barang = await db.barang.create({ data: { kode: "BRG-HPS", nama: "Barang Uji Hapus", hargaBeli: 0, hargaJual: 20000 } });
  const kas = await db.akun.create({ data: { kode: "HPS-KAS", nama: "Kas Uji Hapus", jenis: "ASET", kasBank: true } });
  const modal = await db.akun.create({ data: { kode: "HPS-MODAL", nama: "Modal Uji Hapus", jenis: "MODAL" } });
  const asetAkun = await db.akun.create({ data: { kode: "HPS-ASET", nama: "Aset Uji Hapus", jenis: "ASET" } });
  const akum = await db.akun.create({ data: { kode: "HPS-AKUM", nama: "Akum Uji Hapus", jenis: "ASET" } });
  const susut = await db.akun.create({ data: { kode: "HPS-SUSUT", nama: "Susut Uji Hapus", jenis: "BEBAN" } });

  console.log("=== 1. Siklus penjualan lengkap, lalu dihapus urut terbalik ===");
  await jalankan("PS saldo awal 20 @ 5.000", () => buatPenyesuaianPersediaan(formulir({ gudangId: gudang.id, akunLawanId: modal.id, baris: [{ barangId: barang.id, jumlahSesudah: 20, hargaSatuan: 5000 }] })));
  await jalankan("PSJ 10 @ 20.000", () => buatPesanan(formulir({ pelangganId: pelanggan.id, baris: [{ barangId: barang.id, jumlah: 10, harga: 20000 }] })));
  const pesanan = await db.pesananPenjualan.findFirstOrThrow({ where: { pelangganId: pelanggan.id }, include: { baris: true } });
  await jalankan("SJ 10 (transit 50.000)", () => buatPengiriman(formulir({ pesananId: pesanan.id, gudangId: gudang.id, baris: [{ barisPesananId: pesanan.baris[0].id, barangId: barang.id, jumlah: 10 }] })));
  await pastikanSinkron("SJ (barang terkirim belum ditagih)");
  await harusDitolak("hapus pesanan yang sudah dikirim", () => hapusDokumen("pesanan", pesanan.id), "sudah punya surat jalan");
  await jalankan("FJ 10", () => buatFaktur(formulir({ pesananId: pesanan.id, baris: [{ barangId: barang.id, jumlah: 10, harga: 20000 }] })));
  const faktur = await db.fakturPenjualan.findFirstOrThrow({ where: { pesananId: pesanan.id } });
  await pastikanSinkron("FJ (transit terkonsumsi)");
  const sj = await db.pengirimanPesanan.findFirstOrThrow({ where: { pesananId: pesanan.id } });
  await harusDitolak("hapus SJ saat faktur dibuat setelahnya", () => hapusDokumen("pengiriman", sj.id), "hapus faktur itu dulu");
  await jalankan("TRM 100.000", () => buatPenerimaan(formulir({ fakturId: faktur.id, akunId: kas.id, jumlah: 100000 })));
  await jalankan("RJ 2 (40.000)", () => buatRetur(formulir({ fakturId: faktur.id, gudangId: gudang.id, baris: [{ barangId: barang.id, jumlah: 2 }] })));
  await pastikanSinkron("TRM + RJ");
  await harusDitolak("hapus faktur yang punya penerimaan", () => hapusDokumen("faktur", faktur.id), "sudah punya penerimaan");
  const retur = await db.returPenjualan.findFirstOrThrow({ where: { fakturId: faktur.id } });
  const trm = await db.penerimaanPenjualan.findFirstOrThrow({ where: { fakturId: faktur.id } });
  await jalankan("hapus RJ", () => hapusDokumen("returPenjualan", retur.id));
  pastikan((await stok(barang.id, gudang.id)) === 10, "stok kembali 10 setelah retur dihapus");
  await pastikanSinkron("hapus RJ");
  await jalankan("hapus TRM", () => hapusDokumen("penerimaan", trm.id));
  pastikan((await db.fakturPenjualan.findUniqueOrThrow({ where: { id: faktur.id } })).status === "DRAF", "status faktur kembali DRAF setelah penerimaan dihapus");
  await pastikanSinkron("hapus TRM");
  await jalankan("hapus FJ", () => hapusDokumen("faktur", faktur.id));
  const barisSj = await db.barisPengiriman.findFirstOrThrow({ where: { pengirimanId: sj.id } });
  pastikan(Number(barisSj.jumlahDifaktur) === 0 && Number((await db.barisPesananPenjualan.findUniqueOrThrow({ where: { id: pesanan.baris[0].id } })).jumlahDifaktur) === 0, "konsumsi transit & progres faktur dibalik");
  await pastikanSinkron("hapus FJ (kembali ke transit 50.000)");
  await jalankan("hapus SJ", () => hapusDokumen("pengiriman", sj.id));
  pastikan((await stok(barang.id, gudang.id)) === 20 && (await db.pesananPenjualan.findUniqueOrThrow({ where: { id: pesanan.id } })).status === "DRAF", "stok kembali 20, pesanan kembali DRAF");
  await pastikanSinkron("hapus SJ");
  await jalankan("hapus PSJ", () => hapusDokumen("pesanan", pesanan.id));

  console.log("=== 2. Siklus pembelian lengkap, lalu dihapus urut terbalik ===");
  await jalankan("PSB 10 @ 6.000", () => buatPesananPembelian(formulir({ pemasokId: pemasok.id, baris: [{ barangId: barang.id, jumlah: 10, harga: 6000 }] })));
  const psb = await db.pesananPembelian.findFirstOrThrow({ where: { pemasokId: pemasok.id }, include: { baris: true } });
  await jalankan("TB 10", () => buatPenerimaanBarang(formulir({ pesananId: psb.id, gudangId: gudang.id, baris: [{ barisPesananId: psb.baris[0].id, barangId: barang.id, jumlah: 10 }] })));
  const hargaSetelahTb = Number((await db.barang.findUniqueOrThrow({ where: { id: barang.id } })).hargaBeli);
  pastikan(Math.abs(hargaSetelahTb - (20 * 5000 + 10 * 6000) / 30) < 0.01, `harga rata-rata setelah TB = 5.333,33 (${hargaSetelahTb})`);
  await jalankan("FB 10 @ 6.500 (beda harga)", () => buatFakturPembelian(formulir({ pesananId: psb.id, baris: [{ barangId: barang.id, jumlah: 10, harga: 6500 }] })));
  const fb = await db.fakturPembelian.findFirstOrThrow({ where: { pesananId: psb.id } });
  await jalankan("BYR 30.000", () => buatPembayaranPembelian(formulir({ fakturId: fb.id, akunId: kas.id, jumlah: 30000 })));
  await jalankan("RB 1", () => buatReturPembelian(formulir({ fakturId: fb.id, gudangId: gudang.id, baris: [{ barangId: barang.id, jumlah: 1 }] })));
  await pastikanSinkron("siklus pembelian");
  await harusDitolak("hapus FB yang punya pembayaran", () => hapusDokumen("fakturPembelian", fb.id), "sudah punya pembayaran");
  const rb = await db.returPembelian.findFirstOrThrow({ where: { fakturId: fb.id } });
  const byr = await db.pembayaranPembelian.findFirstOrThrow({ where: { fakturId: fb.id } });
  const tb = await db.penerimaanBarang.findFirstOrThrow({ where: { pesananId: psb.id } });
  await jalankan("hapus RB", () => hapusDokumen("returPembelian", rb.id));
  await pastikanSinkron("hapus RB");
  await jalankan("hapus BYR", () => hapusDokumen("pembayaran", byr.id));
  await pastikanSinkron("hapus BYR");
  await jalankan("hapus FB", () => hapusDokumen("fakturPembelian", fb.id));
  pastikan(Math.abs(Number((await db.barang.findUniqueOrThrow({ where: { id: barang.id } })).hargaBeli) - hargaSetelahTb) < 0.01, "harga rata-rata kembali seperti setelah TB");
  await pastikanSinkron("hapus FB");
  await jalankan("hapus TB", () => hapusDokumen("penerimaanBarang", tb.id));
  pastikan((await stok(barang.id, gudang.id)) === 20, "stok kembali 20 setelah TB dihapus");
  await pastikanSinkron("hapus TB");
  await jalankan("hapus PSB", () => hapusDokumen("pesananPembelian", psb.id));

  console.log("=== 3. Kas masuk, aset + penyusutan, penyesuaian ===");
  await jalankan("KM 1.000", () => buatKasMasuk(formulir({ akunKasId: kas.id, akunLawanId: modal.id, jumlah: 1000, keterangan: "uji hapus" })));
  const km = await db.jurnal.findFirstOrThrow({ where: { sumber: "KAS_MASUK", keterangan: "uji hapus" } });
  await jalankan("hapus KM", () => hapusDokumen("jurnal", km.id));
  await jalankan("AT dibayar kas", () => buatAsetTetap(formulir({ kode: "AT-HPS", nama: "Aset Uji Hapus", hargaPerolehan: 120000, nilaiSisa: 0, umurBulan: 12, akunAsetId: asetAkun.id, akunBebanPenyusutanId: susut.id, akunAkumulasiPenyusutanId: akum.id, akunPembayaranId: kas.id })));
  await jalankan("penyusutan 2030-01", () => jalankanPenyusutanBulanan(formulir({ periode: "2030-01" })));
  const aset = await db.asetTetap.findUniqueOrThrow({ where: { kode: "AT-HPS" }, include: { penyusutan: true } });
  await harusDitolak("hapus aset yang sudah disusutkan", () => hapusDokumen("aset", aset.id), "hapus penyusutannya dulu");
  const jurnalSusut = aset.penyusutan[0].jurnalId!;
  const jurnalFj = await db.jurnal.findFirst({ where: { nomor: { startsWith: "JU-FJ" } } });
  if (jurnalFj) await harusDitolak("hapus jurnal otomatis lewat menu jurnal", () => hapusDokumen("jurnal", jurnalFj.id), "jurnal otomatis");
  await jalankan("hapus penyusutan periode", () => hapusDokumen("penyusutan", jurnalSusut));
  await jalankan("hapus aset", () => hapusDokumen("aset", aset.id));
  pastikan((await db.asetTetap.count({ where: { kode: "AT-HPS" } })) === 0 && (await db.jurnal.count({ where: { tanggal: { gte: mulaiUji }, sumber: { in: ["ASET_TETAP", "PENYUSUTAN"] } } })) === 0, "aset dan jurnal perolehan/penyusutannya hilang");
  const ps = await db.penyesuaianPersediaan.findFirstOrThrow({ where: { gudangId: gudang.id } });
  await jalankan("hapus PS saldo awal", () => hapusDokumen("penyesuaian", ps.id));
  pastikan((await stok(barang.id, gudang.id)) === 0, "stok kembali 0");
  await pastikanSinkron("hapus PS");
  pastikan((await db.jurnal.count()) === jumlahJurnalAwal, "tidak ada jurnal uji yang tersisa");
  pastikan((await db.logAktivitas.count()) - jumlahLogAwal === 14, `14 penghapusan tercatat di log aktivitas (${(await db.logAktivitas.count()) - jumlahLogAwal})`);

  console.log("=== Bersih-bersih ===");
  await db.logAktivitas.deleteMany({ where: { waktu: { gte: mulaiUji } } });
  await db.stokBarang.deleteMany({ where: { barangId: barang.id } });
  await db.barang.delete({ where: { id: barang.id } });
  await db.pelanggan.delete({ where: { id: pelanggan.id } });
  await db.pemasok.delete({ where: { id: pemasok.id } });
  await db.gudang.delete({ where: { id: gudang.id } });
  await db.akun.deleteMany({ where: { kode: { startsWith: "HPS-" } } });
  await pastikanSinkron("bersih-bersih");
  console.log("=== DONE, all hapus dokumen checks passed ===");
}

main().then(() => process.exit(0)).catch((err) => { console.error("TEST FAILED", err); process.exit(1); });
