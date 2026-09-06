import type { Prisma } from "@/prisma-klien/client";
import { D, format, type Desimal } from "@/lib/uang";

type Tx = Prisma.TransactionClient;

/**
 * Kurangi stok dengan pengecekan ketersediaan. Dipanggil di dalam transaksi.
 * Pengaman terakhir untuk kondisi balapan ada di DB: CHECK ("jumlah" >= 0) pada StokBarang —
 * kalau dua transaksi bersamaan sama-sama lolos cek ini, yang kedua ditolak DB dan
 * seluruh transaksinya dibatalkan (bukan stok jadi minus).
 */
export async function kurangiStok(tx: Tx, barangId: string, gudangId: string, jumlah: Desimal, labelBarang: string) {
  const stok = await tx.stokBarang.findUnique({ where: { barangId_gudangId: { barangId, gudangId } } });
  const tersedia = D(stok?.jumlah ?? 0);
  if (tersedia.lt(jumlah)) {
    throw new Error(
      `Stok ${labelBarang} tidak cukup di gudang ini (tersedia ${format(tersedia)}, diminta ${format(jumlah)})`,
    );
  }
  await tx.stokBarang.update({
    where: { barangId_gudangId: { barangId, gudangId } },
    data: { jumlah: { decrement: jumlah } },
  });
}

export async function tambahStok(tx: Tx, barangId: string, gudangId: string, jumlah: Desimal) {
  await tx.stokBarang.upsert({
    where: { barangId_gudangId: { barangId, gudangId } },
    create: { barangId, gudangId, jumlah },
    update: { jumlah: { increment: jumlah } },
  });
}

/** Peta barangId -> "KODE - Nama" untuk pesan error yang manusiawi. */
export async function labelBarang(tx: Tx, itemIds: string[]): Promise<Map<string, string>> {
  const daftarBarang = await tx.barang.findMany({ where: { id: { in: itemIds } }, select: { id: true, kode: true, nama: true } });
  return new Map(daftarBarang.map((i) => [i.id, `${i.kode} - ${i.nama}`]));
}
