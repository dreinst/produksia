import type { Prisma, PrismaClient } from "@/prisma-klien/client";
import { D, jumlahkan, type Desimal } from "@/lib/uang";

type Klien = PrismaClient | Prisma.TransactionClient;

/** Laporan prive: pengambilan pribadi pemilik pada periode, dikelompokkan per pemilik + rincian per dokumen. */
export async function hitungLaporanPrive(klien: Klien, dari: Date, sampai: Date) {
  const rincian = await klien.prive.findMany({ where: { tanggal: { gte: dari, lte: sampai } }, include: { akunKas: true }, orderBy: { tanggal: "asc" } });
  const peta = new Map<string, Desimal[]>();
  for (const p of rincian) peta.set(p.pemilikNama, [...(peta.get(p.pemilikNama) ?? []), D(p.jumlah)]);
  const perPemilik = [...peta.entries()].map(([pemilikNama, daftar]) => ({ pemilikNama, total: jumlahkan(daftar) }));
  return { rincian, perPemilik, total: jumlahkan(rincian.map((p) => p.jumlah)) };
}
