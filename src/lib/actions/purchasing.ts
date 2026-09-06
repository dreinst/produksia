"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { nextDocNumber } from "@/lib/numbering";
import { runForm, type FormState } from "@/lib/formState";
import { D, fmt, money, mul, parseMoney, sum, type Dec } from "@/lib/money";
import { decrementStock, incrementStock, itemLabels } from "@/lib/stock";
import {
  postPurchaseInvoiceJournal,
  postPurchasePaymentJournal,
  postPurchaseReturnJournal,
} from "@/lib/accounting";

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

// ---------- Pesanan Pembelian ----------

export async function createPurchaseOrder(formData: FormData) {
  const supplierId = String(formData.get("supplierId") ?? "");
  if (!supplierId) throw new Error("Pemasok wajib dipilih");
  const lines = parseLines(formData);
  const total = lineTotal(lines);

  const no = await nextDocNumber(db.purchaseOrder, "PSB");

  await db.purchaseOrder.create({
    data: {
      no,
      supplierId,
      total,
      lines: { create: lines.map((l) => ({ itemId: l.itemId, qty: l.qty, price: l.price })) },
    },
  });

  revalidatePath("/purchasing/orders");
  redirect("/purchasing/orders");
}

// ---------- Penerimaan Barang ----------

export async function createGoodsReceipt(formData: FormData) {
  const orderId = String(formData.get("orderId") ?? "");
  const warehouseId = String(formData.get("warehouseId") ?? "");
  if (!orderId) throw new Error("Pesanan wajib dipilih");
  if (!warehouseId) throw new Error("Gudang wajib dipilih");

  const lines = parseQtyLines<{ orderLineId: string; itemId: string; qty: string | number }>(
    formData,
    "Minimal 1 baris barang wajib diterima",
  );

  const order = await db.purchaseOrder.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });

  for (const l of lines) {
    const orderLine = order.lines.find((ol) => ol.id === l.orderLineId);
    if (!orderLine) throw new Error("Baris pesanan tidak ditemukan");
    const remaining = D(orderLine.qty).minus(orderLine.qtyReceived);
    if (l.qty.gt(remaining)) {
      throw new Error(`Kuantitas terima melebihi sisa pesanan (sisa ${fmt(remaining)}, diminta ${fmt(l.qty)})`);
    }
  }

  const no = await nextDocNumber(db.goodsReceipt, "TB");

  await db.$transaction(async (tx) => {
    await tx.goodsReceipt.create({
      data: {
        no,
        orderId,
        warehouseId,
        status: "PROCESSED",
        lines: { create: lines.map((l) => ({ orderLineId: l.orderLineId, itemId: l.itemId, qty: l.qty })) },
      },
    });

    for (const line of lines) {
      await incrementStock(tx, line.itemId, warehouseId, line.qty);
      await tx.purchaseOrderLine.update({ where: { id: line.orderLineId }, data: { qtyReceived: { increment: line.qty } } });
    }

    const updatedLines = await tx.purchaseOrderLine.findMany({ where: { orderId } });
    const fullyReceived = updatedLines.every((l) => D(l.qtyReceived).gte(l.qty));
    await tx.purchaseOrder.update({ where: { id: orderId }, data: { status: fullyReceived ? "PROCESSED" : "PARTIAL" } });
  });

  revalidatePath("/purchasing/orders");
  revalidatePath("/purchasing/receipts");
  redirect("/purchasing/receipts");
}

// ---------- Faktur Pembelian ----------

export async function createPurchaseInvoice(formData: FormData) {
  const orderId = String(formData.get("orderId") ?? "");
  const receiptId = String(formData.get("receiptId") ?? "") || null;
  if (!orderId) throw new Error("Pesanan wajib dipilih");
  const lines = parseLines(formData);
  const total = lineTotal(lines);

  const order = await db.purchaseOrder.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });

  for (const l of lines) {
    const orderLines = order.lines.filter((ol) => ol.itemId === l.itemId);
    if (orderLines.length === 0) throw new Error("Barang tidak ada di pesanan ini");
    const remaining = sum(orderLines.map((ol) => D(ol.qty).minus(ol.qtyInvoiced)));
    if (l.qty.gt(remaining)) {
      throw new Error(`Kuantitas faktur melebihi sisa yang belum ditagih (sisa ${fmt(remaining)}, diminta ${fmt(l.qty)})`);
    }
  }

  const no = await nextDocNumber(db.purchaseInvoice, "FB");

  await db.$transaction(async (tx) => {
    const invoice = await tx.purchaseInvoice.create({
      data: {
        no,
        supplierId: order.supplierId,
        orderId,
        receiptId,
        total,
        dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        lines: {
          create: lines.map((l) => ({ itemId: l.itemId, qty: l.qty, price: l.price, subtotal: mul(l.qty, l.price) })),
        },
      },
    });

    for (const l of lines) {
      const orderLine = await tx.purchaseOrderLine.findFirst({ where: { orderId, itemId: l.itemId } });
      if (orderLine) {
        await tx.purchaseOrderLine.update({ where: { id: orderLine.id }, data: { qtyInvoiced: { increment: l.qty } } });
      }
    }

    await postPurchaseInvoiceJournal(tx, invoice);
  });

  revalidatePath("/purchasing/invoices");
  redirect("/purchasing/invoices");
}

// ---------- Pembayaran Pembelian ----------

export async function createPurchasePayment(formData: FormData) {
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const accountId = String(formData.get("accountId") ?? "");
  const paymentMethod = String(formData.get("paymentMethod") ?? "TRANSFER");
  if (!invoiceId) throw new Error("Faktur wajib dipilih");
  if (!accountId) throw new Error("Akun Kas/Bank sumber wajib dipilih");
  const amount = parseMoney(formData.get("amount"), "Jumlah bayar");

  const invoice = await db.purchaseInvoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { payments: true } });
  if (invoice.status === "PAID") throw new Error("Faktur ini sudah lunas");

  const alreadyPaid = sum(invoice.payments.map((p) => p.amount));
  const remaining = D(invoice.total).minus(alreadyPaid);
  if (amount.gt(remaining)) {
    throw new Error(`Jumlah bayar melebihi sisa utang (sisa ${fmt(remaining)})`);
  }
  const status = alreadyPaid.plus(amount).gte(invoice.total) ? "PAID" : "PARTIAL";

  const no = await nextDocNumber(db.purchasePayment, "BYR");

  await db.$transaction(async (tx) => {
    const payment = await tx.purchasePayment.create({
      data: { no, supplierId: invoice.supplierId, invoiceId, accountId, amount, paymentMethod },
    });
    await tx.purchaseInvoice.update({ where: { id: invoiceId }, data: { status } });
    await postPurchasePaymentJournal(tx, payment);
  });

  revalidatePath("/purchasing/payments");
  revalidatePath("/purchasing/invoices");
  redirect("/purchasing/payments");
}

// ---------- Retur Pembelian ----------

export async function createPurchaseReturn(formData: FormData) {
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const warehouseId = String(formData.get("warehouseId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!invoiceId) throw new Error("Faktur wajib dipilih");
  if (!warehouseId) throw new Error("Gudang wajib dipilih");

  const lines = parseQtyLines<{ itemId: string; qty: string | number }>(formData, "Minimal 1 baris barang wajib diretur");

  const invoice = await db.purchaseInvoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: { lines: true, returns: { include: { lines: true } } },
  });

  for (const l of lines) {
    const invoiced = sum(invoice.lines.filter((il) => il.itemId === l.itemId).map((il) => il.qty));
    if (invoiced.isZero()) throw new Error("Barang tidak ada di faktur ini");
    const returned = sum(invoice.returns.flatMap((r) => r.lines.filter((rl) => rl.itemId === l.itemId).map((rl) => rl.qty)));
    const remaining = invoiced.minus(returned);
    if (l.qty.gt(remaining)) {
      throw new Error(`Kuantitas retur melebihi yang bisa diretur (maks ${fmt(remaining)}, diminta ${fmt(l.qty)})`);
    }
  }

  const returnAmount = sum(lines.map((l) => mul(l.qty, invoice.lines.find((il) => il.itemId === l.itemId)?.price ?? 0)));

  const no = await nextDocNumber(db.purchaseReturn, "RB");

  await db.$transaction(async (tx) => {
    const labels = await itemLabels(tx, lines.map((l) => l.itemId));

    await tx.purchaseReturn.create({
      data: {
        no,
        invoiceId,
        warehouseId,
        reason: reason || null,
        lines: { create: lines.map((l) => ({ itemId: l.itemId, qty: l.qty })) },
      },
    });

    for (const l of lines) {
      await decrementStock(tx, l.itemId, warehouseId, l.qty, labels.get(l.itemId) ?? l.itemId);
    }

    await postPurchaseReturnJournal(tx, returnAmount);
  });

  revalidatePath("/purchasing/returns");
  redirect("/purchasing/returns");
}

// ---------- Varian untuk <ActionForm> (mengembalikan pesan error, bukan throw) ----------

export async function createPurchaseOrderForm(_prev: FormState, formData: FormData) {
  return runForm(() => createPurchaseOrder(formData));
}
export async function createGoodsReceiptForm(_prev: FormState, formData: FormData) {
  return runForm(() => createGoodsReceipt(formData));
}
export async function createPurchaseInvoiceForm(_prev: FormState, formData: FormData) {
  return runForm(() => createPurchaseInvoice(formData));
}
export async function createPurchasePaymentForm(_prev: FormState, formData: FormData) {
  return runForm(() => createPurchasePayment(formData));
}
export async function createPurchaseReturnForm(_prev: FormState, formData: FormData) {
  return runForm(() => createPurchaseReturn(formData));
}
