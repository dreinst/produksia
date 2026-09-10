import { Prisma } from "@/prisma-klien/client";

/**
 * Semua perhitungan uang & kuantitas di server memakai Prisma.Decimal (decimal.js),
 * bukan float JS — 0.1 + 0.2 harus persis 0.3, dan total faktur harus sama persis
 * dengan jumlah barisnya. Kolom DB sudah Decimal(18,2); helper ini menjaga sisi aplikasinya.
 */
export type Desimal = Prisma.Decimal;
type NilaiDesimal = string | number | Prisma.Decimal | null | undefined;

export function D(v: NilaiDesimal): Desimal {
  if (v === null || v === undefined || v === "") return new Prisma.Decimal(0);
  try {
    const d = new Prisma.Decimal(v);
    if (!d.isFinite()) throw new Error();
    return d;
  } catch {
    throw new Error(`Angka tidak valid: ${String(v)}`);
  }
}

/** Bulatkan ke 2 desimal (half-up) — dipakai untuk semua nilai uang & jumlah yang disimpan. */
export function uang(v: NilaiDesimal): Desimal {
  return D(v).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

export function jumlahkan(values: Iterable<NilaiDesimal>): Desimal {
  let acc = new Prisma.Decimal(0);
  for (const v of values) acc = acc.plus(D(v));
  return acc;
}

export function kali(a: NilaiDesimal, b: NilaiDesimal): Desimal {
  return uang(D(a).mul(D(b)));
}

/** Baca nominal dari FormData; wajib ada, angka valid, dan (default) > 0. */
export function bacaUang(raw: FormDataEntryValue | null, label: string, opts: { allowZero?: boolean } = {}): Desimal {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) throw new Error(`${label} wajib diisi`);
  const d = uang(s);
  if (d.isNegative()) throw new Error(`${label} tidak boleh negatif`);
  if (!opts.allowZero && d.isZero()) throw new Error(`${label} harus lebih dari 0`);
  return d;
}

/** Format untuk pesan error/log: 1234567.5 -> "1.234.567,5" */
export function format(v: NilaiDesimal): string {
  return D(v).toNumber().toLocaleString("id-ID");
}

/** Nilai terkecil / terbesar dari dua Decimal (Prisma.Decimal tidak menyediakan min/max statis pada alias D). */
export function terkecil(a: Desimal, b: Desimal): Desimal {
  return a.lte(b) ? a : b;
}
export function terbesar(a: Desimal, b: Desimal): Desimal {
  return a.gte(b) ? a : b;
}
