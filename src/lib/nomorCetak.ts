import type { JenisDokumenCetak, ResetNomor } from "@/prisma-klien/enums";
import type { Prisma } from "@/prisma-klien/client";
import type { KlienDb } from "@/lib/log";
import { tanggalIso } from "@/lib/waktu";

/*
 * Nomor cetak dokumen penjualan (D2 §3.7): nomor tampil per perusahaan menurut FormatNomor bertoken, terpisah dari
 * nomor internal (PNW-, FJ-, dst.) yang tetap unik global. Penghitung dinaikkan atomik lewat
 * INSERT ... ON CONFLICT ... RETURNING di transaksi dokumen pemanggil. Bukan "use server"; fungsi menerima klien
 * dari pemanggil (alokasiNomorCetak hanya menerima klien transaksi).
 */

export const JENIS_NOMOR_CETAK = ["penawaran", "faktur", "kwitansi", "kwitansi-dp", "tagihan-termin"] as const;
export type JenisNomorCetak = (typeof JENIS_NOMOR_CETAK)[number];

export const LABEL_JENIS_NOMOR_CETAK: Record<JenisNomorCetak, string> = {
  penawaran: "Penawaran / Proposal",
  faktur: "Faktur / Invoice",
  kwitansi: "Kuitansi pelunasan",
  "kwitansi-dp": "Kuitansi uang muka",
  "tagihan-termin": "Tagihan termin",
};

export function jenisNomorCetakSah(nilai: string | null | undefined): nilai is JenisNomorCetak {
  return (JENIS_NOMOR_CETAK as readonly string[]).includes(nilai ?? "");
}

/**
 * Peta kosakata cetak D3 (enum JenisDokumenCetak, dipakai TemplateCetak) ke kosakata D2 (FormatNomor.jenis,
 * JenisCetakPenjualan, rute /cetak/[jenis]) (SKEMA-CATATAN §9 no. 7).
 */
export const JENIS_CETAK_KE_NOMOR: Record<JenisDokumenCetak, JenisNomorCetak> = {
  PENAWARAN: "penawaran",
  TAGIHAN_TERMIN: "tagihan-termin",
  FAKTUR: "faktur",
  KWITANSI: "kwitansi",
  KWITANSI_DP: "kwitansi-dp",
};

// ---------- Pola dan periode ----------

export const TOKEN_POLA = ["PREFIX", "KODE", "YYYY", "YY", "MM", "ROMAN", "SEQ", "SEQ2", "SEQ3"] as const;
const ROMAWI = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

export type IsianPola = { nilai: number; tanggal: Date; prefiks: string; kode: string; digit: number };

/**
 * Isi pola dengan nilai penghitung. Tahun dan bulan diambil dari tanggal dokumen di ZONA_WAKTU (tanggalIso), bukan
 * jam server. {SEQ2}/{SEQ3}/{SEQ} hanya menambah nol di depan, tidak pernah memotong (12345 tetap "12345").
 */
export function isiPola(pola: string, a: IsianPola): string {
  const [yyyy, mm] = tanggalIso(a.tanggal).split("-");
  const urut = String(a.nilai);
  return pola
    .replaceAll("{PREFIX}", a.prefiks)
    .replaceAll("{KODE}", a.kode)
    .replaceAll("{YYYY}", yyyy)
    .replaceAll("{YY}", yyyy.slice(2))
    .replaceAll("{MM}", mm)
    .replaceAll("{ROMAN}", ROMAWI[Number(mm) - 1])
    .replaceAll("{SEQ3}", urut.padStart(3, "0"))
    .replaceAll("{SEQ2}", urut.padStart(2, "0"))
    .replaceAll("{SEQ}", urut.padStart(a.digit, "0"));
}

/** Kunci periode penghitung: "2026" (TAHUNAN), "2026-09" (BULANAN), "-" (TIDAK_PERNAH), di ZONA_WAKTU. */
export function periodeReset(reset: ResetNomor, tanggal: Date): string {
  const [yyyy, mm] = tanggalIso(tanggal).split("-");
  return reset === "TAHUNAN" ? yyyy : reset === "BULANAN" ? `${yyyy}-${mm}` : "-";
}

const PESAN_POLA = "Pola nomor harus 3-60 karakter dan memuat {SEQ}, {SEQ2}, atau {SEQ3}";

/** Validasi pola terhadap token dan jenis reset; mengembalikan pola yang sudah dipangkas. */
export function periksaPola(pola: string, reset: ResetNomor): string {
  const p = pola.trim();
  if (p.length < 3 || p.length > 60) throw new Error(PESAN_POLA);
  for (const [, token] of p.matchAll(/\{([^{}]*)\}/g)) {
    if (!(TOKEN_POLA as readonly string[]).includes(token)) throw new Error(`Token {${token}} tidak dikenal`);
  }
  if (!/\{SEQ[23]?\}/.test(p)) throw new Error(PESAN_POLA);
  const adaTahun = /\{YYYY\}|\{YY\}/.test(p);
  const adaBulan = /\{MM\}|\{ROMAN\}/.test(p);
  if (reset === "TAHUNAN" && !adaTahun) throw new Error("Pola dengan reset tahunan wajib memuat {YYYY} atau {YY} supaya tidak bentrok dengan nomor tahun lalu");
  if (reset === "BULANAN" && !(adaTahun && adaBulan)) {
    throw new Error("Pola dengan reset bulanan wajib memuat tahun ({YYYY} atau {YY}) dan bulan ({MM} atau {ROMAN}) supaya tidak bentrok dengan nomor bulan lain");
  }
  return p;
}

export type IsianFormatNomor = { jenis: JenisNomorCetak; pola: string; prefiks: string; kode: string; digit: number; kunciDeret: string; reset: ResetNomor };

const RESET_SAH: readonly ResetNomor[] = ["TAHUNAN", "BULANAN", "TIDAK_PERNAH"];

/**
 * Validasi seluruh isian format nomor (D2 §3.7 "Validasi simpan format"), kecuali nomorTerakhir yang butuh basis data
 * (setelNomorTerakhir). Kosong: prefiks dan kode "", digit 4, kunciDeret = jenis, reset TAHUNAN.
 */
export function bacaFormatNomor(isian: { jenis: unknown; pola: unknown; prefiks?: unknown; kode?: unknown; digit?: unknown; kunciDeret?: unknown; reset?: unknown }): IsianFormatNomor {
  const teks = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const jenis = teks(isian.jenis);
  if (!jenisNomorCetakSah(jenis)) throw new Error("Jenis nomor cetak tidak dikenal");
  const resetIsian = teks(isian.reset) || "TAHUNAN";
  if (!(RESET_SAH as readonly string[]).includes(resetIsian)) throw new Error("Jenis reset nomor tidak dikenal");
  const reset = resetIsian as ResetNomor;
  const pola = periksaPola(teks(isian.pola), reset);
  const prefiks = teks(isian.prefiks);
  if (!/^[A-Za-z0-9]{0,8}$/.test(prefiks)) throw new Error("Prefiks hanya huruf/angka, maksimal 8");
  const kode = teks(isian.kode);
  if (!/^[A-Za-z0-9-]{0,12}$/.test(kode)) throw new Error("Kode hanya huruf/angka/tanda hubung, maksimal 12");
  const digitIsian = teks(isian.digit) || (typeof isian.digit === "number" ? String(isian.digit) : "");
  const digit = digitIsian ? Number(digitIsian) : 4;
  if (!/^\d*$/.test(digitIsian) || !Number.isInteger(digit) || digit < 3 || digit > 8) throw new Error("Digit urut harus bilangan bulat 3-8");
  const kunciDeret = teks(isian.kunciDeret) || jenis;
  if (!/^[a-z0-9-]{1,40}$/.test(kunciDeret)) throw new Error("Kunci deret hanya huruf kecil, angka, dan tanda hubung, maksimal 40");
  return { jenis, pola, prefiks: prefiks.toUpperCase(), kode: kode.toUpperCase(), digit, kunciDeret, reset };
}

// ---------- Penghitung ----------

/**
 * Menyetel penghitung periode berjalan (periode dari `tanggal`, bawaan hari ini) untuk melanjutkan nomor manual lama
 * (mis. D'Pro sudah sampai 080). Tidak boleh lebih kecil dari penghitung sekarang; pembandingan dan penulisan dalam
 * satu pernyataan supaya tidak berpacu dengan alokasi yang sedang berjalan.
 */
export async function setelNomorTerakhir(
  klien: KlienDb,
  p: { perusahaanId: string; kunciDeret: string; reset: ResetNomor; nilai: number; tanggal?: Date },
): Promise<void> {
  if (!Number.isInteger(p.nilai) || p.nilai < 0 || p.nilai > 2_147_483_647) throw new Error("Nomor terakhir harus bilangan bulat 0 atau lebih");
  const periode = periodeReset(p.reset, p.tanggal ?? new Date());
  const hasil = await klien.$queryRaw<{ nilai: number }[]>`
    INSERT INTO "PenghitungNomor" ("perusahaanId", "kunciDeret", "periode", "nilai")
    VALUES (${p.perusahaanId}, ${p.kunciDeret}, ${periode}, ${p.nilai})
    ON CONFLICT ("perusahaanId", "kunciDeret", "periode") DO UPDATE SET "nilai" = EXCLUDED."nilai"
    WHERE "PenghitungNomor"."nilai" <= EXCLUDED."nilai"
    RETURNING "nilai"`;
  if (hasil.length === 0) {
    const sekarang = await klien.penghitungNomor.findUnique({ where: { perusahaanId_kunciDeret_periode: { perusahaanId: p.perusahaanId, kunciDeret: p.kunciDeret, periode } }, select: { nilai: true } });
    throw new Error(`Nomor terakhir tidak boleh lebih kecil dari penghitung sekarang (${sekarang?.nilai ?? 0})`);
  }
}

/** Benar bila nomor cetak sudah dipakai dokumen lain berjenis sama di perusahaan itu (kecualiId = dokumen yang diubah). */
export async function nomorCetakTerpakai(klien: KlienDb, jenis: JenisNomorCetak, perusahaanId: string, nomor: string, kecualiId?: string): Promise<boolean> {
  return (await daftarNomorCetakTerpakai(klien, jenis, perusahaanId, [nomor], kecualiId)).size > 0;
}

/** Bagian dari `daftar` yang sudah dipakai dokumen berjenis sama di perusahaan itu (satu kueri berindeks). */
async function daftarNomorCetakTerpakai(klien: KlienDb, jenis: JenisNomorCetak, perusahaanId: string, daftar: string[], kecualiId?: string): Promise<Set<string>> {
  const where = { perusahaanId, nomorCetak: { in: daftar }, ...(kecualiId ? { NOT: { id: kecualiId } } : {}) };
  const select = { nomorCetak: true } as const;
  let baris: { nomorCetak: string | null }[];
  switch (jenis) {
    case "penawaran":
      baris = await klien.penawaranPenjualan.findMany({ where, select });
      break;
    case "faktur":
      baris = await klien.fakturPenjualan.findMany({ where, select });
      break;
    case "kwitansi":
      baris = await klien.penerimaanPenjualan.findMany({ where, select });
      break;
    case "kwitansi-dp":
      baris = await klien.uangMukaPelanggan.findMany({ where, select });
      break;
    case "tagihan-termin":
      baris = await klien.rencanaTermin.findMany({ where, select });
      break;
  }
  return new Set(baris.flatMap((b) => (b.nomorCetak === null ? [] : [b.nomorCetak])));
}

export const PANJANG_NOMOR_CETAK = 60;

/**
 * Nomor cetak isian manual: kosong = null (pemanggil lalu memakai alokasiNomorCetak); selain itu dipangkas, paling
 * panjang 60, dan unik per perusahaan di tabel jenisnya. Disimpan apa adanya; penghitung tidak naik.
 */
export async function bacaNomorCetakManual(
  klien: KlienDb,
  p: { jenis: JenisNomorCetak; perusahaanId: string; isian: unknown; kecualiId?: string },
): Promise<string | null> {
  // NFC supaya nomor yang tampak sama juga sama bagi indeks unik
  const nomor = typeof p.isian === "string" ? p.isian.normalize("NFC").trim() : "";
  if (!nomor) return null;
  if (nomor.length > PANJANG_NOMOR_CETAK) throw new Error(`Nomor cetak paling panjang ${PANJANG_NOMOR_CETAK} karakter`);
  // kendali C0/C1, karakter format (arah teks, lebar nol, BOM), dan pemisah baris/paragraf Unicode
  if (/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(nomor)) throw new Error("Nomor cetak memuat karakter yang tidak diizinkan");
  if (await nomorCetakTerpakai(klien, p.jenis, p.perusahaanId, nomor, p.kecualiId)) throw new Error(`Nomor cetak ${nomor} sudah dipakai dokumen lain`);
  return nomor;
}

/**
 * Klien transaksi saja. Prisma.TransactionClient sendiri masih menerima `db` (PrismaClient memuat semua kuncinya),
 * jadi $connect (yang tidak ada di klien transaksi) dilarang supaya TypeScript menolak `db` biasa.
 */
export type KlienTransaksi = Prisma.TransactionClient & { $connect?: never };

/** Paling banyak sekian nomor di atas penghitung yang diperiksa sebelum alokasi menyerah. */
export const MAKS_LOMPAT_NOMOR_CETAK = 10_000;
const UKURAN_BLOK_LOMPAT = 500;
const NILAI_PENGHITUNG_MAKS = 2_147_483_647;

/**
 * Alokasi nomor cetak di dalam transaksi dokumen yang sama. null bila perusahaan belum punya format untuk jenis itu
 * atau formatnya nonaktif. ON CONFLICT ... RETURNING mengunci baris penghitung, jadi transaksi bersamaan tidak
 * mendapat angka sama. Bila nomor hasil penghitung sudah dipakai (mis. nomor manual di depan penghitung), dipakai
 * nomor bebas terkecil di atasnya (diperiksa per blok, paling jauh MAKS_LOMPAT_NOMOR_CETAK) dan penghitung dinaikkan
 * ke nomor itu, supaya percobaan berikutnya tidak menabrak nomor yang sama lagi. Indeks unik
 * [perusahaanId, nomorCetak] tetap penjaga terakhir.
 */
export async function alokasiNomorCetak(tx: KlienTransaksi, p: { perusahaanId: string; jenis: JenisNomorCetak; tanggal: Date }): Promise<string | null> {
  const f = await tx.formatNomor.findUnique({
    where: { perusahaanId_jenis: { perusahaanId: p.perusahaanId, jenis: p.jenis } },
    include: { perusahaan: { select: { kode: true } } },
  });
  if (!f || !f.aktif) return null;
  const periode = periodeReset(f.reset, p.tanggal);
  const [{ nilai }] = await tx.$queryRaw<{ nilai: number }[]>`
    INSERT INTO "PenghitungNomor" ("perusahaanId", "kunciDeret", "periode", "nilai")
    VALUES (${p.perusahaanId}, ${f.kunciDeret}, ${periode}, 1)
    ON CONFLICT ("perusahaanId", "kunciDeret", "periode") DO UPDATE SET "nilai" = "PenghitungNomor"."nilai" + 1
    RETURNING "nilai"`;
  const isi = (n: number) => isiPola(f.pola, { nilai: n, tanggal: p.tanggal, prefiks: f.prefiks, kode: f.kode || f.perusahaan.kode, digit: f.digit });
  const batas = Math.min(nilai + MAKS_LOMPAT_NOMOR_CETAK - 1, NILAI_PENGHITUNG_MAKS);
  // blok pertama hanya nomor hasil penghitung (jalur biasa satu kueri), blok berikutnya UKURAN_BLOK_LOMPAT nomor
  for (let awal = nilai, ukuran = 1; awal <= batas; awal += ukuran, ukuran = UKURAN_BLOK_LOMPAT) {
    const calon = Array.from({ length: Math.min(ukuran, batas - awal + 1) }, (_, i) => awal + i);
    const terpakai = await daftarNomorCetakTerpakai(tx, p.jenis, p.perusahaanId, calon.map(isi));
    const bebas = calon.find((n) => !terpakai.has(isi(n)));
    if (bebas === undefined) continue;
    if (bebas !== nilai) {
      await tx.$executeRaw`
        UPDATE "PenghitungNomor" SET "nilai" = ${bebas}
        WHERE "perusahaanId" = ${p.perusahaanId} AND "kunciDeret" = ${f.kunciDeret} AND "periode" = ${periode}`;
    }
    return isi(bebas);
  }
  throw new Error(`Nomor cetak ${isi(nilai)} sampai ${isi(batas)} sudah dipakai semua. Setel Nomor terakhir di pengaturan Format Nomor supaya penomoran melanjutkan nomor yang sudah ada.`);
}
