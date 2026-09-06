"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { nextDocNumber } from "@/lib/numbering";
import { runForm, type FormState } from "@/lib/formState";
import { D, fmt, money, mul, parseMoney, sum, type Dec } from "@/lib/money";
import { decrementStock, incrementStock, itemLabels } from "@/lib/stock";
import { postSalesInvoiceJournal, postSalesReceiptJournal, postSalesReturnJournal } from "@/lib/accounting";

type Line = { itemId: string; qty: Dec; price: Dec };

function parseJson(raw: FormDataEntryValue | null, emptyMessage: string): unknown[] {
  if (typeof raw !== "string" || !raw) throw new Error(emptyMessage);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Format baris barang tidak valid");
  }
  if (!Array.isArray(parsed)) throw new Error(emptyMessage);
  return parsed;
}

/** Baris barang dengan harga (penawaran, pesanan, faktur). */
function parseLines(formData: FormData): Line[] {
  const parsed = parseJson(formData.get("lines"), "Minimal 1 baris barang wajib diisi") as {
    itemId?: string;
    qty?: string | number;
    price?: string | number;
  }[];
  const lines = parsed
    .filter((l) => l.itemId)
    .map((l) => ({ itemId: String(l.itemId), qty: money(l.qty), price: money(l.price) }))
    .filter((l) => l.qty.gt(0));
  if (lines.length === 0) throw new Error("Minimal 1 baris barang dengan qty > 0 wajib diisi");
  if (lines.some((l) => l.price.isNegative())) throw new Error("Harga tidak boleh negatif");
  return lines;
}

/** Baris qty saja (pengiriman, retur). */
function parseQtyLines<T extends { itemId?: string; qty?: string | number }>(
  formData: FormData,
  emptyMessage: string,
): (T & { qty: Dec })[] {
  const parsed = parseJson(formData.get("lines"), emptyMessage) as T[];
  const lines = parsed.filter((l) => l.itemId).map((l) => ({ ...l, qty: money(l.qty) })).filter((l) => l.qty.gt(0));
  if (lines.length === 0) throw new Error(emptyMessage);
  return lines;
}

function lineTotal(lines: Line[]): Dec {
  return sum(lines.map((l) => mul(l.qty, l.price)));
}

// ---------- Penawaran Penjualan ----------

export async function createQuotation(formData: FormData) {
  const customerId = String(formData.get("customerId") ?? "");
  if (!customerId) throw new Error("Pelanggan wajib dipilih");
  const lines = parseLines(formData);
  const total = lineTotal(lines);

  const no = await nextDocNumber(db.salesQuotation, "SQ");

  await db.salesQuotation.create({
    data: {
      no,
      customerId,
      total,
      lines: {
        create: lines.map((l) => ({ itemId: l.itemId, qty: l.qty, price: l.price, subtotal: mul(l.qty, l.price) })),
      },
    },
  });

  revalidatePath("/sales/quotations");
  redirect("/sales/quotations");
}

export async function convertQuotationToOrder(quotationId: string) {
  const quotation = await db.salesQuotation.findUniqueOrThrow({
    where: { id: quotationId },
    include: { lines: true },
  });
  if (quotation.status === "CONVERTED") throw new Error("Penawaran sudah dikonversi");

  const no = await nextDocNumber(db.salesOrder, "SO");

  await db.$transaction([
    db.salesOrder.create({
      data: {
        no,
        customerId: quotation.customerId,
        quotationId: quotation.id,
        total: quotation.total,
        lines: { create: quotation.lines.map((l) => ({ itemId: l.itemId, qty: l.qty, price: l.price })) },
      },
    }),
    db.salesQuotation.update({ where: { id: quotation.id }, data: { status: "CONVERTED" } }),
  ]);

  revalidatePath("/sales/quotations");
  revalidatePath("/sales/orders");
  redirect("/sales/orders");
}

// ---------- Pesanan Penjualan ----------

export async function createOrder(formData: FormData) {
  const customerId = String(formData.get("customerId") ?? "");
  if (!customerId) throw new Error("Pelanggan wajib dipilih");
  const lines = parseLines(formData);
  const total = lineTotal(lines);

  const no = await nextDocNumber(db.salesOrder, "SO");

  await db.salesOrder.create({
    data: {
      no,
      customerId,
      total,
      lines: { create: lines.map((l) => ({ itemId: l.itemId, qty: l.qty, price: l.price })) },
    },
  });

  revalidatePath("/sales/orders");
  redirect("/sales/orders");
}

// ---------- Pengiriman Pesanan ----------

export async function createDelivery(formData: FormData) {
  const orderId = String(formData.get("orderId") ?? "");
  const warehouseId = String(formData.get("warehouseId") ?? "");
  if (!orderId) throw new Error("Pesanan wajib dipilih");
  if (!warehouseId) throw new Error("Gudang wajib dipilih");

  const lines = parseQtyLines<{ orderLineId: string; itemId: string; qty: string | number }>(
    formData,
    "Minimal 1 baris barang wajib dikirim",
  );

  const order = await db.salesOrder.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });

  // tidak boleh mengirim lebih dari sisa pesanan
  for (const l of lines) {
    const orderLine = order.lines.find((ol) => ol.id === l.orderLineId);
    if (!orderLine) throw new Error("Baris pesanan tidak ditemukan");
    const remaining = D(orderLine.qty).minus(orderLine.qtyShipped);
    if (l.qty.gt(remaining)) {
      throw new Error(`Qty kirim melebihi sisa pesanan (sisa ${fmt(remaining)}, diminta ${fmt(l.qty)})`);
    }
  }

  const no = await nextDocNumber(db.delivery, "DO");

  await db.$transaction(async (tx) => {
    const labels = await itemLabels(tx, lines.map((l) => l.itemId));

    await tx.delivery.create({
      data: {
        no,
        orderId,
        warehouseId,
        status: "PROCESSED",
        lines: { create: lines.map((l) => ({ orderLineId: l.orderLineId, itemId: l.itemId, qty: l.qty })) },
      },
    });

    for (const line of lines) {
      await decrementStock(tx, line.itemId, warehouseId, line.qty, labels.get(line.itemId) ?? line.itemId);
      await tx.salesOrderLine.update({ where: { id: line.orderLineId }, data: { qtyShipped: { increment: line.qty } } });
    }

    const updatedLines = await tx.salesOrderLine.findMany({ where: { orderId } });
    const fullyShipped = updatedLines.every((l) => D(l.qtyShipped).gte(l.qty));
    await tx.salesOrder.update({ where: { id: orderId }, data: { status: fullyShipped ? "PROCESSED" : "PARTIAL" } });
  });

  revalidatePath("/sales/orders");
  revalidatePath("/sales/deliveries");
  redirect("/sales/deliveries");
}

// ---------- Faktur Penjualan ----------

export async function createInvoice(formData: FormData) {
  const orderId = String(formData.get("orderId") ?? "");
  const deliveryId = String(formData.get("deliveryId") ?? "") || null;
  if (!orderId) throw new Error("Pesanan wajib dipilih");
  const lines = parseLines(formData);
  const total = lineTotal(lines);

  const order = await db.salesOrder.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });

  // tidak boleh menagih lebih dari sisa qty pesanan (per barang)
  for (const l of lines) {
    const orderLines = order.lines.filter((ol) => ol.itemId === l.itemId);
    if (orderLines.length === 0) throw new Error("Barang tidak ada di pesanan ini");
    const remaining = sum(orderLines.map((ol) => D(ol.qty).minus(ol.qtyInvoiced)));
    if (l.qty.gt(remaining)) {
      throw new Error(`Qty faktur melebihi sisa yang belum ditagih (sisa ${fmt(remaining)}, diminta ${fmt(l.qty)})`);
    }
  }

  const no = await nextDocNumber(db.salesInvoice, "INV");

  await db.$transaction(async (tx) => {
    const invoice = await tx.salesInvoice.create({
      data: {
        no,
        customerId: order.customerId,
        orderId,
        deliveryId,
        total,
        dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        lines: {
          create: lines.map((l) => ({ itemId: l.itemId, qty: l.qty, price: l.price, subtotal: mul(l.qty, l.price) })),
        },
      },
    });

    for (const l of lines) {
      const orderLine = await tx.salesOrderLine.findFirst({ where: { orderId, itemId: l.itemId } });
      if (orderLine) {
        await tx.salesOrderLine.update({ where: { id: orderLine.id }, data: { qtyInvoiced: { increment: l.qty } } });
      }
    }

    const items = await tx.item.findMany({ where: { id: { in: lines.map((l) => l.itemId) } } });
    const costOfGoods = sum(lines.map((l) => mul(l.qty, items.find((i) => i.id === l.itemId)?.costPrice ?? 0)));
    await postSalesInvoiceJournal(tx, invoice, costOfGoods);
  });

  revalidatePath("/sales/invoices");
  redirect("/sales/invoices");
}

// ---------- Penerimaan Penjualan ----------

export async function createReceipt(formData: FormData) {
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const accountId = String(formData.get("accountId") ?? "");
  const paymentMethod = String(formData.get("paymentMethod") ?? "CASH");
  if (!invoiceId) throw new Error("Faktur wajib dipilih");
  if (!accountId) throw new Error("Akun Kas/Bank penerima wajib dipilih");
  const amount = parseMoney(formData.get("amount"), "Jumlah bayar");

  const invoice = await db.salesInvoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { receipts: true } });
  if (invoice.status === "PAID") throw new Error("Faktur ini sudah lunas");

  const alreadyPaid = sum(invoice.receipts.map((r) => r.amount));
  const remaining = D(invoice.total).minus(alreadyPaid);
  if (amount.gt(remaining)) {
    throw new Error(`Jumlah bayar melebihi sisa tagihan (sisa ${fmt(remaining)})`);
  }
  const status = alreadyPaid.plus(amount).gte(invoice.total) ? "PAID" : "PARTIAL";

  const no = await nextDocNumber(db.salesReceipt, "RCP");

  await db.$transaction(async (tx) => {
    const receipt = await tx.salesReceipt.create({
      data: { no, customerId: invoice.customerId, invoiceId, accountId, amount, paymentMethod },
    });
    await tx.salesInvoice.update({ where: { id: invoiceId }, data: { status } });
    await postSalesReceiptJournal(tx, receipt);
  });

  revalidatePath("/sales/receipts");
  revalidatePath("/sales/invoices");
  redirect("/sales/receipts");
}

// ---------- Retur Penjualan ----------

export async function createReturn(formData: FormData) {
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const warehouseId = String(formData.get("warehouseId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!invoiceId) throw new Error("Faktur wajib dipilih");
  if (!warehouseId) throw new Error("Gudang wajib dipilih");

  const lines = parseQtyLines<{ itemId: string; qty: string | number }>(formData, "Minimal 1 baris barang wajib diretur");

  const invoice = await db.salesInvoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: { lines: true, returns: { include: { lines: true } } },
  });

  // tidak boleh meretur lebih dari qty yang pernah difakturkan (dikurangi retur sebelumnya)
  for (const l of lines) {
    const invoiced = sum(invoice.lines.filter((il) => il.itemId === l.itemId).map((il) => il.qty));
    if (invoiced.isZero()) throw new Error("Barang tidak ada di faktur ini");
    const returned = sum(invoice.returns.flatMap((r) => r.lines.filter((rl) => rl.itemId === l.itemId).map((rl) => rl.qty)));
    const remaining = invoiced.minus(returned);
    if (l.qty.gt(remaining)) {
      throw new Error(`Qty retur melebihi yang bisa diretur (maks ${fmt(remaining)}, diminta ${fmt(l.qty)})`);
    }
  }

  const items = await db.item.findMany({ where: { id: { in: lines.map((l) => l.itemId) } } });
  const returnAmount = sum(lines.map((l) => mul(l.qty, invoice.lines.find((il) => il.itemId === l.itemId)?.price ?? 0)));
  const costOfGoods = sum(lines.map((l) => mul(l.qty, items.find((i) => i.id === l.itemId)?.costPrice ?? 0)));

  const no = await nextDocNumber(db.salesReturn, "RET");

  await db.$transaction(async (tx) => {
    await tx.salesReturn.create({
      data: {
        no,
        invoiceId,
        warehouseId,
        reason: reason || null,
        lines: { create: lines.map((l) => ({ itemId: l.itemId, qty: l.qty })) },
      },
    });

    for (const l of lines) await incrementStock(tx, l.itemId, warehouseId, l.qty);

    await postSalesReturnJournal(tx, returnAmount, costOfGoods);
  });

  revalidatePath("/sales/returns");
  redirect("/sales/returns");
}

// ---------- Varian untuk <ActionForm> (mengembalikan pesan error, bukan throw) ----------

export async function createQuotationForm(_prev: FormState, formData: FormData) {
  return runForm(() => createQuotation(formData));
}
// Dipakai lewat .bind(null, quotationId); argumen (prevState, formData) dari useActionState sengaja diabaikan
export async function convertQuotationToOrderForm(quotationId: string) {
  return runForm(() => convertQuotationToOrder(quotationId));
}
export async function createOrderForm(_prev: FormState, formData: FormData) {
  return runForm(() => createOrder(formData));
}
export async function createDeliveryForm(_prev: FormState, formData: FormData) {
  return runForm(() => createDelivery(formData));
}
export async function createInvoiceForm(_prev: FormState, formData: FormData) {
  return runForm(() => createInvoice(formData));
}
export async function createReceiptForm(_prev: FormState, formData: FormData) {
  return runForm(() => createReceipt(formData));
}
export async function createReturnForm(_prev: FormState, formData: FormData) {
  return runForm(() => createReturn(formData));
}
