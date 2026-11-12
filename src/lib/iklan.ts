import type { Kampanye, Prisma, PrismaClient } from "@/prisma-klien/client";
import type { GenderAudiens, StatusKampanye, TujuanKampanye } from "@/prisma-klien/enums";
import { URUTAN_STATUS_KAMPANYE, URUTAN_TUJUAN } from "@/lib/labelPemasaran";
import { saringPerusahaan } from "@/lib/perusahaan";
import { D, uang, type Desimal } from "@/lib/uang";
import type { ParamDaftar } from "@/lib/daftar";
import { bacaWaktuLokal, tanggalIso } from "@/lib/waktu";
import {
  bulatOpsional,
  enumWajib,
  geserHari,
  idOpsional,
  tanggalDariIso,
  tanggalOpsional,
  teksOpsional,
  teksWajib,
  uangBolehKosong,
  uangOpsional,
} from "@/lib/pemasaran";

/*
 * Pustaka Perencana Iklan Meta (D6 §3.3, §6.1). Bukan "use server". Berisi rumus turunan (semua Prisma.Decimal,
 * pembulatan uang() 2 desimal setengah ke atas) dan ringkasanIklan dari paket dashboard (rumus tidak diubah), ditambah
 * pembaca isian kampanye, set iklan, iklan, dan laporan harian, kunci kampanye aktif, daftarKampanye, dan
 * kampanyeLengkap untuk halaman.
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

// ---------- Kunci dan pembaca isian (D6 §3.3 no. 1 sampai 4) ----------

export const PESAN_KAMPANYE_TIDAK_ADA = "Kampanye tidak ditemukan";

/**
 * Kunci baris kampanye lalu baca ulang; melempar bila tidak ada atau sudah diarsipkan. `eksklusif` (FOR UPDATE) untuk
 * ubah dan arsip kampanye serta laporan harian (unik per tanggal); aksi anak lain cukup FOR SHARE supaya kampanye tidak
 * diarsipkan di tengah jalan.
 */
export async function kunciKampanyeAktif(tx: Klien, id: string, eksklusif = false): Promise<Kampanye> {
  if (eksklusif) await tx.$queryRaw`SELECT 1 FROM "Kampanye" WHERE "id" = ${id} FOR UPDATE`;
  else await tx.$queryRaw`SELECT 1 FROM "Kampanye" WHERE "id" = ${id} FOR SHARE`;
  const k = await tx.kampanye.findFirst({ where: { id, diarsipkanPada: null } });
  if (!k) throw new Error(PESAN_KAMPANYE_TIDAK_ADA);
  return k;
}

export type IsianKampanye = {
  nama: string;
  tujuan: TujuanKampanye;
  anggaran: Desimal;
  tanggalMulai: Date | null;
  tanggalSelesai: Date | null;
  status: StatusKampanye;
  catatan: string | null;
};

/** Isian kampanye (D6 §3.3 no. 1). Proyek dibaca terpisah dengan bacaProyekId terhadap perusahaan kampanye. */
export function bacaIsianKampanye(fd: FormData): IsianKampanye {
  const tanggalMulai = tanggalOpsional(fd, "tanggalMulai", "Tanggal mulai");
  const tanggalSelesai = tanggalOpsional(fd, "tanggalSelesai", "Tanggal selesai");
  if (tanggalMulai && tanggalSelesai && tanggalIso(tanggalSelesai) < tanggalIso(tanggalMulai)) throw new Error("Tanggal selesai tidak boleh sebelum tanggal mulai");
  return {
    nama: teksWajib(fd, "nama", "Nama kampanye", 200),
    tujuan: enumWajib(fd, "tujuan", URUTAN_TUJUAN, "PROSPEK", "Tujuan kampanye"),
    anggaran: uangOpsional(fd, "anggaran", "Anggaran"),
    tanggalMulai,
    tanggalSelesai,
    status: enumWajib(fd, "status", URUTAN_STATUS_KAMPANYE, "DIRENCANAKAN", "Status kampanye"),
    catatan: teksOpsional(fd, "catatan", "Catatan", 5000),
  };
}

const URUTAN_GENDER: readonly GenderAudiens[] = ["SEMUA", "PEREMPUAN", "LAKI_LAKI"];

export type IsianSetIklan = {
  nama: string;
  audiens: string | null;
  lokasi: string | null;
  usia: string | null;
  gender: GenderAudiens;
  penempatan: string | null;
  anggaran: Desimal;
  catatan: string | null;
};

/** Isian set iklan (D6 §3.3 no. 2). Kampanye diambil dari argumen aksi, tidak dari isian. */
export function bacaIsianSetIklan(fd: FormData): IsianSetIklan {
  return {
    nama: teksWajib(fd, "nama", "Nama set iklan", 200),
    audiens: teksOpsional(fd, "audiens", "Audiens", 500),
    lokasi: teksOpsional(fd, "lokasi", "Lokasi", 200),
    usia: teksOpsional(fd, "usia", "Usia", 20),
    gender: enumWajib(fd, "gender", URUTAN_GENDER, "SEMUA", "Gender"),
    penempatan: teksOpsional(fd, "penempatan", "Penempatan", 200),
    anggaran: uangOpsional(fd, "anggaran", "Anggaran"),
    catatan: teksOpsional(fd, "catatan", "Catatan", 5000),
  };
}

export type IsianIklan = {
  setIklanId: string;
  nama: string;
  berkasKreatifId: string | null;
  teksUtama: string | null;
  judulIklan: string | null;
  cta: string | null;
  urlTujuan: string | null;
  catatan: string | null;
};

/** URL tujuan iklan harus http:// atau https:// (mencegah javascript: ikut dirender sebagai tautan). Murni. */
export function urlTujuanSah(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Isian iklan (D6 §3.3 no. 3). Kepemilikan set iklan dan berkas kreatif diperiksa aksi di dalam transaksi. */
export function bacaIsianIklan(fd: FormData): IsianIklan {
  const setIklanId = idOpsional(fd, "setIklanId");
  if (!setIklanId) throw new Error("Set iklan wajib dipilih");
  const urlTujuan = teksOpsional(fd, "urlTujuan", "URL tujuan", 2000);
  if (urlTujuan && !urlTujuanSah(urlTujuan)) throw new Error("URL tujuan harus diawali http:// atau https://");
  return {
    setIklanId,
    nama: teksWajib(fd, "nama", "Nama iklan", 200),
    berkasKreatifId: idOpsional(fd, "berkasKreatifId"),
    teksUtama: teksOpsional(fd, "teksUtama", "Teks utama", 5000),
    judulIklan: teksOpsional(fd, "judulIklan", "Judul iklan", 200),
    cta: teksOpsional(fd, "cta", "CTA", 60),
    urlTujuan,
    catatan: teksOpsional(fd, "catatan", "Catatan", 5000),
  };
}

export type IsianMetrik = {
  tanggal: Date;
  belanja: Desimal;
  jangkauan: number;
  tayangan: number;
  klik: number;
  leads: number;
  konversi: number;
  hasil: number | null;
  pendapatan: Desimal;
  ctrManual: Desimal | null;
  cpcManual: Desimal | null;
  cpmManual: Desimal | null;
  catatan: string | null;
};

/** Isian laporan harian (D6 §3.3 no. 4). Kosong pada hasil dan nilai CTR/CPC/CPM manual = dihitung otomatis. */
export function bacaIsianMetrik(fd: FormData): IsianMetrik {
  const t = String(fd.get("tanggal") ?? "").trim();
  if (!t) throw new Error("Tanggal laporan wajib diisi");
  const tanggal = tanggalDariIso(t);
  if (!tanggal) throw new Error("Tanggal laporan tidak valid");
  return {
    tanggal,
    belanja: uangOpsional(fd, "belanja", "Belanja"),
    jangkauan: bulatOpsional(fd, "jangkauan", "Jangkauan"),
    tayangan: bulatOpsional(fd, "tayangan", "Tayangan"),
    klik: bulatOpsional(fd, "klik", "Klik"),
    leads: bulatOpsional(fd, "leads", "Leads"),
    konversi: bulatOpsional(fd, "konversi", "Konversi"),
    hasil: bulatOpsional(fd, "hasil", "Hasil", { bolehKosong: true }),
    pendapatan: uangOpsional(fd, "pendapatan", "Pendapatan"),
    ctrManual: uangBolehKosong(fd, "ctrManual", "CTR"),
    cpcManual: uangBolehKosong(fd, "cpcManual", "CPC"),
    cpmManual: uangBolehKosong(fd, "cpmManual", "CPM"),
    catatan: teksOpsional(fd, "catatan", "Catatan", 2000),
  };
}

/** Rentang satu hari (ZONA_WAKTU) untuk tanggal laporan, dipakai pemeriksaan unik per kampanye per tanggal. */
export function rentangHariLaporan(tanggal: Date): { gte: Date; lt: Date } {
  const iso = tanggalIso(tanggal);
  return { gte: bacaWaktuLokal(`${iso}T00:00`)!, lt: bacaWaktuLokal(`${geserHari(iso, 1)}T00:00`)! };
}

// ---------- Fungsi baca halaman (D6 §6.6) ----------

type ParamMentah = Record<string, string | string[] | undefined>;
const satu = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v ?? "").trim();

/** Saringan dari query string halaman; nilai tidak dikenal diabaikan. q diambil dari param daftar. */
export function bacaSaringanIklan(p: ParamMentah): SaringanIklan {
  const status = satu(p.status);
  return { proyek: satu(p.proyek).slice(0, 100), status: (URUTAN_STATUS_KAMPANYE as readonly string[]).includes(status) ? (status as StatusKampanye) : "" };
}

const PILIH_KAMPANYE_DAFTAR = {
  id: true,
  nama: true,
  tujuan: true,
  status: true,
  anggaran: true,
  tanggalMulai: true,
  tanggalSelesai: true,
  proyekId: true,
  perusahaanId: true,
  dibuatPada: true,
  perusahaan: { select: { id: true, kode: true, nama: true, warna: true } },
  proyek: { select: { id: true, kode: true, nama: true, warna: true } },
} satisfies Prisma.KampanyeSelect;

export type BarisKampanyeDaftar = Omit<Prisma.KampanyeGetPayload<{ select: typeof PILIH_KAMPANYE_DAFTAR }>, "anggaran"> & { anggaran: Desimal; total: TotalMetrik };

/**
 * Tabel kampanye halaman Perencana Iklan (D6 §6.6): kampanye aktif tersaring dipaginasi param (urut dibuat terbaru),
 * dengan total metrik per kampanye yang dihitung hanya untuk baris halaman itu (dua groupBy seperti ringkasanIklan).
 */
export async function daftarKampanye(klien: Klien, saringan: SaringanIklan, param: Pick<ParamDaftar, "q" | "lewati" | "ambil">, perusahaanId?: string | null): Promise<{ total: number; baris: BarisKampanyeDaftar[] }> {
  const where = whereKampanye({ ...saringan, q: param.q || saringan.q }, perusahaanId);
  const [total, kampanye] = await Promise.all([
    klien.kampanye.count({ where }),
    klien.kampanye.findMany({ where, orderBy: [{ dibuatPada: "desc" }, { id: "asc" }], skip: param.lewati, take: param.ambil, select: PILIH_KAMPANYE_DAFTAR }),
  ]);
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
  return {
    total,
    baris: kampanye.map((k) => {
      const s = petaSemua.get(k.id);
      const m = petaManual.get(k.id);
      const dasar = (x: typeof s) => ({ jangkauan: x?.jangkauan ?? 0, klik: x?.klik ?? 0, leads: x?.leads ?? 0, konversi: x?.konversi ?? 0 });
      const ds = dasar(s);
      const dm = dasar(m);
      const dasarOtomatis = dasarHasil({ jangkauan: ds.jangkauan - dm.jangkauan, klik: ds.klik - dm.klik, leads: ds.leads - dm.leads, konversi: ds.konversi - dm.konversi }, k.tujuan);
      const j: JumlahDasar = { belanja: D(s?.belanja), tayangan: s?.tayangan ?? 0, pendapatan: D(s?.pendapatan), ...ds, hasilEfektif: (m?.hasil ?? 0) + dasarOtomatis };
      return { ...k, anggaran: D(k.anggaran), total: totalDariJumlah(j) };
    }),
  };
}

const PILIH_KAMPANYE_LENGKAP = {
  perusahaan: { select: { id: true, kode: true, nama: true, warna: true } },
  proyek: { select: { id: true, kode: true, nama: true, warna: true } },
  setIklan: { orderBy: [{ dibuatPada: "asc" }, { id: "asc" }] },
  metrik: { orderBy: [{ tanggal: "desc" }, { id: "asc" }] },
  tugasDesain: {
    where: { diarsipkanPada: null },
    orderBy: [{ dibuatPada: "desc" }, { id: "asc" }],
    select: { id: true, judul: true, status: true, prioritas: true, tenggat: true, desainer: { select: { id: true, nama: true } } },
  },
} satisfies Prisma.KampanyeInclude;

type KampanyeLengkapMentah = Prisma.KampanyeGetPayload<{ include: typeof PILIH_KAMPANYE_LENGKAP }>;

/** Satu laporan harian beserta turunannya; `manual` menandai CTR/CPC/CPM/hasil yang diketik (bukan hitungan). */
export type LaporanIklan = KampanyeLengkapMentah["metrik"][number] & {
  turunan: TurunanMetrik;
  manual: { ctr: boolean; cpc: boolean; cpm: boolean; hasil: boolean };
};

export type IklanLengkap = Prisma.IklanGetPayload<{ include: { setIklan: { select: { id: true; nama: true } }; berkasKreatif: { select: { id: true; namaBerkas: true; tipeMime: true; dihapusPada: true } } } }>;

export type KampanyeLengkap = Omit<KampanyeLengkapMentah, "metrik"> & {
  iklan: IklanLengkap[];
  laporan: LaporanIklan[];
  /** total dari jumlah angka dasar; nilai manual per laporan diabaikan (D6 §3.3 no. 5) */
  total: TotalMetrik;
};

/**
 * Detail kampanye (D6 §6.6): kampanye, perusahaan, proyek, set iklan (urut dibuat), iklan (urut dibuat, dengan nama set
 * dan berkas kreatif), laporan harian (tanggal terbaru dulu, dengan turunan per baris), total, dan tugas desain aktif
 * yang menaut kampanye ini. null bila tidak ada atau sudah diarsipkan.
 */
export async function kampanyeLengkap(klien: Klien, id: string): Promise<KampanyeLengkap | null> {
  const k = await klien.kampanye.findFirst({ where: { id, diarsipkanPada: null }, include: PILIH_KAMPANYE_LENGKAP });
  if (!k) return null;
  const iklan = await klien.iklan.findMany({
    where: { setIklan: { kampanyeId: id } },
    orderBy: [{ dibuatPada: "asc" }, { id: "asc" }],
    include: { setIklan: { select: { id: true, nama: true } }, berkasKreatif: { select: { id: true, namaBerkas: true, tipeMime: true, dihapusPada: true } } },
  });
  const { metrik, ...sisa } = k;
  const laporan: LaporanIklan[] = metrik.map((m) => ({
    ...m,
    turunan: turunanMetrik(m, k.tujuan),
    manual: { ctr: m.ctrManual !== null, cpc: m.cpcManual !== null, cpm: m.cpmManual !== null, hasil: m.hasil !== null },
  }));
  return { ...sisa, iklan, laporan, total: totalMetrik(metrik, k.tujuan) };
}

/** Penjelasan "hasil" otomatis menurut tujuan kampanye, untuk label formulir dan KPI (mis. "Hasil = leads"). */
export function aturanHasil(tujuan: TujuanKampanye): string {
  switch (tujuan) {
    case "PROSPEK":
      return "leads";
    case "PENJUALAN":
    case "PROMOSI_APLIKASI":
      return "konversi";
    case "TRAFFIC":
      return "klik";
    case "KESADARAN":
      return "jangkauan";
    case "INTERAKSI":
      return "isi manual";
  }
}
