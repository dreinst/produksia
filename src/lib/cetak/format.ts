import { Prisma } from "@/prisma-klien/browser";
import type { GayaAngka } from "@/prisma-klien/enums";
import type { Desimal } from "@/lib/uang";
import { tanggalIso } from "@/lib/waktu";
import { potongAman } from "@/lib/tipeBerkas";

/*
 * Format angka, tanggal, nama berkas, dan teks untuk cetak (D3 §3.4). Fungsi murni tanpa basis data; Decimal dari
 * klien Prisma versi peramban (kelasnya sama dengan Prisma.Decimal server), jadi aman untuk komponen klien.
 */

/** Kepala Content-Disposition (D7 §3.3.10). Satu fungsi bersama dengan rute berkas (DESAIN F6), letaknya di tipeBerkas.ts. */
export { kepalaDisposisi } from "@/lib/tipeBerkas";

export type NilaiAngka = Desimal | number | string;

function desimal(v: NilaiAngka): Desimal {
  const d = new Prisma.Decimal(v);
  if (!d.isFinite()) throw new Error(`Angka tidak valid: ${String(v)}`);
  return d;
}

/** 2 bila ada satu nilai uang di dokumen yang punya sen bukan nol, selain itu 0. Satu dokumen memakai satu jumlah desimal. */
export function desimalDokumen(nilai: readonly NilaiAngka[]): 0 | 2 {
  return nilai.some((v) => !desimal(v).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).isInteger()) ? 2 : 0;
}

const PEMISAH: Record<GayaAngka, { ribuan: string; desimal: string }> = {
  TITIK: { ribuan: ".", desimal: "," },
  KOMA: { ribuan: ",", desimal: "." },
};

const kelompokRibuan = (bulat: string, pemisah: string) => bulat.replace(/\B(?=(\d{3})+(?!\d))/g, pemisah);

/**
 * Angka dengan pemisah ribuan manual (tidak bergantung ICU): TITIK = 1.234,50; KOMA = 1,234.50. Dibulatkan half-up ke
 * `jumlahDesimal` (nilai uang sudah 2 desimal). Negatif diawali "-".
 */
export function formatAngka(d: NilaiAngka, gaya: GayaAngka, jumlahDesimal: 0 | 2 = 0): string {
  const teks = desimal(d).toFixed(jumlahDesimal, Prisma.Decimal.ROUND_HALF_UP);
  const negatif = teks.startsWith("-");
  const [bulat, pecahan] = (negatif ? teks.slice(1) : teks).split(".");
  const p = PEMISAH[gaya];
  const hasil = kelompokRibuan(bulat, p.ribuan) + (pecahan ? p.desimal + pecahan : "");
  // -0 (mis. -0,004 dibulatkan) ditulis tanpa tanda
  return negatif && /[1-9]/.test(hasil) ? `-${hasil}` : hasil;
}

/** Rupiah: awalan + formatAngka + akhiran; negatif "-Rp 90.000". Bonanova: { akhiran: ",-" } menjadi "Rp 500.000,-". */
export function formatRupiah(d: NilaiAngka, gaya: GayaAngka, jumlahDesimal: 0 | 2 = 0, opsi: { awalan?: string; akhiran?: string } = {}): string {
  const angka = formatAngka(d, gaya, jumlahDesimal);
  const { awalan = "Rp ", akhiran = "" } = opsi;
  return angka.startsWith("-") ? `-${awalan}${angka.slice(1)}${akhiran}` : `${awalan}${angka}${akhiran}`;
}

/** Kuantitas seperti %g: nol di belakang desimal dibuang, tanpa pemisah ribuan ("6", "1,5" TITIK, "1.5" KOMA). */
export function formatJumlah(d: NilaiAngka, gaya: GayaAngka = "TITIK"): string {
  const teks = desimal(d).toFixed();
  const [bulat, pecahan] = teks.split(".");
  const sisa = (pecahan ?? "").replace(/0+$/, "");
  return sisa ? `${bulat}${PEMISAH[gaya].desimal}${sisa}` : bulat;
}

// ---------- Tanggal (zona ZONA_WAKTU lewat tanggalIso, nama bulan sendiri) ----------

export const BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"] as const;
const ROMAWI = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"] as const;

function bagianTanggal(d: Date): { tahun: number; bulan: number; hari: number } {
  const [tahun, bulan, hari] = tanggalIso(d).split("-").map(Number);
  return { tahun, bulan, hari };
}

/** "21 September 2026" */
export function formatTanggalPanjang(d: Date): string {
  const t = bagianTanggal(d);
  return `${t.hari} ${BULAN[t.bulan - 1]} ${t.tahun}`;
}

/** "21/09/2026" */
export function formatTanggalPendek(d: Date): string {
  const [yyyy, mm, dd] = tanggalIso(d).split("-");
  return `${dd}/${mm}/${yyyy}`;
}

/** Bulan romawi I-XII di zona tampilan. */
export function bulanRomawi(d: Date): string {
  return ROMAWI[bagianTanggal(d).bulan - 1];
}

/**
 * Rentang tanggal untuk teks event: sama hari "21 September 2026"; sama bulan "27-30 Agustus 2026"; beda bulan
 * "30 Agustus - 2 September 2026"; beda tahun "30 Desember 2026 - 2 Januari 2027". Urutan masukan dirapikan.
 */
export function rentangTanggalTeks(a: Date, b: Date): string {
  const [awal, akhir] = a.getTime() <= b.getTime() ? [a, b] : [b, a];
  const x = bagianTanggal(awal);
  const y = bagianTanggal(akhir);
  if (x.tahun !== y.tahun) return `${formatTanggalPanjang(awal)} - ${formatTanggalPanjang(akhir)}`;
  if (x.bulan !== y.bulan) return `${x.hari} ${BULAN[x.bulan - 1]} - ${y.hari} ${BULAN[y.bulan - 1]} ${y.tahun}`;
  if (x.hari !== y.hari) return `${x.hari}-${y.hari} ${BULAN[y.bulan - 1]} ${y.tahun}`;
  return formatTanggalPanjang(awal);
}

// ---------- Nama berkas dan teks ----------

export const PANJANG_NAMA_BERKAS_CETAK = 120;

/**
 * Nama berkas PDF: "{judulBerkas} {nomor}" dengan \ / : * ? " < > | diganti "-", karakter kendali dan format Unicode
 * (pengatur arah teks, lebar nol) dibuang, spasi dirapikan, paling panjang 120 karakter, akhiran " (DRAF)" bila draf,
 * lalu ".pdf". Dipakai rute cetak dan aksi simpan PDF supaya nama unduhan dan nama lampiran sama.
 */
export function namaBerkasAman(judulBerkas: string, nomorTampil: string, draf: boolean): string {
  const dasar = `${judulBerkas} ${nomorTampil}`
    .normalize("NFC")
    .replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, "")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  const potong = potongAman(dasar, PANJANG_NAMA_BERKAS_CETAK).replace(/[\s.]+$/g, "").replace(/^[\s.]+/g, "");
  return `${potong || "Dokumen"}${draf ? " (DRAF)" : ""}.pdf`;
}

/**
 * Teks siap gambar: NFC, \r\n dan \r jadi \n, \t jadi spasi, karakter kendali lain dibuang (kecuali \n). Bila
 * `adaGlyph` diberikan (mesin cetak memeriksa cmap Carlito), karakter tanpa glyph diganti "?". Tanpa pemeriksa,
 * karakter lain dibiarkan.
 */
export function bersihkanTeks(s: string | null | undefined, adaGlyph?: (kodeTitik: number) => boolean): string {
  if (!s) return "";
  const rapi = s
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, "");
  if (!adaGlyph) return rapi;
  let hasil = "";
  for (const c of rapi) hasil += c === "\n" || adaGlyph(c.codePointAt(0)!) ? c : "?";
  return hasil;
}
