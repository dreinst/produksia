import type { Prisma, PrismaClient } from "@/prisma-klien/client";

/*
 * Saringan proyek bersama lewat parameter "?proyek=" (D5 §6.3, §7.3), pengganti useProjectFilter/useProjectScope HKA.
 * Berkas ini murni (hanya `import type`), jadi aman diimpor komponen klien FilterProyek maupun halaman server.
 * - ""       = semua proyek (tanpa saringan)
 * - "tanpa"  = dokumen tanpa proyek
 * - lainnya  = id proyek
 * Model tanpa kolom proyekId sendiri (faktur, penerimaan, retur) dibungkus pemanggil lewat relasi induknya, mis.
 * `{ pesanan: whereFilterProyek(f) }`; saringan tidak dipasang sama sekali bila f === "".
 */

export type FilterProyek = "" | "tanpa" | string;

type ParamHalaman = Record<string, string | string[] | undefined>;
type Klien = PrismaClient | Prisma.TransactionClient;

export const FILTER_TANPA_PROYEK = "tanpa";

/** Status proyek yang tidak ditawarkan di pilihan (D5 §3.1), kecuali sedang terpilih. */
const STATUS_TERSEMBUNYI = new Set(["DIARSIP", "BATAL"]);

/** Bentuk id yang diterima (cuid dan id buatan seed); nilai lain dianggap "semua" supaya parameter rusak tidak menyaring apa pun. */
const POLA_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Nilai "?proyek=" dari searchParams halaman. Larik memakai nilai pertama; nilai kosong atau tidak sah = "" (semua). */
export function bacaFilterProyek(param: ParamHalaman): FilterProyek {
  const mentah = param.proyek;
  const nilai = (Array.isArray(mentah) ? mentah[0] : mentah)?.trim() ?? "";
  if (nilai === FILTER_TANPA_PROYEK) return FILTER_TANPA_PROYEK;
  return POLA_ID.test(nilai) ? nilai : "";
}

/** Penyaring Prisma: {} untuk semua, { proyekId: null } untuk tanpa proyek, { proyekId } untuk satu proyek. */
export function whereFilterProyek(f: FilterProyek): { proyekId?: string | null } {
  if (f === "") return {};
  if (f === FILTER_TANPA_PROYEK) return { proyekId: null };
  return { proyekId: f };
}

/**
 * Proyek bawaan formulir baru dari "?proyek=" (setara defaultProject HKA): id bila parameternya id proyek, null untuk
 * "" dan "tanpa". Bila `pilihan` diberikan (mis. hasil daftarProyekAktif(db, lingkup.perusahaanId)), id hanya dipakai
 * bila ada di pilihan itu, jadi proyek perusahaan lain, diarsipkan, atau batal tidak pernah terpilih otomatis.
 */
export function proyekBawaan(param: ParamHalaman, pilihan?: readonly { id: string }[]): string | null {
  const f = bacaFilterProyek(param);
  if (f === "" || f === FILTER_TANPA_PROYEK) return null;
  if (pilihan && !pilihan.some((p) => p.id === f)) return null;
  return f;
}

/** Id proyek yang sudah tidak ada dianggap "semua" (perilaku HKA). "" dan "tanpa" dikembalikan apa adanya. */
export async function filterProyekSah(klien: Klien, f: FilterProyek): Promise<FilterProyek> {
  if (f === "" || f === FILTER_TANPA_PROYEK) return f;
  const ada = await klien.proyek.findUnique({ where: { id: f }, select: { id: true } });
  return ada ? f : "";
}

export type ProyekPilihan = { id: string; kode: string; nama: string; status: string };

/**
 * Proyek yang ditawarkan FilterProyek: semua kecuali yang diarsipkan atau batal, ditambah proyek yang sedang terpilih
 * walau statusnya tersembunyi. Urutan masukan dipertahankan.
 */
export function opsiFilterProyek<T extends ProyekPilihan>(daftar: readonly T[], nilai: FilterProyek): T[] {
  return daftar.filter((p) => p.id === nilai || !STATUS_TERSEMBUNYI.has(p.status));
}
