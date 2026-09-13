import type { PrismaClient } from "@/prisma-klien/client";
import { D, type Desimal } from "@/lib/uang";
import { saldoAkunPeriode, susunHierarki, type BarisLaporan, type Periode } from "@/lib/laporan";

/*
 * Ringkasan Pendapatan periode, dibaca dari buku besar (akun jenis PENDAPATAN, tanpa jurnal penutup)
 * supaya totalnya selalu sama dengan baris Pendapatan di Laba Rugi.
 * Per pelanggan: baris jurnal Faktur/Retur Penjualan ditelusuri ke pelanggan fakturnya; baris pendapatan
 * dari Kas Masuk, Jurnal Umum, atau pelepasan aset tidak punya pelanggan dan dikumpulkan sebagai satu baris.
 * Per jenis layanan: hierarki akun pendapatan (Event / Produksi / Sewa × Reguler / Flagship, dst.).
 */

export type PendapatanPelanggan = {
  id: string | null; // null = tanpa pelanggan
  kode: string;
  nama: string;
  jumlahFaktur: number;
  faktur: Desimal; // pendapatan dari faktur (DPP)
  retur: Desimal; // pengurang dari retur penjualan
  bersih: Desimal;
};
export type RingkasanPendapatan = {
  periode: Periode;
  perPelanggan: PendapatanPelanggan[];
  perLayanan: BarisLaporan[];
  total: Desimal;
  jumlahFaktur: number;
};

export const TANPA_PELANGGAN = "Tanpa pelanggan (kas masuk, jurnal umum, lainnya)";

export async function ringkasanPendapatan(klien: PrismaClient, periode: Periode): Promise<RingkasanPendapatan> {
  const rentang = { gte: periode.dari, lte: periode.sampai };
  const [baris, daftarAkun] = await Promise.all([
    klien.barisJurnal.findMany({
      where: { akun: { jenis: "PENDAPATAN" }, jurnal: { tanggal: rentang, sumber: { not: "PENUTUP" } } },
      select: {
        debit: true,
        kredit: true,
        jurnal: {
          select: {
            fakturPenjualan: { select: { id: true, pelanggan: { select: { id: true, kode: true, nama: true } } } },
            returPenjualan: { select: { faktur: { select: { pelanggan: { select: { id: true, kode: true, nama: true } } } } } },
          },
        },
      },
    }),
    saldoAkunPeriode(klien, periode.dari, periode.sampai, true),
  ]);

  const peta = new Map<string, PendapatanPelanggan & { fakturIds: Set<string> }>();
  const ambil = (p: { id: string; kode: string; nama: string } | null) => {
    const kunci = p?.id ?? "";
    let k = peta.get(kunci);
    if (!k) {
      k = { id: p?.id ?? null, kode: p?.kode ?? "", nama: p?.nama ?? TANPA_PELANGGAN, jumlahFaktur: 0, faktur: D(0), retur: D(0), bersih: D(0), fakturIds: new Set() };
      peta.set(kunci, k);
    }
    return k;
  };
  for (const b of baris) {
    const kredit = D(b.kredit), debit = D(b.debit);
    if (b.jurnal.fakturPenjualan) {
      const k = ambil(b.jurnal.fakturPenjualan.pelanggan);
      k.faktur = k.faktur.plus(kredit).minus(debit);
      k.fakturIds.add(b.jurnal.fakturPenjualan.id);
    } else if (b.jurnal.returPenjualan) {
      const k = ambil(b.jurnal.returPenjualan.faktur.pelanggan);
      k.retur = k.retur.plus(debit).minus(kredit);
    } else {
      const k = ambil(null);
      k.faktur = k.faktur.plus(kredit).minus(debit);
    }
  }
  const perPelanggan = [...peta.values()]
    .map(({ fakturIds, ...k }) => ({ ...k, jumlahFaktur: fakturIds.size, bersih: k.faktur.minus(k.retur) }))
    .filter((k) => !k.bersih.isZero() || k.jumlahFaktur > 0)
    .sort((a, b) => (a.id === null ? 1 : b.id === null ? -1 : b.bersih.comparedTo(a.bersih)));

  const layanan = susunHierarki(daftarAkun, (a) => a.jenis === "PENDAPATAN");
  return {
    periode,
    perPelanggan,
    perLayanan: layanan.baris,
    total: layanan.total,
    jumlahFaktur: perPelanggan.reduce((s, k) => s + k.jumlahFaktur, 0),
  };
}
