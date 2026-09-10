import type { PrismaClient } from "@/prisma-klien/client";
import { db } from "@/lib/db";
import { D, jumlahkan, type Desimal } from "@/lib/uang";

/*
 * Laporan Piutang (per pelanggan) dan Hutang (per pemasok) per tanggal: sisa tiap faktur yang belum lunas
 * dikelompokkan menurut umur terhadap jatuh tempo (belum jatuh tempo, 1–30, 31–60, 61–90, >90 hari).
 */
export const KERANJANG_UMUR = ["Belum jatuh tempo", "1–30 hari", "31–60 hari", "61–90 hari", "> 90 hari"] as const;

export type BarisUmur = {
  id: string;
  nomor: string;
  tanggal: Date;
  jatuhTempo: Date | null;
  total: Desimal;
  terbayar: Desimal; // termasuk uang muka, potongan pajak, retur
  sisa: Desimal;
  umurHari: number; // hari lewat jatuh tempo (negatif = belum)
  keranjang: number; // indeks KERANJANG_UMUR
};
export type KelompokRekanan = { id: string; kode: string; nama: string; faktur: BarisUmur[]; sisa: Desimal; perKeranjang: Desimal[] };
export type LaporanUmur = { sampai: Date; kelompok: KelompokRekanan[]; total: Desimal; perKeranjang: Desimal[]; jumlahFaktur: number };

function keranjangDari(umurHari: number): number {
  if (umurHari <= 0) return 0;
  if (umurHari <= 30) return 1;
  if (umurHari <= 60) return 2;
  if (umurHari <= 90) return 3;
  return 4;
}
const hari = 24 * 60 * 60 * 1000;

function susun(sampai: Date, daftar: { rekanan: { id: string; kode: string; nama: string }; faktur: BarisUmur }[]): LaporanUmur {
  const peta = new Map<string, KelompokRekanan>();
  for (const { rekanan, faktur } of daftar) {
    if (faktur.sisa.lte(0)) continue;
    const k = peta.get(rekanan.id) ?? { id: rekanan.id, kode: rekanan.kode, nama: rekanan.nama, faktur: [], sisa: D(0), perKeranjang: KERANJANG_UMUR.map(() => D(0)) };
    k.faktur.push(faktur);
    k.sisa = k.sisa.plus(faktur.sisa);
    k.perKeranjang[faktur.keranjang] = k.perKeranjang[faktur.keranjang].plus(faktur.sisa);
    peta.set(rekanan.id, k);
  }
  const kelompok = [...peta.values()].sort((a, b) => a.nama.localeCompare(b.nama));
  for (const k of kelompok) k.faktur.sort((a, b) => a.tanggal.getTime() - b.tanggal.getTime());
  return {
    sampai,
    kelompok,
    total: jumlahkan(kelompok.map((k) => k.sisa)),
    perKeranjang: KERANJANG_UMUR.map((_, i) => jumlahkan(kelompok.map((k) => k.perKeranjang[i]))),
    jumlahFaktur: kelompok.reduce((s, k) => s + k.faktur.length, 0),
  };
}

/** Piutang usaha per tanggal: faktur penjualan s.d. tanggal itu dikurangi uang muka, penerimaan, dan retur s.d. tanggal itu. */
export async function laporanPiutang(klien: PrismaClient = db, sampai: Date): Promise<LaporanUmur> {
  const faktur = await klien.fakturPenjualan.findMany({
    where: { tanggal: { lte: sampai } },
    include: { pelanggan: { select: { id: true, kode: true, nama: true } }, penerimaan: { where: { tanggal: { lte: sampai } }, select: { jumlah: true, potonganPajak: true } }, retur: { where: { tanggal: { lte: sampai } }, select: { total: true } } },
  });
  return susun(
    sampai,
    faktur.map((f) => {
      const terbayar = D(f.uangMuka).plus(jumlahkan(f.penerimaan.map((p) => D(p.jumlah).plus(p.potonganPajak)))).plus(jumlahkan(f.retur.map((r) => r.total)));
      const umurHari = f.jatuhTempo ? Math.floor((sampai.getTime() - f.jatuhTempo.getTime()) / hari) : 0;
      return { rekanan: f.pelanggan, faktur: { id: f.id, nomor: f.nomor, tanggal: f.tanggal, jatuhTempo: f.jatuhTempo, total: D(f.total), terbayar, sisa: D(f.total).minus(terbayar), umurHari, keranjang: keranjangDari(umurHari) } };
    }),
  );
}

/** Hutang usaha per tanggal: faktur pembelian s.d. tanggal itu dikurangi pembayaran dan retur s.d. tanggal itu. */
export async function laporanHutang(klien: PrismaClient = db, sampai: Date): Promise<LaporanUmur> {
  const faktur = await klien.fakturPembelian.findMany({
    where: { tanggal: { lte: sampai } },
    include: { pemasok: { select: { id: true, kode: true, nama: true } }, pembayaran: { where: { tanggal: { lte: sampai } }, select: { jumlah: true, potonganPajak: true } }, retur: { where: { tanggal: { lte: sampai } }, select: { total: true } } },
  });
  return susun(
    sampai,
    faktur.map((f) => {
      const terbayar = jumlahkan(f.pembayaran.map((p) => D(p.jumlah).plus(p.potonganPajak))).plus(jumlahkan(f.retur.map((r) => r.total)));
      const umurHari = f.jatuhTempo ? Math.floor((sampai.getTime() - f.jatuhTempo.getTime()) / hari) : 0;
      return { rekanan: f.pemasok, faktur: { id: f.id, nomor: f.nomor, tanggal: f.tanggal, jatuhTempo: f.jatuhTempo, total: D(f.total), terbayar, sisa: D(f.total).minus(terbayar), umurHari, keranjang: keranjangDari(umurHari) } };
    }),
  );
}

export type PerubahanModal = {
  periode: { dari: Date; sampai: Date };
  ekuitasAwal: Desimal;
  setoranModal: Desimal;
  labaBersih: Desimal;
  prive: Desimal;
  lainnya: Desimal;
  ekuitasAkhir: Desimal;
  ekuitasAkhirNeraca: Desimal;
  cocok: boolean;
  rincianModal: { kode: string; nama: string; mutasi: Desimal }[];
};

/**
 * Laporan Perubahan Modal (ekuitas): ekuitas awal + setoran modal + laba bersih − prive ± lainnya = ekuitas akhir,
 * dicek terhadap total ekuitas neraca. Prive = akun modal bernama "Prive"; jurnal penutup tidak dihitung sebagai setoran.
 */
export async function laporanPerubahanModal(klien: PrismaClient = db, dari: Date, sampai: Date, labaBersih: Desimal, ekuitasAwal: Desimal, ekuitasAkhir: Desimal): Promise<PerubahanModal> {
  const baris = await klien.barisJurnal.findMany({
    where: { jurnal: { tanggal: { gte: dari, lte: sampai }, sumber: { not: "PENUTUP" } }, akun: { jenis: "MODAL", kelompok: false } },
    select: { debit: true, kredit: true, akun: { select: { kode: true, nama: true } } },
  });
  const peta = new Map<string, { kode: string; nama: string; mutasi: Desimal }>();
  for (const b of baris) {
    const ada = peta.get(b.akun.kode) ?? { kode: b.akun.kode, nama: b.akun.nama, mutasi: D(0) };
    peta.set(b.akun.kode, { ...ada, mutasi: ada.mutasi.plus(b.kredit).minus(b.debit) });
  }
  const rincian = [...peta.values()].sort((a, b) => a.kode.localeCompare(b.kode));
  const adalahPrive = (r: { nama: string }) => /prive/i.test(r.nama);
  const adalahLabaDitahan = (r: { nama: string }) => /laba/i.test(r.nama);
  const prive = jumlahkan(rincian.filter(adalahPrive).map((r) => r.mutasi.neg()));
  const setoranModal = jumlahkan(rincian.filter((r) => !adalahPrive(r) && !adalahLabaDitahan(r)).map((r) => r.mutasi));
  const lainnya = jumlahkan(rincian.filter((r) => adalahLabaDitahan(r)).map((r) => r.mutasi));
  const ekuitasAkhirHitung = ekuitasAwal.plus(setoranModal).plus(labaBersih).minus(prive).plus(lainnya);
  return {
    periode: { dari, sampai },
    ekuitasAwal,
    setoranModal,
    labaBersih,
    prive,
    lainnya,
    ekuitasAkhir: ekuitasAkhirHitung,
    ekuitasAkhirNeraca: ekuitasAkhir,
    cocok: ekuitasAkhirHitung.minus(ekuitasAkhir).abs().lte(D("0.01")),
    rincianModal: rincian,
  };
}
