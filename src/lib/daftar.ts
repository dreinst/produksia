/*
 * Parameter daftar (pencarian + paginasi) yang dibaca dari query string: ?q=teks&hal=2
 * Dipakai semua halaman daftar bersama komponen <KontrolDaftar>.
 */
export const UKURAN_HALAMAN = 25;
/** Nomor halaman terbesar yang diterima. Di atasnya (atau bukan bilangan bulat aman) dianggap halaman 1, supaya skip tetap muat 64 bit. */
export const MAKS_HALAMAN = 100_000;

export type ParamDaftar = {
  q: string;
  hal: number;
  ambil: number; // take
  lewati: number; // skip
};

type ParamMentah = Record<string, string | string[] | undefined>;

export async function bacaParamDaftar(searchParams: Promise<ParamMentah>, ukuran = UKURAN_HALAMAN): Promise<ParamDaftar> {
  const p = await searchParams;
  const q = (Array.isArray(p.q) ? p.q[0] : p.q ?? "").trim();
  const halMentah = Number(Array.isArray(p.hal) ? p.hal[0] : p.hal);
  const hal = Number.isSafeInteger(halMentah) && halMentah >= 1 && halMentah <= MAKS_HALAMAN ? halMentah : 1;
  return { q, hal, ambil: ukuran, lewati: (hal - 1) * ukuran };
}

/** Klausa Prisma "contains, insensitive" untuk satu kata kunci pada beberapa kolom teks. */
export function cocokTeks(q: string) {
  return { contains: q, mode: "insensitive" as const };
}
