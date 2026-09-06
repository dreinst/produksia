import type { Prisma } from "@/generated/prisma/client";
import { nextDocNumber } from "@/lib/numbering";
import { D, type Dec } from "@/lib/money";

type Tx = Prisma.TransactionClient;
type JournalLineInput = { accountId: string; debit: Dec; credit: Dec; description: string };

const ZERO = D(0);

async function nextJournalNumber(tx: Tx, prefix: string) {
  return nextDocNumber(tx.journalEntry, prefix);
}

export async function getAccountMapping(tx: Tx) {
  const mapping = await tx.accountMapping.findUnique({ where: { id: "default" } });
  if (!mapping) {
    throw new Error(
      "Pemetaan akun belum diatur. Buka menu Buku Besar > Pemetaan Akun sebelum membuat transaksi ini.",
    );
  }
  return mapping;
}

async function postJournal(tx: Tx, prefix: string, memo: string, source: "PENJUALAN" | "PEMBELIAN", lines: JournalLineInput[]) {
  const no = await nextJournalNumber(tx, prefix);
  await tx.journalEntry.create({ data: { no, memo, source, lines: { create: lines } } });
}

/** Faktur Penjualan: Dr Piutang / Cr Pendapatan; plus Dr HPP / Cr Persediaan bila ada harga pokok. */
export async function postSalesInvoiceJournal(tx: Tx, invoice: { total: Dec | number | string }, costOfGoods: Dec) {
  const m = await getAccountMapping(tx);
  const total = D(invoice.total);
  const lines: JournalLineInput[] = [
    { accountId: m.piutangUsahaId, debit: total, credit: ZERO, description: "Piutang Faktur Penjualan" },
    { accountId: m.pendapatanPenjualanId, debit: ZERO, credit: total, description: "Pendapatan Penjualan" },
  ];
  if (costOfGoods.gt(0)) {
    lines.push(
      { accountId: m.hppId, debit: costOfGoods, credit: ZERO, description: "HPP Penjualan" },
      { accountId: m.persediaanId, debit: ZERO, credit: costOfGoods, description: "Pengurangan Persediaan" },
    );
  }
  await postJournal(tx, "JU-FJ", "Faktur Penjualan", "PENJUALAN", lines);
}

/** Penerimaan Penjualan: Dr Kas/Bank pilihan / Cr Piutang. */
export async function postSalesReceiptJournal(tx: Tx, receipt: { accountId: string; amount: Dec | number | string }) {
  const m = await getAccountMapping(tx);
  const amount = D(receipt.amount);
  await postJournal(tx, "JU-TRM", "Penerimaan Penjualan", "PENJUALAN", [
    { accountId: receipt.accountId, debit: amount, credit: ZERO, description: "Penerimaan dari pelanggan" },
    { accountId: m.piutangUsahaId, debit: ZERO, credit: amount, description: "Pelunasan piutang" },
  ]);
}

/** Retur Penjualan: kebalikan faktur (Dr Pendapatan / Cr Piutang; Dr Persediaan / Cr HPP). */
export async function postSalesReturnJournal(tx: Tx, returnAmount: Dec, costOfGoods: Dec) {
  const m = await getAccountMapping(tx);
  const lines: JournalLineInput[] = [
    { accountId: m.pendapatanPenjualanId, debit: returnAmount, credit: ZERO, description: "Retur Penjualan" },
    { accountId: m.piutangUsahaId, debit: ZERO, credit: returnAmount, description: "Pengurangan Piutang" },
  ];
  if (costOfGoods.gt(0)) {
    lines.push(
      { accountId: m.persediaanId, debit: costOfGoods, credit: ZERO, description: "Barang retur masuk gudang" },
      { accountId: m.hppId, debit: ZERO, credit: costOfGoods, description: "Koreksi HPP" },
    );
  }
  await postJournal(tx, "JU-RJ", "Retur Penjualan", "PENJUALAN", lines);
}

/** Faktur Pembelian: Dr Persediaan / Cr Utang. */
export async function postPurchaseInvoiceJournal(tx: Tx, invoice: { total: Dec | number | string }) {
  const m = await getAccountMapping(tx);
  const total = D(invoice.total);
  await postJournal(tx, "JU-FB", "Faktur Pembelian", "PEMBELIAN", [
    { accountId: m.persediaanId, debit: total, credit: ZERO, description: "Penambahan Persediaan" },
    { accountId: m.utangUsahaId, debit: ZERO, credit: total, description: "Utang Faktur Pembelian" },
  ]);
}

/** Pembayaran Pembelian: Dr Utang / Cr Kas/Bank pilihan. */
export async function postPurchasePaymentJournal(tx: Tx, payment: { accountId: string; amount: Dec | number | string }) {
  const m = await getAccountMapping(tx);
  const amount = D(payment.amount);
  await postJournal(tx, "JU-BYR", "Pembayaran Pembelian", "PEMBELIAN", [
    { accountId: m.utangUsahaId, debit: amount, credit: ZERO, description: "Pelunasan utang" },
    { accountId: payment.accountId, debit: ZERO, credit: amount, description: "Pembayaran ke pemasok" },
  ]);
}

/** Retur Pembelian: Dr Utang / Cr Persediaan. */
export async function postPurchaseReturnJournal(tx: Tx, returnAmount: Dec) {
  const m = await getAccountMapping(tx);
  await postJournal(tx, "JU-RB", "Retur Pembelian", "PEMBELIAN", [
    { accountId: m.utangUsahaId, debit: returnAmount, credit: ZERO, description: "Pengurangan Utang" },
    { accountId: m.persediaanId, debit: ZERO, credit: returnAmount, description: "Barang keluar retur ke pemasok" },
  ]);
}
