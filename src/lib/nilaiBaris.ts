import { Prisma } from "@/prisma-klien/browser";
import type { Desimal } from "@/lib/uang";

/*
 * Nilai satu baris dokumen penjualan (D2 §3.2): satu fungsi untuk semua titik hitung (aksi, jurnal, basis kas,
 * komposer). Berkas ini aman untuk komponen klien: Decimal diambil dari klien Prisma versi peramban, yang kelasnya
 * sama dengan Prisma.Decimal di server (keduanya dari @prisma/client-runtime-utils), dan uang.ts hanya diimpor
 * sebagai tipe karena uang.ts memuat klien Prisma server.
 */

type Angka = string | number | Desimal | null | undefined;
export type BarisNilai = { jumlah: Angka; harga: Angka; frekuensi?: Angka };

/** Sama dengan D() di src/lib/uang.ts: null, undefined, dan "" bernilai 0; selain angka sah dilempar. */
function D(v: Angka): Desimal {
  if (v === null || v === undefined || v === "") return new Prisma.Decimal(0);
  try {
    const d = new Prisma.Decimal(v);
    if (!d.isFinite()) throw new Error();
    return d;
  } catch {
    throw new Error(`Angka tidak valid: ${String(v)}`);
  }
}

/**
 * Nilai uang satu baris penjualan: uang(jumlah × frekuensi × harga), satu kali pembulatan half-up 2 desimal.
 * Dengan frekuensi kosong/1 hasilnya identik dengan kali(jumlah, harga) di src/lib/uang.ts.
 */
export function nilaiBaris(b: BarisNilai): Desimal {
  return bobotBaris(b).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/** Bobot alokasi basis kas TANPA pembulatan; dengan frekuensi 1 sama persis dengan D(jumlah).mul(harga) lama. */
export function bobotBaris(b: BarisNilai): Desimal {
  // ?? 1 wajib: D(null) bernilai 0, jadi frekuensi kosong tidak boleh sampai ke D()
  return D(b.jumlah).mul(D(b.frekuensi ?? 1)).mul(D(b.harga));
}

/** Jumlah nilaiBaris semua baris (tiap baris dibulatkan dulu, lalu dijumlahkan). */
export function subtotalBaris(daftar: readonly BarisNilai[]): Desimal {
  return daftar.reduce((acc, b) => acc.plus(nilaiBaris(b)), new Prisma.Decimal(0));
}
