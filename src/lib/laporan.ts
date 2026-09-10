import type { PrismaClient } from "@/prisma-klien/client";
import { db } from "@/lib/db";
import { D, jumlahkan, type Desimal } from "@/lib/uang";

/*
 * Laporan keuangan dari buku besar: Laba Rugi (periode) dan Neraca / posisi keuangan (per tanggal).
 * Laba Rugi mengabaikan jurnal penutup (JU-TUTUP) supaya tahun yang sudah ditutup tetap terbaca.
 * Neraca menyertakannya: tahun yang ditutup sudah pindah ke akun Laba Ditahan, sedangkan laba tahun-tahun
 * yang belum ditutup dan laba tahun berjalan dihitung langsung dari jurnal supaya neraca selalu seimbang.
 */

export type Periode = { dari: Date; sampai: Date; dariTeks: string; sampaiTeks: string };

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** ?dari=YYYY-MM-DD&sampai=YYYY-MM-DD — bawaan: awal tahun berjalan s.d. hari ini (waktu lokal server). */
/** Periode laporan dari query string; bawaan = tahun buku (sampai hari ini bila tahun berjalan, selain itu sampai 31 Des). */
export function bacaPeriode(p: Record<string, string | string[] | undefined>, tahunBuku?: number): Periode {
  const ambil = (k: string) => {
    const v = Array.isArray(p[k]) ? p[k][0] : p[k];
    return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  };
  const hariIni = new Date();
  const akhirBawaan = tahunBuku && tahunBuku !== hariIni.getFullYear() ? `${tahunBuku}-12-31` : iso(hariIni);
  const sampaiTeks = ambil("sampai") ?? akhirBawaan;
  const dariTeks = ambil("dari") ?? `${sampaiTeks.slice(0, 4)}-01-01`;
  return {
    dari: new Date(`${dariTeks}T00:00:00`),
    sampai: new Date(`${sampaiTeks}T23:59:59.999`),
    dariTeks,
    sampaiTeks,
  };
}

export type AkunSaldo = {
  id: string;
  kode: string;
  nama: string;
  jenis: string;
  kelompok: boolean;
  indukId: string | null;
  debit: Desimal;
  kredit: Desimal;
  /** saldo pada posisi normal (aset & beban: debit − kredit; lainnya: kredit − debit) */
  saldo: Desimal;
};

const NORMAL_DEBIT = new Set(["ASET", "BEBAN"]);

/** Saldo tiap akun rinci dari jurnal bertanggal dalam [dari, sampai]; `tanpaPenutup` mengabaikan jurnal penutup tahun. */
/** Filter tambahan laporan: proyek/event tertentu. */
export type OpsiLaporan = { proyekId?: string | null };

export async function saldoAkunPeriode(klien: PrismaClient, dari: Date | null, sampai: Date, tanpaPenutup = false, opsi: OpsiLaporan = {}): Promise<AkunSaldo[]> {
  const [daftarAkun, agregat] = await Promise.all([
    klien.akun.findMany({ orderBy: { kode: "asc" } }),
    klien.barisJurnal.groupBy({
      by: ["akunId"],
      where: { jurnal: { tanggal: { ...(dari ? { gte: dari } : {}), lte: sampai }, ...(tanpaPenutup ? { sumber: { not: "PENUTUP" as const } } : {}), ...(opsi.proyekId ? { proyekId: opsi.proyekId } : {}) } },
      _sum: { debit: true, kredit: true },
    }),
  ]);
  const peta = new Map(agregat.map((a) => [a.akunId, { debit: D(a._sum.debit ?? 0), kredit: D(a._sum.kredit ?? 0) }]));
  return daftarAkun.map((a) => {
    const s = peta.get(a.id) ?? { debit: D(0), kredit: D(0) };
    const saldo = NORMAL_DEBIT.has(a.jenis) ? s.debit.minus(s.kredit) : s.kredit.minus(s.debit);
    return { id: a.id, kode: a.kode, nama: a.nama, jenis: a.jenis, kelompok: a.kelompok, indukId: a.indukId, debit: s.debit, kredit: s.kredit, saldo };
  });
}

export type BarisLaporan = { id: string; kode: string; nama: string; kelompok: boolean; kedalaman: number; jumlah: Desimal };

/** Menyusun baris laporan berjenjang (kelompok = subtotal keturunan); baris bernilai nol disembunyikan. */
export function susunHierarki(daftar: AkunSaldo[], pilih: (a: AkunSaldo) => boolean): { baris: BarisLaporan[]; total: Desimal } {
  const terpilih = daftar.filter(pilih);
  const idTerpilih = new Set(terpilih.map((a) => a.id));
  const byId = new Map(daftar.map((a) => [a.id, a]));
  const anak = new Map<string, AkunSaldo[]>();
  for (const a of daftar) if (a.indukId) anak.set(a.indukId, [...(anak.get(a.indukId) ?? []), a]);

  const subtotal = (a: AkunSaldo): Desimal =>
    a.kelompok ? jumlahkan((anak.get(a.id) ?? []).filter((x) => idTerpilih.has(x.id)).map(subtotal)) : a.saldo;
  const kedalaman = (a: AkunSaldo) => {
    let d = 0;
    let x: AkunSaldo | undefined = a;
    while (x?.indukId) {
      x = byId.get(x.indukId);
      d++;
    }
    return d;
  };
  const baris = terpilih
    .map((a) => ({ id: a.id, kode: a.kode, nama: a.nama, kelompok: a.kelompok, kedalaman: kedalaman(a), jumlah: subtotal(a) }))
    .filter((b) => !b.jumlah.isZero());
  const total = jumlahkan(terpilih.filter((a) => !a.kelompok).map((a) => a.saldo));
  return { baris, total };
}

function akarDari(daftar: AkunSaldo[], id: string | undefined): string | null {
  if (!id) return null;
  const byId = new Map(daftar.map((a) => [a.id, a]));
  let x = byId.get(id);
  while (x?.indukId) x = byId.get(x.indukId);
  return x?.id ?? null;
}
function keturunanDari(daftar: AkunSaldo[], akarId: string | null): Set<string> {
  const hasil = new Set<string>();
  if (!akarId) return hasil;
  const byInduk = new Map<string, AkunSaldo[]>();
  for (const a of daftar) if (a.indukId) byInduk.set(a.indukId, [...(byInduk.get(a.indukId) ?? []), a]);
  const tumpukan = [akarId];
  while (tumpukan.length) {
    const id = tumpukan.pop()!;
    hasil.add(id);
    for (const c of byInduk.get(id) ?? []) tumpukan.push(c.id);
  }
  return hasil;
}

export type LabaRugi = {
  periode: Periode;
  pendapatan: BarisLaporan[];
  totalPendapatan: Desimal;
  bebanPokok: BarisLaporan[];
  totalBebanPokok: Desimal;
  labaKotor: Desimal;
  bebanLain: BarisLaporan[];
  totalBebanLain: Desimal;
  labaBersih: Desimal;
};

/** Laba Rugi periode: pendapatan − beban pokok (kelompok yang memuat akun HPP) = laba kotor; − beban lain = laba bersih. */
export async function hitungLabaRugi(klien: PrismaClient = db, periode: Periode, opsi: OpsiLaporan = {}): Promise<LabaRugi> {
  const [daftar, pemetaan] = await Promise.all([saldoAkunPeriode(klien, periode.dari, periode.sampai, true, opsi), klien.pemetaanAkun.findUnique({ where: { id: "default" } })]);
  const akarPokok = akarDari(daftar, pemetaan?.hppId);
  const pokok = keturunanDari(daftar, akarPokok);
  const pendapatan = susunHierarki(daftar, (a) => a.jenis === "PENDAPATAN");
  const bebanPokok = susunHierarki(daftar, (a) => a.jenis === "BEBAN" && pokok.has(a.id));
  const bebanLain = susunHierarki(daftar, (a) => a.jenis === "BEBAN" && !pokok.has(a.id));
  const labaKotor = pendapatan.total.minus(bebanPokok.total);
  return {
    periode,
    pendapatan: pendapatan.baris,
    totalPendapatan: pendapatan.total,
    bebanPokok: bebanPokok.baris,
    totalBebanPokok: bebanPokok.total,
    labaKotor,
    bebanLain: bebanLain.baris,
    totalBebanLain: bebanLain.total,
    labaBersih: labaKotor.minus(bebanLain.total),
  };
}

export type Neraca = {
  sampai: Date;
  sampaiTeks: string;
  aset: BarisLaporan[];
  totalAset: Desimal;
  kewajiban: BarisLaporan[];
  totalKewajiban: Desimal;
  ekuitas: BarisLaporan[];
  totalEkuitasAkun: Desimal;
  labaDitahan: Desimal;
  labaBerjalan: Desimal;
  totalEkuitas: Desimal;
  totalPasiva: Desimal;
  seimbang: boolean;
};

/** Neraca per tanggal: aset = kewajiban + ekuitas (akun) + laba tahun-tahun lalu + laba tahun berjalan. */
export async function hitungNeraca(klien: PrismaClient = db, sampai: Date, sampaiTeks: string): Promise<Neraca> {
  const awalTahun = new Date(sampai.getFullYear(), 0, 1);
  const [kumulatif, sebelumTahunIni] = await Promise.all([
    saldoAkunPeriode(klien, null, sampai),
    saldoAkunPeriode(klien, null, new Date(awalTahun.getTime() - 1)),
  ]);
  const labaDari = (daftar: AkunSaldo[]) =>
    jumlahkan(daftar.filter((a) => !a.kelompok && a.jenis === "PENDAPATAN").map((a) => a.saldo)).minus(
      jumlahkan(daftar.filter((a) => !a.kelompok && a.jenis === "BEBAN").map((a) => a.saldo)),
    );
  const labaKumulatif = labaDari(kumulatif);
  const labaDitahan = labaDari(sebelumTahunIni);
  const labaBerjalan = labaKumulatif.minus(labaDitahan);

  const aset = susunHierarki(kumulatif, (a) => a.jenis === "ASET");
  const kewajiban = susunHierarki(kumulatif, (a) => a.jenis === "KEWAJIBAN");
  const ekuitas = susunHierarki(kumulatif, (a) => a.jenis === "MODAL");
  const totalEkuitas = ekuitas.total.plus(labaDitahan).plus(labaBerjalan);
  const totalPasiva = kewajiban.total.plus(totalEkuitas);
  return {
    sampai,
    sampaiTeks,
    aset: aset.baris,
    totalAset: aset.total,
    kewajiban: kewajiban.baris,
    totalKewajiban: kewajiban.total,
    ekuitas: ekuitas.baris,
    totalEkuitasAkun: ekuitas.total,
    labaDitahan,
    labaBerjalan,
    totalEkuitas,
    totalPasiva,
    seimbang: aset.total.minus(totalPasiva).abs().lte(D("0.01")),
  };
}

export type LabaRugiBulan = { bulan: number; pendapatan: Desimal; bebanPokok: Desimal; bebanLain: Desimal; labaBersih: Desimal };
export type LabaRugiBulanan = { tahun: number; bulan: LabaRugiBulan[]; total: Omit<LabaRugiBulan, "bulan"> };

/** Laba Rugi per bulan dalam satu tahun (untuk tampilan bulanan), tanpa jurnal penutup, opsional per proyek. */
export async function hitungLabaRugiBulanan(klien: PrismaClient = db, tahun: number, opsi: OpsiLaporan = {}): Promise<LabaRugiBulanan> {
  const dari = new Date(tahun, 0, 1), sampai = new Date(tahun, 11, 31, 23, 59, 59, 999);
  const [baris, pemetaan, daftarAkun] = await Promise.all([
    klien.barisJurnal.findMany({
      where: { jurnal: { tanggal: { gte: dari, lte: sampai }, sumber: { not: "PENUTUP" }, ...(opsi.proyekId ? { proyekId: opsi.proyekId } : {}) }, akun: { jenis: { in: ["PENDAPATAN", "BEBAN"] } } },
      select: { debit: true, kredit: true, akunId: true, jurnal: { select: { tanggal: true } }, akun: { select: { jenis: true } } },
    }),
    klien.pemetaanAkun.findUnique({ where: { id: "default" } }),
    klien.akun.findMany({ select: { id: true, kode: true, nama: true, jenis: true, kelompok: true, indukId: true } }),
  ]);
  const dasar: AkunSaldo[] = daftarAkun.map((a) => ({ ...a, debit: D(0), kredit: D(0), saldo: D(0) }));
  const pokok = keturunanDari(dasar, akarDari(dasar, pemetaan?.hppId));
  const nol = D(0);
  const bulan: LabaRugiBulan[] = Array.from({ length: 12 }, (_, i) => ({ bulan: i + 1, pendapatan: nol, bebanPokok: nol, bebanLain: nol, labaBersih: nol }));
  for (const b of baris) {
    const m = bulan[b.jurnal.tanggal.getMonth()];
    if (b.akun.jenis === "PENDAPATAN") m.pendapatan = m.pendapatan.plus(b.kredit).minus(b.debit);
    else if (pokok.has(b.akunId)) m.bebanPokok = m.bebanPokok.plus(b.debit).minus(b.kredit);
    else m.bebanLain = m.bebanLain.plus(b.debit).minus(b.kredit);
  }
  for (const m of bulan) m.labaBersih = m.pendapatan.minus(m.bebanPokok).minus(m.bebanLain);
  const total = {
    pendapatan: jumlahkan(bulan.map((m) => m.pendapatan)),
    bebanPokok: jumlahkan(bulan.map((m) => m.bebanPokok)),
    bebanLain: jumlahkan(bulan.map((m) => m.bebanLain)),
    labaBersih: jumlahkan(bulan.map((m) => m.labaBersih)),
  };
  return { tahun, bulan, total };
}
