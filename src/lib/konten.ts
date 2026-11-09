import type { Prisma, PrismaClient } from "@/prisma-klien/client";
import type { PlatformKonten, StatusKonten, StatusPersetujuanKonten } from "@/prisma-klien/enums";
import { URUTAN_STATUS_KONTEN } from "@/lib/labelPemasaran";
import { saringPerusahaan } from "@/lib/perusahaan";
import { bacaWaktuLokal, tanggalIso } from "@/lib/waktu";

/*
 * Pustaka konten media sosial (D6 §6.1). Bukan "use server". Yang ada sekarang hanya fungsi baca untuk beranda;
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
