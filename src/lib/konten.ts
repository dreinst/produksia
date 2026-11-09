import type { Prisma, PrismaClient } from "@/prisma-klien/client";
import type { PlatformKonten, StatusKonten, StatusPersetujuanKonten, StatusTugasDesain } from "@/prisma-klien/enums";
import { URUTAN_STATUS_KONTEN } from "@/lib/labelPemasaran";
import { saringPerusahaan } from "@/lib/perusahaan";
import { SYARAT_TUGAS_AKTIF } from "@/lib/desain";
import { bacaWaktuLokal, tanggalIso } from "@/lib/waktu";

/*
 * Pustaka konten media sosial (D6 §6.1). Bukan "use server". Yang ada sekarang hanya fungsi baca untuk beranda
 * (ringkasanKontenBeranda untuk tab Pemasaran, kontenSaya untuk tab Tugas Saya);
 * penjaga status, aksi, kalender, dan kanban ditambahkan paket Pemasaran dengan nama dan tanda tangan rancangan.
 */

type Klien = PrismaClient | Prisma.TransactionClient;

/** Konten aktif = belum diarsipkan (D6 §3.0 no. 6). */
export const SYARAT_KONTEN_AKTIF = { diarsipkanPada: null } satisfies Prisma.KontenWhereInput;

/** Jumlah hari ke depan untuk daftar "konten mendatang" beranda (S04 §6.1). */
export const HARI_KONTEN_MENDATANG = 14;

/** "2026-11-09" + n hari, dihitung dengan Date.UTC supaya bebas zona proses. */
export function geserTanggalIso(iso: string, hari: number): string {
  const [th, bl, tg] = iso.split("-").map(Number);
  return new Date(Date.UTC(th, bl - 1, tg + hari)).toISOString().slice(0, 10);
}

/** Awal hari (00.00 jam dinding ZONA_WAKTU) untuk tanggal ISO. */
export function awalHariLokal(iso: string): Date {
  const d = bacaWaktuLokal(`${iso}T00:00`);
  if (!d) throw new Error(`Tanggal tidak valid: ${iso}`);
  return d;
}

export type KontenMendatang = {
  id: string;
  judul: string;
  platform: PlatformKonten;
  status: StatusKonten;
  statusPersetujuan: StatusPersetujuanKonten;
  tanggalTerbit: Date;
  jamTerbit: string | null;
  perusahaanId: string;
};

export type RingkasanKontenBeranda = {
  /** Semua status urut kanban, termasuk yang nol. */
  perStatus: { status: StatusKonten; jumlah: number }[];
  menungguPersetujuan: number;
  /** Paling banyak 10 konten dengan hari ini ≤ tanggal terbit ≤ hari ini + 14 (ZONA_WAKTU), urut tanggal naik. */
  mendatang: KontenMendatang[];
};

/**
 * Ringkasan konten untuk panel beranda (D6 §6.6, S04 §6.1). perusahaanId null/undefined = gabungan.
 * Konten arsip tidak ikut. Daftar mendatang memuat status apa pun (termasuk TERBIT), seperti HKA.
 */
export async function ringkasanKontenBeranda(klien: Klien, perusahaanId?: string | null): Promise<RingkasanKontenBeranda> {
  const where = { ...SYARAT_KONTEN_AKTIF, ...saringPerusahaan(perusahaanId) };
  const hariIni = tanggalIso(new Date());
  const dari = awalHariLokal(hariIni);
  const sampai = awalHariLokal(geserTanggalIso(hariIni, HARI_KONTEN_MENDATANG + 1));
  const [kelompok, menungguPersetujuan, mendatang] = await Promise.all([
    klien.konten.groupBy({ by: ["status"], where, _count: { _all: true } }),
    klien.konten.count({ where: { ...where, statusPersetujuan: "MENUNGGU" } }),
    klien.konten.findMany({
      where: { ...where, tanggalTerbit: { gte: dari, lt: sampai } },
      orderBy: [{ tanggalTerbit: "asc" }, { jamTerbit: { sort: "asc", nulls: "last" } }, { judul: "asc" }],
      take: 10,
      select: { id: true, judul: true, platform: true, status: true, statusPersetujuan: true, tanggalTerbit: true, jamTerbit: true, perusahaanId: true },
    }),
  ]);
  const jumlah = new Map(kelompok.map((k) => [k.status, k._count._all]));
  return {
    perStatus: URUTAN_STATUS_KONTEN.map((status) => ({ status, jumlah: jumlah.get(status) ?? 0 })),
    menungguPersetujuan,
    mendatang: mendatang.map((k) => ({ ...k, tanggalTerbit: k.tanggalTerbit! })),
  };
}

/** Alasan konten masuk kartu "Konten saya" di tab Tugas Saya, urut dari yang paling mendesak. */
export type AlasanKontenSaya = "DITOLAK" | "REVISI_DESAIN" | "DESAIN_SIAP" | "AKAN_TERBIT" | "BELUM_SELESAI";
export const URUTAN_ALASAN_KONTEN_SAYA: readonly AlasanKontenSaya[] = ["DITOLAK", "REVISI_DESAIN", "DESAIN_SIAP", "AKAN_TERBIT", "BELUM_SELESAI"];

/** Status konten yang masih harus dikerjakan penanggung jawabnya (belum masuk desain atau tinjauan). */
const STATUS_KONTEN_BELUM_SELESAI: readonly StatusKonten[] = ["IDE", "DRAF"];
/** Status tugas desain yang berarti desainnya sudah bisa dipakai untuk mengajukan konten (D6 §3.2.2). */
const STATUS_DESAIN_SIAP: readonly StatusTugasDesain[] = ["DISETUJUI", "SELESAI"];

export type KontenSaya = Omit<KontenMendatang, "tanggalTerbit"> & {
  tanggalTerbit: Date | null;
  /** Status tugas desain aktif konten ini (paling banyak satu, D6 §3.2.1), null bila tidak ada. */
  statusDesain: StatusTugasDesain | null;
  alasan: AlasanKontenSaya[];
};

/**
 * Alasan sebuah konten perlu perhatian penanggung jawabnya: ditolak penyetuju, desainnya sedang direvisi, desainnya
 * sudah disetujui sementara konten masih di tahap Desain (siap diajukan), akan terbit dalam rentang [dari, sampai)
 * dan belum terbit, atau masih Ide/Draf. Kosong = tidak perlu tindakan. Murni, diuji langsung.
 */
export function alasanKontenSaya(
  k: { status: StatusKonten; statusPersetujuan: StatusPersetujuanKonten; tanggalTerbit: Date | null; statusDesain: StatusTugasDesain | null },
  dari: Date,
  sampai: Date,
): AlasanKontenSaya[] {
  const alasan: AlasanKontenSaya[] = [];
  if (k.statusPersetujuan === "DITOLAK") alasan.push("DITOLAK");
  if (k.statusDesain === "REVISI") alasan.push("REVISI_DESAIN");
  if (k.status === "DESAIN" && k.statusDesain !== null && STATUS_DESAIN_SIAP.includes(k.statusDesain)) alasan.push("DESAIN_SIAP");
  if (k.status !== "TERBIT" && k.tanggalTerbit && k.tanggalTerbit >= dari && k.tanggalTerbit < sampai) alasan.push("AKAN_TERBIT");
  if (STATUS_KONTEN_BELUM_SELESAI.includes(k.status)) alasan.push("BELUM_SELESAI");
  return alasan;
}

/**
 * Konten yang ditangani pengguna (sebagai Social Media Manager konten itu, atau pembuatnya bila SMM belum diisi) dan
 * perlu tindakan menurut alasanKontenSaya, termasuk yang akan terbit 14 hari ke depan. Hanya konten aktif dalam
 * lingkup perusahaan (null/undefined = gabungan). Urut alasan paling mendesak, lalu tanggal terbit (kosong terakhir).
 * `total` = semua konten yang memenuhi syarat; `baris` paling banyak `batas`.
 */
export async function kontenSaya(klien: Klien, penggunaId: string, perusahaanId?: string | null, batas = 10): Promise<{ total: number; baris: KontenSaya[] }> {
  const hariIni = tanggalIso(new Date());
  const dari = awalHariLokal(hariIni);
  const sampai = awalHariLokal(geserTanggalIso(hariIni, HARI_KONTEN_MENDATANG + 1));
  const tugasAktif = SYARAT_TUGAS_AKTIF;
  const where: Prisma.KontenWhereInput = {
    ...SYARAT_KONTEN_AKTIF,
    ...saringPerusahaan(perusahaanId),
    AND: [
      { OR: [{ smmId: penggunaId }, { smmId: null, dibuatOlehId: penggunaId }] },
      {
        OR: [
          { statusPersetujuan: "DITOLAK" },
          { status: { in: [...STATUS_KONTEN_BELUM_SELESAI] } },
          { tugasDesain: { some: { ...tugasAktif, status: "REVISI" } } },
          { status: "DESAIN", tugasDesain: { some: { ...tugasAktif, status: { in: [...STATUS_DESAIN_SIAP] } } } },
          { status: { not: "TERBIT" }, tanggalTerbit: { gte: dari, lt: sampai } },
        ],
      },
    ],
  };
  const daftar = await klien.konten.findMany({
    where,
    select: {
      id: true, judul: true, platform: true, status: true, statusPersetujuan: true, tanggalTerbit: true, jamTerbit: true, perusahaanId: true,
      tugasDesain: { where: tugasAktif, select: { status: true }, orderBy: { dibuatPada: "desc" }, take: 1 },
    },
  });
  const baris: KontenSaya[] = daftar.map(({ tugasDesain, ...k }) => {
    const statusDesain = tugasDesain[0]?.status ?? null;
    return { ...k, statusDesain, alasan: alasanKontenSaya({ ...k, statusDesain }, dari, sampai) };
  });
  const peringkat = (k: KontenSaya) => Math.min(...k.alasan.map((a) => URUTAN_ALASAN_KONTEN_SAYA.indexOf(a)), URUTAN_ALASAN_KONTEN_SAYA.length);
  baris.sort(
    (a, b) =>
      peringkat(a) - peringkat(b) ||
      (a.tanggalTerbit?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.tanggalTerbit?.getTime() ?? Number.MAX_SAFE_INTEGER) ||
      a.judul.localeCompare(b.judul, "id"),
  );
  return { total: baris.length, baris: baris.slice(0, batas) };
}
