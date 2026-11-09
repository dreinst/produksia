import type { Prisma, PrismaClient } from "@/prisma-klien/client";
import type { StatusKampanye, TujuanKampanye } from "@/prisma-klien/enums";
import { URUTAN_STATUS_KAMPANYE } from "@/lib/labelPemasaran";
import { saringPerusahaan } from "@/lib/perusahaan";
import { D, uang, type Desimal } from "@/lib/uang";

/*
 * Pustaka Perencana Iklan Meta (D6 §3.3, §6.1). Bukan "use server". Berisi rumus turunan (semua Prisma.Decimal,
 * pembulatan uang() 2 desimal setengah ke atas) dan ringkasanIklan. daftarKampanye dan kampanyeLengkap ditambahkan
 * paket Pemasaran dengan nama dan tanda tangan rancangan.
 */

type Klien = PrismaClient | Prisma.TransactionClient;
type Angka = Desimal | number | string;

/** Angka dasar satu laporan harian (atau jumlah beberapa laporan). */
export type DasarMetrik = {
  belanja: Angka;
  jangkauan: number;
  tayangan: number;
  klik: number;
  leads: number;
  konversi: number;
  pendapatan: Angka;
};

/** Laporan harian beserta nilai manual (null = otomatis). */
export type BarisMetrik = DasarMetrik & {
  hasil?: number | null;
  ctrManual?: Angka | null;
  cpcManual?: Angka | null;
  cpmManual?: Angka | null;
};

export type TurunanMetrik = {
  ctr: Desimal;
  cpc: Desimal;
  cpm: Desimal;
  hasilEfektif: number;
  cpr: Desimal;
  roas: Desimal;
};

export type TotalMetrik = {
  belanja: Desimal;
  jangkauan: number;
  tayangan: number;
  klik: number;
  leads: number;
  konversi: number;
  pendapatan: Desimal;
  hasilEfektif: number;
  ctr: Desimal;
  cpc: Desimal;
  cpm: Desimal;
  /** null bila laporan berasal dari kampanye dengan tujuan berbeda (CPR lintas tujuan tidak bermakna). */
  cpr: Desimal | null;
  roas: Desimal;
};

const NOL = D(0);
const manual = (v: Angka | null | undefined): Desimal | null => (v === null || v === undefined || v === "" ? null : uang(v));

/** Dasar "hasil" otomatis menurut tujuan kampanye. INTERAKSI tidak punya dasar (isi manual bila ingin CPR). */
export function dasarHasil(m: Pick<DasarMetrik, "jangkauan" | "klik" | "leads" | "konversi">, tujuan: TujuanKampanye): number {
  switch (tujuan) {
    case "PROSPEK":
      return m.leads;
    case "PENJUALAN":
    case "PROMOSI_APLIKASI":
      return m.konversi;
    case "TRAFFIC":
      return m.klik;
    case "KESADARAN":
      return m.jangkauan;
    case "INTERAKSI":
      return 0;
  }
}

/** CTR persen = klik × 100 ÷ tayangan; perkalian dulu, baru pembagian. */
export function hitungCtr(klik: number, tayangan: number): Desimal {
  return tayangan > 0 ? uang(D(klik).mul(100).div(tayangan)) : NOL;
}
/** CPC rupiah per klik. */
export function hitungCpc(belanja: Angka, klik: number): Desimal {
  return klik > 0 ? uang(D(belanja).div(klik)) : NOL;
}
/** CPM rupiah per 1000 tayangan. */
export function hitungCpm(belanja: Angka, tayangan: number): Desimal {
  return tayangan > 0 ? uang(D(belanja).mul(1000).div(tayangan)) : NOL;
}
/** Biaya per hasil. */
export function hitungCpr(belanja: Angka, hasil: number): Desimal {
  return hasil > 0 ? uang(D(belanja).div(hasil)) : NOL;
}
/** ROAS (kali) = pendapatan ÷ belanja. */
export function hitungRoas(pendapatan: Angka, belanja: Angka): Desimal {
  const b = D(belanja);
  return b.gt(0) ? uang(D(pendapatan).div(b)) : NOL;
}

/** Turunan satu laporan harian (D6 §3.3 no. 5): nilai manual menimpa hitungan. */
export function turunanMetrik(m: BarisMetrik, tujuan: TujuanKampanye): TurunanMetrik {
  const hasilEfektif = m.hasil ?? dasarHasil(m, tujuan);
  return {
    ctr: manual(m.ctrManual) ?? hitungCtr(m.klik, m.tayangan),
    cpc: manual(m.cpcManual) ?? hitungCpc(m.belanja, m.klik),
    cpm: manual(m.cpmManual) ?? hitungCpm(m.belanja, m.tayangan),
    hasilEfektif,
    cpr: hitungCpr(m.belanja, hasilEfektif),
    roas: hitungRoas(m.pendapatan, m.belanja),
  };
}

/** Dasar yang sudah dijumlah, ditambah hasilEfektif yang dijumlah per laporan. */
export type JumlahDasar = DasarMetrik & { hasilEfektif: number };

/**
 * Total dari angka dasar yang sudah dijumlah: CTR, CPC, CPM, CPR, ROAS dihitung ulang dari jumlah, nilai manual per laporan
 * diabaikan (seperti totals HKA). satuTujuan = false membuat CPR null.
 */
export function totalDariJumlah(j: JumlahDasar, satuTujuan = true): TotalMetrik {
  const belanja = uang(j.belanja);
  const pendapatan = uang(j.pendapatan);
  return {
    belanja,
    jangkauan: j.jangkauan,
    tayangan: j.tayangan,
    klik: j.klik,
    leads: j.leads,
    konversi: j.konversi,
    pendapatan,
    hasilEfektif: j.hasilEfektif,
    ctr: hitungCtr(j.klik, j.tayangan),
    cpc: hitungCpc(belanja, j.klik),
    cpm: hitungCpm(belanja, j.tayangan),
    cpr: satuTujuan ? hitungCpr(belanja, j.hasilEfektif) : null,
    roas: hitungRoas(pendapatan, belanja),
  };
}

/** Total beberapa laporan harian satu tujuan (atau tujuan berbeda per baris bila diberikan lewat tujuanPerBaris). */
export function totalMetrik(baris: readonly BarisMetrik[], tujuan: TujuanKampanye | readonly TujuanKampanye[]): TotalMetrik {
  const tujuanBaris = (i: number) => (typeof tujuan === "string" ? tujuan : (tujuan as readonly TujuanKampanye[])[i]);
  const j: JumlahDasar = { belanja: NOL, jangkauan: 0, tayangan: 0, klik: 0, leads: 0, konversi: 0, pendapatan: NOL, hasilEfektif: 0 };
  baris.forEach((m, i) => {
    j.belanja = D(j.belanja).plus(D(m.belanja));
    j.pendapatan = D(j.pendapatan).plus(D(m.pendapatan));
    j.jangkauan += m.jangkauan;
    j.tayangan += m.tayangan;
    j.klik += m.klik;
    j.leads += m.leads;
    j.konversi += m.konversi;
    j.hasilEfektif += m.hasil ?? dasarHasil(m, tujuanBaris(i));
  });
  const satuTujuan = typeof tujuan === "string" || new Set(tujuan).size <= 1;
  return totalDariJumlah(j, satuTujuan);
}

export type SaringanIklan = {
  /** "" atau undefined = semua, "tanpa" = kampanye tanpa proyek, selain itu id proyek */
  proyek?: string;
  status?: StatusKampanye | "";
  q?: string;
};

export type BarisKampanyeRingkas = {
  id: string;
  nama: string;
  tujuan: TujuanKampanye;
  status: StatusKampanye;
  anggaran: Desimal;
  proyekId: string | null;
  perusahaanId: string;
  dibuatPada: Date;
  total: TotalMetrik;
};

export type RingkasanIklan = {
  jumlahKampanye: number;
  aktif: number;
  anggaranRencana: Desimal;
  perStatus: { status: StatusKampanye; jumlah: number }[];
  total: TotalMetrik;
  /** Urut dibuatPada turun. */
  perKampanye: BarisKampanyeRingkas[];
};

function whereKampanye(saringan: SaringanIklan, perusahaanId: string | null | undefined): Prisma.KampanyeWhereInput {
  const where: Prisma.KampanyeWhereInput = { diarsipkanPada: null, ...saringPerusahaan(perusahaanId) };
  if (saringan.proyek === "tanpa") where.proyekId = null;
  else if (saringan.proyek) where.proyekId = saringan.proyek;
  if (saringan.status) where.status = saringan.status;
  const q = saringan.q?.trim();
  if (q) where.nama = { contains: q, mode: "insensitive" };
  return where;
}

/**
 * Ringkasan iklan (D6 §3.3 no. 6): kampanye aktif (belum diarsip) yang tersaring, jumlah per status, anggaran rencana,
 * dan total metrik. Angka laporan dijumlah dengan dua groupBy per kampanye (semua baris; baris yang hasil-nya diisi
 * manual), jadi hasilEfektif = Σ hasil manual + Σ dasar baris yang tidak manual tanpa memuat semua baris.
 * perusahaanId null/undefined = gabungan.
 */
export async function ringkasanIklan(klien: Klien, saringan: SaringanIklan = {}, perusahaanId?: string | null): Promise<RingkasanIklan> {
  const kampanye = await klien.kampanye.findMany({
    where: whereKampanye(saringan, perusahaanId),
    orderBy: [{ dibuatPada: "desc" }, { id: "asc" }],
    select: { id: true, nama: true, tujuan: true, status: true, anggaran: true, proyekId: true, perusahaanId: true, dibuatPada: true },
  });
  const ids = kampanye.map((k) => k.id);
  const _sum = { belanja: true, jangkauan: true, tayangan: true, klik: true, leads: true, konversi: true, pendapatan: true, hasil: true } as const;
  const [semua, manualHasil] = ids.length
    ? await Promise.all([
        klien.metrikIklan.groupBy({ by: ["kampanyeId"], where: { kampanyeId: { in: ids } }, _sum }),
        klien.metrikIklan.groupBy({ by: ["kampanyeId"], where: { kampanyeId: { in: ids }, hasil: { not: null } }, _sum }),
      ])
    : [[], []];
  const petaSemua = new Map(semua.map((g) => [g.kampanyeId, g._sum]));
  const petaManual = new Map(manualHasil.map((g) => [g.kampanyeId, g._sum]));

  const nol: JumlahDasar = { belanja: NOL, jangkauan: 0, tayangan: 0, klik: 0, leads: 0, konversi: 0, pendapatan: NOL, hasilEfektif: 0 };
  const keseluruhan: JumlahDasar = { ...nol };
  const perKampanye: BarisKampanyeRingkas[] = kampanye.map((k) => {
    const s = petaSemua.get(k.id);
    const m = petaManual.get(k.id);
    const dasar = (x: typeof s) => ({ jangkauan: x?.jangkauan ?? 0, klik: x?.klik ?? 0, leads: x?.leads ?? 0, konversi: x?.konversi ?? 0 });
    // dasar baris otomatis = dasar semua baris − dasar baris yang hasil-nya manual
    const ds = dasar(s);
    const dm = dasar(m);
    const dasarOtomatis = dasarHasil(
      { jangkauan: ds.jangkauan - dm.jangkauan, klik: ds.klik - dm.klik, leads: ds.leads - dm.leads, konversi: ds.konversi - dm.konversi },
      k.tujuan,
    );
    const j: JumlahDasar = {
      belanja: D(s?.belanja),
      jangkauan: ds.jangkauan,
      tayangan: s?.tayangan ?? 0,
      klik: ds.klik,
      leads: ds.leads,
      konversi: ds.konversi,
      pendapatan: D(s?.pendapatan),
      hasilEfektif: (m?.hasil ?? 0) + dasarOtomatis,
    };
    keseluruhan.belanja = D(keseluruhan.belanja).plus(D(j.belanja));
    keseluruhan.pendapatan = D(keseluruhan.pendapatan).plus(D(j.pendapatan));
    keseluruhan.jangkauan += j.jangkauan;
    keseluruhan.tayangan += j.tayangan;
    keseluruhan.klik += j.klik;
    keseluruhan.leads += j.leads;
    keseluruhan.konversi += j.konversi;
    keseluruhan.hasilEfektif += j.hasilEfektif;
    return { ...k, anggaran: D(k.anggaran), total: totalDariJumlah(j) };
  });

  const jumlahStatus = new Map<StatusKampanye, number>();
  for (const k of kampanye) jumlahStatus.set(k.status, (jumlahStatus.get(k.status) ?? 0) + 1);
  const satuTujuan = new Set(kampanye.map((k) => k.tujuan)).size <= 1;
  return {
    jumlahKampanye: kampanye.length,
    aktif: jumlahStatus.get("AKTIF") ?? 0,
    anggaranRencana: uang(kampanye.reduce((a, k) => a.plus(D(k.anggaran)), NOL)),
    perStatus: URUTAN_STATUS_KAMPANYE.map((status) => ({ status, jumlah: jumlahStatus.get(status) ?? 0 })),
    total: totalDariJumlah(keseluruhan, satuTujuan),
    perKampanye,
  };
}
