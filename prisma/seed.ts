import "dotenv/config";
import { db } from "../src/lib/db";

/**
 * Satu alur cerita tunggal yang melewati SETIAP tahap siklus penjualan,
 * supaya tiap halaman (Penawaran, Pesanan, Pengiriman, Faktur, Penerimaan, Retur)
 * langsung punya contoh data yang bisa dilihat dan saling terhubung.
 */
async function main() {
  console.log("=== Master data ===");
  const dept = await db.department.create({ data: { name: "Penjualan" } });
  const sales = await db.employee.create({
    data: { code: "SLS-01", name: "Rudi Hartono", departmentId: dept.id },
  });
  const customer = await db.customer.create({
    data: {
      code: "CUST-001",
      name: "Toko Kue Manis",
      address: "Jl. Melati No. 7, Jakarta",
      phone: "021-5551234",
      salesId: sales.id,
    },
  });
  const supplier = await db.supplier.create({
    data: { code: "SUP-001", name: "PT Sumber Tepung Jaya", address: "Kawasan Industri Pulogadung", phone: "021-4449876" },
  });
  const warehouse = await db.warehouse.create({
    data: { code: "WH-01", name: "Gudang Utama", address: "Jl. Raya Bekasi KM 20" },
  });
  const category = await db.itemCategory.create({ data: { name: "Bahan Baku" } });
  await db.project.create({
    data: { code: "PRJ-001", name: "Pesanan Ulang Tahun", customerId: customer.id, status: "OPEN" },
  });

  console.log("=== Daftar Akun (Chart of Accounts) ===");
  const accountDefs = [
    { code: "1-1000", name: "Kas", type: "ASET" as const },
    { code: "1-1100", name: "Bank", type: "ASET" as const },
    { code: "1-1200", name: "Piutang Usaha", type: "ASET" as const },
    { code: "1-1300", name: "Persediaan Barang Dagang", type: "ASET" as const },
    { code: "2-1000", name: "Utang Usaha", type: "KEWAJIBAN" as const },
    { code: "3-1000", name: "Modal Pemilik", type: "MODAL" as const },
    { code: "4-1000", name: "Pendapatan Penjualan", type: "PENDAPATAN" as const },
    { code: "5-1000", name: "Harga Pokok Penjualan", type: "BEBAN" as const },
    { code: "5-2000", name: "Beban Sewa", type: "BEBAN" as const },
    { code: "5-2100", name: "Beban Listrik & Air", type: "BEBAN" as const },
    { code: "1-2000", name: "Peralatan Dapur", type: "ASET" as const },
    { code: "1-2100", name: "Akumulasi Penyusutan Peralatan", type: "ASET" as const },
    { code: "5-3000", name: "Beban Penyusutan", type: "BEBAN" as const },
  ];
  const accounts: Record<string, Awaited<ReturnType<typeof db.account.create>>> = {};
  for (const def of accountDefs) {
    accounts[def.code] = await db.account.create({ data: def });
  }
  const [kas, bank, piutang, persediaanAkun, utang, modal, pendapatan, hpp, sewa, , peralatan, akumPenyusutan, bebanPenyusutan] =
    Object.values(accounts);

  await db.accountMapping.create({
    data: {
      id: "default",
      piutangUsahaId: piutang.id,
      persediaanId: persediaanAkun.id,
      hppId: hpp.id,
      pendapatanPenjualanId: pendapatan.id,
      utangUsahaId: utang.id,
    },
  });

  const itemDefs = [
    { code: "BRG-001", name: "Tepung Terigu 1kg", unit: "pack", costPrice: 9000, sellPrice: 12000 },
    { code: "BRG-002", name: "Gula Pasir 1kg", unit: "pack", costPrice: 13000, sellPrice: 16000 },
    { code: "BRG-003", name: "Telur Ayam 1kg", unit: "pack", costPrice: 24000, sellPrice: 29000 },
  ];
  const items: Record<string, Awaited<ReturnType<typeof db.item.create>>> = {};
  for (const def of itemDefs) {
    const item = await db.item.create({
      data: { ...def, categoryId: category.id, minStock: 10 },
    });
    items[def.code] = item;
    await db.itemStock.create({ data: { itemId: item.id, warehouseId: warehouse.id, qty: 100 } });
  }
  const tepung = items["BRG-001"];
  const gula = items["BRG-002"];
  const telur = items["BRG-003"];

  console.log("=== Tahap 1: Penawaran Penjualan (draft, belum dikonversi) ===");
  await db.salesQuotation.create({
    data: {
      no: "PNW-2026-0001",
      customerId: customer.id,
      status: "DRAFT",
      total: 5 * 12000 + 5 * 16000,
      lines: {
        create: [
          { itemId: tepung.id, qty: 5, price: 12000, subtotal: 60000 },
          { itemId: gula.id, qty: 5, price: 16000, subtotal: 80000 },
        ],
      },
    },
  });
  console.log("  -> PNW-2026-0001 dibuat (cek halaman Penawaran Penjualan)");

  console.log("=== Tahap 2: Penawaran kedua, dikonversi jadi Pesanan ===");
  const qtyTepung = 20;
  const qtyGula = 10;
  const qtyTelur = 15;
  const orderTotal = qtyTepung * 12000 + qtyGula * 16000 + qtyTelur * 29000;

  const q2 = await db.salesQuotation.create({
    data: {
      no: "PNW-2026-0002",
      customerId: customer.id,
      status: "CONVERTED",
      total: orderTotal,
      lines: {
        create: [
          { itemId: tepung.id, qty: qtyTepung, price: 12000, subtotal: qtyTepung * 12000 },
          { itemId: gula.id, qty: qtyGula, price: 16000, subtotal: qtyGula * 16000 },
          { itemId: telur.id, qty: qtyTelur, price: 29000, subtotal: qtyTelur * 29000 },
        ],
      },
    },
  });

  const order = await db.salesOrder.create({
    data: {
      no: "PSJ-2026-0001",
      customerId: customer.id,
      quotationId: q2.id,
      status: "DRAFT",
      total: orderTotal,
      lines: {
        create: [
          { itemId: tepung.id, qty: qtyTepung, price: 12000 },
          { itemId: gula.id, qty: qtyGula, price: 16000 },
          { itemId: telur.id, qty: qtyTelur, price: 29000 },
        ],
      },
    },
    include: { lines: true },
  });
  console.log("  -> PNW-2026-0002 dikonversi jadi PSJ-2026-0001 (cek halaman Pesanan Penjualan)");

  const orderLineTepung = order.lines.find((l) => l.itemId === tepung.id)!;
  const orderLineGula = order.lines.find((l) => l.itemId === gula.id)!;
  const orderLineTelur = order.lines.find((l) => l.itemId === telur.id)!;

  console.log("=== Tahap 3: Pengiriman sebagian (parsial) ===");
  await db.delivery.create({
    data: {
      no: "SJ-2026-0001",
      orderId: order.id,
      warehouseId: warehouse.id,
      status: "PROCESSED",
      lines: {
        create: [
          { orderLineId: orderLineTepung.id, itemId: tepung.id, qty: 10 },
          { orderLineId: orderLineGula.id, itemId: gula.id, qty: 5 },
        ],
      },
    },
  });
  await db.salesOrderLine.update({ where: { id: orderLineTepung.id }, data: { qtyShipped: 10 } });
  await db.salesOrderLine.update({ where: { id: orderLineGula.id }, data: { qtyShipped: 5 } });
  await db.itemStock.update({
    where: { itemId_warehouseId: { itemId: tepung.id, warehouseId: warehouse.id } },
    data: { qty: { decrement: 10 } },
  });
  await db.itemStock.update({
    where: { itemId_warehouseId: { itemId: gula.id, warehouseId: warehouse.id } },
    data: { qty: { decrement: 5 } },
  });
  await db.salesOrder.update({ where: { id: order.id }, data: { status: "PARTIAL" } });
  console.log("  -> SJ-2026-0001 (parsial), status Pesanan jadi PARTIAL, stok berkurang (cek halaman Pengiriman & Barang)");

  console.log("=== Tahap 4: Pengiriman sisa (lengkap) ===");
  await db.delivery.create({
    data: {
      no: "SJ-2026-0002",
      orderId: order.id,
      warehouseId: warehouse.id,
      status: "PROCESSED",
      lines: {
        create: [
          { orderLineId: orderLineTepung.id, itemId: tepung.id, qty: 10 },
          { orderLineId: orderLineGula.id, itemId: gula.id, qty: 5 },
          { orderLineId: orderLineTelur.id, itemId: telur.id, qty: qtyTelur },
        ],
      },
    },
  });
  await db.salesOrderLine.update({ where: { id: orderLineTepung.id }, data: { qtyShipped: qtyTepung } });
  await db.salesOrderLine.update({ where: { id: orderLineGula.id }, data: { qtyShipped: qtyGula } });
  await db.salesOrderLine.update({ where: { id: orderLineTelur.id }, data: { qtyShipped: qtyTelur } });
  await db.itemStock.update({
    where: { itemId_warehouseId: { itemId: tepung.id, warehouseId: warehouse.id } },
    data: { qty: { decrement: 10 } },
  });
  await db.itemStock.update({
    where: { itemId_warehouseId: { itemId: gula.id, warehouseId: warehouse.id } },
    data: { qty: { decrement: 5 } },
  });
  await db.itemStock.update({
    where: { itemId_warehouseId: { itemId: telur.id, warehouseId: warehouse.id } },
    data: { qty: { decrement: qtyTelur } },
  });
  await db.salesOrder.update({ where: { id: order.id }, data: { status: "PROCESSED" } });
  console.log("  -> SJ-2026-0002 (sisa), status Pesanan jadi PROCESSED, stok Tepung/Gula/Telur berkurang penuh");

  console.log("=== Tahap 5: Faktur Penjualan (untuk seluruh qty pesanan) ===");
  const invoice = await db.salesInvoice.create({
    data: {
      no: "FJ-2026-0001",
      customerId: customer.id,
      orderId: order.id,
      status: "DRAFT",
      total: orderTotal,
      dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      lines: {
        create: [
          { itemId: tepung.id, qty: qtyTepung, price: 12000, subtotal: qtyTepung * 12000 },
          { itemId: gula.id, qty: qtyGula, price: 16000, subtotal: qtyGula * 16000 },
          { itemId: telur.id, qty: qtyTelur, price: 29000, subtotal: qtyTelur * 29000 },
        ],
      },
    },
  });
  await db.salesOrderLine.update({ where: { id: orderLineTepung.id }, data: { qtyInvoiced: qtyTepung } });
  await db.salesOrderLine.update({ where: { id: orderLineGula.id }, data: { qtyInvoiced: qtyGula } });
  await db.salesOrderLine.update({ where: { id: orderLineTelur.id }, data: { qtyInvoiced: qtyTelur } });
  console.log(`  -> FJ-2026-0001 terbit, total ${orderTotal.toLocaleString("id-ID")} (cek halaman Faktur Penjualan)`);

  console.log("=== Tahap 6: Penerimaan sebagian (cicilan pertama) ===");
  const firstPayment = Math.round(orderTotal / 2);
  await db.salesReceipt.create({
    data: { no: "TRM-2026-0001", customerId: customer.id, invoiceId: invoice.id, accountId: bank.id, amount: firstPayment, paymentMethod: "TRANSFER" },
  });
  await db.salesInvoice.update({ where: { id: invoice.id }, data: { status: "PARTIAL" } });
  console.log(`  -> TRM-2026-0001 (${firstPayment.toLocaleString("id-ID")}), status Faktur jadi PARTIAL`);

  console.log("=== Tahap 7: Penerimaan pelunasan ===");
  const secondPayment = orderTotal - firstPayment;
  await db.salesReceipt.create({
    data: { no: "TRM-2026-0002", customerId: customer.id, invoiceId: invoice.id, accountId: kas.id, amount: secondPayment, paymentMethod: "CASH" },
  });
  await db.salesInvoice.update({ where: { id: invoice.id }, data: { status: "PAID" } });
  console.log(`  -> TRM-2026-0002 (${secondPayment.toLocaleString("id-ID")}), status Faktur jadi PAID (cek halaman Penerimaan Penjualan)`);

  console.log("=== Tahap 8: Retur sebagian barang ===");
  await db.salesReturn.create({
    data: {
      no: "RJ-2026-0001",
      invoiceId: invoice.id,
      warehouseId: warehouse.id,
      reason: "Kemasan tepung rusak saat pengiriman",
      lines: { create: [{ itemId: tepung.id, qty: 2 }] },
    },
  });
  await db.itemStock.update({
    where: { itemId_warehouseId: { itemId: tepung.id, warehouseId: warehouse.id } },
    data: { qty: { increment: 2 } },
  });
  console.log("  -> RJ-2026-0001, stok Tepung bertambah 2 (cek halaman Retur Penjualan & Barang)");

  console.log("=== Tahap 9: Pesanan Pembelian (restock Tepung ke pemasok) ===");
  const qtyBeli = 50;
  const poTotal = qtyBeli * 9000;
  const po = await db.purchaseOrder.create({
    data: {
      no: "PSB-2026-0001",
      supplierId: supplier.id,
      status: "DRAFT",
      total: poTotal,
      lines: { create: [{ itemId: tepung.id, qty: qtyBeli, price: 9000 }] },
    },
    include: { lines: true },
  });
  const poLine = po.lines[0];
  console.log("  -> PSB-2026-0001 dibuat (cek halaman Pesanan Pembelian)");

  console.log("=== Tahap 10: Penerimaan Barang sebagian ===");
  await db.goodsReceipt.create({
    data: {
      no: "TB-2026-0001",
      orderId: po.id,
      warehouseId: warehouse.id,
      status: "PROCESSED",
      lines: { create: [{ orderLineId: poLine.id, itemId: tepung.id, qty: 30 }] },
    },
  });
  await db.purchaseOrderLine.update({ where: { id: poLine.id }, data: { qtyReceived: 30 } });
  await db.itemStock.update({
    where: { itemId_warehouseId: { itemId: tepung.id, warehouseId: warehouse.id } },
    data: { qty: { increment: 30 } },
  });
  await db.purchaseOrder.update({ where: { id: po.id }, data: { status: "PARTIAL" } });
  console.log("  -> TB-2026-0001 (30 dari 50), status Pesanan Pembelian jadi PARTIAL, stok Tepung bertambah (cek halaman Penerimaan Barang)");

  console.log("=== Tahap 11: Penerimaan Barang sisa ===");
  await db.goodsReceipt.create({
    data: {
      no: "TB-2026-0002",
      orderId: po.id,
      warehouseId: warehouse.id,
      status: "PROCESSED",
      lines: { create: [{ orderLineId: poLine.id, itemId: tepung.id, qty: 20 }] },
    },
  });
  await db.purchaseOrderLine.update({ where: { id: poLine.id }, data: { qtyReceived: qtyBeli } });
  await db.itemStock.update({
    where: { itemId_warehouseId: { itemId: tepung.id, warehouseId: warehouse.id } },
    data: { qty: { increment: 20 } },
  });
  await db.purchaseOrder.update({ where: { id: po.id }, data: { status: "PROCESSED" } });
  console.log("  -> TB-2026-0002 (sisa 20), status Pesanan Pembelian jadi PROCESSED");

  console.log("=== Tahap 12: Faktur Pembelian ===");
  const purchaseInvoice = await db.purchaseInvoice.create({
    data: {
      no: "FB-2026-0001",
      supplierId: supplier.id,
      orderId: po.id,
      status: "DRAFT",
      total: poTotal,
      dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      lines: { create: [{ itemId: tepung.id, qty: qtyBeli, price: 9000, subtotal: poTotal }] },
    },
  });
  await db.purchaseOrderLine.update({ where: { id: poLine.id }, data: { qtyInvoiced: qtyBeli } });
  console.log(`  -> FB-2026-0001 terbit, total ${poTotal.toLocaleString("id-ID")} (cek halaman Faktur Pembelian)`);

  console.log("=== Tahap 13: Pembayaran sebagian ke pemasok ===");
  const firstPurchasePayment = Math.round(poTotal / 2);
  await db.purchasePayment.create({
    data: { no: "BYR-2026-0001", supplierId: supplier.id, invoiceId: purchaseInvoice.id, accountId: bank.id, amount: firstPurchasePayment, paymentMethod: "TRANSFER" },
  });
  await db.purchaseInvoice.update({ where: { id: purchaseInvoice.id }, data: { status: "PARTIAL" } });
  console.log(`  -> BYR-2026-0001 (${firstPurchasePayment.toLocaleString("id-ID")}), status Faktur Pembelian jadi PARTIAL (cek halaman Pembayaran Pembelian)`);

  console.log("=== Tahap 14: Pelunasan ke pemasok ===");
  const secondPurchasePayment = poTotal - firstPurchasePayment;
  await db.purchasePayment.create({
    data: { no: "BYR-2026-0002", supplierId: supplier.id, invoiceId: purchaseInvoice.id, accountId: kas.id, amount: secondPurchasePayment, paymentMethod: "CASH" },
  });
  await db.purchaseInvoice.update({ where: { id: purchaseInvoice.id }, data: { status: "PAID" } });
  console.log(`  -> BYR-2026-0002 (${secondPurchasePayment.toLocaleString("id-ID")}), status Faktur Pembelian jadi PAID`);

  console.log("=== Tahap 15: Retur sebagian barang ke pemasok ===");
  await db.purchaseReturn.create({
    data: {
      no: "RB-2026-0001",
      invoiceId: purchaseInvoice.id,
      warehouseId: warehouse.id,
      reason: "Tepung apek, dikembalikan ke pemasok",
      lines: { create: [{ itemId: tepung.id, qty: 5 }] },
    },
  });
  await db.itemStock.update({
    where: { itemId_warehouseId: { itemId: tepung.id, warehouseId: warehouse.id } },
    data: { qty: { decrement: 5 } },
  });
  console.log("  -> RB-2026-0001, stok Tepung berkurang 5 (cek halaman Retur Pembelian & Barang)");

  console.log("=== Tahap 16: Jurnal Umum - setoran modal awal ===");
  await db.journalEntry.create({
    data: {
      no: "JU-2026-0001",
      memo: "Setoran modal awal pemilik",
      source: "MANUAL",
      lines: {
        create: [
          { accountId: kas.id, debit: 10000000, credit: 0, description: "Setoran modal" },
          { accountId: modal.id, debit: 0, credit: 10000000, description: "Setoran modal" },
        ],
      },
    },
  });
  console.log("  -> JU-2026-0001 (cek halaman Jurnal Umum)");

  console.log("=== Tahap 17: Kas Masuk - setor tunai ke bank ===");
  await db.journalEntry.create({
    data: {
      no: "KM-2026-0001",
      memo: "Setor tunai ke bank",
      source: "KAS_MASUK",
      lines: {
        create: [
          { accountId: bank.id, debit: 2000000, credit: 0, description: "Setor tunai ke bank" },
          { accountId: kas.id, debit: 0, credit: 2000000, description: "Setor tunai ke bank" },
        ],
      },
    },
  });
  console.log("  -> KM-2026-0001 (cek halaman Kas Masuk)");

  console.log("=== Tahap 18: Kas Keluar - bayar sewa tempat ===");
  await db.journalEntry.create({
    data: {
      no: "KK-2026-0001",
      memo: "Bayar sewa tempat bulan ini",
      source: "KAS_KELUAR",
      lines: {
        create: [
          { accountId: sewa.id, debit: 1500000, credit: 0, description: "Bayar sewa tempat" },
          { accountId: kas.id, debit: 0, credit: 1500000, description: "Bayar sewa tempat" },
        ],
      },
    },
  });
  console.log("  -> KK-2026-0001, saldo Kas jadi 10.000.000 - 2.000.000 - 1.500.000 = 6.500.000 (cek halaman Kas Keluar & Buku Besar)");

  console.log("=== Tahap 19: Aset Tetap - beli mixer adonan ===");
  const mixer = await db.fixedAsset.create({
    data: {
      code: "AT-001",
      name: "Mixer Adonan Industrial",
      acquisitionDate: new Date("2026-01-01"),
      acquisitionCost: 6000000,
      salvageValue: 600000,
      usefulLifeMonths: 36,
      assetAccountId: peralatan.id,
      depreciationExpenseAccountId: bebanPenyusutan.id,
      accumulatedDepreciationAccountId: akumPenyusutan.id,
    },
  });
  console.log("  -> AT-001 terdaftar, penyusutan bulanan: (6.000.000-600.000)/36 = 150.000 (cek halaman Daftar Aset)");

  console.log("=== Tahap 20: Jalankan Penyusutan periode 2026-08 ===");
  const monthlyDepreciation = (Number(mixer.acquisitionCost) - Number(mixer.salvageValue)) / mixer.usefulLifeMonths;
  const depCount = await db.journalEntry.count();
  const depNo = `JU-PNY-2026-${String(depCount + 1).padStart(4, "0")}`;
  const depJournal = await db.journalEntry.create({
    data: {
      no: depNo,
      memo: "Penyusutan aset periode 2026-08",
      source: "PENYUSUTAN",
      lines: {
        create: [
          { accountId: bebanPenyusutan.id, debit: monthlyDepreciation, credit: 0, description: "Penyusutan Mixer Adonan Industrial" },
          { accountId: akumPenyusutan.id, debit: 0, credit: monthlyDepreciation, description: "Akumulasi penyusutan Mixer Adonan Industrial" },
        ],
      },
    },
  });
  await db.fixedAssetDepreciation.create({
    data: { assetId: mixer.id, period: new Date("2026-08-01"), amount: monthlyDepreciation, journalEntryId: depJournal.id },
  });
  console.log(`  -> ${depNo}, nilai buku Mixer jadi 6.000.000 - 150.000 = 5.850.000 (cek halaman Penyusutan)`);

  console.log("\n=== Selesai. Ringkasan stok akhir ===");
  const finalStock = await db.itemStock.findMany({ include: { item: true }, where: { warehouseId: warehouse.id } });
  for (const s of finalStock) {
    console.log(`  ${s.item.name}: ${s.qty.toString()}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("SEED FAILED", err);
    process.exit(1);
  });
