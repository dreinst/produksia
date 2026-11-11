/*
 * Pratinjau angka dokumen penjualan di peramban (D2 §3.2, §3.4, §3.8): editor baris, ringkasan diskon, fee, PPN, dan
 * rencana termin. Hanya angka biasa, tanpa Prisma dan tanpa impor apa pun, jadi aman untuk komponen klien (L10).
 * Server tetap sumber kebenaran (dokumenPenjualan.ts, rencanaTermin.ts); fungsi di sini meniru rumusnya untuk tampilan
 * dan mengembalikan pesan galat yang sama sebagai `galat` alih-alih melempar.
 */

export type AngkaKlien = number | string | null | undefined;
export type JenisNilaiKlien = "NOMINAL" | "PERSEN";

/** Pembulatan dua desimal pratinjau: Math.round((x + EPSILON) × 100) / 100. */
export function bulat2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

/** Angka isian: kosong atau tidak sah = 0. */
export function angkaKlien(v: AngkaKlien): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : 0;
}

const frekuensiKlien = (v: AngkaKlien) => (v === null || v === undefined || v === "" ? 1 : angkaKlien(v));

/** Nilai satu baris: bulat2(jumlah × frekuensi × harga); frekuensi kosong = 1. */
export function nilaiBarisKlien(b: { jumlah: AngkaKlien; harga: AngkaKlien; frekuensi?: AngkaKlien }): number {
  return bulat2(angkaKlien(b.jumlah) * frekuensiKlien(b.frekuensi) * angkaKlien(b.harga));
}

/** Jumlah nilai baris (tiap baris dibulatkan dulu), dibulatkan lagi supaya galat float tidak menumpuk. */
export function subtotalKlien(baris: readonly { jumlah: AngkaKlien; harga: AngkaKlien; frekuensi?: AngkaKlien }[]): number {
  return bulat2(baris.reduce((s, b) => s + nilaiBarisKlien(b), 0));
}

const rupiah = (n: number) => n.toLocaleString("id-ID");

export type RingkasanKlien = { subtotal: number; diskon: number; fee: number; total: number; ppn: number; totalDenganPpn: number; galat: string | null };

/**
 * Ringkasan penawaran dan pesanan: total = subtotal - diskon + fee (tanpa PPN), PPN hanya tampilan. `galat` berisi
 * pesan yang sama dengan server bila isian akan ditolak.
 */
export function ringkasanDokumenKlien(p: {
  baris: readonly { jumlah: AngkaKlien; harga: AngkaKlien; frekuensi?: AngkaKlien }[];
  jenisDiskon: JenisNilaiKlien;
  nilaiDiskon: AngkaKlien;
  jenisFee: JenisNilaiKlien;
  nilaiFee: AngkaKlien;
  ppnPersen?: AngkaKlien;
  dokumen?: "penawaran" | "pesanan";
}): RingkasanKlien {
  const subtotal = subtotalKlien(p.baris);
  const nDiskon = angkaKlien(p.nilaiDiskon);
  const nFee = angkaKlien(p.nilaiFee);
  let galat: string | null = null;
  if (nDiskon < 0) galat = "Diskon tidak boleh negatif";
  else if (p.jenisDiskon === "PERSEN" && nDiskon > 100) galat = "Persen diskon tidak boleh lebih dari 100";
  const diskon = galat ? 0 : bulat2(p.jenisDiskon === "PERSEN" ? (subtotal * nDiskon) / 100 : nDiskon);
  if (!galat && diskon > subtotal) galat = `Diskon (${rupiah(diskon)}) melebihi subtotal ${p.dokumen ?? "penawaran"} (${rupiah(subtotal)})`;
  if (!galat && nFee < 0) galat = "Management fee tidak boleh negatif";
  else if (!galat && p.jenisFee === "PERSEN" && nFee > 100) galat = "Persen management fee tidak boleh lebih dari 100";
  const dasarFee = bulat2(subtotal - diskon);
  const fee = galat ? 0 : bulat2(p.jenisFee === "PERSEN" ? (dasarFee * nFee) / 100 : nFee);
  const total = bulat2(subtotal - diskon + fee);
  const ppn = bulat2((total * angkaKlien(p.ppnPersen)) / 100);
  return { subtotal, diskon, fee, total, ppn, totalDenganPpn: bulat2(total + ppn), galat };
}

export type ButirTerminKlien = { no: number; label: string; jumlah: number; persen: number; bruto: number };

/** Pratinjau rencana termin (meniru selesaikanRencana): butir terakhir menutup sisa, bruto termasuk PPN. */
export function pratinjauTerminKlien(
  butir: readonly { label?: string | null; mode?: JenisNilaiKlien | null; nilai?: AngkaKlien }[],
  basisMentah: AngkaKlien,
  ppnPersen: AngkaKlien = 0,
): { butir: ButirTerminKlien[]; galat: string | null } {
  const basis = bulat2(angkaKlien(basisMentah));
  if (butir.length === 0) return { butir: [], galat: null };
  if (butir.length > 4) return { butir: [], galat: "Rencana termin maksimal 4 butir" };
  if (basis <= 0) return { butir: [], galat: "Rencana termin butuh nilai kontrak di atas nol" };
  const hasil: ButirTerminKlien[] = [];
  let terpakai = 0;
  for (const [i, b] of butir.entries()) {
    const n = i + 1;
    const terakhir = n === butir.length;
    const label = String(b.label ?? "").trim().replace(/\s+/g, " ");
    if (label.length > 40) return { butir: hasil, galat: "Label termin maksimal 40 karakter" };
    const nilai = bulat2(angkaKlien(b.nilai));
    if (nilai < 0) return { butir: hasil, galat: `Nilai termin ${n} tidak boleh negatif` };
    const persenMode = (b.mode ?? "PERSEN") === "PERSEN";
    if (!terakhir && persenMode && nilai > 100) return { butir: hasil, galat: `Persen termin ${n} tidak boleh lebih dari 100` };
    const jumlah = terakhir ? bulat2(basis - terpakai) : persenMode ? bulat2((basis * nilai) / 100) : nilai;
    if (jumlah <= 0) return { butir: hasil, galat: terakhir ? "Termin sebelumnya sudah menutup seluruh nilai kontrak" : `Termin ${n} harus lebih dari nol` };
    terpakai = bulat2(terpakai + jumlah);
    hasil.push({ no: n, label: label || `Termin ${n}`, jumlah, persen: bulat2((jumlah / basis) * 100), bruto: bulat2(jumlah + bulat2((jumlah * angkaKlien(ppnPersen)) / 100)) });
  }
  return { butir: hasil, galat: null };
}
