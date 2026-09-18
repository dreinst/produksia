import type { Prisma, PrismaClient } from "@/prisma-klien/client";
import { D, type Desimal } from "@/lib/uang";
import { tanggalIso } from "@/lib/waktu";

/*
 * Peminjaman Barang (loading out / loading in) tidak menyentuh StokBarang maupun jurnal.
 * "Sedang di luar" dihitung dari baris dokumen yang belum ditautkan ke Penyesuaian Stok,
 * termasuk dokumen yang sudah ditutup dengan selisih: barang hilang tetap dihitung di luar
 * sampai Admin menautkan penyesuaiannya. Tersedia = StokBarang.jumlah - sedang di luar.
 */
type KlienDb = PrismaClient | Prisma.TransactionClient;

export type StatusPeminjaman = "TERBUKA" | "SELESAI" | "SELISIH" | "DISESUAIKAN";

export const LABEL_STATUS_PEMINJAMAN: Record<StatusPeminjaman, { label: string; kelas: string }> = {
  TERBUKA: { label: "Terbuka", kelas: "lencana-amber" },
  SELESAI: { label: "Selesai", kelas: "lencana-emerald" },
  SELISIH: { label: "Selisih", kelas: "lencana-rose" },
  DISESUAIKAN: { label: "Disesuaikan", kelas: "lencana-slate" },
};

export function sisaBaris(b: { jumlah: unknown; jumlahKembali: unknown }): number {
  return D(b.jumlah as string).minus(D(b.jumlahKembali as string)).toNumber();
}

/** Status turunan, bukan kolom: TERBUKA, SELESAI (semua kembali), SELISIH (ditutup dengan sisa), DISESUAIKAN (sudah ditautkan ke PS). */
export function statusPeminjaman(p: { ditutupPada: Date | null; penyesuaianId: string | null; baris: { jumlah: unknown; jumlahKembali: unknown }[] }): StatusPeminjaman {
  if (p.penyesuaianId) return "DISESUAIKAN";
  if (!p.ditutupPada) return "TERBUKA";
  return p.baris.some((b) => sisaBaris(b) > 0) ? "SELISIH" : "SELESAI";
}

/** Terlambat bila tanggal rencana (di zona tampilan) sudah lewat; pada hari rencana itu sendiri belum terlambat. */
export function terlambat(p: { rencanaKembali: Date | null; ditutupPada: Date | null }, sekarang: Date = new Date()): boolean {
  return !p.ditutupPada && !!p.rencanaKembali && tanggalIso(p.rencanaKembali) < tanggalIso(sekarang);
}

/**
 * Peta jumlah yang sedang di luar. Kunci = barangId bila gudangId diberikan,
 * selain itu `${gudangId}:${barangId}`. Barang tanpa sisa tidak masuk peta.
 */
export async function petaSedangDiLuar(klien: KlienDb, gudangId?: string): Promise<Map<string, number>> {
  const baris = await klien.barisPeminjamanBarang.findMany({
    where: { peminjaman: { penyesuaianId: null, ...(gudangId ? { gudangId } : {}) } },
    select: { barangId: true, jumlah: true, jumlahKembali: true, peminjaman: { select: { gudangId: true } } },
  });
  // Dijumlahkan sebagai Decimal supaya 0,1 + 0,2 tetap 0,3 (satuan bisa bukan pcs), baru diubah ke number.
  const jumlah = new Map<string, Desimal>();
  for (const b of baris) {
    const sisa = D(b.jumlah).minus(D(b.jumlahKembali));
    if (sisa.lte(0)) continue;
    const kunci = gudangId ? b.barangId : `${b.peminjaman.gudangId}:${b.barangId}`;
    jumlah.set(kunci, (jumlah.get(kunci) ?? D(0)).plus(sisa));
  }
  return new Map([...jumlah].map(([k, v]) => [k, v.toNumber()]));
}
