import { D } from "@/lib/uang";
import { tanggalIso } from "@/lib/waktu";

/*
 * Peminjaman Barang (loading out / loading in) untuk kru event. Sejak disetujui Gudang, StokBarang
 * sungguhan dikurangi (lihat src/lib/persetujuan.ts, berkas "peminjaman") lewat kurangiStok/tambahStok
 * (src/lib/stok.ts) di dalam transaksi, jadi StokBarang.jumlah SUDAH mencerminkan barang yang masih
 * di luar - tidak ada lagi perhitungan "tersedia = stok - sedang di luar" yang terpisah. Dokumen yang
 * masih DRAFT/MENUNGGU belum menyentuh stok sama sekali (lihat src/lib/hakAkses.ts).
 */

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

/** Bagian yang sudah diajukan kembali oleh Kru tapi belum dikonfirmasi (stok belum ditambah balik) oleh Gudang. */
export function menungguKonfirmasiBaris(b: { jumlahDiajukanKembali: unknown; jumlahKembali: unknown }): number {
  return D(b.jumlahDiajukanKembali as string).minus(D(b.jumlahKembali as string)).toNumber();
}
