import { Prisma, type PrismaClient } from "@/prisma-klien/client";
import type { JenisTahapLead, StatusTindakLanjut } from "@/prisma-klien/enums";
import { ZONA_WAKTU } from "@/lib/laporan";
import { D, type Desimal } from "@/lib/uang";
import { bacaWaktuLokal, tanggalIso } from "@/lib/waktu";

/*
 * Pustaka CRM (D4 §6.3). Bukan "use server". Bagian yang ada sekarang hanya fungsi baca untuk beranda
 * (statistik dan tindak lanjut saya). Validasi isian, aksi, dan halaman CRM ditambahkan paket domain CRM
 * dengan nama dan tanda tangan yang sama seperti rancangan.
 */

export type KlienDb = PrismaClient | Prisma.TransactionClient;

export const LABEL_JENIS_TAHAP: Record<JenisTahapLead, string> = { BERJALAN: "Berjalan", MENANG: "Menang", KALAH: "Kalah" };
export const LABEL_STATUS_TINDAK_LANJUT: Record<StatusTindakLanjut, string> = { MENUNGGU: "Menunggu", SELESAI: "Selesai", DIBATALKAN: "Dibatalkan" };

/**
 * Tindak lanjut milik lead terarsip disembunyikan (D4 §3.5). Selalu digabung lewat AND supaya tidak menimpa OR lain.
 */
export const SYARAT_TINDAK_LANJUT_TERLIHAT = { OR: [{ leadId: null }, { lead: { dihapusPada: null } }] } satisfies Prisma.TindakLanjutWhereInput;

const SATU_HARI_MS = 24 * 60 * 60 * 1000;
const NAMA_BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

/** Tampilan ringkas rupiah (padanan idrShort HKA): "Rp 1,5 M", "Rp 12,3 jt", selain itu "Rp 950.000". */
export function ringkasRupiah(n: Desimal | number | string): string {
  const x = Number(n);
  const satuDesimal = (v: number) => v.toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (Math.abs(x) >= 1e9) return `Rp ${satuDesimal(x / 1e9)} M`;
  if (Math.abs(x) >= 1e6) return `Rp ${satuDesimal(x / 1e6)} jt`;
  return `Rp ${x.toLocaleString("id-ID")}`;
}

/** Persen satu desimal, pembulatan setengah ke atas pada Decimal (D4 §3.12). */
function bulat1(pembilang: number, penyebut: number): Desimal {
  if (penyebut === 0) return D(0);
  return D(pembilang).mul(100).div(penyebut).toDecimalPlaces(1, Prisma.Decimal.ROUND_HALF_UP);
}

/** n bulan terakhir sampai bulan `sekarang` di zona usaha, urut lama ke baru: [{ bulan: "2026-06", label: "Jun 2026" }, ...]. */
export function bulanTerakhir(n: number, sekarang: Date = new Date()): { bulan: string; label: string }[] {
  const [th, bl] = tanggalIso(sekarang).split("-").map(Number);
  const k = th * 12 + (bl - 1);
  const hasil: { bulan: string; label: string }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const yyyy = Math.floor((k - i) / 12);
    const mm = ((k - i) % 12) + 1;
    hasil.push({ bulan: `${yyyy}-${String(mm).padStart(2, "0")}`, label: `${NAMA_BULAN[mm - 1]} ${yyyy}` });
  }
  return hasil;
}

export type StatistikCrm = {
  totalLead: number;
  leadBaru30Hari: number;
  nilaiPipeline: Desimal;
  menang: number;
  kalah: number;
  nilaiMenang: Desimal;
  tingkatKonversi: Desimal;
  tingkatClosing: Desimal;
  pendapatanLunas: Desimal;
  kinerjaSales: { picId: string | null; nama: string; lead: number; menang: number; nilaiMenang: Desimal }[];
  kinerjaSumber: { sumber: string; lead: number; menang: number; nilaiMenang: Desimal }[];
  corong: { perusahaanId: string; namaPerusahaan: string; tahapId: string; nama: string; jenis: JenisTahapLead; jumlah: number }[];
  bulanan: { bulan: string; label: string; dibuat: number; menang: number }[];
  tindakLanjutJatuhTempo: {
    id: string;
    judul: string;
    jatuhTempo: Date;
    leadId: string | null;
    namaLead: string | null;
    namaPenerima: string | null;
    perusahaanId: string;
  }[];
};

/**
 * Statistik dasbor CRM (D4 §3.12). perusahaanId null = gabungan (penjumlahan tanpa eliminasi).
 * Semua jumlah diagregasi di PostgreSQL; tidak ada lead yang dimuat ke memori untuk dijumlahkan.
 */
export async function statistikCrm(klien: KlienDb, sekarang: Date = new Date(), perusahaanId: string | null = null): Promise<StatistikCrm> {
  const saringP = perusahaanId ? { perusahaanId } : {};
  const base: Prisma.LeadWhereInput = { dihapusPada: null, ...saringP };
  const jendela = bulanTerakhir(6, sekarang);
  const awalJendela = bacaWaktuLokal(`${jendela[0].bulan}-01T00:00`) ?? new Date(0);
  const batasBaru = new Date(sekarang.getTime() - 30 * SATU_HARI_MS);
  const batasJatuhTempo = new Date(sekarang.getTime() + SATU_HARI_MS);
  const saringPSql = perusahaanId ? Prisma.sql`AND l."perusahaanId" = ${perusahaanId}` : Prisma.empty;

  const [perTahap, perPic, perSumber, leadBaru30Hari, pendapatan, daftarTahap, dibuatBulanan, menangBulanan, jatuhTempo] = await Promise.all([
    klien.lead.groupBy({ by: ["tahapId"], where: base, _count: { _all: true }, _sum: { nilaiEstimasi: true } }),
    klien.lead.groupBy({ by: ["picId", "tahapId"], where: base, _count: { _all: true }, _sum: { nilaiEstimasi: true } }),
    klien.lead.groupBy({ by: ["sumber", "tahapId"], where: base, _count: { _all: true }, _sum: { nilaiEstimasi: true } }),
    klien.lead.count({ where: { ...base, dibuatPada: { gte: batasBaru } } }),
    klien.fakturPenjualan.aggregate({ where: { status: "LUNAS", statusPersetujuan: "DISETUJUI", ...saringP }, _sum: { dpp: true } }),
    klien.tahapLead.findMany({
      where: saringP,
      select: { id: true, nama: true, jenis: true, urutan: true, perusahaanId: true, perusahaan: { select: { nama: true, urutan: true } } },
    }),
    klien.$queryRaw<{ bulan: string; jumlah: bigint }[]>`
      SELECT to_char((l."dibuatPada" AT TIME ZONE 'UTC') AT TIME ZONE ${ZONA_WAKTU}, 'YYYY-MM') AS bulan, COUNT(*) AS jumlah
      FROM "Lead" l
      WHERE l."dihapusPada" IS NULL AND l."dibuatPada" >= ${awalJendela} ${saringPSql}
      GROUP BY 1`,
    klien.$queryRaw<{ bulan: string; jumlah: bigint }[]>`
      SELECT to_char((l."ditutupPada" AT TIME ZONE 'UTC') AT TIME ZONE ${ZONA_WAKTU}, 'YYYY-MM') AS bulan, COUNT(*) AS jumlah
      FROM "Lead" l
      JOIN "TahapLead" t ON t."id" = l."tahapId" AND t."jenis" = 'MENANG'
      WHERE l."dihapusPada" IS NULL AND l."ditutupPada" IS NOT NULL AND l."ditutupPada" >= ${awalJendela} ${saringPSql}
      GROUP BY 1`,
    klien.tindakLanjut.findMany({
      where: { AND: [SYARAT_TINDAK_LANJUT_TERLIHAT, { status: "MENUNGGU", jatuhTempo: { lte: batasJatuhTempo }, ...saringP }] },
      orderBy: [{ jatuhTempo: "asc" }, { id: "asc" }],
      take: 10,
      select: { id: true, judul: true, jatuhTempo: true, leadId: true, perusahaanId: true, lead: { select: { nama: true } }, ditugaskanKe: { select: { nama: true } } },
    }),
  ]);

  const jenisTahap = new Map(daftarTahap.map((t) => [t.id, t.jenis]));
  const jenisDari = (tahapId: string): JenisTahapLead => jenisTahap.get(tahapId) ?? "BERJALAN";

  let totalLead = 0, menang = 0, kalah = 0;
  let nilaiPipeline = D(0), nilaiMenang = D(0);
  for (const g of perTahap) {
    const jumlah = g._count._all;
    const nilai = D(g._sum.nilaiEstimasi);
    totalLead += jumlah;
    const jenis = jenisDari(g.tahapId);
    if (jenis === "BERJALAN") nilaiPipeline = nilaiPipeline.plus(nilai);
    else if (jenis === "MENANG") { menang += jumlah; nilaiMenang = nilaiMenang.plus(nilai); }
    else kalah += jumlah;
  }

  // kinerja per PIC
  const perPicPeta = new Map<string | null, { lead: number; menang: number; nilaiMenang: Desimal }>();
  for (const g of perPic) {
    const isi = perPicPeta.get(g.picId) ?? { lead: 0, menang: 0, nilaiMenang: D(0) };
    isi.lead += g._count._all;
    if (jenisDari(g.tahapId) === "MENANG") { isi.menang += g._count._all; isi.nilaiMenang = isi.nilaiMenang.plus(D(g._sum.nilaiEstimasi)); }
    perPicPeta.set(g.picId, isi);
  }
  const idPic = [...perPicPeta.keys()].filter((x): x is string => !!x);
  const namaPic = new Map(
    idPic.length ? (await klien.pengguna.findMany({ where: { id: { in: idPic } }, select: { id: true, nama: true } })).map((p) => [p.id, p.nama]) : [],
  );
  const kinerjaSales = [...perPicPeta.entries()]
    .map(([picId, isi]) => ({ picId, nama: (picId ? namaPic.get(picId) : null) ?? "Belum ada PIC", ...isi }))
    .sort((a, b) => b.nilaiMenang.comparedTo(a.nilaiMenang) || b.lead - a.lead || a.nama.localeCompare(b.nama, "id"));

  // kinerja per sumber
  const perSumberPeta = new Map<string, { lead: number; menang: number; nilaiMenang: Desimal }>();
  for (const g of perSumber) {
    const kunci = g.sumber || "Tidak diketahui";
    const isi = perSumberPeta.get(kunci) ?? { lead: 0, menang: 0, nilaiMenang: D(0) };
    isi.lead += g._count._all;
    if (jenisDari(g.tahapId) === "MENANG") { isi.menang += g._count._all; isi.nilaiMenang = isi.nilaiMenang.plus(D(g._sum.nilaiEstimasi)); }
    perSumberPeta.set(kunci, isi);
  }
  const kinerjaSumber = [...perSumberPeta.entries()]
    .map(([sumber, isi]) => ({ sumber, ...isi }))
    .sort((a, b) => b.lead - a.lead || a.sumber.localeCompare(b.sumber, "id"));

  // corong: per perusahaan dalam lingkup, per tahap urut; tahap tanpa lead = 0
  const jumlahPerTahap = new Map(perTahap.map((g) => [g.tahapId, g._count._all]));
  const corong = [...daftarTahap]
    .sort((a, b) => a.perusahaan.urutan - b.perusahaan.urutan || a.perusahaan.nama.localeCompare(b.perusahaan.nama, "id") || a.urutan - b.urutan)
    .map((t) => ({ perusahaanId: t.perusahaanId, namaPerusahaan: t.perusahaan.nama, tahapId: t.id, nama: t.nama, jenis: t.jenis, jumlah: jumlahPerTahap.get(t.id) ?? 0 }));

  const petaDibuat = new Map(dibuatBulanan.map((r) => [r.bulan, Number(r.jumlah)]));
  const petaMenang = new Map(menangBulanan.map((r) => [r.bulan, Number(r.jumlah)]));
  const bulanan = jendela.map((b) => ({ ...b, dibuat: petaDibuat.get(b.bulan) ?? 0, menang: petaMenang.get(b.bulan) ?? 0 }));

  return {
    totalLead,
    leadBaru30Hari,
    nilaiPipeline,
    menang,
    kalah,
    nilaiMenang,
    tingkatKonversi: bulat1(menang, totalLead),
    tingkatClosing: bulat1(menang, menang + kalah),
    pendapatanLunas: D(pendapatan._sum.dpp),
    kinerjaSales,
    kinerjaSumber,
    corong,
    bulanan,
    tindakLanjutJatuhTempo: jatuhTempo.map((t) => ({
      id: t.id,
      judul: t.judul,
      jatuhTempo: t.jatuhTempo,
      leadId: t.leadId,
      namaLead: t.lead?.nama ?? null,
      namaPenerima: t.ditugaskanKe?.nama ?? null,
      perusahaanId: t.perusahaanId,
    })),
  };
}

export type TindakLanjutSaya = {
  id: string;
  judul: string;
  jatuhTempo: Date;
  catatan: string | null;
  leadId: string | null;
  namaLead: string | null;
  namaUsahaLead: string | null;
  perusahaanId: string;
};

/**
 * Tindak lanjut MENUNGGU yang ditugaskan ke pengguna, urut jatuh tempo naik, tanpa milik lead terarsip.
 * perusahaanId (tambahan di posisi terakhir, null = gabungan) dipakai beranda supaya ikut lingkup perusahaan.
 */
export async function tindakLanjutSaya(klien: KlienDb, penggunaId: string, batas = 10, perusahaanId: string | null = null): Promise<TindakLanjutSaya[]> {
  const daftar = await klien.tindakLanjut.findMany({
    where: { AND: [SYARAT_TINDAK_LANJUT_TERLIHAT, { ditugaskanKeId: penggunaId, status: "MENUNGGU", ...(perusahaanId ? { perusahaanId } : {}) }] },
    orderBy: [{ jatuhTempo: "asc" }, { id: "asc" }],
    take: batas,
    select: { id: true, judul: true, jatuhTempo: true, catatan: true, leadId: true, perusahaanId: true, lead: { select: { nama: true, namaUsaha: true } } },
  });
  return daftar.map((t) => ({
    id: t.id,
    judul: t.judul,
    jatuhTempo: t.jatuhTempo,
    catatan: t.catatan,
    leadId: t.leadId,
    namaLead: t.lead?.nama ?? null,
    namaUsahaLead: t.lead?.namaUsaha ?? null,
    perusahaanId: t.perusahaanId,
  }));
}

/** Terlambat tidak disimpan: MENUNGGU dan jatuh tempo sudah lewat (D4 §3.5). */
export function tindakLanjutTerlambat(t: { jatuhTempo: Date; status?: StatusTindakLanjut }, sekarang: Date = new Date()): boolean {
  return (t.status ?? "MENUNGGU") === "MENUNGGU" && t.jatuhTempo.getTime() < sekarang.getTime();
}
