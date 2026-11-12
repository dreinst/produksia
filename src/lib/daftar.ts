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

/**
 * Loloskan `\`, `%`, dan `_` supaya `contains` Prisma (LIKE/ILIKE) mencocokkan kata kunci apa adanya, bukan sebagai
 * wildcard. Dipakai jalur pencarian peleburan (pencarian global, lead, pemasaran, berkas). `cocokTeks` dan kueri lama
 * `/cari` sengaja tidak diubah, jadi di sana `%` dan `_` tetap berlaku sebagai wildcard seperti sebelumnya.
 */
export function loloskanWildcard(term: string): string {
  return term.replace(/[\\%_]/g, "\\$&");
}

/** Batas panjang kata kunci pencarian global sesudah dinormalkan. */
export const MAKS_PANJANG_CARI = 100;

/**
 * Kata kunci pencarian dari searchParams atau pemanggil lain: elemen pertama bila larik (`?q=a&q=b`), byte NUL dibuang
 * (PostgreSQL menolak 0x00 di teks), dirapikan, lalu dipotong `MAKS_PANJANG_CARI` karakter.
 */
export function normalkanKataCari(q: string | string[] | null | undefined): string {
  const mentah = Array.isArray(q) ? q[0] : q;
  return String(mentah ?? "").replace(/\u0000/g, "").trim().slice(0, MAKS_PANJANG_CARI);
}
