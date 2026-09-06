import "dotenv/config";
import { db } from "../src/lib/db";
import { createOrder, createDelivery, createInvoice, createReceipt, createReturn } from "../src/lib/actions/sales";

async function expectThrow(label: string, fn: () => Promise<void>, expected: string) {
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
  const testStart = new Date();
  const wh = await db.warehouse.create({ data: { code: "WH-GUARD", name: "Gudang Guard Test" } });
  const item = await db.item.create({ data: { code: "ITM-GUARD", name: "Barang Guard Test", unit: "pcs", costPrice: 1000, sellPrice: 2000 } });
  const cust = await db.customer.create({ data: { code: "CUST-GUARD", name: "Pelanggan Guard" } });
  const kas = await db.account.create({ data: { code: "GUARD-KAS", name: "Kas Guard", type: "ASET" } });
  await db.itemStock.create({ data: { itemId: item.id, warehouseId: wh.id, qty: 5 } });

  console.log("=== Pesanan 10 pcs, stok cuma 5 ===");
  const of = new FormData(); of.set("customerId", cust.id);
  of.set("lines", JSON.stringify([{ itemId: item.id, qty: 10, price: 2000 }]));
  await ok("createOrder", () => createOrder(of));
  const order = await db.salesOrder.findFirstOrThrow({ where: { customerId: cust.id }, include: { lines: true } });

  console.log("=== 1. Kirim 10 saat stok 5 -> harus ditolak, stok tetap 5 ===");
  const d1 = new FormData(); d1.set("orderId", order.id); d1.set("warehouseId", wh.id);
  d1.set("lines", JSON.stringify([{ orderLineId: order.lines[0].id, itemId: item.id, qty: 10 }]));
  await expectThrow("createDelivery (stok kurang)", () => createDelivery(d1), "tidak cukup");
  const s1 = await db.itemStock.findUniqueOrThrow({ where: { itemId_warehouseId: { itemId: item.id, warehouseId: wh.id } } });
  if (s1.qty.toString() !== "5") throw new Error(`stok berubah padahal ditolak: ${s1.qty}`);
  console.log("stok tetap:", s1.qty.toString());

  console.log("=== 2. Kirim 12 (> sisa pesanan 10) -> ditolak ===");
  const d2 = new FormData(); d2.set("orderId", order.id); d2.set("warehouseId", wh.id);
  d2.set("lines", JSON.stringify([{ orderLineId: order.lines[0].id, itemId: item.id, qty: 12 }]));
  await expectThrow("createDelivery (lebih dari pesanan)", () => createDelivery(d2), "melebihi sisa pesanan");

  console.log("=== 3. Kirim 5 -> ok, stok 0 ===");
  const d3 = new FormData(); d3.set("orderId", order.id); d3.set("warehouseId", wh.id);
  d3.set("lines", JSON.stringify([{ orderLineId: order.lines[0].id, itemId: item.id, qty: 5 }]));
  await ok("createDelivery 5", () => createDelivery(d3));

  console.log("=== 4. Faktur 11 (> pesanan 10) -> ditolak; faktur 10 -> ok ===");
  const i1 = new FormData(); i1.set("orderId", order.id);
  i1.set("lines", JSON.stringify([{ itemId: item.id, qty: 11, price: 2000 }]));
  await expectThrow("createInvoice (lebih dari pesanan)", () => createInvoice(i1), "melebihi sisa");
  const i2 = new FormData(); i2.set("orderId", order.id);
  i2.set("lines", JSON.stringify([{ itemId: item.id, qty: 10, price: 2000 }]));
  await ok("createInvoice 10", () => createInvoice(i2));
  const inv = await db.salesInvoice.findFirstOrThrow({ where: { orderId: order.id } });

  console.log("=== 5. Bayar 25.000 untuk faktur 20.000 -> ditolak; bayar 20.000 -> lunas; bayar lagi -> ditolak ===");
  const p1 = new FormData(); p1.set("invoiceId", inv.id); p1.set("accountId", kas.id); p1.set("amount", "25000");
  await expectThrow("createReceipt (overpay)", () => createReceipt(p1), "melebihi sisa tagihan");
  const p2 = new FormData(); p2.set("invoiceId", inv.id); p2.set("accountId", kas.id); p2.set("amount", "20000");
  await ok("createReceipt 20000", () => createReceipt(p2));
  const p3 = new FormData(); p3.set("invoiceId", inv.id); p3.set("accountId", kas.id); p3.set("amount", "1");
  await expectThrow("createReceipt (sudah lunas)", () => createReceipt(p3), "sudah lunas");

  console.log("=== 6. Retur 11 (> faktur 10) -> ditolak; retur 4 ok; retur 7 lagi (4+7 > 10) -> ditolak ===");
  const r1 = new FormData(); r1.set("invoiceId", inv.id); r1.set("warehouseId", wh.id);
  r1.set("lines", JSON.stringify([{ itemId: item.id, qty: 11 }]));
  await expectThrow("createReturn (lebih dari faktur)", () => createReturn(r1), "melebihi yang bisa diretur");
  const r2 = new FormData(); r2.set("invoiceId", inv.id); r2.set("warehouseId", wh.id);
  r2.set("lines", JSON.stringify([{ itemId: item.id, qty: 4 }]));
  await ok("createReturn 4", () => createReturn(r2));
  const r3 = new FormData(); r3.set("invoiceId", inv.id); r3.set("warehouseId", wh.id);
  r3.set("lines", JSON.stringify([{ itemId: item.id, qty: 7 }]));
  await expectThrow("createReturn (akumulasi > faktur)", () => createReturn(r3), "melebihi yang bisa diretur");

  console.log("=== 7. Desimal: 3 x 0.1 harus persis 0.3 (bukan 0.30000000000000004) ===");
  const of2 = new FormData(); of2.set("customerId", cust.id);
  of2.set("lines", JSON.stringify([{ itemId: item.id, qty: 3, price: 0.1 }]));
  await ok("createOrder desimal", () => createOrder(of2));
  const o2 = await db.salesOrder.findFirstOrThrow({ where: { customerId: cust.id, total: 0.3 } });
  console.log("total tersimpan:", o2.total.toString());

  console.log("=== 8. Constraint DB: update langsung ke stok negatif harus ditolak ===");
  await expectThrow("raw negative stock", async () => {
    await db.itemStock.update({ where: { itemId_warehouseId: { itemId: item.id, warehouseId: wh.id } }, data: { qty: -1 } });
  }, "ItemStock_qty_non_negative");

  console.log("=== Cleanup ===");
  const jids = (await db.journalEntry.findMany({ where: { date: { gte: testStart } }, select: { id: true } })).map((j) => j.id);
  await db.journalLine.deleteMany({ where: { journalEntryId: { in: jids } } });
  await db.journalEntry.deleteMany({ where: { id: { in: jids } } });
  await db.salesReturnLine.deleteMany({ where: { return: { invoiceId: inv.id } } });
  await db.salesReturn.deleteMany({ where: { invoiceId: inv.id } });
  await db.salesReceipt.deleteMany({ where: { invoiceId: inv.id } });
  await db.salesInvoiceLine.deleteMany({ where: { invoiceId: inv.id } });
  await db.salesInvoice.deleteMany({ where: { id: inv.id } });
  await db.deliveryLine.deleteMany({ where: { delivery: { order: { customerId: cust.id } } } });
  await db.delivery.deleteMany({ where: { order: { customerId: cust.id } } });
  await db.salesOrderLine.deleteMany({ where: { order: { customerId: cust.id } } });
  await db.salesOrder.deleteMany({ where: { customerId: cust.id } });
  await db.itemStock.deleteMany({ where: { itemId: item.id } });
  await db.item.delete({ where: { id: item.id } });
  await db.customer.delete({ where: { id: cust.id } });
  await db.warehouse.delete({ where: { id: wh.id } });
  await db.account.delete({ where: { id: kas.id } });
  console.log("=== DONE, all guard checks passed ===");
  process.exit(0);
}
main().catch((e) => { console.error("TEST SUITE FAILED", e); process.exit(1); });
