/*
 * Parameter daftar (pencarian + paginasi) yang dibaca dari query string: ?q=teks&hal=2
 * Dipakai semua halaman daftar bersama komponen <KontrolDaftar>.
 */
export const UKURAN_HALAMAN = 25;

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
  const hal = Number.isInteger(halMentah) && halMentah > 0 ? halMentah : 1;
  return { q, hal, ambil: ukuran, lewati: (hal - 1) * ukuran };
}

/** Klausa Prisma "contains, insensitive" untuk satu kata kunci pada beberapa kolom teks. */
export function cocokTeks(q: string) {
  return { contains: q, mode: "insensitive" as const };
}
