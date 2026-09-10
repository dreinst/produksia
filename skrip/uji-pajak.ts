import "dotenv/config";
// Skrip ini memanggil aksi server di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { db } from "../src/lib/db";
import { periksaSinkron } from "../src/lib/sinkron";
import { buatPesanan, buatFaktur, buatPenerimaan, buatRetur } from "../src/lib/aksi/penjualan";
import { buatPesananPembelian, buatFakturPembelian, buatPembayaranPembelian, buatReturPembelian } from "../src/lib/aksi/pembelian";

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
async function saldo(akunId: string) {
  const agg = await db.barisJurnal.aggregate({ where: { akunId }, _sum: { debit: true, kredit: true } });
  return Number(agg._sum.debit ?? 0) - Number(agg._sum.kredit ?? 0);
}
async function pastikanSinkron(label: string) {
  const s = await periksaSinkron(db);
  pastikan(s.seimbang && s.persediaan.sinkron && s.piutang.sinkron && s.hutang.sinkron, `sinkron setelah ${label} (piutang BB ${Number(s.piutang.bukuBesar)} vs dok ${Number(s.piutang.dokumen)}; hutang ${Number(s.hutang.bukuBesar)} vs ${Number(s.hutang.dokumen)})`);
}

async function main() {
  const mulaiUji = new Date();
  const pengaturanAwal = await db.pengaturanPerusahaan.findUnique({ where: { id: "default" } });

  console.log("=== Data uji & pengaturan PKP ===");
  const [ppnKeluaran, ppnMasukan, pph23Dimuka, pph23Hutang, kas] = await Promise.all([
    db.akun.create({ data: { kode: "TPJK-PPNK", nama: "PPN Keluaran Uji", jenis: "KEWAJIBAN" } }),
    db.akun.create({ data: { kode: "TPJK-PPNM", nama: "PPN Masukan Uji", jenis: "ASET" } }),
    db.akun.create({ data: { kode: "TPJK-PPH23D", nama: "PPh 23 Dimuka Uji", jenis: "ASET" } }),
    db.akun.create({ data: { kode: "TPJK-PPH23H", nama: "Hutang PPh 23 Uji", jenis: "KEWAJIBAN" } }),
    db.akun.create({ data: { kode: "TPJK-KAS", nama: "Kas Uji Pajak", jenis: "ASET", kasBank: true } }),
  ]);
  const pelanggan = await db.pelanggan.create({ data: { kode: "CUST-PJK", nama: "Pelanggan Uji Pajak" } });
  const pemasok = await db.pemasok.create({ data: { kode: "SUP-PJK", nama: "Vendor Uji Pajak" } });
  const gudang = await db.gudang.create({ data: { kode: "WH-PJK", nama: "Gudang Uji Pajak" } });
  const jasa = await db.barang.create({ data: { kode: "JSA-PJK", nama: "Jasa Uji Pajak", jenis: "JASA", hargaBeli: 0, hargaJual: 100000 } });
  const pemetaan = await db.pemetaanAkun.findUniqueOrThrow({ where: { id: "default" } });

  console.log("=== 1. Non-PKP: faktur dengan PPN ditolak ===");
  await db.pengaturanPerusahaan.upsert({ where: { id: "default" }, create: { id: "default", nama: "Uji Pajak", pkp: false }, update: { pkp: false } });
  await jalankan("PSJ 2 jasa @100.000", () => buatPesanan(formulir({ pelangganId: pelanggan.id, baris: [{ barangId: jasa.id, jumlah: 2, harga: 100000 }] })));
  const pesanan = await db.pesananPenjualan.findFirstOrThrow({ where: { pelangganId: pelanggan.id } });
  await harusDitolak("faktur PPN 11% saat non-PKP", () => buatFaktur(formulir({ pesananId: pesanan.id, ppnPersen: 11, baris: [{ barangId: jasa.id, jumlah: 2, harga: 100000 }] })), "belum berstatus PKP");

  console.log("=== 2. PKP: Faktur Penjualan memungut PPN 11% ===");
  await db.pengaturanPerusahaan.update({
    where: { id: "default" },
    data: { pkp: true, tarifPpnPersen: 11, terminHari: 30, akunPpnKeluaranId: ppnKeluaran.id, akunPpnMasukanId: ppnMasukan.id, akunPph23DimukaId: pph23Dimuka.id, akunPph23DipotongId: pph23Hutang.id },
  });
  await jalankan("FJ 2 jasa (DPP 200.000, PPN 22.000)", () => buatFaktur(formulir({ pesananId: pesanan.id, baris: [{ barangId: jasa.id, jumlah: 2, harga: 100000 }] })));
  const faktur = await db.fakturPenjualan.findFirstOrThrow({ where: { pesananId: pesanan.id } });
  pastikan(Number(faktur.dpp) === 200000 && Number(faktur.ppn) === 22000 && Number(faktur.total) === 222000 && Number(faktur.ppnPersen) === 11, `faktur dpp/ppn/total = ${Number(faktur.dpp)}/${Number(faktur.ppn)}/${Number(faktur.total)}`);
  const selisihHari = Math.round((faktur.jatuhTempo!.getTime() - faktur.tanggal.getTime()) / 86400000);
  pastikan(selisihHari === 30, `jatuh tempo memakai termin 30 hari (dapat ${selisihHari})`);
  pastikan((await saldo(ppnKeluaran.id)) === -22000 && (await saldo(pemetaan.piutangUsahaId)) >= 222000, "JU-FJ: Cr PPN Keluaran 22.000, Dr Piutang 222.000");
  await pastikanSinkron("faktur PPN");

  console.log("=== 3. Retur 1 jasa membalik PPN proporsional ===");
  await jalankan("RJ 1 jasa (DPP 100.000, PPN 11.000)", () => buatRetur(formulir({ fakturId: faktur.id, gudangId: gudang.id, baris: [{ barangId: jasa.id, jumlah: 1 }] })));
  const retur = await db.returPenjualan.findFirstOrThrow({ where: { fakturId: faktur.id } });
  pastikan(Number(retur.dpp) === 100000 && Number(retur.ppn) === 11000 && Number(retur.total) === 111000, `retur dpp/ppn/total = ${Number(retur.dpp)}/${Number(retur.ppn)}/${Number(retur.total)}`);
  pastikan((await saldo(ppnKeluaran.id)) === -11000, "JU-RJ: PPN Keluaran tersisa 11.000");
  await pastikanSinkron("retur PPN");

  console.log("=== 4. Penerimaan dengan potongan PPh 23 (2% dari DPP sisa 100.000) ===");
  await harusDitolak("bayar + potongan melebihi sisa", () => buatPenerimaan(formulir({ fakturId: faktur.id, akunId: kas.id, jumlah: 111000, potonganPajak: 2000 })), "melebihi sisa tagihan");
  await jalankan("TRM 109.000 + PPh 23 2.000 → LUNAS", () => buatPenerimaan(formulir({ fakturId: faktur.id, akunId: kas.id, jumlah: 109000, potonganPajak: 2000, metodeBayar: "TRANSFER" })));
  const fakturLunas = await db.fakturPenjualan.findUniqueOrThrow({ where: { id: faktur.id } });
  pastikan(fakturLunas.status === "LUNAS", `status faktur ${fakturLunas.status}`);
  pastikan((await saldo(pph23Dimuka.id)) === 2000 && (await saldo(kas.id)) === 109000, "JU-TRM: Dr PPh 23 dimuka 2.000, Dr Kas 109.000");
  await pastikanSinkron("penerimaan PPh 23");

  console.log("=== 5. Pembelian jasa: PPN masukan, retur, pembayaran dengan potongan PPh 23 ===");
  await jalankan("PSB 2 jasa @50.000", () => buatPesananPembelian(formulir({ pemasokId: pemasok.id, baris: [{ barangId: jasa.id, jumlah: 2, harga: 50000 }] })));
  const psb = await db.pesananPembelian.findFirstOrThrow({ where: { pemasokId: pemasok.id } });
  await jalankan("FB 2 jasa (DPP 100.000, PPN 11.000)", () => buatFakturPembelian(formulir({ pesananId: psb.id, baris: [{ barangId: jasa.id, jumlah: 2, harga: 50000 }] })));
  const fb = await db.fakturPembelian.findFirstOrThrow({ where: { pesananId: psb.id } });
  pastikan(Number(fb.dpp) === 100000 && Number(fb.ppn) === 11000 && Number(fb.total) === 111000, `FB dpp/ppn/total = ${Number(fb.dpp)}/${Number(fb.ppn)}/${Number(fb.total)}`);
  pastikan((await saldo(ppnMasukan.id)) === 11000 && (await saldo(pemetaan.bebanJasaId ?? pemetaan.hppId)) >= 100000, "JU-FB: Dr PPN Masukan 11.000, Dr beban jasa 100.000");
  await jalankan("RB 1 jasa (DPP 50.000, PPN 5.500)", () => buatReturPembelian(formulir({ fakturId: fb.id, gudangId: gudang.id, baris: [{ barangId: jasa.id, jumlah: 1 }] })));
  pastikan((await saldo(ppnMasukan.id)) === 5500, "JU-RB: PPN Masukan tersisa 5.500");
  await jalankan("BYR 54.500 + potong PPh 23 1.000 → LUNAS", () => buatPembayaranPembelian(formulir({ fakturId: fb.id, akunId: kas.id, jumlah: 54500, potonganPajak: 1000 })));
  const fbLunas = await db.fakturPembelian.findUniqueOrThrow({ where: { id: fb.id } });
  pastikan(fbLunas.status === "LUNAS", `status faktur pembelian ${fbLunas.status}`);
  pastikan((await saldo(pph23Hutang.id)) === -1000 && (await saldo(kas.id)) === 109000 - 54500, "JU-BYR: Cr Hutang PPh 23 1.000, Cr Kas 54.500");
  await pastikanSinkron("pembayaran PPh 23");

  console.log("=== Bersih-bersih & pulihkan pengaturan ===");
  const jids = (await db.jurnal.findMany({ where: { tanggal: { gte: mulaiUji } }, select: { id: true } })).map((j) => j.id);
  await db.barisJurnal.deleteMany({ where: { jurnalId: { in: jids } } });
  await db.jurnal.deleteMany({ where: { id: { in: jids } } });
  await db.barisReturPembelian.deleteMany({ where: { retur: { fakturId: fb.id } } });
  await db.returPembelian.deleteMany({ where: { fakturId: fb.id } });
  await db.pembayaranPembelian.deleteMany({ where: { fakturId: fb.id } });
  await db.barisFakturPembelian.deleteMany({ where: { fakturId: fb.id } });
  await db.fakturPembelian.deleteMany({ where: { id: fb.id } });
  await db.barisPesananPembelian.deleteMany({ where: { pesananId: psb.id } });
  await db.pesananPembelian.deleteMany({ where: { id: psb.id } });
  await db.barisReturPenjualan.deleteMany({ where: { retur: { fakturId: faktur.id } } });
  await db.returPenjualan.deleteMany({ where: { fakturId: faktur.id } });
  await db.penerimaanPenjualan.deleteMany({ where: { fakturId: faktur.id } });
  await db.barisFakturPenjualan.deleteMany({ where: { fakturId: faktur.id } });
  await db.fakturPenjualan.deleteMany({ where: { id: faktur.id } });
  await db.barisPesananPenjualan.deleteMany({ where: { pesananId: pesanan.id } });
  await db.pesananPenjualan.deleteMany({ where: { id: pesanan.id } });
  await db.barang.delete({ where: { id: jasa.id } });
  await db.pelanggan.delete({ where: { id: pelanggan.id } });
  await db.pemasok.delete({ where: { id: pemasok.id } });
  await db.gudang.delete({ where: { id: gudang.id } });
  if (pengaturanAwal) {
    const { id: _id, ...data } = pengaturanAwal;
    void _id;
    await db.pengaturanPerusahaan.update({ where: { id: "default" }, data });
  } else {
    await db.pengaturanPerusahaan.delete({ where: { id: "default" } });
  }
  await db.akun.deleteMany({ where: { kode: { startsWith: "TPJK-" } } });
  await pastikanSinkron("bersih-bersih");
  console.log("=== DONE, all pajak checks passed ===");
}

main().then(() => process.exit(0)).catch((err) => { console.error("TEST FAILED", err); process.exit(1); });
