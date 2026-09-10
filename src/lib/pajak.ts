import type { Prisma, PrismaClient } from "@/prisma-klien/client";
import { D, jumlahkan, uang, type Desimal } from "@/lib/uang";

/*
 * Ringkasan pajak per bulan langsung dari dokumen: omzet (DPP faktur penjualan − retur), PPN keluaran/masukan
 * (hanya terisi bila PKP), PPh 23 yang dipotong klien / yang kita potong, dan PPh Final UMKM = omzet × tarif.
 * Dipakai halaman Pajak & SPT dan aksi catatPphFinal.
 */
type Klien = PrismaClient | Prisma.TransactionClient;

export type PajakBulan = {
  periode: string; // YYYY-MM
  bulan: number;
  omzet: Desimal;
  ppnKeluaran: Desimal;
  ppnMasukan: Desimal;
  ppnKurangBayar: Desimal;
  pph23DipotongKlien: Desimal;
  pph23KitaPotong: Desimal;
  pphFinal: Desimal;
  tercatat: { id: string; jumlah: Desimal; omzet: Desimal; tarifPersen: Desimal; nomorJurnal: string | null } | null;
};
export type RingkasanPajak = {
  tahun: number;
  tarifPphFinal: Desimal;
  bulan: PajakBulan[];
  total: Pick<PajakBulan, "omzet" | "ppnKeluaran" | "ppnMasukan" | "ppnKurangBayar" | "pph23DipotongKlien" | "pph23KitaPotong" | "pphFinal">;
  totalPphFinalTercatat: Desimal;
};

export const periodeBulan = (tahun: number, bulan: number) => `${tahun}-${String(bulan).padStart(2, "0")}`;
export function batasBulan(tahun: number, bulan: number): { dari: Date; sampai: Date } {
  return { dari: new Date(tahun, bulan - 1, 1, 0, 0, 0, 0), sampai: new Date(tahun, bulan, 0, 23, 59, 59, 999) };
}
export function hitungPphFinal(omzet: Desimal, tarifPersen: Desimal): Desimal {
  return omzet.lte(0) ? D(0) : uang(omzet.mul(tarifPersen).div(100));
}

export async function ringkasanPajak(klien: Klien, tahun: number, tarifPphFinal: Desimal): Promise<RingkasanPajak> {
  const dari = new Date(tahun, 0, 1), sampai = new Date(tahun, 11, 31, 23, 59, 59, 999);
  const rentang = { tanggal: { gte: dari, lte: sampai } };
  const [fj, rj, fb, rb, trm, byr, tercatat] = await Promise.all([
    klien.fakturPenjualan.findMany({ where: rentang, select: { tanggal: true, dpp: true, ppn: true } }),
    klien.returPenjualan.findMany({ where: rentang, select: { tanggal: true, dpp: true, ppn: true } }),
    klien.fakturPembelian.findMany({ where: rentang, select: { tanggal: true, ppn: true } }),
    klien.returPembelian.findMany({ where: rentang, select: { tanggal: true, ppn: true } }),
    klien.penerimaanPenjualan.findMany({ where: rentang, select: { tanggal: true, potonganPajak: true } }),
    klien.pembayaranPembelian.findMany({ where: rentang, select: { tanggal: true, potonganPajak: true } }),
    klien.pphFinalBulanan.findMany({ where: { periode: { startsWith: `${tahun}-` } }, include: { jurnal: { select: { nomor: true } } } }),
  ]);
  const nol = D(0);
  const perBulan = <T extends { tanggal: Date }>(daftar: T[], bulan: number) => daftar.filter((d) => d.tanggal.getMonth() + 1 === bulan);
  const petaTercatat = new Map(tercatat.map((t) => [t.periode, t]));
  const bulan: PajakBulan[] = [];
  for (let b = 1; b <= 12; b++) {
    const omzet = jumlahkan(perBulan(fj, b).map((x) => x.dpp)).minus(jumlahkan(perBulan(rj, b).map((x) => x.dpp)));
    const ppnKeluaran = jumlahkan(perBulan(fj, b).map((x) => x.ppn)).minus(jumlahkan(perBulan(rj, b).map((x) => x.ppn)));
    const ppnMasukan = jumlahkan(perBulan(fb, b).map((x) => x.ppn)).minus(jumlahkan(perBulan(rb, b).map((x) => x.ppn)));
    const t = petaTercatat.get(periodeBulan(tahun, b));
    bulan.push({
      periode: periodeBulan(tahun, b),
      bulan: b,
      omzet,
      ppnKeluaran,
      ppnMasukan,
      ppnKurangBayar: ppnKeluaran.minus(ppnMasukan),
      pph23DipotongKlien: jumlahkan(perBulan(trm, b).map((x) => x.potonganPajak)),
      pph23KitaPotong: jumlahkan(perBulan(byr, b).map((x) => x.potonganPajak)),
      pphFinal: hitungPphFinal(omzet, tarifPphFinal),
      tercatat: t ? { id: t.id, jumlah: D(t.jumlah), omzet: D(t.omzet), tarifPersen: D(t.tarifPersen), nomorJurnal: t.jurnal?.nomor ?? null } : null,
    });
  }
  const total = (k: keyof PajakBulan) => jumlahkan(bulan.map((x) => x[k] as Desimal));
  return {
    tahun,
    tarifPphFinal,
    bulan,
    total: { omzet: total("omzet"), ppnKeluaran: total("ppnKeluaran"), ppnMasukan: total("ppnMasukan"), ppnKurangBayar: total("ppnKurangBayar"), pph23DipotongKlien: total("pph23DipotongKlien"), pph23KitaPotong: total("pph23KitaPotong"), pphFinal: total("pphFinal") },
    totalPphFinalTercatat: jumlahkan(bulan.map((x) => x.tercatat?.jumlah ?? nol)),
  };
}
