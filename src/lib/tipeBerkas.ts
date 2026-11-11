/*
 * Jenis berkas yang diterima, nama tampil, dan kepala Content-Disposition (D7 §3.3.2, §3.3.3, §3.3.10).
 * Murni (tanpa basis data), jadi boleh dipakai komponen klien. Tipe selalu ditentukan dari magic bytes yang
 * harus cocok dengan keluarga ekstensinya; File.type dari klien tidak pernah dipercaya.
 */

/** Keluarga tampilan berkas (ikon di halaman Berkas). */
export type KeluargaBerkas = "gambar" | "pdf" | "lembar" | "video" | "arsip" | "lain";

export type HasilDeteksiTipe =
  | { ok: true; ekstensi: string; tipeMime: string; keluarga: KeluargaBerkas; inline: boolean }
  | { ok: false; galat: string };

type AturanTipe = { tipeMime: string; keluarga: KeluargaBerkas; inline: boolean; cocok: (isi: Uint8Array) => boolean };

const awalan = (isi: Uint8Array, byte: readonly number[], mulai = 0) => isi.length >= mulai + byte.length && byte.every((b, i) => isi[mulai + i] === b);
const ascii = (teks: string) => [...teks].map((c) => c.charCodeAt(0));
const teksPada = (isi: Uint8Array, teks: string, mulai = 0) => awalan(isi, ascii(teks), mulai);

const JPEG = (isi: Uint8Array) => awalan(isi, [0xff, 0xd8, 0xff]);
const PNG = (isi: Uint8Array) => awalan(isi, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP = (isi: Uint8Array) => teksPada(isi, "RIFF") && teksPada(isi, "WEBP", 8);
const GIF = (isi: Uint8Array) => teksPada(isi, "GIF87a") || teksPada(isi, "GIF89a");
const PDF = (isi: Uint8Array) => teksPada(isi, "%PDF-");
const ZIP_LOKAL = (isi: Uint8Array) => awalan(isi, [0x50, 0x4b, 0x03, 0x04]);
const ZIP = (isi: Uint8Array) => ZIP_LOKAL(isi) || awalan(isi, [0x50, 0x4b, 0x05, 0x06]);
const OLE = (isi: Uint8Array) => awalan(isi, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const FTYP = (isi: Uint8Array) => teksPada(isi, "ftyp", 4);
const MEREK_HEIC = ["heic", "heix", "hevc", "hevx", "mif1", "msf1", "heif"];
const HEIC = (isi: Uint8Array) => FTYP(isi) && MEREK_HEIC.some((m) => teksPada(isi, m, 8));
const PSD = (isi: Uint8Array) => teksPada(isi, "8BPS");

/** Teks: tanpa byte 00 di 8 KB pertama dan seluruh isi UTF-8 sah. */
function TEKS(isi: Uint8Array): boolean {
  if (isi.subarray(0, 8192).includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(isi);
    return true;
  } catch {
    return false;
  }
}

const OOXML = "application/vnd.openxmlformats-officedocument";
const ATURAN: Record<string, AturanTipe> = {
  jpg: { tipeMime: "image/jpeg", keluarga: "gambar", inline: true, cocok: JPEG },
  jpeg: { tipeMime: "image/jpeg", keluarga: "gambar", inline: true, cocok: JPEG },
  png: { tipeMime: "image/png", keluarga: "gambar", inline: true, cocok: PNG },
  webp: { tipeMime: "image/webp", keluarga: "gambar", inline: true, cocok: WEBP },
  gif: { tipeMime: "image/gif", keluarga: "gambar", inline: true, cocok: GIF },
  pdf: { tipeMime: "application/pdf", keluarga: "pdf", inline: true, cocok: PDF },
  docx: { tipeMime: `${OOXML}.wordprocessingml.document`, keluarga: "lain", inline: false, cocok: ZIP_LOKAL },
  xlsx: { tipeMime: `${OOXML}.spreadsheetml.sheet`, keluarga: "lembar", inline: false, cocok: ZIP_LOKAL },
  pptx: { tipeMime: `${OOXML}.presentationml.presentation`, keluarga: "lain", inline: false, cocok: ZIP_LOKAL },
  zip: { tipeMime: "application/zip", keluarga: "arsip", inline: false, cocok: ZIP },
  doc: { tipeMime: "application/msword", keluarga: "lain", inline: false, cocok: OLE },
  xls: { tipeMime: "application/vnd.ms-excel", keluarga: "lembar", inline: false, cocok: OLE },
  ppt: { tipeMime: "application/vnd.ms-powerpoint", keluarga: "lain", inline: false, cocok: OLE },
  mp4: { tipeMime: "video/mp4", keluarga: "video", inline: false, cocok: FTYP },
  mov: { tipeMime: "video/quicktime", keluarga: "video", inline: false, cocok: FTYP },
  heic: { tipeMime: "image/heic", keluarga: "gambar", inline: false, cocok: HEIC },
  heif: { tipeMime: "image/heif", keluarga: "gambar", inline: false, cocok: HEIC },
  psd: { tipeMime: "image/vnd.adobe.photoshop", keluarga: "lain", inline: false, cocok: PSD },
  ai: { tipeMime: "application/postscript", keluarga: "lain", inline: false, cocok: PDF },
  txt: { tipeMime: "text/plain; charset=utf-8", keluarga: "lain", inline: false, cocok: TEKS },
  csv: { tipeMime: "text/csv; charset=utf-8", keluarga: "lembar", inline: false, cocok: TEKS },
};

/** Ekstensi yang diterima (untuk atribut accept di klien; server tetap memeriksa isi). */
export const EKSTENSI_DITERIMA: readonly string[] = Object.keys(ATURAN);

/** Isi yang selalu ditolak apa pun ekstensinya: program Windows (MZ), ELF, dan skrip (#!). */
const isiBerbahaya = (isi: Uint8Array) => teksPada(isi, "MZ") || awalan(isi, [0x7f, 0x45, 0x4c, 0x46]) || teksPada(isi, "#!");

/** Ekstensi huruf kecil dari nama asli, atau "" bila tidak ada. */
export function ekstensiNama(nama: string): string {
  const dasar = nama.split(/[\\/]/).pop() ?? "";
  const titik = dasar.lastIndexOf(".");
  return titik > 0 && titik < dasar.length - 1 ? dasar.slice(titik + 1).toLowerCase() : "";
}

/** Deteksi tipe dari magic bytes (D7 §3.3.2). Ekstensi di luar tabel, isi yang tidak cocok, dan nama tanpa ekstensi ditolak. */
export function deteksiTipe(isi: Uint8Array, namaAsli: string): HasilDeteksiTipe {
  const ekstensi = ekstensiNama(namaAsli);
  if (!ekstensi) return { ok: false, galat: "Berkas wajib punya ekstensi (mis. .pdf, .jpg)" };
  const aturan = ATURAN[ekstensi];
  if (!aturan) return { ok: false, galat: `Jenis berkas .${ekstensi} tidak didukung` };
  if (isiBerbahaya(isi) || !aturan.cocok(isi)) return { ok: false, galat: `Isi berkas tidak cocok dengan ekstensi .${ekstensi}` };
  return { ok: true, ekstensi, tipeMime: aturan.tipeMime, keluarga: aturan.keluarga, inline: aturan.inline };
}

/** Keluarga tampilan dari tipeMime tersimpan. */
export function keluargaDariMime(tipeMime: string): KeluargaBerkas {
  for (const a of Object.values(ATURAN)) if (a.tipeMime === tipeMime) return a.keluarga;
  return "lain";
}

/** Benar bila berkas bertipe ini disajikan inline (gambar raster dan PDF). */
export function disajikanInline(tipeMime: string): boolean {
  return Object.values(ATURAN).some((a) => a.tipeMime === tipeMime && a.inline);
}

export const PANJANG_NAMA_BERKAS = 200;

/**
 * Nama tampil yang aman (D7 §3.3.3): NFC, tanpa karakter kendali dan / \ : * ? " < > |, spasi rapi, tanpa titik/spasi
 * di tepi, ekstensi hasil deteksi selalu di akhir (tidak ganda), total paling panjang 200 karakter.
 */
export function bersihkanNamaBerkas(nama: string, ekstensi: string): string {
  const ext = ekstensi.toLowerCase();
  let dasar = nama
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[/\\:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s.]+|[\s.]+$/g, "");
  if (dasar.toLowerCase().endsWith(`.${ext}`)) dasar = dasar.slice(0, -(ext.length + 1)).replace(/[\s.]+$/g, "");
  const ruang = PANJANG_NAMA_BERKAS - (ext.length + 1);
  if (dasar.length > ruang) dasar = dasar.slice(0, ruang).replace(/[\s.]+$/g, "");
  return `${dasar || "berkas"}.${ext}`;
}

/** Kepala Content-Disposition RFC 5987: filename ASCII aman dan filename* UTF-8. */
export function kepalaDisposisi(jenis: "inline" | "attachment", nama: string): string {
  const amanAscii = nama.replace(/[^\x20-\x7e]|["\\]/g, "_");
  // encodeURIComponent membiarkan ' ( ) * ! yang bukan attr-char RFC 5987, jadi ikut disandikan
  const tersandi = encodeURIComponent(nama).replace(/['()*!]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${jenis}; filename="${amanAscii}"; filename*=UTF-8''${tersandi}`;
}
