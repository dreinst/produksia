import type { PrismaClient } from "@/prisma-klien/client";
import { db } from "@/lib/db";
import { D, jumlahkan, type Desimal } from "@/lib/uang";
import type { Periode } from "@/lib/laporan";

/*
 * Laporan arus kas metode langsung, langsung dari jurnal: setiap jurnal yang menyentuh akun kas/bank
 * dipecah menurut akun lawannya (kredit − debit lawan = kas masuk). Karena tiap jurnal seimbang,
 * Σ arus = perubahan saldo kas/bank, dicek ulang ke buku besar (harus persis sama).
 * Klasifikasi akun lawan: Modal & kewajiban jangka panjang (2-2xxx) → pendanaan;
 * aset tetap & investasi (1-2xxx, 1-3xxx) → investasi; selebihnya → operasi.
 */
export type KelasArus = "OPERASI" | "INVESTASI" | "PENDANAAN";
export type BarisArus = { id: string; kode: string; nama: string; kelompok: false; kedalaman: 0; jumlah: Desimal };
export type ArusKas = {
  periode: Periode;
  kasAwal: Desimal;
  operasi: BarisArus[];
  totalOperasi: Desimal;
  investasi: BarisArus[];
  totalInvestasi: Desimal;
  pendanaan: BarisArus[];
  totalPendanaan: Desimal;
  kenaikan: Desimal;
  kasAkhir: Desimal;
  kasAkhirBukuBesar: Desimal;
  cocok: boolean;
  daftarKas: { id: string; kode: string; nama: string; saldoAwal: Desimal; saldoAkhir: Desimal }[];
  jumlahJurnal: number;
};

export function kelasArus(akun: { jenis: string; kode: string }): KelasArus {
  if (akun.jenis === "MODAL") return "PENDANAAN";
  if (akun.jenis === "KEWAJIBAN" && akun.kode.startsWith("2-2")) return "PENDANAAN";
  if (akun.jenis === "ASET" && (akun.kode.startsWith("1-2") || akun.kode.startsWith("1-3"))) return "INVESTASI";
  return "OPERASI";
}

export async function hitungArusKas(klien: PrismaClient = db, periode: Periode): Promise<ArusKas> {
  const akunKas = await klien.akun.findMany({ where: { kasBank: true, kelompok: false }, orderBy: { kode: "asc" } });
  const idKas = akunKas.map((a) => a.id);
  const saldoKas = async (sampai: Date) => {
    const agg = await klien.barisJurnal.groupBy({ by: ["akunId"], where: { akunId: { in: idKas }, jurnal: { tanggal: { lte: sampai } } }, _sum: { debit: true, kredit: true } });
    return new Map(agg.map((a) => [a.akunId, D(a._sum.debit ?? 0).minus(D(a._sum.kredit ?? 0))]));
  };
  const [awal, akhir, daftarJurnal] = await Promise.all([
    saldoKas(new Date(periode.dari.getTime() - 1)),
    saldoKas(periode.sampai),
    klien.jurnal.findMany({
      where: { tanggal: { gte: periode.dari, lte: periode.sampai }, baris: { some: { akunId: { in: idKas } } } },
      include: { baris: { include: { akun: { select: { id: true, kode: true, nama: true, jenis: true, kasBank: true, kelompok: true } } } } },
    }),
  ]);
  const nol = D(0);
  const kumpul: Record<KelasArus, Map<string, BarisArus>> = { OPERASI: new Map(), INVESTASI: new Map(), PENDANAAN: new Map() };
  for (const j of daftarJurnal) {
    for (const b of j.baris) {
      if (b.akun.kasBank) continue; // perpindahan antar kas/bank saling meniadakan
      const masuk = D(b.kredit).minus(b.debit);
      if (masuk.isZero()) continue;
      const kelas = kelasArus(b.akun);
      const ada = kumpul[kelas].get(b.akun.id) ?? { id: b.akun.id, kode: b.akun.kode, nama: b.akun.nama, kelompok: false as const, kedalaman: 0 as const, jumlah: nol };
      kumpul[kelas].set(b.akun.id, { ...ada, jumlah: ada.jumlah.plus(masuk) });
    }
  }
  const susun = (kelas: KelasArus) => {
    const baris = [...kumpul[kelas].values()].filter((b) => !b.jumlah.isZero()).sort((a, b) => a.kode.localeCompare(b.kode));
    return { baris, total: jumlahkan(baris.map((b) => b.jumlah)) };
  };
  const operasi = susun("OPERASI"), investasi = susun("INVESTASI"), pendanaan = susun("PENDANAAN");
  const kasAwal = jumlahkan(idKas.map((id) => awal.get(id) ?? nol));
  const kasAkhirBukuBesar = jumlahkan(idKas.map((id) => akhir.get(id) ?? nol));
  const kenaikan = operasi.total.plus(investasi.total).plus(pendanaan.total);
  const kasAkhir = kasAwal.plus(kenaikan);
  return {
    periode,
    kasAwal,
    operasi: operasi.baris,
    totalOperasi: operasi.total,
    investasi: investasi.baris,
    totalInvestasi: investasi.total,
    pendanaan: pendanaan.baris,
    totalPendanaan: pendanaan.total,
    kenaikan,
    kasAkhir,
    kasAkhirBukuBesar,
    cocok: kasAkhir.minus(kasAkhirBukuBesar).abs().lte(D("0.01")),
    daftarKas: akunKas.map((a) => ({ id: a.id, kode: a.kode, nama: a.nama, saldoAwal: awal.get(a.id) ?? nol, saldoAkhir: akhir.get(a.id) ?? nol })),
    jumlahJurnal: daftarJurnal.length,
  };
}
