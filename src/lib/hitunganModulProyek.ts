import { Prisma, type PrismaClient } from "@/prisma-klien/client";
import type { Hak } from "@/lib/hakAkses";

/*
 * Hitungan pekerjaan per modul di daftar proyek (D5 §3.3). Bukan "use server". Setiap penghitung satu kueri GROUP BY
 * per proyek untuk semua proyek di halaman; proyek tanpa item mendapat { total: 0, terbuka: 0 }. Kolom hanya tampil dan
 * dihitung bila pengguna memegang hak lihat modulnya (dipilih pemanggil lewat `hak`).
 *
 * `tautan` menuju halaman modul yang membaca "?proyek=" (bacaFilterProyek). Halaman konten, kampanye, dan tugas desain
 * belum ada, jadi tautannya null sampai paket halamannya memasang (sel tampil tanpa tautan).
 */

type Klien = PrismaClient | Prisma.TransactionClient;

export type HitunganModul = { total: number; terbuka: number };

export type KunciModulProyek = "penawaran" | "faktur" | "penerimaan" | "konten" | "kampanye" | "tugas-desain";

export type PenghitungModulProyek = {
  kunci: KunciModulProyek;
  label: string;
  hak: Hak;
  tautan: ((proyekId: string) => string) | null;
  hitung: (klien: Klien, proyekIds: string[]) => Promise<Map<string, HitunganModul>>;
};

type BarisHitung = { proyekId: string; total: number; terbuka: number };

function keMap(baris: BarisHitung[]): Map<string, HitunganModul> {
  return new Map(baris.map((b) => [b.proyekId, { total: Number(b.total), terbuka: Number(b.terbuka) }]));
}

const kosong = (ids: string[]) => ids.length === 0;

export const PENGHITUNG_MODUL_PROYEK: readonly PenghitungModulProyek[] = [
  {
    kunci: "penawaran",
    label: "Penawaran",
    hak: "penawaran.lihat",
    tautan: (id) => `/penjualan/penawaran?proyek=${encodeURIComponent(id)}`,
    // terbuka = masih draf dan status komersial draf atau terkirim (HKA draft/sent)
    hitung: async (klien, ids) =>
      kosong(ids)
        ? new Map()
        : keMap(
            await klien.$queryRaw<BarisHitung[]>`
              SELECT q."proyekId", count(*)::int AS total,
                count(*) FILTER (WHERE q."status" = 'DRAF' AND q."statusKomersial" IN ('DRAF', 'TERKIRIM'))::int AS terbuka
              FROM "PenawaranPenjualan" q WHERE q."proyekId" IN (${Prisma.join(ids)}) GROUP BY 1`,
          ),
  },
  {
    kunci: "faktur",
    label: "Faktur",
    hak: "faktur.lihat",
    tautan: (id) => `/penjualan/faktur?proyek=${encodeURIComponent(id)}`,
    // terbuka = belum disetujui atau belum lunas (HKA draft/sent/overdue)
    hitung: async (klien, ids) =>
      kosong(ids)
        ? new Map()
        : keMap(
            await klien.$queryRaw<BarisHitung[]>`
              SELECT p."proyekId", count(*)::int AS total,
                count(*) FILTER (WHERE f."statusPersetujuan" <> 'DISETUJUI' OR f."status" <> 'LUNAS')::int AS terbuka
              FROM "FakturPenjualan" f JOIN "PesananPenjualan" p ON p."id" = f."pesananId"
              WHERE p."proyekId" IN (${Prisma.join(ids)}) GROUP BY 1`,
          ),
  },
  {
    kunci: "penerimaan",
    label: "Penerimaan",
    hak: "penerimaan.lihat",
    tautan: (id) => `/penjualan/penerimaan?proyek=${encodeURIComponent(id)}`,
    // penerimaan Produksia langsung disetujui, jadi tidak ada yang terbuka (D5 §3.3)
    hitung: async (klien, ids) =>
      kosong(ids)
        ? new Map()
        : keMap(
            await klien.$queryRaw<BarisHitung[]>`
              SELECT p."proyekId", count(*)::int AS total, 0::int AS terbuka
              FROM "PenerimaanPenjualan" t JOIN "FakturPenjualan" f ON f."id" = t."fakturId" JOIN "PesananPenjualan" p ON p."id" = f."pesananId"
              WHERE p."proyekId" IN (${Prisma.join(ids)}) GROUP BY 1`,
          ),
  },
  {
    kunci: "konten",
    label: "Konten",
    hak: "konten.lihat",
    tautan: null,
    // belum diarsipkan; terbuka = belum terbit
    hitung: async (klien, ids) =>
      kosong(ids)
        ? new Map()
        : keMap(
            await klien.$queryRaw<BarisHitung[]>`
              SELECT k."proyekId", count(*)::int AS total, count(*) FILTER (WHERE k."status" <> 'TERBIT')::int AS terbuka
              FROM "Konten" k WHERE k."diarsipkanPada" IS NULL AND k."proyekId" IN (${Prisma.join(ids)}) GROUP BY 1`,
          ),
  },
  {
    kunci: "kampanye",
    label: "Kampanye",
    hak: "kampanye.lihat",
    tautan: null,
    // belum diarsipkan; terbuka = direncanakan, aktif, atau dijeda
    hitung: async (klien, ids) =>
      kosong(ids)
        ? new Map()
        : keMap(
            await klien.$queryRaw<BarisHitung[]>`
              SELECT k."proyekId", count(*)::int AS total, count(*) FILTER (WHERE k."status" IN ('DIRENCANAKAN', 'AKTIF', 'DIJEDA'))::int AS terbuka
              FROM "Kampanye" k WHERE k."diarsipkanPada" IS NULL AND k."proyekId" IN (${Prisma.join(ids)}) GROUP BY 1`,
          ),
  },
  {
    kunci: "tugas-desain",
    label: "Desain",
    hak: "tugas-desain.lihat",
    tautan: null,
    // belum diarsipkan; terbuka = belum selesai
    hitung: async (klien, ids) =>
      kosong(ids)
        ? new Map()
        : keMap(
            await klien.$queryRaw<BarisHitung[]>`
              SELECT t."proyekId", count(*)::int AS total, count(*) FILTER (WHERE t."status" <> 'SELESAI')::int AS terbuka
              FROM "TugasDesain" t WHERE t."diarsipkanPada" IS NULL AND t."proyekId" IN (${Prisma.join(ids)}) GROUP BY 1`,
          ),
  },
];

/** Penghitung yang boleh dipakai pengguna dengan `punya(hak)`. */
export function penghitungTerlihat(punya: (hak: Hak) => boolean): PenghitungModulProyek[] {
  return PENGHITUNG_MODUL_PROYEK.filter((p) => punya(p.hak));
}

/**
 * Hitungan semua penghitung terpilih untuk proyekIds: proyekId -> kunci modul -> hitungan. Penghitung dijalankan
 * berurutan supaya aman dipakai dengan tx interaktif.
 */
export async function hitungModulProyek(klien: Klien, proyekIds: string[], penghitung: readonly PenghitungModulProyek[]): Promise<Map<string, Partial<Record<KunciModulProyek, HitunganModul>>>> {
  const hasil = new Map<string, Partial<Record<KunciModulProyek, HitunganModul>>>(proyekIds.map((id) => [id, {}]));
  for (const p of penghitung) {
    const peta = await p.hitung(klien, proyekIds);
    for (const id of proyekIds) hasil.get(id)![p.kunci] = peta.get(id) ?? { total: 0, terbuka: 0 };
  }
  return hasil;
}
