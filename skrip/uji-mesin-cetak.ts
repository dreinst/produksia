import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import nextConfig from "../next.config";
import { GayaEntitas, JenisAsetKop } from "../src/prisma-klien/enums";
import { DIR_ASET_CETAK, PESAN_GAMBAR_FORMAT, PESAN_GAMBAR_TERLALU_BESAR, PESAN_GAMBAR_TIDAK_SAH, asetBawaan, jalurFont, namaBerkasSlot, periksaGambar } from "../src/lib/cetak/aset";
import { GalatIsiTerlaluTinggi, KERTAS, KanvasCetak, SKALA_KERTAS, buatPerekam, type Kertas, type Perekam } from "../src/lib/cetak/mesin/kanvas";
import { gambarTabel, type BarisTabel } from "../src/lib/cetak/mesin/tabel";
import { harusDitolak, pastikan } from "./bantuan";

/*
 * Uji mesin PDF dasar (P09, D3 §1.4, §1.5, §3.10, §6.4): aset bawaan dan larangan TTD/cap/KTP/NPWP, checksum font,
 * konfigurasi Next, validasi gambar sinkron (PNG rusak ditolak tanpa mematikan proses), KanvasCetak A4/A5/A5L,
 * teks Carlito tertanam, pemecah baris, gambar ditanam sekali, lapisan dan stempel, serta gambarTabel dengan kepala
 * berulang dan baris yang tidak terpotong. Tidak menyentuh basis data.
 */

const latin1 = (b: Uint8Array) => Buffer.from(b).toString("latin1");
const mediaBox = (pdf: Uint8Array) => [...latin1(pdf).matchAll(/\/MediaBox \[([^\]]+)\]/g)].map((m) => m[1].trim().split(/\s+/).map(Number));
const jumlahGambar = (pdf: Uint8Array) => (latin1(pdf).match(/\/Subtype \/Image/g) ?? []).length;
const dekat = (a: number, b: number, toleransi = 0.01) => Math.abs(a - b) <= toleransi;

// ---------- Pembuat PNG/JPEG uji ----------

let tabel: number[] | null = null;
function crc(b: Buffer): number {
  if (!tabel) tabel = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  let c = 0xffffffff;
  for (const x of b) c = tabel[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(jenis: string, isi: Buffer, crcSalah = false): Buffer {
  const kepala = Buffer.alloc(8);
  kepala.writeUInt32BE(isi.length, 0);
  kepala.write(jenis, 4, "latin1");
  const ekor = Buffer.alloc(4);
  ekor.writeUInt32BE((crc(Buffer.concat([kepala.subarray(4), isi])) ^ (crcSalah ? 1 : 0)) >>> 0, 0);
  return Buffer.concat([kepala, isi, ekor]);
}
type OpsiPng = { lebar?: number; tinggi?: number; warna?: number; kedalaman?: number; trns?: Buffer; interlace?: boolean; idat?: Buffer; filter?: number; tanpaPlte?: boolean; crcSalah?: boolean; tanpaIend?: boolean };
function buatPng(o: OpsiPng = {}): Uint8Array {
  const w = o.lebar ?? 16;
  const h = o.tinggi ?? 16;
  const warna = o.warna ?? 6;
  const kanal = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[warna as 0 | 2 | 3 | 4 | 6];
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  const kedalaman = o.kedalaman ?? 8;
  ihdr[8] = kedalaman;
  ihdr[9] = warna;
  ihdr[12] = o.interlace ? 1 : 0;
  const lintasan = o.interlace ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] : [[0, 0, 1, 1]];
  const baris: Buffer[] = [];
  for (const [x0, y0, dx, dy] of lintasan) {
    const pw = Math.ceil((w - x0) / dx);
    const ph = Math.ceil((h - y0) / dy);
    if (pw <= 0 || ph <= 0) continue;
    for (let r = 0; r < ph; r++) {
      const b = Buffer.alloc(1 + Math.ceil((pw * kanal * kedalaman) / 8), warna === 3 ? 0 : 0x80);
      b[0] = o.filter ?? 0;
      baris.push(b);
    }
  }
  const bagian = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr)];
  if (warna === 3 && !o.tanpaPlte) bagian.push(chunk("PLTE", Buffer.from([0, 0, 0, 255, 255, 255])));
  if (o.trns) bagian.push(chunk("tRNS", o.trns));
  bagian.push(chunk("IDAT", o.idat ?? zlib.deflateSync(Buffer.concat(baris)), o.crcSalah));
  if (!o.tanpaIend) bagian.push(chunk("IEND", Buffer.alloc(0)));
  return new Uint8Array(Buffer.concat(bagian));
}
function buatJpeg(o: { lebar?: number; tinggi?: number; tanpaEoi?: boolean; sof?: number } = {}): Uint8Array {
  const sof = Buffer.from([0xff, o.sof ?? 0xc0, 0x00, 0x11, 0x08, 0, 0, 0, 0, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]);
  sof.writeUInt16BE(o.tinggi ?? 32, 5);
  sof.writeUInt16BE(o.lebar ?? 48, 7);
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  return new Uint8Array(Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xda, 0x00, 0x02, 0x00, 0x00]), o.tanpaEoi ? Buffer.alloc(0) : Buffer.from([0xff, 0xd9])]));
}

function tolakGambar(label: string, isi: Uint8Array, pesan = PESAN_GAMBAR_TIDAK_SAH) {
  try {
    periksaGambar(isi);
    pastikan(false, `${label}: LOLOS`);
  } catch (e) {
    pastikan((e as Error).message === pesan, `${label} ditolak: ${(e as Error).message}`);
  }
}

/** Kanvas satu halaman dengan area isi 15 mm di semua sisi. */
function kanvasUji(kertas: Kertas = KERTAS.A4, perekam: Perekam = buatPerekam(), lapisan?: Parameters<KanvasCetak["halamanBaru"]>[1]) {
  const k = new KanvasCetak({ judul: "Uji mesin cetak", subjek: "Uji", penulis: "skrip", perekam });
  k.aturArea({ atas: k.mm(15), bawah: k.mm(15), kiri: k.mm(15), kanan: k.mm(15) });
  k.halamanBaru(kertas, lapisan);
  return { k, perekam };
}

async function main() {
  console.log("=== 1. Aset bawaan dan larangan ===");
  const berkasAset: string[] = [];
  const jelajah = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = path.join(d, n);
      if (statSync(p).isDirectory()) jelajah(p);
      else berkasAset.push(path.relative(DIR_ASET_CETAK, p));
    }
  };
  jelajah(DIR_ASET_CETAK);
  const harapanAset = [
    "README.md",
    ...["Carlito-Regular.ttf", "Carlito-Bold.ttf", "Carlito-Italic.ttf", "Carlito-BoldItalic.ttf", "OFL.txt"].map((n) => `font/${n}`),
    ...["kop", "kaki", "watermark", "judul-invoice", "label-pembayaran", "label-salam"].map((n) => `dpro/${n}.png`),
    ...["kop", "logo", "kaki", "judul-invoice", "judul-kwitansi"].map((n) => `tapussa/${n}.png`),
    "bonanova/logo.png",
    "bonanova/watermark.png",
    "sahara/logo.png",
    ...["kop", "judul-invoice", "judul-kwitansi"].map((n) => `nawasena/${n}.png`),
  ];
  pastikan(berkasAset.length === harapanAset.length && harapanAset.every((a) => berkasAset.includes(a)), `isi src/aset-cetak sesuai D3 §1.5 (${berkasAset.length} berkas)`);
  const terlarang = berkasAset.filter((a) => /ttd|cap|ktp|npwp|tanda.?tangan|stempel/i.test(a));
  pastikan(terlarang.length === 0, `tidak ada berkas tanda tangan, cap, KTP, atau NPWP: ${terlarang.join(", ")}`);
  const sha = (n: string) => createHash("sha256").update(readFileSync(path.join(DIR_ASET_CETAK, "font", n))).digest("hex");
  const harapanSha: Record<string, string> = {
    "Carlito-Regular.ttf": "f6418f708baede9789daef5d458c0f53d2a888af9820e8062934e504fedc6595",
    "Carlito-Bold.ttf": "bb5d20f79b82599ec72983597437373a80f2d2085fa91fc144fd74e876a594db",
    "Carlito-Italic.ttf": "0b019225e58d702bfedcbd35c21696769f8ee115cb6343f84c2f240312450d1c",
    "Carlito-BoldItalic.ttf": "b32928186c119599e03ca6a1ffc680fdcb7fac95772f4b95d989cf6cd3861517",
  };
  pastikan(Object.entries(harapanSha).every(([n, h]) => sha(n) === h), "SHA-256 keempat font Carlito sama dengan tabel D3 §1.4");
  pastikan(jalurFont("BI") === path.join(process.cwd(), "src", "aset-cetak", "font", "Carlito-BoldItalic.ttf") && jalurFont() === path.join(DIR_ASET_CETAK, "font", "Carlito-Regular.ttf"), "jalurFont dari process.cwd()/src/aset-cetak");
  const ofl = readFileSync(path.join(DIR_ASET_CETAK, "font", "OFL.txt"), "utf8");
  pastikan(ofl.startsWith("Copyright 2013 The Carlito Project Authors") && ofl.includes("SIL OPEN FONT LICENSE Version 1.1") && ofl.includes("DISCLAIMER"), "OFL.txt memuat hak cipta Carlito dan teks lisensi lengkap");
  const readme = readFileSync(path.join(DIR_ASET_CETAK, "README.md"), "utf8");
  pastikan(["tanda tangan", "cap", "KTP", "NPWP"].every((t) => readme.includes(t)) && readme.includes("dpro-docgen"), "README menyebut sumber dan larangan");

  const pngAset = berkasAset.filter((a) => a.endsWith(".png"));
  for (const a of pngAset) {
    const info = periksaGambar(new Uint8Array(readFileSync(path.join(DIR_ASET_CETAK, a))));
    pastikan(info.tipe === "image/png", `${a} lolos periksaGambar (${info.lebarPx}x${info.tinggiPx})`);
  }
  const kop = asetBawaan(GayaEntitas.DPRO, JenisAsetKop.KOP);
  pastikan(kop !== null && asetBawaan(GayaEntitas.DPRO, JenisAsetKop.KOP) === kop, "asetBawaan DPRO KOP ada dan objeknya dipakai ulang");
  const infoKop = periksaGambar(kop!);
  pastikan(infoKop.lebarPx === 2480 && infoKop.tinggiPx === 415, "dpro/kop.png 2480x415");
  pastikan(asetBawaan(GayaEntitas.BONANOVA, JenisAsetKop.KOP) === null && asetBawaan(GayaEntitas.SAHARA, JenisAsetKop.WATERMARK) === null, "slot tanpa berkas: null");
  pastikan(Object.values(GayaEntitas).every((g) => asetBawaan(g, JenisAsetKop.TANDA_TANGAN) === null && asetBawaan(g, JenisAsetKop.STEMPEL) === null), "TANDA_TANGAN dan STEMPEL tidak pernah punya aset bawaan");
  pastikan(asetBawaan("../font" as GayaEntitas, JenisAsetKop.KOP) === null && asetBawaan(GayaEntitas.DPRO, "../../font/OFL" as JenisAsetKop) === null, "gaya atau slot di luar enum: null (tanpa keluar folder)");
  pastikan(namaBerkasSlot(JenisAsetKop.LABEL_PEMBAYARAN) === "label-pembayaran.png", "nama berkas slot");
  const terisi = Object.values(GayaEntitas).flatMap((g) => Object.values(JenisAsetKop).filter((s) => asetBawaan(g, s)).map((s) => `${g}/${s}`));
  pastikan(terisi.length === pngAset.length, `setiap PNG terjangkau lewat asetBawaan (${terisi.length})`);

  console.log("=== 2. Konfigurasi Next ===");
  pastikan(JSON.stringify(nextConfig.serverExternalPackages) === JSON.stringify(["pdfkit"]), "serverExternalPackages: pdfkit");
  const jejak = nextConfig.outputFileTracingIncludes ?? {};
  pastikan(["/cetak/**", "/api/cetak/**", "/penjualan/**", "/proyek/**"].every((k) => JSON.stringify(jejak[k]) === JSON.stringify(["./src/aset-cetak/**/*"])) && Object.keys(jejak).length === 4, "outputFileTracingIncludes empat prefiks ke ./src/aset-cetak/**/*");
  const kepala = await nextConfig.headers!();
  pastikan(kepala.length === 1 && kepala[0].source === "/:path*" && kepala[0].headers.some((h) => h.key === "X-Frame-Options" && h.value === "DENY"), "header keamanan global tetap (X-Frame-Options DENY)");
  pastikan(nextConfig.output === "standalone" && nextConfig.experimental?.serverActions?.bodySizeLimit === "3mb", "output standalone dan batas aksi 3mb tetap");

  console.log("=== 3. periksaGambar ===");
  const png16 = periksaGambar(buatPng());
  pastikan(png16.tipe === "image/png" && png16.lebarPx === 16 && png16.tinggiPx === 16, "PNG RGBA 16x16 lolos");
  pastikan(periksaGambar(buatPng({ warna: 2, lebar: 40, tinggi: 17 })).lebarPx === 40, "PNG RGB 40x17 lolos");
  pastikan(periksaGambar(buatPng({ interlace: true, lebar: 21, tinggi: 19 })).tinggiPx === 19, "PNG Adam7 21x19 lolos");
  pastikan(periksaGambar(buatPng({ warna: 3 })).tipe === "image/png", "PNG palet dengan PLTE lolos");
  tolakGambar("PNG IDAT rusak (CRC benar)", buatPng({ idat: Buffer.from("bukan data zlib sama sekali") }));
  tolakGambar("PNG CRC salah", buatPng({ crcSalah: true }));
  const utuh = buatPng();
  tolakGambar("PNG terpotong", utuh.subarray(0, utuh.length - 20));
  tolakGambar("PNG tanpa IEND", buatPng({ tanpaIend: true }));
  tolakGambar("PNG byte filter 7", buatPng({ filter: 7 }));
  tolakGambar("PNG data piksel kurang", buatPng({ idat: zlib.deflateSync(Buffer.alloc(100)) }));
  tolakGambar("PNG palet tanpa PLTE", buatPng({ warna: 3, tanpaPlte: true }));
  tolakGambar("PNG 8x8 (sisi < 16)", buatPng({ lebar: 8, tinggi: 8 }));
  tolakGambar("PNG 8001 px", buatPng({ lebar: 8001, tinggi: 16, idat: zlib.deflateSync(Buffer.alloc(0)) }));
  tolakGambar("GIF", new Uint8Array(Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(40, 1)])));
  tolakGambar("WebP", new Uint8Array(Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x24, 0, 0, 0]), Buffer.from("WEBPVP8 "), Buffer.alloc(32, 7)])));
  tolakGambar("kosong", new Uint8Array(0));
  tolakGambar("bait acak", new Uint8Array(Array.from({ length: 64 }, (_, i) => (i * 37) % 256)));
  const jpg = periksaGambar(buatJpeg());
  pastikan(jpg.tipe === "image/jpeg" && jpg.lebarPx === 48 && jpg.tinggiPx === 32, "JPEG SOF0 48x32 lolos");
  tolakGambar("JPEG tanpa EOI", buatJpeg({ tanpaEoi: true }));
  tolakGambar("JPEG 10x10", buatJpeg({ lebar: 10, tinggi: 10 }));
  // tinjauan P09 temuan 1: bentuk yang lolos struktur tetapi dirender salah oleh png-js/pdfkit
  tolakGambar("PNG palet 4 bit dengan tRNS", buatPng({ warna: 3, kedalaman: 4, lebar: 17, tinggi: 17, trns: Buffer.from([255, 0]) }), PESAN_GAMBAR_FORMAT);
  tolakGambar("PNG palet 2 bit Adam7", buatPng({ warna: 3, kedalaman: 2, lebar: 33, tinggi: 17, interlace: true }), PESAN_GAMBAR_FORMAT);
  tolakGambar("PNG abu-abu 1 bit Adam7", buatPng({ warna: 0, kedalaman: 1, lebar: 17, tinggi: 17, interlace: true }), PESAN_GAMBAR_FORMAT);
  tolakGambar("PNG abu-abu 4 bit tanpa tRNS", buatPng({ warna: 0, kedalaman: 4 }), PESAN_GAMBAR_FORMAT);
  tolakGambar("PNG RGBA 16 bit", buatPng({ warna: 6, kedalaman: 16 }), PESAN_GAMBAR_FORMAT);
  tolakGambar("PNG abu-abu 8 bit dengan tRNS", buatPng({ warna: 0, trns: Buffer.from([0, 0x80]) }), PESAN_GAMBAR_FORMAT);
  tolakGambar("PNG RGB 8 bit dengan tRNS", buatPng({ warna: 2, trns: Buffer.from([0, 1, 0, 2, 0, 3]) }), PESAN_GAMBAR_FORMAT);
  pastikan(periksaGambar(buatPng({ warna: 3, trns: Buffer.from([0, 255]) })).tipe === "image/png", "PNG palet 8 bit dengan tRNS lolos");
  pastikan(periksaGambar(buatPng({ warna: 4, interlace: true, lebar: 19, tinggi: 23 })).lebarPx === 19, "PNG abu-abu+alfa 8 bit Adam7 lolos");
  tolakGambar("JPEG SOF3 (lossless)", buatJpeg({ sof: 0xc3 }), PESAN_GAMBAR_FORMAT);
  tolakGambar("JPEG SOF9 (aritmetika)", buatJpeg({ sof: 0xc9 }), PESAN_GAMBAR_FORMAT);
  pastikan(periksaGambar(buatJpeg({ sof: 0xc1 })).tipe === "image/jpeg" && periksaGambar(buatJpeg({ sof: 0xc2 })).tipe === "image/jpeg", "JPEG SOF1 dan SOF2 lolos");
  // temuan 2: batas memori diperiksa sebelum inflate (IDAT kosong, jadi pesan ini hanya muncul bila batas lebih dulu)
  const kosong = zlib.deflateSync(Buffer.alloc(0));
  tolakGambar("PNG RGBA 16 bit 8000x8000", buatPng({ warna: 6, kedalaman: 16, lebar: 8000, tinggi: 8000, idat: kosong }), PESAN_GAMBAR_FORMAT);
  tolakGambar("PNG abu-abu 6000x4200 (> 25 juta piksel)", buatPng({ warna: 0, lebar: 6000, tinggi: 4200, idat: kosong }), PESAN_GAMBAR_TERLALU_BESAR);
  tolakGambar("PNG RGBA 4500x4000 (data mentah > 64 MB)", buatPng({ warna: 6, lebar: 4500, tinggi: 4000, idat: kosong }), PESAN_GAMBAR_TERLALU_BESAR);
  tolakGambar("PNG abu-abu 5000x5000 (25 juta piksel) dengan data kurang", buatPng({ warna: 0, lebar: 5000, tinggi: 5000, idat: kosong }));
  // temuan 6: hasil validasi disimpan per objek
  const sekali = buatPng();
  pastikan(periksaGambar(sekali) === periksaGambar(sekali) && periksaGambar(kop!) === infoKop, "periksaGambar menyimpan hasil per objek (aset bawaan tidak diperiksa ulang)");
  // PNG rusak yang diteruskan ke kanvas ditolak secara sinkron dan proses tetap hidup
  {
    const { k } = kanvasUji();
    await harusDitolak("kanvas.gambar dengan PNG IDAT rusak", async () => k.gambar(buatPng({ idat: Buffer.from("rusak") }), { x: 10, y: 10, w: 50 }), PESAN_GAMBAR_TIDAK_SAH);
    await harusDitolak("kanvas.gambar dengan GIF", async () => k.gambar(new Uint8Array(Buffer.from("GIF89a................................")), { x: 10, y: 10, w: 50 }), PESAN_GAMBAR_TIDAK_SAH);
    await harusDitolak("kanvas.gambar jalur di luar src/aset-cetak", async () => k.gambar("../../package.json", { x: 0, y: 0, w: 10 }), "src/aset-cetak");
    k.gambar("dpro/judul-invoice.png", { x: 10, y: 10, w: 100 }, "JUDUL_INVOICE");
    const pdf = await k.selesai();
    pastikan(latin1(pdf).startsWith("%PDF-") && jumlahGambar(pdf) >= 1, "setelah gambar rusak ditolak, PDF tetap selesai dengan gambar sah");
  }

  console.log("=== 4. Satuan ===");
  {
    const { k } = kanvasUji();
    pastikan(dekat(k.mm(210), 595.2756) && dekat(k.px(2480), k.mm(210)) && dekat(k.px(2480, SKALA_KERTAS.A5), k.mm(148), 0.05), "mm dan px (frame 2480 = 210 mm; A5 skala 1748/2480)");
    pastikan(k.ukuranHuruf(37) === 9 && k.ukuranHuruf(45) === 11 && k.ukuranHuruf(64) === 15.5 && k.ukuranHuruf(37, SKALA_KERTAS.A5) === 6.5, "ukuranHuruf: 37 px = 9 pt, 45 = 11, 64 = 15,5, A5 37 = 6,5");
    k.skala = SKALA_KERTAS.A5;
    pastikan(dekat(k.px(2480), k.mm(148), 0.05) && k.ukuranHuruf(37) === 6.5, "skala kanvas menjadi bawaan px dan ukuranHuruf");
    await k.selesai();
  }

  console.log("=== 5. Kertas A4, A5, A5 landscape dan font Carlito ===");
  const harapanKertas: [keyof typeof KERTAS, number, number][] = [
    ["A4", 595.2756, 841.8898],
    ["A5", 419.5276, 595.2756],
    ["A5_LANDSCAPE", 595.2756, 419.5276],
  ];
  for (const [nama, lebar, tinggi] of harapanKertas) {
    const { k } = kanvasUji(KERTAS[nama]);
    const a = k.areaIsi;
    k.teks("Kwitansi uji Carlito", { x: a.kiri, lebar: a.lebar, ukuran: 12 });
    k.teks([{ teks: "Tebal", tebal: true }, { teks: " miring", miring: true }, { teks: " tebal miring", tebal: true, miring: true }], { x: a.kiri, lebar: a.lebar, ukuran: 12 });
    const pdf = await k.selesai();
    const teks = latin1(pdf);
    const mb = mediaBox(pdf);
    pastikan(teks.startsWith("%PDF-") && teks.trimEnd().endsWith("%%EOF"), `${nama}: diawali %PDF- dan diakhiri %%EOF (${pdf.length} byte)`);
    pastikan(mb.length === 1 && dekat(mb[0][2], lebar) && dekat(mb[0][3], tinggi), `${nama}: MediaBox ${mb[0]?.slice(2).join(" x ")}`);
    const font = new Set([...teks.matchAll(/\/BaseFont \/[A-Z]{6}\+([A-Za-z-]+)/g)].map((m) => m[1]));
    pastikan(["Carlito-Regular", "Carlito-Bold", "Carlito-Italic", "Carlito-BoldItalic"].every((f) => font.has(f)) && !teks.includes("Helvetica"), `${nama}: font tertanam ${[...font].join(", ")}, tanpa Helvetica`);
    const objJudul = teks.match(/\/Title (\d+) 0 R/)?.[1];
    pastikan(objJudul !== undefined && teks.includes(`\n${objJudul} 0 obj\n(Uji mesin cetak)`) && /\/Lang \(id-ID\)/.test(teks), `${nama}: info judul dan bahasa id-ID`);
  }

  console.log("=== 6. Teks ===");
  {
    const { k, perekam } = kanvasUji();
    const a = k.areaIsi;
    const y0 = k.y;
    const t1 = k.teks("Tes ✓ tanda centang", { x: a.kiri, lebar: a.lebar, ukuran: 10 });
    pastikan(perekam.teks.at(-1)!.teks === "Tes ? tanda centang" && dekat(k.y, y0 + t1), "karakter tanpa glyph Carlito menjadi ?; tanpa y kursor turun setinggi teks");
    pastikan(dekat(t1, 10 * 1.2207, 0.01), `tinggi satu baris = 1,2207 x ukuran (${t1.toFixed(3)})`);
    k.teks("• ▪ \u2013 \u2014 ’ “ … × · €", { x: a.kiri, lebar: a.lebar, ukuran: 10, y: 400 });
    pastikan(perekam.teks.at(-1)!.teks === "• ▪ \u2013 \u2014 ’ “ … × · €" && dekat(k.y, y0 + t1), "glyph yang ada di Carlito tetap; dengan y kursor tidak berubah");
    const yKanan = k.teks("kanan", { x: 100, lebar: 200, ukuran: 10, rata: "kanan", y: 420 });
    const kanan = perekam.teks.at(-1)!;
    pastikan(yKanan > 0 && dekat(kanan.x + kanan.lebar, 300, 0.05), "rata kanan berakhir di x + lebar");
    k.teks("tengah", { x: 100, lebar: 200, ukuran: 10, rata: "tengah", y: 440 });
    const tengah = perekam.teks.at(-1)!;
    pastikan(dekat(tengah.x + tengah.lebar / 2, 200, 0.05), "rata tengah berpusat di tengah lebar");
    const panjang = "Bersama ini akan kami sampaikan anggaran yang diperlukan untuk acara yang saudara selenggarakan dengan rincian lengkap.";
    const u = k.ukur(panjang, { x: 0, lebar: 150, ukuran: 10 });
    const sebelum = perekam.teks.length;
    const tinggiGambar = k.teks(panjang, { x: 50, lebar: 150, ukuran: 10, rata: "rata", indenPertama: 20, y: 460 });
    const barisPanjang = perekam.teks.slice(sebelum);
    pastikan(u.jumlahBaris >= 3 && barisPanjang.every((b) => b.lebar <= 150 + 0.01), `teks panjang dibungkus ${u.jumlahBaris} baris, tiap baris tidak melebihi lebar`);
    pastikan(dekat(barisPanjang[0].x, 70) && dekat(barisPanjang[1].x, 50) && barisPanjang[0].lebar <= 130 + 0.01, "indenPertama menggeser dan mempersempit baris pertama saja");
    pastikan(dekat(tinggiGambar, barisPanjang.length * 10 * 1.2207, 0.01), "tinggi teks = jumlah baris x tinggi baris");
    const spasi13 = k.ukur(panjang, { x: 0, lebar: 150, ukuran: 10, tinggiBaris: 1.3 });
    const pasti = k.ukur(panjang, { x: 0, lebar: 150, ukuran: 10, tinggiBaris: { pasti: 20 } });
    pastikan(dekat(spasi13.tinggi, u.tinggi * 1.3, 0.01) && dekat(pasti.tinggi, pasti.jumlahBaris * 20), "tinggiBaris kelipatan 1,3 dan pasti 20 pt");
    const kataPanjang = k.ukur("Supercalifragilisticexpialidocious", { x: 0, lebar: 40, ukuran: 10 });
    pastikan(kataPanjang.jumlahBaris > 1 && kataPanjang.lebar <= 40 + 0.01, `kata lebih lebar dari kolom dipotong per huruf (${kataPanjang.jumlahBaris} baris)`);
    const paragraf = k.ukur("satu\n\ntiga", { x: 0, lebar: 200, ukuran: 10 });
    pastikan(paragraf.jumlahBaris === 3 && k.ukur("", { x: 0, lebar: 200, ukuran: 10 }).jumlahBaris === 0, "baris baru dan baris kosong dihitung; teks kosong nol baris");
    pastikan(k.ukur("satu\n \ntiga", { x: 0, lebar: 200, ukuran: 10 }).jumlahBaris === 3 && k.ukur("satu\n   \n\ntiga", { x: 0, lebar: 200, ukuran: 10 }).jumlahBaris === 4 && k.ukur("   ", { x: 0, lebar: 200, ukuran: 10 }).jumlahBaris === 0, "paragraf yang hanya berisi spasi tetap satu baris kosong; teks spasi saja nol baris");
    k.teks("judul", { x: 50, lebar: 200, ukuran: 10, hurufBesar: true, jarakHuruf: 1, y: 560 });
    const besar = perekam.teks.at(-1)!;
    pastikan(besar.teks === "JUDUL" && besar.lebar > k.ukur("JUDUL", { x: 0, lebar: 200, ukuran: 10 }).lebar, "hurufBesar dan jarakHuruf menambah lebar");
    k.teksMuat("Nama klien yang sangat panjang sekali untuk satu kotak sempit", { x: 50, y: 600, w: 120, h: 14 }, { x: 0, lebar: 0, ukuran: 12, ukuranMin: 8, baris: 1 });
    const muat = perekam.teks.at(-1)!;
    pastikan(muat.ukuran === 8 && muat.teks.endsWith("…") && muat.lebar <= 120 + 0.01 && perekam.peringatan.some((p) => p.startsWith("Teks dipotong")), "teksMuat mengecil sampai ukuranMin lalu memotong dengan … dan mencatat peringatan");
    k.teksMuat("Pendek", { x: 50, y: 620, w: 120, h: 16 }, { x: 0, lebar: 0, ukuran: 12, ukuranMin: 8, baris: 1 });
    pastikan(perekam.teks.at(-1)!.ukuran === 12, "teksMuat tidak mengecilkan teks yang sudah muat");
    const yButir = k.y;
    const tb = k.teksBerbutir(
      [
        { jenis: "paragraf", isi: [{ teks: "Sound system", tebal: true }] },
        { jenis: "butir", isi: [{ teks: "Speaker aktif", tebal: false }] },
        { jenis: "subbutir", isi: [{ teks: "operator ", tebal: false }, { teks: "2 orang", tebal: true }] },
      ],
      { x: 50, lebar: 300, ukuran: 10 },
    );
    const penanda = perekam.teks.filter((t) => t.teks === "•" || t.teks === "▪");
    pastikan(penanda.length === 2 && dekat(tb, 3 * 10 * 1.2207, 0.01) && dekat(k.y, yButir + tb), "teks berbutir: penanda • dan ▪, tiga baris, kursor turun");
    const isiButir = perekam.teks.find((t) => t.teks === "Speaker aktif")!;
    const isiSub = perekam.teks.find((t) => t.teks === "operator 2 orang")!;
    pastikan(dekat(isiButir.x, 50 + k.mm(3)) && dekat(isiSub.x, 50 + k.mm(8)), "inden butir 3 mm dan sub-butir 8 mm");
    k.teks("garis bawah", { x: 50, lebar: 200, ukuran: 10, garisBawah: true, y: 700 });
    await k.selesai();
  }

  console.log("=== 7. Halaman, lapisan, stempel, gambar ===");
  {
    const perekam = buatPerekam();
    const panggilBelakang: number[] = [];
    const panggilDepan: [number, number][] = [];
    const wm = asetBawaan(GayaEntitas.DPRO, JenisAsetKop.WATERMARK)!;
    const { k } = kanvasUji(KERTAS.A5, perekam, {
      belakang: (kk) => {
        panggilBelakang.push(kk.halamanKe);
        kk.gambar(wm, { x: 20, y: 60, w: 300 }, "WATERMARK");
      },
      depan: (kk, ke, dari) => {
        panggilDepan.push([ke, dari]);
        kk.gambar(kop!, { x: 0, y: 0, w: kk.lebarKertas }, "KOP");
      },
    });
    const halamanKe = () => k.halamanKe;
    pastikan(!k.pastikanRuang(10) && halamanKe() === 1, "pastikanRuang: masih muat, tidak pindah halaman");
    k.y = k.tinggiKertas - k.mm(20);
    pastikan(k.pastikanRuang(k.mm(10)) && halamanKe() === 2 && dekat(k.y, k.mm(15)), "pastikanRuang: pindah halaman, kursor ke atas area");
    pastikan(!k.pastikanRuang(k.tinggiKertas * 2) && halamanKe() === 2 && perekam.peringatan.some((p) => p.includes("lebih tinggi dari area")), "halaman kosong tidak ditambah lagi untuk isi lebih tinggi dari satu halaman (peringatan)");
    let ketat: unknown = null;
    try {
      k.pastikanRuang(k.tinggiKertas * 2, { ketat: true });
    } catch (e) {
      ketat = e;
    }
    pastikan(ketat instanceof GalatIsiTerlaluTinggi && halamanKe() === 2, "pastikanRuang ketat di halaman kosong melempar GalatIsiTerlaluTinggi");
    k.y = k.tinggiKertas;
    k.pastikanRuang(1);
    k.stempelStatus("DRAF");
    const pdf = await k.selesai();
    pastikan(perekam.halaman === 3 && mediaBox(pdf).length === 3, "tiga halaman A5");
    pastikan(panggilBelakang.join(",") === "1,2,3" && JSON.stringify(panggilDepan) === JSON.stringify([[1, 3], [2, 3], [3, 3]]), "lapisan belakang saat halaman dibuat, depan saat selesai dengan (ke, dari)");
    const draf = perekam.teks.filter((t) => t.teks === "DRAF");
    pastikan(draf.length === 3 && draf.every((t) => t.ukuran === 72 * (1748 / 2480)) && draf.map((t) => t.halaman).join(",") === "1,2,3", "stempel DRAF di setiap halaman, 72 pt x 0,7048 untuk A5");
    pastikan(perekam.gambar.filter((g) => g.slot === "KOP").length === 3 && perekam.gambar.filter((g) => g.slot === "WATERMARK").length === 3, "kop dan watermark tercatat di tiap halaman");
    const satu = kanvasUji(KERTAS.A5).k;
    satu.gambar(wm, { x: 20, y: 60, w: 300 });
    satu.gambar(kop!, { x: 0, y: 0, w: satu.lebarKertas });
    pastikan(jumlahGambar(pdf) === jumlahGambar(await satu.selesai()), `gambar yang sama ditanam sekali per PDF (${jumlahGambar(pdf)} objek gambar untuk 3 halaman)`);
    await harusDitolak("selesai dua kali", () => k.selesai(), "sudah selesai");
    await harusDitolak("selesai tanpa halaman", () => new KanvasCetak({ judul: "x", subjek: "x", penulis: "x" }).selesai(), "tanpa halaman");
    const ukur = kanvasUji();
    const r = ukur.k.gambar(kop!, { x: 10, y: 10, w: 248 });
    const m = ukur.k.gambar(kop!, { x: 10, y: 100, muat: [100, 100], rata: "kanan" });
    pastikan(dekat(r.h, 248 * (415 / 2480)) && dekat(m.w, 100) && dekat(ukur.perekam.gambar[1].y, 100 + (100 - m.h) / 2), "gambar: rasio dijaga untuk w saja; muat menempatkan di tengah kotak");
    await ukur.k.selesai();
  }

  console.log("=== 8. gambarTabel ===");
  {
    const { k, perekam } = kanvasUji();
    const a = k.areaIsi;
    const kolom = [k.px(170), k.px(1334), k.px(454)];
    const sel = (isi: string, lain: object = {}) => ({ isi, ukuran: 9, ...lain });
    const baris: BarisTabel[] = Array.from({ length: 60 }, (_, i) => ({
      tinggiMin: k.px(77),
      sel: [sel(`${i + 1}`, { rata: "tengah" }), sel(i % 9 === 4 ? `Baris-${i + 1} dengan uraian panjang yang dibungkus menjadi beberapa baris supaya tinggi barisnya berbeda dari baris lain di tabel` : `Baris-${i + 1}`), sel((1_500_000 * (i + 1)).toLocaleString("en-US"), { rpKiri: true })],
    }));
    gambarTabel(k, {
      x: a.kiri,
      kolom,
      garisBawaan: { warna: "#0B2144", tebal: 0.75 },
      zebra: "#F3F4F6",
      kepala: { tinggiMin: k.px(102), sel: ["NO.", "DESCRIPTION", "PRICE"].map((t) => sel(t, { font: "B", warna: "#FFFFFF", latar: "#CA1E1E", rata: "tengah", valign: "tengah" })) },
      baris,
      barisTotal: { latar: "#DBE4F0", garisAtas: 1.5 },
    });
    const yAkhir = k.y;
    const halamanTabel = k.halamanKe;
    await k.selesai();
    const kepalaTabel = perekam.teks.filter((t) => t.teks === "DESCRIPTION");
    pastikan(halamanTabel >= 2 && kepalaTabel.length === halamanTabel && kepalaTabel.map((t) => t.halaman).join(",") === Array.from({ length: halamanTabel }, (_, i) => i + 1).join(","), `kepala tabel diulang di ${kepalaTabel.length} halaman`);
    const batasBawah = k.tinggiKertas - k.mm(15);
    let utuh = true;
    let urut = true;
    let halamanSebelum = 1;
    for (let i = 1; i <= 60; i++) {
      const teksBaris = perekam.teks.filter((t) => t.teks.startsWith(`Baris-${i} `) || t.teks === `Baris-${i}`);
      const awal = perekam.teks.findIndex((t) => t.teks.startsWith(`Baris-${i}`) && (t.teks === `Baris-${i}` || t.teks.startsWith(`Baris-${i} `)));
      const lanjutan = perekam.teks.slice(awal, awal + 8).filter((t) => t.halaman !== perekam.teks[awal].halaman && t.x > a.kiri + kolom[0] && t.x < a.kiri + kolom[0] + kolom[1] && !t.teks.startsWith("Baris-") && t.teks !== "DESCRIPTION");
      if (teksBaris.length !== 1 || lanjutan.length || teksBaris[0].y + teksBaris[0].tinggi > batasBawah + 0.01) utuh = false;
      if (teksBaris[0] && teksBaris[0].halaman < halamanSebelum) urut = false;
      halamanSebelum = teksBaris[0]?.halaman ?? halamanSebelum;
    }
    pastikan(utuh && urut, "60 baris tampil sekali, berurutan, tidak terpotong antarhalaman, dan di atas batas bawah area");
    const barisPanjang = perekam.teks.filter((t) => t.halaman === perekam.teks.find((x) => x.teks.startsWith("Baris-5 "))!.halaman && t.x > a.kiri + kolom[0] && t.x < a.kiri + kolom[0] + kolom[1] && t.y >= perekam.teks.find((x) => x.teks.startsWith("Baris-5 "))!.y && t.y < perekam.teks.find((x) => x.teks === "Baris-6")!.y);
    pastikan(barisPanjang.length >= 2, `uraian panjang dibungkus ${barisPanjang.length} baris di sel yang sama`);
    const rp = perekam.teks.filter((t) => t.teks === "Rp");
    const angka = perekam.teks.find((t) => t.teks === "1,500,000")!;
    const xKolom3 = a.kiri + kolom[0] + kolom[1];
    pastikan(rp.length === 60 && rp.every((t) => dekat(t.x, xKolom3 + 3)) && dekat(angka.x + angka.lebar, xKolom3 + kolom[2] - 3, 0.05), "sel rpKiri: Rp rata kiri, angka rata kanan (pad 3 pt)");
    const terakhir = perekam.teks.find((t) => t.teks === "Baris-60")!;
    pastikan(yAkhir > terakhir.y && yAkhir <= batasBawah + 0.01, "kursor di bawah tabel setelah selesai");
  }
  {
    // kepala tidak sendirian di dasar halaman
    const { k, perekam } = kanvasUji();
    k.y = k.tinggiKertas - k.mm(15) - 25;
    gambarTabel(k, { x: k.mm(15), kolom: [100, 200], kepala: { sel: [{ isi: "KEPALA", ukuran: 10 }, { isi: "B", ukuran: 10 }], tinggiMin: 20 }, baris: [{ sel: [{ isi: "isi-1", ukuran: 10 }, { isi: "x", ukuran: 10 }], tinggiMin: 20 }] });
    await k.selesai();
    const kp = perekam.teks.find((t) => t.teks === "KEPALA")!;
    const isi = perekam.teks.find((t) => t.teks === "isi-1")!;
    pastikan(kp.halaman === 2 && isi.halaman === 2 && perekam.teks.filter((t) => t.teks === "KEPALA").length === 1, "kepala dan baris pertama pindah bersama ke halaman berikutnya");
  }
  {
    const { k } = kanvasUji();
    await harusDitolak("span melebihi kolom", async () => gambarTabel(k, { x: 0, kolom: [50, 50], baris: [{ sel: [{ isi: "a", ukuran: 9, span: 3 }] }] }), "melebihi 2 kolom");
    await harusDitolak("baris kurang kolom", async () => gambarTabel(k, { x: 0, kolom: [50, 50], baris: [{ sel: [{ isi: "a", ukuran: 9 }] }] }), "mengisi 1 dari 2 kolom");
    gambarTabel(k, { x: k.mm(15), kolom: [50, 50, 50], baris: [{ sel: [{ isi: "gabung", ukuran: 9, span: 2, garis: null }, { isi: "c", ukuran: 9 }], tinggiPasti: 30 }] });
    pastikan(dekat(k.y, k.mm(15) + 30), "tinggiPasti dipakai apa adanya; span 2 kolom sah");
    await k.selesai();
  }

  {
    // tinjauan P09 temuan 3: baris lebih tinggi dari satu halaman dipecah per baris teks
    const { k, perekam } = kanvasUji(KERTAS.A5_LANDSCAPE);
    const a = k.areaIsi;
    const batasBawah = k.tinggiKertas - k.mm(15);
    const uraian = Array.from({ length: 70 }, (_, i) => `uraian-${i + 1}`).join("\n");
    const butir = Array.from({ length: 40 }, (_, i) => ({ jenis: (i % 2 ? "butir" : "subbutir") as "butir" | "subbutir", isi: [{ teks: `butir-${i + 1}`, tebal: false }] }));
    k.y = a.atas + 100;
    gambarTabel(k, {
      x: a.kiri,
      kolom: [40, 200, 200, 100],
      garisBawaan: { warna: "#000000", tebal: 0.5 },
      kepala: { sel: ["NO", "URAIAN", "BUTIR", "HARGA"].map((t) => ({ isi: t, ukuran: 9, font: "B" as const })) },
      baris: [
        { sel: [{ isi: "1", ukuran: 9 }, { isi: "pendek-awal", ukuran: 9 }, { isi: "", ukuran: 9 }, { isi: "1,000", ukuran: 9, rpKiri: true }] },
        { sel: [{ isi: "2", ukuran: 9, valign: "tengah" }, { isi: uraian, ukuran: 9 }, { isi: butir, ukuran: 9 }, { isi: "2,000", ukuran: 9, rpKiri: true }] },
        { sel: [{ isi: "3", ukuran: 9 }, { isi: "pendek-akhir", ukuran: 9 }, { isi: "", ukuran: 9 }, { isi: "3,000", ukuran: 9, rpKiri: true }] },
      ],
      barisTotal: { latar: "#DBE4F0", garisAtas: 1 },
    });
    const yAkhir = k.y;
    const halamanAkhir = k.halamanKe;
    await k.selesai();
    const urutan = (awalan: string, n: number) => Array.from({ length: n }, (_, i) => perekam.teks.filter((t) => t.teks === `${awalan}-${i + 1}`));
    const barisUraian = urutan("uraian", 70);
    const barisButir = urutan("butir", 40);
    const semua = [...barisUraian, ...barisButir];
    pastikan(semua.every((t) => t.length === 1) && semua.every(([t]) => t.y + t.tinggi <= batasBawah + 0.01), "70 baris uraian dan 40 butir tampil sekali dan tidak melewati batas bawah area");
    const naik = (d: typeof barisUraian) => d.every(([t], i) => i === 0 || t.halaman > d[i - 1][0].halaman || (t.halaman === d[i - 1][0].halaman && t.y > d[i - 1][0].y));
    pastikan(naik(barisUraian) && naik(barisButir) && halamanAkhir >= 3 && barisUraian[0][0].halaman === 1, `baris dipecah berurutan mulai di sisa halaman pertama sampai halaman ${halamanAkhir}`);
    const kepalaUlang = perekam.teks.filter((t) => t.teks === "URAIAN").map((t) => t.halaman);
    pastikan(kepalaUlang.join(",") === Array.from({ length: halamanAkhir }, (_, i) => i + 1).join(","), "kepala diulang di setiap halaman lanjutan");
    const penandaButir = perekam.teks.filter((t) => t.teks === "•" || t.teks === "▪");
    const rp = perekam.teks.filter((t) => t.teks === "Rp");
    pastikan(penandaButir.length === 40 && rp.length === 3 && perekam.teks.filter((t) => t.teks === "2,000").length === 1, "penanda butir dan Rp hanya digambar sekali per baris teks");
    const akhir = perekam.teks.find((t) => t.teks === "pendek-akhir")!;
    pastikan(akhir.halaman === halamanAkhir && yAkhir > akhir.y && yAkhir <= batasBawah + 0.01 && perekam.peringatan.some((p) => p.startsWith("Baris tabel lebih tinggi")), "baris sesudahnya mengikuti potongan terakhir dan peringatan pecah dicatat");
  }
  {
    // satu baris teks yang lebih tinggi dari halaman kosong tidak bisa dipecah
    const { k } = kanvasUji(KERTAS.A5_LANDSCAPE);
    let galat: unknown = null;
    try {
      gambarTabel(k, { x: k.mm(15), kolom: [100, 100], baris: [{ sel: [{ isi: "a\nb", ukuran: 9, tinggiBaris: { pasti: 500 } }, { isi: "c", ukuran: 9 }] }] });
    } catch (e) {
      galat = e;
    }
    pastikan(galat instanceof GalatIsiTerlaluTinggi && (galat as Error).message.includes("Perpendek"), "baris teks lebih tinggi dari halaman kosong: GalatIsiTerlaluTinggi dengan pesan yang bisa dibaca");
    await k.selesai();
  }

  console.log("=== 9. Impor ===");
  const sumberKlien = ["src/lib/cetak/tipe.ts", "src/lib/cetak/format.ts", "src/lib/cetak/terbilang.ts"].map((f) => readFileSync(f, "utf8"));
  pastikan(sumberKlien.every((s) => !s.includes("pdfkit") && !s.includes("@/lib/cetak/aset") && !s.includes("@/lib/cetak/mesin")), "berkas cetak yang aman untuk klien tidak mengimpor pdfkit, aset, atau mesin");
  const sumberMesin = ["src/lib/cetak/aset.ts", "src/lib/cetak/mesin/kanvas.ts", "src/lib/cetak/mesin/tabel.ts"].map((f) => readFileSync(f, "utf8"));
  pastikan(sumberMesin.every((s) => !s.includes('"use client"') && !s.includes("@/lib/db")), "mesin tidak memakai basis data dan bukan komponen klien");

  console.log("=== DONE, all mesin-cetak checks passed ===");
}

main().catch((galat) => {
  console.error(galat);
  process.exit(1);
});
