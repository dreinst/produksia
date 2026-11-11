import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import PDFDocument from "pdfkit";
import { GayaEntitas, JenisAsetKop } from "@/prisma-klien/enums";

/*
 * Aset cetak bawaan repo (D3 §1.5) dan validasi gambar sinkron (D3 §6.4). Hanya untuk server: membaca berkas dan
 * memuat pdfkit. Folder src/aset-cetak ikut .next/standalone lewat outputFileTracingIncludes di next.config.ts;
 * server standalone menjalankan process.chdir ke foldernya, jadi process.cwd() menunjuk ke tempat yang benar di
 * next dev, next start standalone, dan skrip uji.
 */

/** Varian Carlito: Regular, Bold, Italic, BoldItalic. */
export type Font = "R" | "B" | "I" | "BI";

export const DIR_ASET_CETAK = path.join(process.cwd(), "src", "aset-cetak");

const BERKAS_FONT: Record<Font, string> = {
  R: "Carlito-Regular.ttf",
  B: "Carlito-Bold.ttf",
  I: "Carlito-Italic.ttf",
  BI: "Carlito-BoldItalic.ttf",
};

/** Jalur absolut berkas font Carlito. */
export function jalurFont(font: Font = "R"): string {
  return path.join(DIR_ASET_CETAK, "font", BERKAS_FONT[font]);
}

/** Slot yang tidak pernah punya aset bawaan: hanya dari unggahan privat (D3 §1.5, DESAIN.md G9). */
const SLOT_TANPA_BAWAAN: ReadonlySet<JenisAsetKop> = new Set<JenisAsetKop>([JenisAsetKop.TANDA_TANGAN, JenisAsetKop.STEMPEL]);

/** Nama berkas slot: KOP = kop.png, JUDUL_INVOICE = judul-invoice.png. */
export const namaBerkasSlot = (slot: JenisAsetKop) => `${slot.toLowerCase().replace(/_/g, "-")}.png`;

/** Folder gaya: DPRO = dpro. */
export const folderGaya = (gaya: GayaEntitas) => gaya.toLowerCase();

const cacheBawaan = new Map<string, Uint8Array | null>();

/**
 * Gambar bawaan repo untuk gaya entitas dan slot, atau null bila tidak ada (mis. Bonanova tanpa kop, atau slot
 * tanda tangan dan stempel). Gaya dan slot dicocokkan dengan enum, jadi masukan dari URL tidak bisa keluar folder.
 * Hasil disimpan di memori: objek yang sama dipakai ulang, sehingga kanvas menanam gambarnya sekali per PDF.
 */
export function asetBawaan(gaya: GayaEntitas, slot: JenisAsetKop): Uint8Array | null {
  if (!Object.values(GayaEntitas).includes(gaya) || !Object.values(JenisAsetKop).includes(slot) || SLOT_TANPA_BAWAAN.has(slot)) return null;
  const jalur = path.join(DIR_ASET_CETAK, folderGaya(gaya), namaBerkasSlot(slot));
  if (cacheBawaan.has(jalur)) return cacheBawaan.get(jalur)!;
  let isi: Uint8Array | null = null;
  try {
    isi = new Uint8Array(fs.readFileSync(jalur));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  cacheBawaan.set(jalur, isi);
  return isi;
}

// ---------- Validasi gambar sinkron (D3 §6.4) ----------

export const PESAN_GAMBAR_TIDAK_SAH = "Gambar tidak bisa dipakai di PDF, simpan ulang sebagai PNG atau JPEG standar";
export const SISI_GAMBAR_MIN = 16;
export const SISI_GAMBAR_MAKS = 8000;

export type InfoGambar = { tipe: "image/png" | "image/jpeg"; lebarPx: number; tinggiPx: number };

class GambarTidakSah extends Error {}

const TANDA_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

let tabelCrc: Uint32Array | null = null;
/** CRC-32 PNG (polinom 0xEDB88320). Ditulis sendiri supaya tidak bergantung pada zlib.crc32 (Node 22.2+). */
function crc32(data: Uint8Array, awal: number, akhir: number): number {
  if (!tabelCrc) {
    tabelCrc = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      tabelCrc[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = awal; i < akhir; i++) c = tabelCrc[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const u32 = (d: Uint8Array, i: number) => ((d[i] << 24) | (d[i + 1] << 16) | (d[i + 2] << 8) | d[i + 3]) >>> 0;
const u16 = (d: Uint8Array, i: number) => (d[i] << 8) | d[i + 1];

const KANAL_PNG: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const KEDALAMAN_SAH: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
// Adam7: [xMulai, yMulai, xLangkah, yLangkah]
const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
];

/**
 * Memeriksa PNG tanpa melempar dari callback asinkron: tanda tangan, rantai chunk dan CRC, IHDR, PLTE untuk palet,
 * inflate IDAT sinkron, panjang data per baris (termasuk Adam7), dan byte filter 0-4 di awal setiap baris. png-js
 * mendekode piksel di callback zlib dan melempar di sana, sehingga galat yang lolos pemeriksaan ini mematikan proses.
 */
function periksaPng(d: Uint8Array): { lebar: number; tinggi: number } {
  if (d.length < 8 || TANDA_PNG.some((b, i) => d[i] !== b)) throw new GambarTidakSah("tanda tangan PNG");
  let i = 8;
  let ihdr: { lebar: number; tinggi: number; kedalaman: number; warna: number; interlace: number } | null = null;
  let adaPlte = false;
  let adaIend = false;
  const idat: Uint8Array[] = [];
  while (i < d.length) {
    if (i + 12 > d.length) throw new GambarTidakSah("chunk terpotong");
    const panjang = u32(d, i);
    const jenis = String.fromCharCode(d[i + 4], d[i + 5], d[i + 6], d[i + 7]);
    const awalIsi = i + 8;
    const akhirIsi = awalIsi + panjang;
    if (panjang > 0x7fffffff || akhirIsi + 4 > d.length) throw new GambarTidakSah("chunk terpotong");
    if (crc32(d, i + 4, akhirIsi) !== u32(d, akhirIsi)) throw new GambarTidakSah(`CRC ${jenis}`);
    if (!ihdr && jenis !== "IHDR") throw new GambarTidakSah("IHDR bukan chunk pertama");
    if (jenis === "IHDR") {
      if (ihdr || panjang !== 13) throw new GambarTidakSah("IHDR");
      ihdr = { lebar: u32(d, awalIsi), tinggi: u32(d, awalIsi + 4), kedalaman: d[awalIsi + 8], warna: d[awalIsi + 9], interlace: d[awalIsi + 12] };
      if (!(ihdr.warna in KANAL_PNG) || !KEDALAMAN_SAH[ihdr.warna].includes(ihdr.kedalaman)) throw new GambarTidakSah("tipe warna atau kedalaman");
      if (d[awalIsi + 10] !== 0 || d[awalIsi + 11] !== 0 || ihdr.interlace > 1) throw new GambarTidakSah("kompresi, filter, atau interlace");
    } else if (jenis === "PLTE") {
      adaPlte = true;
    } else if (jenis === "IDAT") {
      idat.push(d.subarray(awalIsi, akhirIsi));
    } else if (jenis === "IEND") {
      adaIend = true;
      break;
    }
    i = akhirIsi + 4;
  }
  if (!ihdr || !adaIend || idat.length === 0) throw new GambarTidakSah("IHDR, IDAT, atau IEND tidak ada");
  if (ihdr.warna === 3 && !adaPlte) throw new GambarTidakSah("PLTE tidak ada");
  const { lebar, tinggi, kedalaman, warna, interlace } = ihdr;
  if (lebar < SISI_GAMBAR_MIN || tinggi < SISI_GAMBAR_MIN || lebar > SISI_GAMBAR_MAKS || tinggi > SISI_GAMBAR_MAKS) throw new GambarTidakSah("ukuran sisi");

  const gabungan = new Uint8Array(idat.reduce((n, b) => n + b.length, 0));
  let p = 0;
  for (const b of idat) {
    gabungan.set(b, p);
    p += b.length;
  }
  const bitPiksel = KANAL_PNG[warna] * kedalaman;
  const lintasan = interlace ? ADAM7 : [[0, 0, 1, 1]];
  const ukuranLintasan = lintasan
    .map(([x0, y0, dx, dy]) => ({ w: Math.ceil((lebar - x0) / dx), h: Math.ceil((tinggi - y0) / dy) }))
    .filter((l) => l.w > 0 && l.h > 0)
    .map((l) => ({ ...l, bytesBaris: 1 + Math.ceil((l.w * bitPiksel) / 8) }));
  const harapan = ukuranLintasan.reduce((n, l) => n + l.h * l.bytesBaris, 0);
  let mentah: Buffer;
  try {
    mentah = zlib.inflateSync(gabungan, { maxOutputLength: harapan + 1 });
  } catch {
    throw new GambarTidakSah("IDAT tidak bisa di-inflate");
  }
  if (mentah.length !== harapan) throw new GambarTidakSah("panjang data piksel");
  let pos = 0;
  for (const l of ukuranLintasan) {
    for (let r = 0; r < l.h; r++) {
      if (mentah[pos] > 4) throw new GambarTidakSah("byte filter");
      pos += l.bytesBaris;
    }
  }
  return { lebar, tinggi };
}

/** JPEG: FF D8 di awal, segmen sampai SOF (C0-CF kecuali C4, C8, CC) untuk lebar dan tinggi, dan FF D9 ada. */
function periksaJpeg(d: Uint8Array): { lebar: number; tinggi: number } {
  if (d.length < 4 || d[0] !== 0xff || d[1] !== 0xd8) throw new GambarTidakSah("tanda tangan JPEG");
  let i = 2;
  let sof: { lebar: number; tinggi: number } | null = null;
  while (i < d.length && !sof) {
    if (d[i] !== 0xff) throw new GambarTidakSah("penanda JPEG");
    while (i < d.length && d[i] === 0xff) i++;
    if (i >= d.length) break;
    const penanda = d[i++];
    if (penanda === 0xd8 || penanda === 0x01 || (penanda >= 0xd0 && penanda <= 0xd7)) continue;
    if (penanda === 0xd9 || penanda === 0xda) break;
    if (i + 2 > d.length) throw new GambarTidakSah("segmen JPEG terpotong");
    const panjang = u16(d, i);
    if (panjang < 2 || i + panjang > d.length) throw new GambarTidakSah("segmen JPEG terpotong");
    if (penanda >= 0xc0 && penanda <= 0xcf && penanda !== 0xc4 && penanda !== 0xc8 && penanda !== 0xcc) {
      if (panjang < 8) throw new GambarTidakSah("SOF");
      sof = { tinggi: u16(d, i + 3), lebar: u16(d, i + 5) };
    }
    i += panjang;
  }
  if (!sof) throw new GambarTidakSah("SOF tidak ada");
  let akhir = false;
  for (let j = d.length - 2; j >= i && !akhir; j--) akhir = d[j] === 0xff && d[j + 1] === 0xd9;
  if (!akhir) throw new GambarTidakSah("EOI tidak ada");
  if (sof.lebar < SISI_GAMBAR_MIN || sof.tinggi < SISI_GAMBAR_MIN || sof.lebar > SISI_GAMBAR_MAKS || sof.tinggi > SISI_GAMBAR_MAKS) throw new GambarTidakSah("ukuran sisi");
  return sof;
}

/**
 * Validasi gambar yang akan digambar pdfkit, seluruhnya sinkron sehingga semua galat bisa ditangkap (D3 §6.4).
 * JANGAN memvalidasi dengan menggambar di PDF uji: PNG rusak melempar dari callback zlib png-js dan mematikan proses.
 * Galat apa pun menjadi Error dengan PESAN_GAMBAR_TIDAK_SAH; alasan teknisnya ada di `cause`.
 */
export function periksaGambar(isi: Uint8Array): InfoGambar {
  try {
    const png = isi.length >= 8 && isi[0] === 0x89;
    const { lebar, tinggi } = png ? periksaPng(isi) : periksaJpeg(isi);
    // pemeriksaan akhir: pdfkit mengenali formatnya (sinkron; GIF, WebP, SVG ditolak di sini)
    const uji = new PDFDocument({ autoFirstPage: false, font: jalurFont("R") }) as PDFKit.PDFDocument & { openImage(src: Buffer): unknown };
    uji.openImage(Buffer.from(isi.buffer, isi.byteOffset, isi.byteLength));
    return { tipe: png ? "image/png" : "image/jpeg", lebarPx: lebar, tinggiPx: tinggi };
  } catch (e) {
    throw new Error(PESAN_GAMBAR_TIDAK_SAH, { cause: e });
  }
}
