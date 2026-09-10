import type { Prisma } from "@/prisma-klien/client";
import { D, format, kali, uang, type Desimal } from "@/lib/uang";

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

/**
 * Harga pokok rata-rata bergerak (moving average). Dipanggil saat BARANG masuk dengan harga tertentu
 * (Terima Barang, penyesuaian). `stokSudahTermasuk` = true bila stok fisik sudah ditambah sebelum pemanggilan.
 * Dengan ini nilai stok (Σ jumlah × hargaBeli) selalu sama dengan saldo akun Persediaan di buku besar.
 */
export async function perbaruiHargaRata(tx: Tx, barangId: string, jumlahMasuk: Desimal, hargaMasuk: Desimal, stokSudahTermasuk: boolean) {
  const barang = await tx.barang.findUniqueOrThrow({ where: { id: barangId }, select: { jenis: true, hargaBeli: true } });
  if (barang.jenis !== "BARANG" || jumlahMasuk.lte(0)) return;
  const agregat = await tx.stokBarang.aggregate({ where: { barangId }, _sum: { jumlah: true } });
  const stokTotal = D(agregat._sum.jumlah ?? 0);
  const stokLama = stokSudahTermasuk ? stokTotal.minus(jumlahMasuk) : stokTotal;
  const stokBaru = stokSudahTermasuk ? stokTotal : stokTotal.plus(jumlahMasuk);
  if (stokBaru.lte(0)) return;
  const nilaiLama = kali(stokLama.gt(0) ? stokLama : D(0), barang.hargaBeli);
  const hargaBaru = uang(nilaiLama.plus(kali(jumlahMasuk, hargaMasuk)).div(stokBaru));
  await tx.barang.update({ where: { id: barangId }, data: { hargaBeli: hargaBaru } });
}

/** Menyebar selisih nilai (mis. beda harga faktur vs pesanan) ke harga pokok rata-rata seluruh stok barang. */
export async function sesuaikanHargaRata(tx: Tx, barangId: string, selisihNilai: Desimal) {
  if (selisihNilai.isZero()) return;
  const barang = await tx.barang.findUniqueOrThrow({ where: { id: barangId }, select: { jenis: true, hargaBeli: true } });
  if (barang.jenis !== "BARANG") return;
  const agregat = await tx.stokBarang.aggregate({ where: { barangId }, _sum: { jumlah: true } });
  const stokTotal = D(agregat._sum.jumlah ?? 0);
  if (stokTotal.lte(0)) return;
  const hargaBaru = uang(kali(stokTotal, barang.hargaBeli).plus(selisihNilai).div(stokTotal));
  await tx.barang.update({ where: { id: barangId }, data: { hargaBeli: hargaBaru } });
}

/** Peta barangId -> jenis, untuk melewati baris JASA pada mutasi stok. */
export async function jenisBarang(tx: Tx, itemIds: string[]): Promise<Map<string, "BARANG" | "JASA">> {
  const daftar = await tx.barang.findMany({ where: { id: { in: [...new Set(itemIds)] } }, select: { id: true, jenis: true } });
  return new Map(daftar.map((b) => [b.id, b.jenis]));
}
