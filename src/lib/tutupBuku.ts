import type { Prisma, PrismaClient } from "@/prisma-klien/client";
import { saldoAkunPeriode, type AkunSaldo } from "@/lib/laporan";
import { jumlahkan, type Desimal } from "@/lib/uang";

/*
 * Tutup buku tahunan: pendapatan & beban tahun itu dipindahkan ke Laba Ditahan lewat jurnal JU-TUTUP
 * bertanggal 31 Desember. Tahun yang sudah ditutup terkunci: jurnal baru maupun penghapusan dokumen
 * bertanggal tahun itu ditolak sampai tahun dibuka kembali.
 */
type Klien = PrismaClient | Prisma.TransactionClient;

export function akhirTahun(tahun: number): Date {
  return new Date(tahun, 11, 31, 23, 59, 59, 999);
}
export function awalTahun(tahun: number): Date {
  return new Date(tahun, 0, 1, 0, 0, 0, 0);
}

/** Menolak pencatatan/penghapusan jurnal bertanggal di tahun yang sudah ditutup. */
export async function pastikanTahunTerbuka(klien: Klien, tanggal: Date) {
  const tahun = tanggal.getFullYear();
  const tutup = await klien.tutupBuku.findUnique({ where: { tahun }, include: { jurnal: { select: { nomor: true } } } });
  if (tutup) {
    throw new Error(
      `Tahun buku ${tahun} sudah ditutup${tutup.jurnal ? ` (jurnal penutup ${tutup.jurnal.nomor})` : ""}; buka kembali di Buku Besar › Tutup Buku sebelum mencatat atau menghapus transaksi bertanggal ${tahun}`,
    );
  }
}

export type BarisPenutupan = { akunId: string; kode: string; nama: string; jenis: string; saldo: Desimal };
export type RingkasanPenutupan = {
  tahun: number;
  pendapatan: BarisPenutupan[];
  beban: BarisPenutupan[];
  totalPendapatan: Desimal;
  totalBeban: Desimal;
  labaBersih: Desimal;
  jumlahJurnal: number;
};

/** Saldo pendapatan & beban rinci tahun `tahun` (tanpa jurnal penutup), bahan jurnal penutup dan pratinjaunya. */
export async function ringkasanPenutupan(klien: Klien, tahun: number): Promise<RingkasanPenutupan> {
  const [daftar, jumlahJurnal] = await Promise.all([
    saldoAkunPeriode(klien as PrismaClient, awalTahun(tahun), akhirTahun(tahun), true),
    klien.jurnal.count({ where: { tanggal: { gte: awalTahun(tahun), lte: akhirTahun(tahun) }, sumber: { not: "PENUTUP" } } }),
  ]);
  const ambil = (jenis: string) =>
    daftar
      .filter((a: AkunSaldo) => !a.kelompok && a.jenis === jenis && !a.saldo.isZero())
      .map((a) => ({ akunId: a.id, kode: a.kode, nama: a.nama, jenis: a.jenis, saldo: a.saldo }));
  const pendapatan = ambil("PENDAPATAN");
  const beban = ambil("BEBAN");
  const totalPendapatan = jumlahkan(pendapatan.map((b) => b.saldo));
  const totalBeban = jumlahkan(beban.map((b) => b.saldo));
  return { tahun, pendapatan, beban, totalPendapatan, totalBeban, labaBersih: totalPendapatan.minus(totalBeban), jumlahJurnal };
}
