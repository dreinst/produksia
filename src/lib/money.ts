import { Prisma } from "@/generated/prisma/client";

/**
 * Semua perhitungan uang & kuantitas di server memakai Prisma.Decimal (decimal.js),
 * bukan float JS — 0.1 + 0.2 harus persis 0.3, dan total faktur harus sama persis
 * dengan jumlah barisnya. Kolom DB sudah Decimal(18,2); helper ini menjaga sisi aplikasinya.
 */
export type Dec = Prisma.Decimal;
type DecValue = string | number | Prisma.Decimal | null | undefined;

export function D(v: DecValue): Dec {
  if (v === null || v === undefined || v === "") return new Prisma.Decimal(0);
  try {
    const d = new Prisma.Decimal(v);
    if (!d.isFinite()) throw new Error();
    return d;
  } catch {
    throw new Error(`Angka tidak valid: ${String(v)}`);
  }
}

/** Bulatkan ke 2 desimal (half-up) — dipakai untuk semua nilai uang & qty yang disimpan. */
export function money(v: DecValue): Dec {
  return D(v).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

export function sum(values: Iterable<DecValue>): Dec {
  let acc = new Prisma.Decimal(0);
  for (const v of values) acc = acc.plus(D(v));
  return acc;
}

export function mul(a: DecValue, b: DecValue): Dec {
  return money(D(a).mul(D(b)));
}

/** Baca nominal dari FormData; wajib ada, angka valid, dan (default) > 0. */
export function parseMoney(raw: FormDataEntryValue | null, label: string, opts: { allowZero?: boolean } = {}): Dec {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) throw new Error(`${label} wajib diisi`);
  const d = money(s);
  if (d.isNegative()) throw new Error(`${label} tidak boleh negatif`);
  if (!opts.allowZero && d.isZero()) throw new Error(`${label} harus lebih dari 0`);
  return d;
}

/** Format untuk pesan error/log: 1234567.5 -> "1.234.567,5" */
export function fmt(v: DecValue): string {
  return D(v).toNumber().toLocaleString("id-ID");
}
