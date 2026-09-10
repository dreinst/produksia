import "dotenv/config";
// Skrip ini memanggil aksi server di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { db } from "../src/lib/db";
import { periksaSinkron } from "../src/lib/sinkron";
import { buatPenyesuaianPersediaan } from "../src/lib/aksi/persediaan";
import { buatPesanan, buatPengiriman, buatFaktur } from "../src/lib/aksi/penjualan";
import { buatPesananPembelian, buatPenerimaanBarang, buatFakturPembelian, buatReturPembelian } from "../src/lib/aksi/pembelian";
import { buatAsetTetap } from "../src/lib/aksi/asetTetap";
import { jalankan, formulir, pastikan, harusDitolak } from "./bantuan";

async function saldo(akunId: string) {
  const agg = await db.barisJurnal.aggregate({ where: { akunId }, _sum: { debit: true, kredit: true } });
  return Number(agg._sum.debit ?? 0) - Number(agg._sum.kredit ?? 0);
}
async function pastikanSinkron(label: string) {
  const s = await periksaSinkron(db);
  const ok = s.seimbang && s.persediaan.sinkron && s.piutang.sinkron && s.hutang.sinkron && s.barangBelumDitagih.sinkron && s.barangTerkirim.sinkron && s.uangMuka.sinkron;
  pastikan(ok, `sinkron setelah ${label} (persediaan BB ${Number(s.persediaan.bukuBesar)} vs stok ${Number(s.persediaan.dokumen)}; BBD ${Number(s.barangBelumDitagih.bukuBesar)} vs ${Number(s.barangBelumDitagih.dokumen)}; terkirim ${Number(s.barangTerkirim.bukuBesar)} vs ${Number(s.barangTerkirim.dokumen)})`);
}

async function main() {
  const mulaiUji = new Date();
  const pemetaan = await db.pemetaanAkun.findUniqueOrThrow({ where: { id: "default" } });
  pastikan(pemetaan.barangBelumDitagihId && pemetaan.selisihPersediaanId && pemetaan.bebanJasaId, "pemetaan akun punya peran opsional (barang belum ditagih, selisih, beban jasa)");
  await pastikanSinkron("awal (sebelum uji)");

  console.log("=== Data uji ===");
  const gudang = await db.gudang.create({ data: { kode: "WH-SYNC", nama: "Gudang Uji Sinkron" } });
  const pelanggan = await db.pelanggan.create({ data: { kode: "CUST-SYNC", nama: "Pelanggan Uji Sinkron" } });
  const pemasok = await db.pemasok.create({ data: { kode: "SUP-SYNC", nama: "Pemasok Uji Sinkron" } });
  const barang = await db.barang.create({ data: { kode: "BRG-SYNC", nama: "Barang Uji Sinkron", hargaBeli: 0, hargaJual: 15000 } });
  const jasa = await db.barang.create({ data: { kode: "JSA-SYNC", nama: "Jasa Uji Sinkron", jenis: "JASA", hargaBeli: 0, hargaJual: 100000 } });
  const kas = await db.akun.create({ data: { kode: "SYNC-KAS", nama: "Kas Uji Sinkron", jenis: "ASET", kasBank: true } });
  const modal = await db.akun.create({ data: { kode: "SYNC-MODAL", nama: "Modal Uji Sinkron", jenis: "MODAL" } });
  const asetAkun = await db.akun.create({ data: { kode: "SYNC-ASET", nama: "Aset Uji Sinkron", jenis: "ASET" } });
  const akum = await db.akun.create({ data: { kode: "SYNC-AKUM", nama: "Akum Uji Sinkron", jenis: "ASET" } });
  const bebanSusut = await db.akun.create({ data: { kode: "SYNC-SUSUT", nama: "Susut Uji Sinkron", jenis: "BEBAN" } });

  console.log("=== 1. Penyesuaian stok: saldo awal 10 @ 8.000 (Dr Persediaan / Cr Modal) ===");
  await harusDitolak("penyesuaian untuk JASA", () => buatPenyesuaianPersediaan(formulir({ gudangId: gudang.id, akunLawanId: modal.id, baris: [{ barangId: jasa.id, jumlahSesudah: 5 }] })), "JASA");
  await jalankan("PS saldo awal", () => buatPenyesuaianPersediaan(formulir({ gudangId: gudang.id, akunLawanId: modal.id, keterangan: "Saldo awal uji", baris: [{ barangId: barang.id, jumlahSesudah: 10, hargaSatuan: 8000 }] })));
  const stok1 = await db.stokBarang.findUniqueOrThrow({ where: { barangId_gudangId: { barangId: barang.id, gudangId: gudang.id } } });
  const barang1 = await db.barang.findUniqueOrThrow({ where: { id: barang.id } });
  pastikan(Number(stok1.jumlah) === 10 && Number(barang1.hargaBeli) === 8000, `stok 10, harga pokok 8.000 (dapat ${Number(stok1.jumlah)} @ ${Number(barang1.hargaBeli)})`);
  pastikan((await saldo(pemetaan.persediaanId)) >= 80000 && (await saldo(modal.id)) === -80000, "jurnal PS: Persediaan +80.000, Modal kredit 80.000");
  const ps = await db.penyesuaianPersediaan.findFirstOrThrow({ where: { gudangId: gudang.id }, include: { jurnal: true } });
  pastikan(ps.jurnal?.nomor.startsWith("JU-PS"), `penyesuaian terhubung ke jurnal ${ps.jurnal?.nomor}`);
  await pastikanSinkron("penyesuaian");

  console.log("=== 2. Penjualan dengan baris JASA: surat jalan tidak menyentuh stok, faktur tanpa HPP untuk jasa ===");
  await jalankan("PSJ 4 barang @15.000 + 1 jasa @100.000", () => buatPesanan(formulir({ pelangganId: pelanggan.id, baris: [{ barangId: barang.id, jumlah: 4, harga: 15000 }, { barangId: jasa.id, jumlah: 1, harga: 100000 }] })));
  const pesanan = await db.pesananPenjualan.findFirstOrThrow({ where: { pelangganId: pelanggan.id }, include: { baris: true } });
  const bp = (id: string) => pesanan.baris.find((b) => b.barangId === id)!;
  await jalankan("SJ 4 barang + 1 jasa", () => buatPengiriman(formulir({ pesananId: pesanan.id, gudangId: gudang.id, baris: [{ barisPesananId: bp(barang.id).id, barangId: barang.id, jumlah: 4 }, { barisPesananId: bp(jasa.id).id, barangId: jasa.id, jumlah: 1 }] })));
  const stok2 = await db.stokBarang.findUniqueOrThrow({ where: { barangId_gudangId: { barangId: barang.id, gudangId: gudang.id } } });
  pastikan(Number(stok2.jumlah) === 6, `stok barang 6 setelah SJ (jasa tidak mengurangi stok): ${Number(stok2.jumlah)}`);
  await pastikanSinkron("surat jalan (barang terkirim belum ditagih 4 × 8.000)");
  pastikan((await db.stokBarang.count({ where: { barangId: jasa.id } })) === 0, "tidak ada baris stok untuk JASA");
  await jalankan("FJ seluruh pesanan", () => buatFaktur(formulir({ pesananId: pesanan.id, baris: pesanan.baris.map((b) => ({ barangId: b.barangId, jumlah: Number(b.jumlah), harga: Number(b.harga) })) })));
  const jurnalFj = await db.jurnal.findFirstOrThrow({ where: { nomor: { startsWith: "JU-FJ" }, tanggal: { gte: mulaiUji } }, include: { baris: true }, orderBy: { tanggal: "desc" } });
  const hppFj = jurnalFj.baris.filter((b) => b.akunId === pemetaan.hppId).reduce((s, b) => s + Number(b.debit), 0);
  pastikan(hppFj === 32000, `HPP faktur = 4 × 8.000 = 32.000 (jasa tidak ber-HPP): ${hppFj}`);
  const pendapatanFj = jurnalFj.baris.filter((b) => b.akunId === pemetaan.pendapatanPenjualanId).reduce((s, b) => s + Number(b.kredit), 0);
  pastikan(pendapatanFj === 160000, `pendapatan faktur 160.000: ${pendapatanFj}`);
  await pastikanSinkron("faktur penjualan");

  console.log("=== 3. Pembelian: TB menjurnal persediaan, FB beda harga menyesuaikan rata-rata, jasa → beban, retur ===");
  await jalankan("PSB 10 barang @9.000 + 1 jasa @50.000", () => buatPesananPembelian(formulir({ pemasokId: pemasok.id, baris: [{ barangId: barang.id, jumlah: 10, harga: 9000 }, { barangId: jasa.id, jumlah: 1, harga: 50000 }] })));
  const psb = await db.pesananPembelian.findFirstOrThrow({ where: { pemasokId: pemasok.id }, include: { baris: true } });
  const bb = (id: string) => psb.baris.find((b) => b.barangId === id)!;
  await jalankan("TB 10 barang + jasa", () => buatPenerimaanBarang(formulir({ pesananId: psb.id, gudangId: gudang.id, baris: [{ barisPesananId: bb(barang.id).id, barangId: barang.id, jumlah: 10 }, { barisPesananId: bb(jasa.id).id, barangId: jasa.id, jumlah: 1 }] })));
  const barang3 = await db.barang.findUniqueOrThrow({ where: { id: barang.id } });
  // rata-rata: (6 × 8.000 + 10 × 9.000) / 16 = 8.625
  pastikan(Number(barang3.hargaBeli) === 8625, `harga pokok rata-rata setelah TB = 8.625: ${Number(barang3.hargaBeli)}`);
  const tb = await db.penerimaanBarang.findFirstOrThrow({ where: { pesananId: psb.id }, include: { jurnal: { include: { baris: true } } } });
  pastikan(tb.jurnal?.nomor.startsWith("JU-TB") && tb.jurnal.baris.some((b) => b.akunId === pemetaan.barangBelumDitagihId && Number(b.kredit) === 90000), "JU-TB: Cr Barang Diterima Belum Ditagih 90.000 (jasa tidak ikut)");
  await pastikanSinkron("terima barang");
  await jalankan("FB: barang @10.000 (beda dari pesanan 9.000) + jasa 50.000", () => buatFakturPembelian(formulir({ pesananId: psb.id, baris: [{ barangId: barang.id, jumlah: 10, harga: 10000 }, { barangId: jasa.id, jumlah: 1, harga: 50000 }] })));
  const barang4 = await db.barang.findUniqueOrThrow({ where: { id: barang.id } });
  // selisih 10 × 1.000 = 10.000 disebar ke 16 unit: 8.625 + 625 = 9.250
  pastikan(Number(barang4.hargaBeli) === 9250, `harga pokok setelah FB beda harga = 9.250: ${Number(barang4.hargaBeli)}`);
  const jurnalFb = await db.jurnal.findFirstOrThrow({ where: { nomor: { startsWith: "JU-FB" }, tanggal: { gte: mulaiUji } }, include: { baris: true }, orderBy: { tanggal: "desc" } });
  pastikan(jurnalFb.baris.some((b) => b.akunId === pemetaan.bebanJasaId && Number(b.debit) === 50000), "JU-FB: jasa didebit ke akun beban jasa 50.000");
  pastikan(jurnalFb.baris.some((b) => b.akunId === pemetaan.barangBelumDitagihId && Number(b.debit) === 90000), "JU-FB: Dr Barang Diterima Belum Ditagih 90.000 (menutup TB)");
  pastikan(jurnalFb.baris.some((b) => b.akunId === pemetaan.utangUsahaId && Number(b.kredit) === 150000), "JU-FB: Cr Hutang 150.000");
  await pastikanSinkron("faktur pembelian");
  const fb = await db.fakturPembelian.findFirstOrThrow({ where: { pesananId: psb.id } });
  await jalankan("RB 2 barang (harga faktur 10.000 vs pokok 9.250 → selisih 1.500)", () => buatReturPembelian(formulir({ fakturId: fb.id, gudangId: gudang.id, baris: [{ barangId: barang.id, jumlah: 2 }] })));
  const jurnalRb = await db.jurnal.findFirstOrThrow({ where: { nomor: { startsWith: "JU-RB" }, tanggal: { gte: mulaiUji } }, include: { baris: true }, orderBy: { tanggal: "desc" } });
  pastikan(jurnalRb.baris.some((b) => b.akunId === pemetaan.selisihPersediaanId && Number(b.kredit) === 1500), "JU-RB: selisih 1.500 ke akun Selisih Persediaan");
  const fbSetelah = await db.fakturPembelian.findUniqueOrThrow({ where: { id: fb.id } });
  pastikan(fbSetelah.status === "SEBAGIAN", `status faktur pembelian setelah retur = SEBAGIAN: ${fbSetelah.status}`);
  await pastikanSinkron("retur pembelian");

  console.log("=== 4. Aset tetap dibayar dari kas → jurnal perolehan ===");
  await jalankan("AT dibayar kas", () => buatAsetTetap(formulir({ kode: "AT-SYNC", nama: "Aset Uji Sinkron", hargaPerolehan: 1200000, nilaiSisa: 0, umurBulan: 12, akunAsetId: asetAkun.id, akunBebanPenyusutanId: bebanSusut.id, akunAkumulasiPenyusutanId: akum.id, akunPembayaranId: kas.id })));
  const aset = await db.asetTetap.findUniqueOrThrow({ where: { kode: "AT-SYNC" }, include: { jurnalPerolehan: true } });
  pastikan(aset.jurnalPerolehan?.nomor.startsWith("JU-AT") && (await saldo(asetAkun.id)) === 1200000 && (await saldo(kas.id)) === -1200000, `JU-AT: Dr Aset 1.200.000 / Cr Kas (${aset.jurnalPerolehan?.nomor})`);
  await pastikanSinkron("perolehan aset");

  console.log("=== Bersih-bersih ===");
  const jids = (await db.jurnal.findMany({ where: { tanggal: { gte: mulaiUji } }, select: { id: true } })).map((j) => j.id);
  await db.asetTetap.deleteMany({ where: { kode: "AT-SYNC" } });
  await db.penerimaanBarang.updateMany({ where: { pesananId: psb.id }, data: { jurnalId: null } });
  await db.penyesuaianPersediaan.updateMany({ where: { gudangId: gudang.id }, data: { jurnalId: null } });
  await db.barisJurnal.deleteMany({ where: { jurnalId: { in: jids } } });
  await db.jurnal.deleteMany({ where: { id: { in: jids } } });
  await db.barisReturPembelian.deleteMany({ where: { retur: { fakturId: fb.id } } });
  await db.returPembelian.deleteMany({ where: { fakturId: fb.id } });
  await db.barisFakturPembelian.deleteMany({ where: { fakturId: fb.id } });
  await db.fakturPembelian.deleteMany({ where: { id: fb.id } });
  await db.barisPenerimaanBarang.deleteMany({ where: { penerimaan: { pesananId: psb.id } } });
  await db.penerimaanBarang.deleteMany({ where: { pesananId: psb.id } });
  await db.barisPesananPembelian.deleteMany({ where: { pesananId: psb.id } });
  await db.pesananPembelian.deleteMany({ where: { id: psb.id } });
  await db.barisFakturPenjualan.deleteMany({ where: { faktur: { pesananId: pesanan.id } } });
  await db.fakturPenjualan.deleteMany({ where: { pesananId: pesanan.id } });
  await db.barisPengiriman.deleteMany({ where: { pengiriman: { pesananId: pesanan.id } } });
  await db.pengirimanPesanan.deleteMany({ where: { pesananId: pesanan.id } });
  await db.barisPesananPenjualan.deleteMany({ where: { pesananId: pesanan.id } });
  await db.pesananPenjualan.deleteMany({ where: { id: pesanan.id } });
  await db.barisPenyesuaianPersediaan.deleteMany({ where: { penyesuaian: { gudangId: gudang.id } } });
  await db.penyesuaianPersediaan.deleteMany({ where: { gudangId: gudang.id } });
  await db.stokBarang.deleteMany({ where: { gudangId: gudang.id } });
  await db.barang.deleteMany({ where: { id: { in: [barang.id, jasa.id] } } });
  await db.pelanggan.delete({ where: { id: pelanggan.id } });
  await db.pemasok.delete({ where: { id: pemasok.id } });
  await db.gudang.delete({ where: { id: gudang.id } });
  await db.akun.deleteMany({ where: { kode: { startsWith: "SYNC-" } } });
  await pastikanSinkron("bersih-bersih");
  console.log("=== DONE, all persediaan/sinkron checks passed ===");
}

main().then(() => process.exit(0)).catch((err) => { console.error("TEST FAILED", err); process.exit(1); });
