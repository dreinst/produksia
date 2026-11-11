/*
 * Pratinjau angka dokumen penjualan di peramban (D2 §3.2, §3.4, §3.8): editor baris, ringkasan diskon, fee, PPN, dan
 * rencana termin. Tanpa Prisma dan tanpa impor apa pun, jadi aman untuk komponen klien (L10). Server tetap sumber
 * kebenaran (dokumenPenjualan.ts, rencanaTermin.ts); fungsi di sini meniru rumusnya untuk tampilan dan mengembalikan
 * pesan galat yang sama sebagai `galat` alih-alih melempar.
 *
 * Semua hitungan memakai sen bulat (BigInt) dengan pembulatan half-up menjauhi nol (sama dengan ROUND_HALF_UP
 * Decimal), bukan float, sehingga hasilnya sama persis dengan server untuk harga bersen dan frekuensi pecahan. Isian
 * dibaca seperti uang() di server: dibulatkan ke 2 desimal lebih dulu. Hasil dikembalikan sebagai number untuk tampilan.
 */

export type AngkaKlien = number | string | null | undefined;
export type JenisNilaiKlien = "NOMINAL" | "PERSEN";

const NOL = BigInt(0);
const SATU = BigInt(1);
const DUA = BigInt(2);
const SEPULUH = BigInt(10);
const SERATUS = BigInt(100);
const SEPULUH_RIBU = BigInt(10_000);
/** Batas nilai termin dan fee nominal server (100.000.000.000.000), dalam sen. */
const MAKS_NOMINAL_SEN = BigInt("10000000000000000");

/** a / b dibulatkan half-up menjauhi nol (b > 0). */
function bagiBulat(a: bigint, b: bigint): bigint {
  const negatif = a < NOL;
  const m = negatif ? -a : a;
  const q = m / b;
  const hasil = (m % b) * DUA >= b ? q + SATU : q;
  return negatif ? -hasil : hasil;
}

/**
 * Isian ke sen (dikali 100, dibulatkan half-up 2 desimal seperti uang()). Kosong = 0. Selain angka desimal sah
 * (boleh bertanda dan berpangkat, mis. "1e3") = null.
 */
function keSen(v: AngkaKlien): bigint | null {
  if (v === null || v === undefined) return NOL;
  if (typeof v === "number" && !Number.isFinite(v)) return null;
  const s = String(v).trim();
  if (s === "") return NOL;
  const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s);
  if (!m || (m[2] === "" && (m[3] ?? "") === "")) return null;
  const pecahan = m[3] ?? "";
  const pangkat = Number(m[4] ?? 0) - pecahan.length + 2;
  if (Math.abs(pangkat) > 60) return null;
  const angka = BigInt((m[2] || "0") + pecahan);
  const sen = pangkat >= 0 ? angka * SEPULUH ** BigInt(pangkat) : bagiBulat(angka, SEPULUH ** BigInt(-pangkat));
  return m[1] === "-" ? -sen : sen;
}

/** Sen ke number tampilan (lewat teks desimal, jadi tanpa galat pembagian float). */
function keAngka(sen: bigint): number {
  const negatif = sen < NOL;
  const m = negatif ? -sen : sen;
  const n = Number(`${m / SERATUS}.${String(m % SERATUS).padStart(2, "0")}`);
  return negatif ? -n : n;
}

/** Angka isian: kosong atau tidak sah = 0, dibulatkan 2 desimal seperti server. */
export function angkaKlien(v: AngkaKlien): number {
  return keAngka(keSen(v) ?? NOL);
}

const senAtauNol = (v: AngkaKlien) => keSen(v) ?? NOL;
const frekuensiSen = (v: AngkaKlien) => (v === null || v === undefined || (typeof v === "string" && v.trim() === "") ? SERATUS : senAtauNol(v));

type BarisKlien = { jumlah: AngkaKlien; harga: AngkaKlien; frekuensi?: AngkaKlien };

/** Nilai satu baris dalam sen: jumlah × frekuensi × harga, satu kali pembulatan (nilaiBaris server). */
function nilaiBarisSen(b: BarisKlien): bigint {
  return bagiBulat(senAtauNol(b.jumlah) * frekuensiSen(b.frekuensi) * senAtauNol(b.harga), SEPULUH_RIBU);
}

function subtotalSen(baris: readonly BarisKlien[]): bigint {
  return baris.reduce((s, b) => s + nilaiBarisSen(b), NOL);
}

/** nilai × persen / 100 dibulatkan ke sen (hitungDiskon, hitungFee, hitungPpn server); keduanya dalam sen. */
const persenDari = (nilaiSen: bigint, persenSen: bigint) => bagiBulat(nilaiSen * persenSen, SEPULUH_RIBU);

/** Nilai satu baris: jumlah × frekuensi × harga, satu kali pembulatan; frekuensi kosong = 1; isian tidak sah = 0. */
export function nilaiBarisKlien(b: BarisKlien): number {
  return keAngka(nilaiBarisSen(b));
}

/** Jumlah nilai baris (tiap baris dibulatkan dulu). */
export function subtotalKlien(baris: readonly BarisKlien[]): number {
  return keAngka(subtotalSen(baris));
}

const rupiah = (sen: bigint) => keAngka(sen).toLocaleString("id-ID");

export type RingkasanKlien = { subtotal: number; diskon: number; fee: number; total: number; ppn: number; totalDenganPpn: number; galat: string | null };

/**
 * Ringkasan penawaran dan pesanan: total = subtotal - diskon + fee (tanpa PPN), PPN hanya tampilan. `galat` berisi
 * pesan yang sama dengan server bila isian akan ditolak, dengan urutan pemeriksaan bacaRingkasanDokumen: isian diskon
 * dan fee dibaca dulu, lalu diskon, lalu fee. Bila ada galat, diskon dan fee pratinjau 0.
 */
export function ringkasanDokumenKlien(p: {
  baris: readonly BarisKlien[];
  jenisDiskon: JenisNilaiKlien;
  nilaiDiskon: AngkaKlien;
  jenisFee: JenisNilaiKlien;
  nilaiFee: AngkaKlien;
  ppnPersen?: AngkaKlien;
  dokumen?: "penawaran" | "pesanan";
}): RingkasanKlien {
  const subtotal = subtotalSen(p.baris);
  const nDiskon = keSen(p.nilaiDiskon);
  const nFee = keSen(p.nilaiFee);
  let galat: string | null = null;
  let diskon = NOL;
  let fee = NOL;
  if (nDiskon === null) galat = "Diskon tidak valid";
  else if (nFee === null) galat = "Management fee tidak valid";
  else if (nDiskon < NOL) galat = "Diskon tidak boleh negatif";
  else if (p.jenisDiskon === "PERSEN" && nDiskon > SEPULUH_RIBU) galat = "Persen diskon tidak boleh lebih dari 100";
  else {
    diskon = p.jenisDiskon === "PERSEN" ? persenDari(subtotal, nDiskon) : nDiskon;
    if (diskon > subtotal) galat = `Diskon (${rupiah(diskon)}) melebihi subtotal ${p.dokumen ?? "penawaran"} (${rupiah(subtotal)})`;
    else if (nFee < NOL) galat = "Management fee tidak boleh negatif";
    else if (p.jenisFee === "PERSEN" && nFee > SEPULUH_RIBU) galat = "Persen management fee tidak boleh lebih dari 100";
    else if (p.jenisFee !== "PERSEN" && nFee > MAKS_NOMINAL_SEN) galat = "Management fee terlalu besar";
    else fee = p.jenisFee === "PERSEN" ? persenDari(subtotal - diskon, nFee) : nFee;
  }
  if (galat) {
    diskon = NOL;
    fee = NOL;
  }
  const total = subtotal - diskon + fee;
  const ppn = persenDari(total, senAtauNol(p.ppnPersen));
  return { subtotal: keAngka(subtotal), diskon: keAngka(diskon), fee: keAngka(fee), total: keAngka(total), ppn: keAngka(ppn), totalDenganPpn: keAngka(total + ppn), galat };
}

export type ButirTerminKlien = { no: number; label: string; jumlah: number; persen: number; bruto: number };

/**
 * Pratinjau rencana termin (meniru selesaikanRencana dan brutoRencana): butir terakhir menutup sisa jumlah, sisa persen
 * (jumlah persen 100), dan sisa nilai kontrak termasuk PPN. Mode kosong = PERSEN.
 */
export function pratinjauTerminKlien(
  butir: readonly { label?: string | null; mode?: string | null; nilai?: AngkaKlien }[],
  basisMentah: AngkaKlien,
  ppnPersen: AngkaKlien = 0,
): { butir: ButirTerminKlien[]; galat: string | null } {
  const basis = senAtauNol(basisMentah);
  if (butir.length === 0) return { butir: [], galat: null };
  if (butir.length > 4) return { butir: [], galat: "Rencana termin maksimal 4 butir" };
  if (basis <= NOL) return { butir: [], galat: "Rencana termin butuh nilai kontrak di atas nol" };
  const ppn = senAtauNol(ppnPersen);
  const hasil: { no: number; label: string; jumlah: bigint; persen: bigint; bruto: bigint }[] = [];
  const keluar = (galat: string | null) => ({ butir: hasil.map((h) => ({ no: h.no, label: h.label, jumlah: keAngka(h.jumlah), persen: keAngka(h.persen), bruto: keAngka(h.bruto) })), galat });
  let terpakai = NOL;
  for (const [i, b] of butir.entries()) {
    const n = i + 1;
    const terakhir = n === butir.length;
    const label = String(b.label ?? "").trim().replace(/\s+/g, " ");
    if (label.length > 40) return keluar("Label termin maksimal 40 karakter");
    const mode = b.mode === null || b.mode === undefined || b.mode === "" ? "PERSEN" : b.mode;
    if (mode !== "PERSEN" && mode !== "NOMINAL") return keluar(`Mode termin ${n} tidak dikenal`);
    const nilai = keSen(b.nilai);
    if (nilai === null) return keluar(`Nilai termin ${n} tidak valid`);
    if (nilai < NOL) return keluar(`Nilai termin ${n} tidak boleh negatif`);
    if (nilai > MAKS_NOMINAL_SEN) return keluar("Nilai termin terlalu besar");
    let jumlah: bigint;
    if (terakhir) jumlah = basis - terpakai;
    else if (mode === "NOMINAL") jumlah = nilai;
    else {
      if (nilai > SEPULUH_RIBU) return keluar(`Persen termin ${n} tidak boleh lebih dari 100`);
      jumlah = persenDari(basis, nilai);
    }
    if (jumlah <= NOL) return keluar(terakhir ? "Termin sebelumnya sudah menutup seluruh nilai kontrak" : `Termin ${n} harus lebih dari nol`);
    terpakai += jumlah;
    const sisaPersen = SEPULUH_RIBU - hasil.reduce((s, h) => s + h.persen, NOL);
    const persen = terakhir ? (sisaPersen > NOL ? sisaPersen : NOL) : bagiBulat(jumlah * SEPULUH_RIBU, basis);
    const bruto = terakhir ? basis + persenDari(basis, ppn) - hasil.reduce((s, h) => s + h.bruto, NOL) : jumlah + persenDari(jumlah, ppn);
    hasil.push({ no: n, label: label || `Termin ${n}`, jumlah, persen, bruto });
  }
  // sama dengan periksaBrutoRencana di server: butir bernilai termasuk PPN 0 atau kurang ditolak
  const kecil = hasil.find((h) => h.bruto <= NOL);
  if (kecil) return keluar(`Termin ${kecil.no} terlalu kecil setelah PPN dibulatkan`);
  return keluar(null);
}
