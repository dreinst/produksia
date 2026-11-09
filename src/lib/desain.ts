import type { Prisma, PrismaClient } from "@/prisma-klien/client";
import type { PrioritasDesain, StatusTugasDesain } from "@/prisma-klien/enums";
import { URUTAN_STATUS_DESAIN } from "@/lib/labelPemasaran";
import { saringPerusahaan } from "@/lib/perusahaan";
import { tanggalIso } from "@/lib/waktu";

/*
 * Pustaka tugas desain (D6 §6.1). Bukan "use server". Yang ada sekarang hanya fungsi baca untuk beranda;
 * penjaga status, tinjauan, kanban, dan daftar ditambahkan paket Pemasaran dengan nama dan tanda tangan rancangan.
 */

type Klien = PrismaClient | Prisma.TransactionClient;

/** Tugas aktif = belum diarsipkan (D6 §3.0 no. 6). */
export const SYARAT_TUGAS_AKTIF = { diarsipkanPada: null } satisfies Prisma.TugasDesainWhereInput;

/** Status yang dianggap sudah beres untuk tanda "Lewat tenggat" dan syarat pengajuan konten. */
const STATUS_BERES: readonly StatusTugasDesain[] = ["DISETUJUI", "SELESAI"];

/** Lewat tenggat = tenggat sebelum hari ini (ZONA_WAKTU) dan status belum Disetujui/Selesai (D6 §3.2.5). */
export function tugasLewatTenggat(t: { tenggat: Date | null; status: StatusTugasDesain }, sekarang: Date = new Date()): boolean {
  return !!t.tenggat && tanggalIso(t.tenggat) < tanggalIso(sekarang) && !STATUS_BERES.includes(t.status);
}

export type TugasSaya = {
  id: string;
  judul: string;
  status: StatusTugasDesain;
  prioritas: PrioritasDesain;
  tenggat: Date | null;
  jumlahRevisi: number;
  perusahaanId: string;
};

export type RingkasanDesainBeranda = {
  /** Tugas yang ditugaskan ke pengguna dan belum Selesai (Disetujui ikut dihitung, seperti HKA). */
  ditugaskanKeSaya: number;
  /** Paling banyak 10 tugas itu, urut tenggat naik, tanpa tenggat paling akhir. */
  tugasSaya: TugasSaya[];
  /** Tugas pengguna yang berstatus Revisi. */
  revisiSaya: number;
  /** Semua tugas dalam lingkup yang berstatus Ditinjau. */
  menungguTinjauan: number;
  /** Semua status urut kanban, termasuk yang nol. */
  perStatus: { status: StatusTugasDesain; jumlah: number }[];
};

/**
 * Ringkasan tugas desain untuk beranda (D6 §6.6, S04 §6.2). perusahaanId null/undefined = gabungan.
 * Tugas arsip tidak ikut.
 */
export async function ringkasanDesainBeranda(klien: Klien, penggunaId: string, perusahaanId?: string | null): Promise<RingkasanDesainBeranda> {
  const where = { ...SYARAT_TUGAS_AKTIF, ...saringPerusahaan(perusahaanId) };
  const milikSaya = { ...where, desainerId: penggunaId, status: { not: "SELESAI" as const } };
  const [ditugaskanKeSaya, tugasSaya, revisiSaya, menungguTinjauan, kelompok] = await Promise.all([
    klien.tugasDesain.count({ where: milikSaya }),
    klien.tugasDesain.findMany({
      where: milikSaya,
      orderBy: [{ tenggat: { sort: "asc", nulls: "last" } }, { dibuatPada: "asc" }],
      take: 10,
      select: { id: true, judul: true, status: true, prioritas: true, tenggat: true, jumlahRevisi: true, perusahaanId: true },
    }),
    klien.tugasDesain.count({ where: { ...where, desainerId: penggunaId, status: "REVISI" } }),
    klien.tugasDesain.count({ where: { ...where, status: "DITINJAU" } }),
    klien.tugasDesain.groupBy({ by: ["status"], where, _count: { _all: true } }),
  ]);
  const jumlah = new Map(kelompok.map((k) => [k.status, k._count._all]));
  return {
    ditugaskanKeSaya,
    tugasSaya,
    revisiSaya,
    menungguTinjauan,
    perStatus: URUTAN_STATUS_DESAIN.map((status) => ({ status, jumlah: jumlah.get(status) ?? 0 })),
  };
}
