import type { Prisma, PrismaClient } from "@/prisma-klien/client";

/*
 * Barang sistem untuk baris bebas dokumen penjualan (D2 §3.3 langkah 7). Baris tanpa barang katalog tetap butuh
 * barangId (kolom wajib), jadi semuanya menunjuk satu Barang JASA bersama berkode JASA-LAIN. Pendapatannya jatuh ke
 * pemetaan Pendapatan Penjualan, kecuali pemilik mengisi akun pendapatan di Barang itu.
 */

type Klien = PrismaClient | Prisma.TransactionClient;

export const KODE_BARANG_LAIN = "JASA-LAIN";
export const NAMA_BARANG_LAIN = "Item lain-lain";

/**
 * Nilai pilihan "Item bebas" di editor baris penjualan (EditorBarisPenjualan.BEBAS). Ditaruh di sini (hanya impor tipe)
 * supaya halaman server, mis. halaman ubah penawaran, bisa memakainya: ekspor berkas "use client" menjadi referensi
 * klien bila diimpor komponen server, bukan string.
 */
export const PILIHAN_BEBAS = "__bebas";

/**
 * id Barang JASA-LAIN, dibuat bila belum ada (perusahaan null = bersama, K3). Panggil di dalam transaksi dokumen.
 * Upsert pada kode unik aman bila dua transaksi membuatnya bersamaan. Kode yang sudah dipakai barang jenis BARANG
 * ditolak, karena baris bebas tidak boleh memotong stok. Barang JASA-LAIN yang punya perusahaan juga ditolak.
 */
export async function pastikanBarangLainLain(tx: Klien): Promise<string> {
  const b = await tx.barang.upsert({
    where: { kode: KODE_BARANG_LAIN },
    create: { kode: KODE_BARANG_LAIN, nama: NAMA_BARANG_LAIN, jenis: "JASA", satuan: "paket", hargaBeli: 0, hargaJual: 0, perusahaanId: null },
    update: {},
    select: { id: true, jenis: true, perusahaanId: true },
  });
  if (b.jenis !== "JASA") throw new Error(`Kode barang ${KODE_BARANG_LAIN} sudah dipakai barang jenis BARANG. Ganti kode barang itu supaya baris bebas bisa dipakai`);
  // baris bebas semua perusahaan menunjuk barang ini, jadi barang ini wajib bersama (K3)
  if (b.perusahaanId !== null) throw new Error(`Barang ${KODE_BARANG_LAIN} harus jasa bersama (tanpa perusahaan). Kosongkan perusahaan barang itu di Data Induk supaya baris bebas bisa dipakai`);
  return b.id;
}

/** Mengisi barangId baris bebas (null) dengan id Barang JASA-LAIN; baris berbarang tidak berubah. */
export function isiBarangLainLain<T extends { barangId: string | null }>(baris: readonly T[], idLain: string): (T & { barangId: string })[] {
  return baris.map((b) => ({ ...b, barangId: b.barangId ?? idLain }));
}
