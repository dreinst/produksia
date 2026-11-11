import type { Prisma } from "@/prisma-klien/client";
import { D, format, kali, uang, type Desimal } from "@/lib/uang";

type Tx = Prisma.TransactionClient;

/**
 * Kurangi stok dengan pengecekan ketersediaan. Dipanggil di dalam transaksi.
 * Pengaman terakhir untuk kondisi balapan ada di DB: CHECK ("jumlah" >= 0) pada StokBarang -
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

/** Pembanding id untuk urutan kunci stok: urutan unit kode JavaScript, sama di semua jalur (bukan collation basis data). */
export function bandingId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Mengunci baris StokBarang (FOR UPDATE) untuk semua pasangan barang dan gudang yang akan dimutasi sebuah dokumen,
 * urut barangId lalu gudangId, sebelum mutasi pertama (tinjauan perbaikan P22 butir 3). Dua dokumen berbaris banyak
 * yang menyentuh barang yang sama dengan urutan baris berbeda lalu saling menunggu di baris stok yang sama, bukan
 * saling mengunci (40P01). Semua jalur stok berbaris banyak (SJ, terima barang, pindah barang, penyesuaian,
 * peminjaman, kerusakan, retur, hapus) memanggilnya. Baris yang belum ada tidak terkunci; tambahStok membuatnya
 * lewat upsert seperti sebelumnya. Batas: kunci lain yang diambil sesudahnya dengan urutan baris dokumen (harga
 * rata di Barang, baris pesanan) tetap mengikuti urutan dokumen.
 */
export async function kunciStokUrut(tx: Tx, pasangan: { barangId: string; gudangId: string }[]) {
  const unik = new Map(pasangan.map((p) => [`${p.barangId}\u0000${p.gudangId}`, p]));
  const urut = [...unik.values()].sort((x, y) => bandingId(x.barangId, y.barangId) || bandingId(x.gudangId, y.gudangId));
  for (const p of urut) await tx.$queryRaw`SELECT 1 FROM "StokBarang" WHERE "barangId" = ${p.barangId} AND "gudangId" = ${p.gudangId} FOR UPDATE`;
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

/**
 * Mengubah jumlah & nilai stok sekaligus (dipakai saat MEMBALIK dokumen): harga pokok rata-rata baru
 * = (nilai lama + selisihNilai) / (jumlah lama + selisihJumlah). Stok fisik per gudang diubah oleh pemanggil.
 */
export async function ubahNilaiStok(tx: Tx, barangId: string, selisihJumlah: Desimal, selisihNilai: Desimal) {
  const barang = await tx.barang.findUniqueOrThrow({ where: { id: barangId }, select: { jenis: true, hargaBeli: true } });
  if (barang.jenis !== "BARANG") return;
  const agregat = await tx.stokBarang.aggregate({ where: { barangId }, _sum: { jumlah: true } });
  const stokTotal = D(agregat._sum.jumlah ?? 0); // sudah termasuk selisihJumlah bila pemanggil mengubah stok lebih dulu
  const stokLama = stokTotal.minus(selisihJumlah);
  const nilaiBaru = kali(stokLama.gt(0) ? stokLama : D(0), barang.hargaBeli).plus(selisihNilai);
  if (stokTotal.lte(0)) return;
  const hargaBaru = uang(nilaiBaru.div(stokTotal));
  await tx.barang.update({ where: { id: barangId }, data: { hargaBeli: hargaBaru.lt(0) ? D(0) : hargaBaru } });
}
