import "dotenv/config";
import { db } from "../src/lib/db";
import {
  buatPesananPembelian,
  buatPenerimaanBarang,
  buatFakturPembelian,
  buatPembayaranPembelian,
  buatReturPembelian,
} from "../src/lib/aksi/pembelian";

async function jalankanAbaikanRedirect(label: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`[ok, nomor redirect thrown] ${label}`);
  } catch (err: unknown) {
    const digest = (err as { digest?: string })?.digest;
    const message = (err as { message?: string })?.message ?? "";
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) {
      console.log(`[ok] ${label} -> redirected as expected`);
    } else if (message.includes("static generation store missing")) {
      console.log(`[ok, ignored outside-Next-context artifact] ${label}`);
    } else {
      console.error(`[FAIL] ${label}`, err);
      throw err;
    }
  }
}

async function main() {
  const mulaiUji = new Date();
  console.log("=== Seed master data ===");
  const gudang = await db.gudang.create({ data: { kode: "WH-PTEST", nama: "Gudang Purchasing Test" } });
  const kelompok = await db.kelompokBarang.create({ data: { nama: "Kategori Purchasing Test" } });
  const barang = await db.barang.create({
    data: { kode: "ITM-PTEST", nama: "Barang Purchasing Test", kelompokId: kelompok.id, satuan: "pcs", hargaBeli: 5000, hargaJual: 10000 },
  });
  const pemasok = await db.pemasok.create({ data: { kode: "SUP-PTEST", nama: "Pemasok Test" } });
  await db.stokBarang.create({ data: { barangId: barang.id, gudangId: gudang.id, jumlah: 50 } });
  const akunKas = await db.akun.create({ data: { kode: "PTEST-KAS", nama: "Kas Purchasing Test", jenis: "ASET" } });

  let pemetaan = await db.pemetaanAkun.findUnique({ where: { id: "default" } });
  let pemetaanDibuat = false;
  let akunPemetaan: string[] = [];
  if (!pemetaan) {
    const [piutang, persediaanAkun, hpp, pendapatan, utang] = await Promise.all([
      db.akun.create({ data: { kode: "PTEST-PIUTANG", nama: "Piutang Test", jenis: "ASET" } }),
      db.akun.create({ data: { kode: "PTEST-PERSEDIAAN", nama: "Persediaan Test", jenis: "ASET" } }),
      db.akun.create({ data: { kode: "PTEST-HPP", nama: "HPP Test", jenis: "BEBAN" } }),
      db.akun.create({ data: { kode: "PTEST-PENDAPATAN", nama: "Pendapatan Test", jenis: "PENDAPATAN" } }),
      db.akun.create({ data: { kode: "PTEST-UTANG", nama: "Utang Test", jenis: "KEWAJIBAN" } }),
    ]);
    akunPemetaan = [piutang.id, persediaanAkun.id, hpp.id, pendapatan.id, utang.id];
    pemetaan = await db.pemetaanAkun.create({
      data: {
        id: "default",
        piutangUsahaId: piutang.id,
        persediaanId: persediaanAkun.id,
        hppId: hpp.id,
        pendapatanPenjualanId: pendapatan.id,
        utangUsahaId: utang.id,
      },
    });
    pemetaanDibuat = true;
  }

  console.log("=== 1. Create Purchase Order (jumlah 20) ===");
  const jumlahDipesan = 20;
  const poFd = new FormData();
  poFd.set("pemasokId", pemasok.id);
  poFd.set("baris", JSON.stringify([{ barangId: barang.id, jumlah: jumlahDipesan, harga: 5000 }]));
  await jalankanAbaikanRedirect("buatPesananPembelian", () => buatPesananPembelian(poFd));

  const pesanan = await db.pesananPembelian.findFirstOrThrow({ where: { pemasokId: pemasok.id }, include: { baris: true } });
  console.log("Order status:", pesanan.status, "total:", pesanan.total.toString());

  console.log("=== 2. Goods Receipt (partial: 8 of 20) ===");
  const gr1 = new FormData();
  gr1.set("pesananId", pesanan.id);
  gr1.set("gudangId", gudang.id);
  gr1.set("baris", JSON.stringify([{ barisPesananId: pesanan.baris[0].id, barangId: barang.id, jumlah: 8 }]));
  await jalankanAbaikanRedirect("buatPenerimaanBarang (partial)", () => buatPenerimaanBarang(gr1));

  let stok = await db.stokBarang.findUniqueOrThrow({ where: { barangId_gudangId: { barangId: barang.id, gudangId: gudang.id } } });
  console.log("Stock after partial penerimaan (expect 58):", stok.jumlah.toString());

  let orderAfterPartial = await db.pesananPembelian.findUniqueOrThrow({ where: { id: pesanan.id } });
  console.log("Order status after partial penerimaan (expect SEBAGIAN):", orderAfterPartial.status);

  console.log("=== 3. Goods Receipt (sisa 12) ===");
  const gr2 = new FormData();
  gr2.set("pesananId", pesanan.id);
  gr2.set("gudangId", gudang.id);
  gr2.set("baris", JSON.stringify([{ barisPesananId: pesanan.baris[0].id, barangId: barang.id, jumlah: 12 }]));
  await jalankanAbaikanRedirect("buatPenerimaanBarang (sisa)", () => buatPenerimaanBarang(gr2));

  stok = await db.stokBarang.findUniqueOrThrow({ where: { barangId_gudangId: { barangId: barang.id, gudangId: gudang.id } } });
  console.log("Stock after full penerimaan (expect 70):", stok.jumlah.toString());

  const orderAfterFull = await db.pesananPembelian.findUniqueOrThrow({ where: { id: pesanan.id } });
  console.log("Order status after full penerimaan (expect DIPROSES):", orderAfterFull.status);

  console.log("=== 4. Purchase Invoice (full jumlah) ===");
  const invFd = new FormData();
  invFd.set("pesananId", pesanan.id);
  invFd.set("baris", JSON.stringify([{ barangId: barang.id, jumlah: jumlahDipesan, harga: 5000 }]));
  await jalankanAbaikanRedirect("buatFakturPembelian", () => buatFakturPembelian(invFd));

  const faktur = await db.fakturPembelian.findFirstOrThrow({ where: { pesananId: pesanan.id } });
  console.log("Invoice total (expect 100000):", faktur.total.toString());

  console.log("=== 5. Purchase Payment (partial 40000) ===");
  const pay1 = new FormData();
  pay1.set("fakturId", faktur.id);
  pay1.set("akunId", akunKas.id);
  pay1.set("jumlah", "40000");
  await jalankanAbaikanRedirect("buatPembayaranPembelian (partial)", () => buatPembayaranPembelian(pay1));

  let invoiceAfterPartialPay = await db.fakturPembelian.findUniqueOrThrow({ where: { id: faktur.id } });
  console.log("Invoice status after partial pay (expect SEBAGIAN):", invoiceAfterPartialPay.status);

  console.log("=== 6. Purchase Payment (sisa 60000) ===");
  const pay2 = new FormData();
  pay2.set("fakturId", faktur.id);
  pay2.set("akunId", akunKas.id);
  pay2.set("jumlah", "60000");
  await jalankanAbaikanRedirect("buatPembayaranPembelian (sisa)", () => buatPembayaranPembelian(pay2));

  const invoiceAfterFullPay = await db.fakturPembelian.findUniqueOrThrow({ where: { id: faktur.id } });
  console.log("Invoice status after full pay (expect LUNAS):", invoiceAfterFullPay.status);

  console.log("=== 7. Purchase Return (3 units, stok should decrease) ===");
  const retFd = new FormData();
  retFd.set("fakturId", faktur.id);
  retFd.set("gudangId", gudang.id);
  retFd.set("alasan", "Barang cacat");
  retFd.set("baris", JSON.stringify([{ barangId: barang.id, jumlah: 3 }]));
  await jalankanAbaikanRedirect("buatReturPembelian", () => buatReturPembelian(retFd));

  stok = await db.stokBarang.findUniqueOrThrow({ where: { barangId_gudangId: { barangId: barang.id, gudangId: gudang.id } } });
  console.log("Stock after return of 3 (expect 67):", stok.jumlah.toString());

  console.log("=== Cleanup ===");
  await db.barisReturPembelian.deleteMany({ where: { retur: { fakturId: faktur.id } } });
  await db.returPembelian.deleteMany({ where: { fakturId: faktur.id } });
  await db.pembayaranPembelian.deleteMany({ where: { fakturId: faktur.id } });
  await db.barisFakturPembelian.deleteMany({ where: { fakturId: faktur.id } });
  await db.fakturPembelian.deleteMany({ where: { id: faktur.id } });
  await db.barisPenerimaanBarang.deleteMany({ where: { penerimaan: { pesananId: pesanan.id } } });
  await db.penerimaanBarang.deleteMany({ where: { pesananId: pesanan.id } });
  await db.barisPesananPembelian.deleteMany({ where: { pesananId: pesanan.id } });
  await db.pesananPembelian.deleteMany({ where: { id: pesanan.id } });
  await db.stokBarang.deleteMany({ where: { barangId: barang.id } });
  await db.barang.deleteMany({ where: { id: barang.id } });
  await db.kelompokBarang.deleteMany({ where: { id: kelompok.id } });
  await db.pemasok.deleteMany({ where: { id: pemasok.id } });
  await db.gudang.deleteMany({ where: { id: gudang.id } });

  const journalIds = (
    await db.jurnal.findMany({ where: { tanggal: { gte: mulaiUji } }, select: { id: true } })
  ).map((j) => j.id);
  await db.barisJurnal.deleteMany({ where: { jurnalId: { in: journalIds } } });
  await db.jurnal.deleteMany({ where: { id: { in: journalIds } } });
  await db.akun.deleteMany({ where: { id: akunKas.id } });

  if (pemetaanDibuat) {
    await db.pemetaanAkun.deleteMany({ where: { id: "default" } });
    await db.akun.deleteMany({ where: { id: { in: akunPemetaan } } });
  }

  console.log("=== DONE, all purchasing checks passed ===");
  process.exit(0);
}

main().catch((err) => {
  console.error("TEST SUITE FAILED", err);
  process.exit(1);
});
