import type { Prisma } from "@/generated/prisma/client";
import { D, fmt, type Dec } from "@/lib/money";

type Tx = Prisma.TransactionClient;

/**
 * Kurangi stok dengan pengecekan ketersediaan. Dipanggil di dalam transaksi.
 * Pengaman terakhir untuk kondisi balapan ada di DB: CHECK ("qty" >= 0) pada ItemStock —
 * kalau dua transaksi bersamaan sama-sama lolos cek ini, yang kedua ditolak DB dan
 * seluruh transaksinya dibatalkan (bukan stok jadi minus).
 */
export async function decrementStock(tx: Tx, itemId: string, warehouseId: string, qty: Dec, itemLabel: string) {
  const stock = await tx.itemStock.findUnique({ where: { itemId_warehouseId: { itemId, warehouseId } } });
  const available = D(stock?.qty ?? 0);
  if (available.lt(qty)) {
    throw new Error(
      `Stok ${itemLabel} tidak cukup di gudang ini (tersedia ${fmt(available)}, diminta ${fmt(qty)})`,
    );
  }
  await tx.itemStock.update({
    where: { itemId_warehouseId: { itemId, warehouseId } },
    data: { qty: { decrement: qty } },
  });
}

export async function incrementStock(tx: Tx, itemId: string, warehouseId: string, qty: Dec) {
  await tx.itemStock.upsert({
    where: { itemId_warehouseId: { itemId, warehouseId } },
    create: { itemId, warehouseId, qty },
    update: { qty: { increment: qty } },
  });
}

/** Peta itemId -> "KODE - Nama" untuk pesan error yang manusiawi. */
export async function itemLabels(tx: Tx, itemIds: string[]): Promise<Map<string, string>> {
  const items = await tx.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, code: true, name: true } });
  return new Map(items.map((i) => [i.id, `${i.code} - ${i.name}`]));
}
