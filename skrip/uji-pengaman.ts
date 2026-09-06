import "dotenv/config";
import { db } from "../src/lib/db";
import { buatPesanan, buatPengiriman, buatFaktur, buatPenerimaan, buatRetur } from "../src/lib/aksi/penjualan";

async function harapGagal(label: string, fn: () => Promise<void>, expected: string) {
  try {
    await fn();
    throw new Error(`${label} should have thrown`);
  } catch (err: unknown) {
    const message = (err as { message?: string })?.message ?? "";
    if (message.includes(expected)) console.log(`[ok] ${label} -> ditolak: ${message}`);
    else throw err;
  }
}
async function ok(label: string, fn: () => Promise<void>) {
  try { await fn(); } catch (err: unknown) {
    const d = (err as { digest?: string })?.digest ?? ""; const m = (err as { message?: string })?.message ?? "";
    if (!d.startsWith("NEXT_REDIRECT") && !m.includes("static generation store missing")) throw err;
  }
  console.log(`[ok] ${label}`);
}

async function main() {
  const mulaiUji = new Date();
  const wh = await db.gudang.create({ data: { kode: "WH-GUARD", nama: "Gudang Guard Test" } });
  const barang = await db.barang.create({ data: { kode: "ITM-GUARD", nama: "Barang Guard Test", satuan: "pcs", hargaBeli: 1000, hargaJual: 2000 } });
  const cust = await db.pelanggan.create({ data: { kode: "CUST-GUARD", nama: "Pelanggan Guard" } });
  const kas = await db.akun.create({ data: { kode: "GUARD-KAS", nama: "Kas Guard", jenis: "ASET" } });
  await db.stokBarang.create({ data: { barangId: barang.id, gudangId: wh.id, jumlah: 5 } });

  console.log("=== Pesanan 10 pcs, stok cuma 5 ===");
  const of = new FormData(); of.set("pelangganId", cust.id);
  of.set("baris", JSON.stringify([{ barangId: barang.id, jumlah: 10, harga: 2000 }]));
  await ok("buatPesanan", () => buatPesanan(of));
  const pesanan = await db.pesananPenjualan.findFirstOrThrow({ where: { pelangganId: cust.id }, include: { baris: true } });

  console.log("=== 1. Kirim 10 saat stok 5 -> harus ditolak, stok tetap 5 ===");
  const d1 = new FormData(); d1.set("pesananId", pesanan.id); d1.set("gudangId", wh.id);
  d1.set("baris", JSON.stringify([{ barisPesananId: pesanan.baris[0].id, barangId: barang.id, jumlah: 10 }]));
  await harapGagal("buatPengiriman (stok kurang)", () => buatPengiriman(d1), "tidak cukup");
  const s1 = await db.stokBarang.findUniqueOrThrow({ where: { barangId_gudangId: { barangId: barang.id, gudangId: wh.id } } });
  if (s1.jumlah.toString() !== "5") throw new Error(`stok berubah padahal ditolak: ${s1.jumlah}`);
  console.log("stok tetap:", s1.jumlah.toString());

  console.log("=== 2. Kirim 12 (> sisa pesanan 10) -> ditolak ===");
  const d2 = new FormData(); d2.set("pesananId", pesanan.id); d2.set("gudangId", wh.id);
  d2.set("baris", JSON.stringify([{ barisPesananId: pesanan.baris[0].id, barangId: barang.id, jumlah: 12 }]));
  await harapGagal("buatPengiriman (lebih dari pesanan)", () => buatPengiriman(d2), "melebihi sisa pesanan");

  console.log("=== 3. Kirim 5 -> ok, stok 0 ===");
  const d3 = new FormData(); d3.set("pesananId", pesanan.id); d3.set("gudangId", wh.id);
  d3.set("baris", JSON.stringify([{ barisPesananId: pesanan.baris[0].id, barangId: barang.id, jumlah: 5 }]));
  await ok("buatPengiriman 5", () => buatPengiriman(d3));

  console.log("=== 4. Faktur 11 (> pesanan 10) -> ditolak; faktur 10 -> ok ===");
  const i1 = new FormData(); i1.set("pesananId", pesanan.id);
  i1.set("baris", JSON.stringify([{ barangId: barang.id, jumlah: 11, harga: 2000 }]));
  await harapGagal("buatFaktur (lebih dari pesanan)", () => buatFaktur(i1), "melebihi sisa");
  const i2 = new FormData(); i2.set("pesananId", pesanan.id);
  i2.set("baris", JSON.stringify([{ barangId: barang.id, jumlah: 10, harga: 2000 }]));
  await ok("buatFaktur 10", () => buatFaktur(i2));
  const inv = await db.fakturPenjualan.findFirstOrThrow({ where: { pesananId: pesanan.id } });

  console.log("=== 5. Bayar 25.000 untuk faktur 20.000 -> ditolak; bayar 20.000 -> lunas; bayar lagi -> ditolak ===");
  const p1 = new FormData(); p1.set("fakturId", inv.id); p1.set("akunId", kas.id); p1.set("jumlah", "25000");
  await harapGagal("buatPenerimaan (overpay)", () => buatPenerimaan(p1), "melebihi sisa tagihan");
  const p2 = new FormData(); p2.set("fakturId", inv.id); p2.set("akunId", kas.id); p2.set("jumlah", "20000");
  await ok("buatPenerimaan 20000", () => buatPenerimaan(p2));
  const p3 = new FormData(); p3.set("fakturId", inv.id); p3.set("akunId", kas.id); p3.set("jumlah", "1");
  await harapGagal("buatPenerimaan (sudah lunas)", () => buatPenerimaan(p3), "sudah lunas");

  console.log("=== 6. Retur 11 (> faktur 10) -> ditolak; retur 4 ok; retur 7 lagi (4+7 > 10) -> ditolak ===");
  const r1 = new FormData(); r1.set("fakturId", inv.id); r1.set("gudangId", wh.id);
  r1.set("baris", JSON.stringify([{ barangId: barang.id, jumlah: 11 }]));
  await harapGagal("buatRetur (lebih dari faktur)", () => buatRetur(r1), "melebihi yang bisa diretur");
  const r2 = new FormData(); r2.set("fakturId", inv.id); r2.set("gudangId", wh.id);
  r2.set("baris", JSON.stringify([{ barangId: barang.id, jumlah: 4 }]));
  await ok("buatRetur 4", () => buatRetur(r2));
  const r3 = new FormData(); r3.set("fakturId", inv.id); r3.set("gudangId", wh.id);
  r3.set("baris", JSON.stringify([{ barangId: barang.id, jumlah: 7 }]));
  await harapGagal("buatRetur (akumulasi > faktur)", () => buatRetur(r3), "melebihi yang bisa diretur");

  console.log("=== 7. Desimal: 3 x 0.1 harus persis 0.3 (bukan 0.30000000000000004) ===");
  const of2 = new FormData(); of2.set("pelangganId", cust.id);
  of2.set("baris", JSON.stringify([{ barangId: barang.id, jumlah: 3, harga: 0.1 }]));
  await ok("buatPesanan desimal", () => buatPesanan(of2));
  const o2 = await db.pesananPenjualan.findFirstOrThrow({ where: { pelangganId: cust.id, total: 0.3 } });
  console.log("total tersimpan:", o2.total.toString());

  console.log("=== 8. Constraint DB: ubah langsung ke stok negatif harus ditolak ===");
  await harapGagal("raw negative stok", async () => {
    await db.stokBarang.update({ where: { barangId_gudangId: { barangId: barang.id, gudangId: wh.id } }, data: { jumlah: -1 } });
  }, "StokBarang_jumlah_tidak_negatif");

  console.log("=== Cleanup ===");
  const jids = (await db.jurnal.findMany({ where: { tanggal: { gte: mulaiUji } }, select: { id: true } })).map((j) => j.id);
  await db.barisJurnal.deleteMany({ where: { jurnalId: { in: jids } } });
  await db.jurnal.deleteMany({ where: { id: { in: jids } } });
  await db.barisReturPenjualan.deleteMany({ where: { retur: { fakturId: inv.id } } });
  await db.returPenjualan.deleteMany({ where: { fakturId: inv.id } });
  await db.penerimaanPenjualan.deleteMany({ where: { fakturId: inv.id } });
  await db.barisFakturPenjualan.deleteMany({ where: { fakturId: inv.id } });
  await db.fakturPenjualan.deleteMany({ where: { id: inv.id } });
  await db.barisPengiriman.deleteMany({ where: { pengiriman: { pesanan: { pelangganId: cust.id } } } });
  await db.pengirimanPesanan.deleteMany({ where: { pesanan: { pelangganId: cust.id } } });
  await db.barisPesananPenjualan.deleteMany({ where: { pesanan: { pelangganId: cust.id } } });
  await db.pesananPenjualan.deleteMany({ where: { pelangganId: cust.id } });
  await db.stokBarang.deleteMany({ where: { barangId: barang.id } });
  await db.barang.delete({ where: { id: barang.id } });
  await db.pelanggan.delete({ where: { id: cust.id } });
  await db.gudang.delete({ where: { id: wh.id } });
  await db.akun.delete({ where: { id: kas.id } });
  console.log("=== DONE, all guard checks passed ===");
  process.exit(0);
}
main().catch((e) => { console.error("TEST SUITE FAILED", e); process.exit(1); });
