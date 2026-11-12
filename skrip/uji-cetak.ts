import "dotenv/config";
// Skrip ini memanggil pustaka di luar siklus HTTP; buka pintu uji (lihat penggunaSaatIni di src/lib/otentikasi.ts)
process.env.UJI_TANPA_SESI = "1";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { db } from "../src/lib/db";
import { penggunaSaatIni } from "../src/lib/otentikasi";
import { punyaHak, type PenggunaSesi } from "../src/lib/hakAkses";
import { asetBawaan, PESAN_GAMBAR_TIDAK_SAH } from "../src/lib/cetak/aset";
import { DATA_CONTOH, IDENTITAS_CONTOH, WARNA_CONTOH, type NamaContoh } from "../src/lib/cetak/contoh";
import { GalatCetak, bacaOpsiCetak, renderPdfDokumenPenjualan } from "../src/lib/cetak";
import {
  PESAN_ASET_DIMENSI,
  PESAN_ASET_FORMAT,
  PESAN_ASET_KOSONG,
  PESAN_ASET_TERLALU_BESAR,
  PESAN_KOP_BUKAN_MILIK,
  PRESET_KOP,
  TATA_LETAK_SAH,
  UKURAN_SAH,
  galatTemplate,
  identitasCetak,
  kopPolos,
  periksaAsetKop,
  pilihKopDanTemplate,
  temaKop,
} from "../src/lib/cetak/kop";
import { KanvasCetak, buatPerekam, type OpsiTeks, type Perekam } from "../src/lib/cetak/mesin/kanvas";
import { isiSlotBaris, pecahBaris, petaAsetBawaan, type MasukanTataLetak } from "../src/lib/cetak/tataLetak/blok";
import { MAKS_BARIS_ALAMAT } from "../src/lib/cetak/tataLetak/hkaStandar";
import { renderDokumen } from "../src/lib/cetak/tataLetak";
import { periksaKonsistensiPerusahaan } from "../src/lib/sinkron";
import type { DokumenCetakPenjualan } from "../src/lib/cetak/tipe";
import type { GayaEntitas, JenisAsetKop, JenisDokumenCetak, TataLetakCetak } from "../src/prisma-klien/enums";
import { Prisma } from "../src/prisma-klien/client";
import { dariDataPenjualan } from "../src/lib/cetak/dariDataPenjualan";
import { pastikan } from "./bantuan";

/*
 * Uji kop, penyaji, dan tata letak HKA (P30, D3 §9.1 bagian pemilihan kop dan template, tanda tangan, stempel, tata
 * letak): pemilihan kop (?kop, kop dokumen, kop bawaan, kop pertama, polos), identitas kop menimpa perusahaan,
 * template, ukuran, tampilan event, gaya angka, judul, tanda tangan dan stempel hanya untuk bukan draf dan pemegang
 * tanda-tangan-cetak.buat (ADMIN ttd=1 bertanda tangan, KASIR tidak), stempel DRAF yang tidak bisa dimatikan, semua
 * tata letak dan ukuran menghasilkan PDF sah di bawah 1 detik, aset kop dari Berkas (isi dihapus, berkas dibuang,
 * gambar rusak, berkas kop lain jatuh ke aset bawaan repo), batas unggahan aset kop sebelum periksaGambar,
 * konsistensi kop dokumen, dan penjaga impor data contoh. Perusahaan, kop, template, dan berkas uji (awalan CTK)
 * dibuat lewat db lalu dihapus. Aset tanda tangan uji adalah gambar buatan sendiri, bukan tanda tangan asli.
 */

const AWALAN = "CTK-UJI";
const latin1 = (b: Uint8Array) => Buffer.from(b).toString("latin1");
const pdfSah = (b: Uint8Array) => latin1(b.subarray(0, 5)) === "%PDF-" && latin1(b.subarray(b.length - 8)).includes("%%EOF");
const halamanPdf = (b: Uint8Array) => (latin1(b).match(/\/Type \/Page\b(?!s)/g) ?? []).length;
const teksAda = (r: Perekam, cari: string, halaman?: number) => r.teks.some((t) => t.teks.includes(cari) && (halaman === undefined || t.halaman === halaman));
const slotAda = (r: Perekam, slot: string) => r.gambar.some((g) => g.slot === slot);

/** PNG RGBA 8-bit buatan sendiri (D3 §9.1); `rusak` = IDAT bukan zlib, `lebarKepala` menimpa lebar di IHDR saja. */
function pngPolos(lebar: number, tinggi: number, opsi: { rusak?: boolean; lebarKepala?: number } = {}): Uint8Array {
  const tabel = new Uint32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = tabel[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const potong = (jenis: string, isi: Buffer) => {
    const k = Buffer.alloc(8);
    k.writeUInt32BE(isi.length, 0);
    k.write(jenis, 4, "ascii");
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(Buffer.concat([k.subarray(4), isi])), 0);
    return Buffer.concat([k, isi, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(opsi.lebarKepala ?? lebar, 0);
  ihdr.writeUInt32BE(tinggi, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const piksel = Buffer.alloc(tinggi * (1 + lebar * 4), 0x80);
  for (let r = 0; r < tinggi; r++) piksel[r * (1 + lebar * 4)] = 0;
  const idat = opsi.rusak ? Buffer.from("bukan-zlib") : deflateSync(piksel);
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), potong("IHDR", ihdr), potong("IDAT", idat), potong("IEND", Buffer.alloc(0))]));
}

function harusGagal(label: string, fn: () => unknown, pesan: string) {
  let galat: unknown = null;
  try {
    fn();
  } catch (e) {
    galat = e;
  }
  pastikan(galat instanceof Error && galat.message.includes(pesan), `${label}: ditolak "${pesan}" (${(galat as Error | null)?.message ?? "tidak ditolak"})`);
}

async function harusGagalAsync(label: string, fn: () => Promise<unknown>, cek: (e: unknown) => boolean) {
  let galat: unknown = null;
  try {
    await fn();
  } catch (e) {
    galat = e;
  }
  pastikan(cek(galat), `${label} (${(galat as Error | null)?.message ?? "tidak ditolak"})`);
}

async function sebagaiPeran<T>(peran: string, fn: (p: PenggunaSesi) => Promise<T>): Promise<T> {
  const lama = process.env.UJI_PERAN;
  process.env.UJI_PERAN = peran;
  try {
    return await fn((await penggunaSaatIni())!);
  } finally {
    if (lama === undefined) delete process.env.UJI_PERAN;
    else process.env.UJI_PERAN = lama;
  }
}

/** Data contoh D2 sebagai milik perusahaan uji, dengan perubahan opsional. */
function data(nama: NamaContoh, perusahaanId: string, ubah: (d: DokumenCetakPenjualan) => void = () => {}): DokumenCetakPenjualan {
  const d = structuredClone(DATA_CONTOH[nama]) as DokumenCetakPenjualan;
  d.perusahaanId = perusahaanId;
  d.kopSuratId = null;
  ubah(d);
  return d;
}

const idUji: { perusahaan: string[]; kop: string[]; berkas: string[] } = { perusahaan: [], kop: [], berkas: [] };

async function buatKop(perusahaanId: string, nama: string, isian: Partial<Prisma.KopSuratUncheckedCreateInput> = {}) {
  const kop = await db.kopSurat.create({ data: { perusahaanId, nama: `${AWALAN} ${nama}`, ...isian } });
  idUji.kop.push(kop.id);
  return kop;
}

/** Aset kop lewat Berkas privat (jenisEntitas kop-surat, folder KOP), seperti hasil unggah P31. */
async function unggahAset(kop: { id: string; perusahaanId: string }, jenis: JenisAsetKop, isi: Uint8Array, lain: { entitasId?: string; perusahaanId?: string } = {}) {
  const berkas = await db.berkas.create({
    data: {
      perusahaanId: lain.perusahaanId ?? kop.perusahaanId,
      folderKode: "KOP",
      namaBerkas: `${AWALAN}-${jenis}.png`,
      tipeMime: "image/png",
      ukuran: isi.length,
      sha256: createHash("sha256").update(isi).digest("hex"),
      jenisEntitas: "kop-surat",
      entitasId: lain.entitasId ?? kop.id,
      diunggahOlehNama: "Skrip Uji",
      isi: { create: { isi: Buffer.from(isi) } },
    },
  });
  idUji.berkas.push(berkas.id);
  await db.asetKopSurat.deleteMany({ where: { kopSuratId: kop.id, jenis } });
  await db.asetKopSurat.create({ data: { kopSuratId: kop.id, jenis, berkasId: berkas.id, lebarPx: 32, tinggiPx: 18 } });
  return berkas;
}

async function bersihkan() {
  const kop = await db.kopSurat.findMany({ where: { OR: [{ nama: { startsWith: AWALAN } }, { id: { in: idUji.kop } }] }, select: { id: true } });
  const kopId = kop.map((k) => k.id);
  await db.berkas.deleteMany({ where: { OR: [{ namaBerkas: { startsWith: AWALAN } }, { id: { in: idUji.berkas } }, { jenisEntitas: "kop-surat", entitasId: { in: kopId } }] } });
  await db.kopSurat.deleteMany({ where: { id: { in: kopId } } });
  await db.perusahaan.deleteMany({ where: { kode: { startsWith: AWALAN } } });
}

class Batal extends Error {}
async function dalamTxBatal<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  let hasil: T | undefined;
  try {
    await db.$transaction(async (tx) => {
      hasil = await fn(tx);
      throw new Batal();
    });
  } catch (e) {
    if (!(e instanceof Batal)) throw e;
  }
  return hasil as T;
}

/** Berkas sumber .ts/.tsx di bawah src. */
/** Berkas diawali direktif "use client" sesudah komentar dan baris kosong (tinjauan P30 T9). */
function direktifKlien(isi: string): boolean {
  const awal = isi.replace(/^(?:\s+|\/\/[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*/, "");
  return /^["']use client["']/.test(awal);
}

function semuaSumber(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) return n === "prisma-klien" ? [] : semuaSumber(p);
    return /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

/** Impor lokal (@/ dan relatif) satu berkas, diselesaikan ke jalur berkas. */
function imporLokal(berkas: string): string[] {
  const isi = readFileSync(berkas, "utf8");
  const hasil: string[] = [];
  for (const m of isi.matchAll(/(?:from|import)\s*\(?\s*"([^"]+)"/g)) {
    const spes = m[1];
    const dasar = spes.startsWith("@/") ? path.join("src", spes.slice(2)) : spes.startsWith(".") ? path.join(path.dirname(berkas), spes) : null;
    if (!dasar) continue;
    const calon = [dasar, `${dasar}.ts`, `${dasar}.tsx`, path.join(dasar, "index.ts"), path.join(dasar, "index.tsx")].find((c) => existsSync(c) && statSync(c).isFile());
    if (calon) hasil.push(path.normalize(calon));
  }
  return hasil;
}

async function main() {
  await bersihkan();
  const p1 = await db.perusahaan.create({
    data: { kode: `${AWALAN}-1`, nama: "Cetak Uji Satu", alamat: "Jl. Perusahaan 1 Malang", kota: "Malang", telepon: "0341-111", email: "satu@contoh.id", namaBank: "BCA", nomorRekening: "1112223334", atasNamaRekening: "PT Cetak Uji Satu", penandaTangan: "Penanda Satu", aktif: true, urutan: 90 },
  });
  const p2 = await db.perusahaan.create({ data: { kode: `${AWALAN}-2`, nama: "Cetak Uji Dua", aktif: true, urutan: 91 } });
  idUji.perusahaan.push(p1.id, p2.id);
  const pemilik = (await penggunaSaatIni())!;

  try {
    console.log("=== 1. Fungsi murni: opsi cetak, aset kop, template, preset, identitas ===");
    {
      const q = (s: string) => bacaOpsiCetak(new URLSearchParams(s));
      pastikan(JSON.stringify(q("")) === JSON.stringify({ kopId: null, ukuran: null, ttd: null, tampilan: null }), "opsi kosong: semua null");
      pastikan(q("ukuran=A5L").ukuran === "A5L" && q("ukuran=a5").ukuran === "A5" && q("ukuran=A5_LANDSCAPE").ukuran === "A5L", "ukuran A5L, a5, dan A5_LANDSCAPE dikenali");
      harusGagal("ukuran A3", () => q("ukuran=A3"), "Ukuran kertas tidak dikenal");
      pastikan((() => {
        try {
          q("ukuran=A3");
        } catch (e) {
          return e instanceof GalatCetak && e.status === 400;
        }
        return false;
      })(), "ukuran A3: GalatCetak berstatus 400");
      pastikan(q("ttd=0&ttd=1").ttd === true && q("ttd=0").ttd === false && q("ttd=1&ttd=0").ttd === false, "ttd memakai nilai terakhir (isian tersembunyi 0 lalu kotak 1)");
      harusGagal("ttd tidak dikenal", () => q("ttd=mungkin"), "tanda tangan tidak dikenal");
      pastikan(q("tampilan=ringkas").tampilan === "RINGKAS" && q("tampilan=RINCI").tampilan === "RINCI" && q("kop=abc").kopId === "abc", "tampilan dan kop terbaca");
      harusGagal("tampilan tidak dikenal", () => q("tampilan=lain"), "Tampilan event tidak dikenal");
      const fd = new FormData();
      fd.append("ttd", "0");
      fd.append("ttd", "1");
      fd.set("ukuran", "A4");
      pastikan(bacaOpsiCetak(fd).ttd === true && bacaOpsiCetak(fd).ukuran === "A4", "opsi dari FormData aksi simpan PDF");

      // batas aset kop sebelum periksaGambar
      harusGagal("aset kosong", () => periksaAsetKop(new Uint8Array()), PESAN_ASET_KOSONG);
      harusGagal("aset 2 MB + 1 byte", () => periksaAsetKop(new Uint8Array(2 * 1024 * 1024 + 1).fill(0x89)), PESAN_ASET_TERLALU_BESAR);
      harusGagal("aset GIF", () => periksaAsetKop(new Uint8Array(Buffer.from("GIF89a-xxxxxxxxxxxxxxxx"))), PESAN_ASET_FORMAT);
      // IHDR menyatakan 7000 piksel: ditolak dari kepala tanpa mengurai piksel (IDAT sengaja tidak cocok)
      harusGagal("aset IHDR 7000 piksel", () => periksaAsetKop(pngPolos(16, 16, { lebarKepala: 7000 })), PESAN_ASET_DIMENSI);
      harusGagal("aset 8 x 8 piksel", () => periksaAsetKop(pngPolos(8, 8)), PESAN_ASET_DIMENSI);
      harusGagal("aset PNG rusak", () => periksaAsetKop(pngPolos(16, 16, { rusak: true })), PESAN_GAMBAR_TIDAK_SAH);
      const info = periksaAsetKop(pngPolos(32, 18));
      pastikan(info.lebarPx === 32 && info.tinggiPx === 18 && info.tipe === "image/png", "aset PNG 32 x 18 lolos dengan dimensinya");
      const kop = asetBawaan("DPRO", "KOP")!;
      pastikan(periksaAsetKop(kop).lebarPx === 2480, "kop D'Pro bawaan 2480 piksel lolos batas 6000");

      // template dan preset
      pastikan(galatTemplate("FAKTUR", "DPRO_PROPOSAL", "A4", null)?.includes("tidak bisa dipakai untuk") === true, "DPRO_PROPOSAL untuk faktur ditolak");
      pastikan(galatTemplate("KWITANSI", "KWITANSI_ENTITAS", "A5_LANDSCAPE", null) === "Kwitansi entitas butuh gaya entitas di kop ini", "kwitansi entitas tanpa gaya ditolak");
      pastikan(galatTemplate("PENAWARAN", "DPRO_PROPOSAL", "A5", "DPRO")?.includes("tidak tersedia") === true && galatTemplate("FAKTUR", "DPRO_INVOICE", "A5", "DPRO") === null, "ukuran A5 untuk proposal ditolak, untuk invoice sah");
      for (const [nama, preset] of Object.entries(PRESET_KOP)) {
        const salah = Object.entries(preset.template).map(([j, t]) => galatTemplate(j as JenisDokumenCetak, t!.tataLetak, t!.ukuran, preset.gayaEntitas)).filter(Boolean);
        pastikan(salah.length === 0, `preset ${nama}: semua template sah (${salah.join("; ") || "-"})`);
      }

      // identitas: kop menimpa perusahaan, kosong = perusahaan
      const polos = kopPolos(p1.id);
      const i1 = identitasCetak(polos, p1);
      pastikan(i1.nama === "Cetak Uji Satu" && i1.namaLegal === "Cetak Uji Satu" && i1.judulMerek === "Cetak Uji Satu" && i1.alamat === "Jl. Perusahaan 1 Malang" && i1.atasNamaRekening === "PT Cetak Uji Satu" && i1.teksSalam === "Hormat kami,", "kop polos: identitas dari perusahaan, namaLegal dan judulMerek = nama");
      const i2 = identitasCetak({ ...polos, alamat: "Jl. Kop 9", namaBank: "BANK CENTRAL ASIA", judulMerek: "Merek", penandaTangan: "  ", teksSalam: "" }, p1);
      pastikan(i2.alamat === "Jl. Kop 9" && i2.namaBank === "BANK CENTRAL ASIA" && i2.judulMerek === "Merek" && i2.penandaTangan === "Penanda Satu" && i2.teksSalam === "Hormat kami,", "penimpa kop dipakai, kolom kop kosong atau spasi jatuh ke perusahaan");
    }

    console.log("=== 2. Pemilihan kop dan template ===");
    const faktur = (ubah?: (d: DokumenCetakPenjualan) => void) => data("hkaStandar", p1.id, ubah);
    {
      const polos = await renderPdfDokumenPenjualan(faktur(), pemilik);
      pastikan(polos.kopSuratId === null && polos.tataLetak === "HKA_STANDAR" && polos.ukuran === "A4" && pdfSah(polos.isi) && polos.namaBerkas === "Invoice INV-HKA-0001.pdf", `perusahaan tanpa kop: kop polos virtual, standar A4, ${polos.namaBerkas}`);
    }
    const beta = await buatKop(p1.id, "Beta", { tataLetakUmum: "HKA_BERMEREK" });
    const alfa = await buatKop(p1.id, "Alfa", { tataLetakUmum: "HKA_MINIMAL", alamat: "Jl. Kop Alfa 9" });
    const lain = await buatKop(p2.id, "Lain");
    const pilih = (opsi: Parameters<typeof pilihKopDanTemplate>[2] = {}, ubah?: (d: DokumenCetakPenjualan) => void) => pilihKopDanTemplate(db, dariDataPenjualan(faktur(ubah)), opsi);
    pastikan((await pilih()).kop.id === alfa.id, "tanpa bawaan: kop pertama urut nama (Alfa sebelum Beta)");
    await db.kopSurat.update({ where: { id: beta.id }, data: { bawaan: true } });
    pastikan((await pilih()).kop.id === beta.id, "kop bawaan perusahaan dipakai");
    pastikan((await pilih({}, (d) => (d.kopSuratId = alfa.id))).kop.id === alfa.id, "kop dokumen mengalahkan kop bawaan");
    pastikan((await pilih({ kopId: beta.id }, (d) => (d.kopSuratId = alfa.id))).kop.id === beta.id, "?kop mengalahkan kop dokumen");
    await harusGagalAsync("?kop milik perusahaan lain", () => pilih({ kopId: lain.id }), (e) => e instanceof GalatCetak && e.status === 400 && e.message === PESAN_KOP_BUKAN_MILIK);
    pastikan((await pilih({}, (d) => (d.kopSuratId = lain.id))).kop.id === beta.id, "kop dokumen milik perusahaan lain dilewati diam-diam, kembali ke bawaan");
    {
      const kedua = await buatKop(p1.id, "Zeta", { bawaan: true });
      pastikan((await pilih()).kop.id === kedua.id, "dua kop bawaan: diubahPada terbaru dipakai");
      await db.kopSurat.update({ where: { id: kedua.id }, data: { dihapusPada: new Date(), bawaan: false } });
    }
    await db.kopSurat.update({ where: { id: alfa.id }, data: { dihapusPada: new Date() } });
    pastikan((await pilih({}, (d) => (d.kopSuratId = alfa.id))).kop.id === beta.id, "kop dokumen yang dihapus dilewati, kembali ke kop bawaan");
    await harusGagalAsync("?kop yang sudah dihapus", () => pilih({ kopId: alfa.id }), (e) => e instanceof GalatCetak && e.status === 400);
    {
      const p = await pilih();
      pastikan(p.tataLetak === "HKA_BERMEREK" && p.ukuran === "A4" && p.gayaAngka === "TITIK" && p.judul === "INVOICE" && p.tampilanEvent === null, "tanpa template: tata letak umum kop, A4, TITIK, judul INVOICE");
      const r = await renderPdfDokumenPenjualan(faktur(), pemilik);
      pastikan(r.kopSuratId === beta.id && r.tataLetak === "HKA_BERMEREK", "penyaji memakai kop bawaan Beta dan tata letak bermerek");
    }

    // identitas kop menimpa perusahaan di PDF
    await db.kopSurat.update({ where: { id: beta.id }, data: { alamat: "Jl. Kop Beta 7", judulMerek: "Merek Beta", warnaAksen: "#2A9DF4" } });
    {
      const perekam = buatPerekam();
      await renderPdfDokumenPenjualan(faktur(), pemilik, {}, { perekam });
      pastikan(teksAda(perekam, "Jl. Kop Beta 7") && !teksAda(perekam, "Jl. Perusahaan 1 Malang") && teksAda(perekam, "Merek Beta") && teksAda(perekam, "PT Cetak Uji Satu"), "PDF: alamat dan merek dari kop, rekening dari perusahaan");
    }

    // template: tata letak, ukuran, gaya angka, judul
    await db.kopSurat.update({ where: { id: beta.id }, data: { gayaEntitas: "DPRO" } });
    await db.templateCetak.create({ data: { kopSuratId: beta.id, jenis: "FAKTUR", tataLetak: "DPRO_INVOICE", ukuran: "A5", tandaTanganBawaan: false } });
    await db.templateCetak.create({ data: { kopSuratId: beta.id, jenis: "KWITANSI", tataLetak: "KWITANSI_ENTITAS", ukuran: "A4", gayaAngka: "KOMA", judul: "TANDA TERIMA" } });
    await db.templateCetak.create({ data: { kopSuratId: beta.id, jenis: "PENAWARAN", tataLetak: "DPRO_INVOICE", ukuran: "A4" } });
    {
      const p = await pilih();
      pastikan(p.tataLetak === "DPRO_INVOICE" && p.ukuran === "A5" && p.gayaAngka === "TITIK" && p.template.tandaTanganBawaan === false, "template faktur: invoice D'Pro A5, gaya angka bawaan TITIK (P-29)");
      pastikan((await pilih({ ukuran: "A5L" })).ukuran === "A5_LANDSCAPE" && (await pilih({ ukuran: "A4" })).ukuran === "A4", "?ukuran yang sah untuk tata letak mengalahkan template");
      const kw = await pilihKopDanTemplate(db, dariDataPenjualan(data("kwitansiDpro", p1.id, (d) => (d.jenis = "kwitansi"))), { ukuran: "A5" });
      pastikan(kw.tataLetak === "KWITANSI_ENTITAS" && kw.ukuran === "A4" && kw.gayaAngka === "KOMA" && kw.judul === "TANDA TERIMA", "kwitansi: ?ukuran A5 tidak sah diabaikan, template A4, gaya KOMA, judul template");
      const kwJudul = await pilihKopDanTemplate(db, dariDataPenjualan(data("kwitansiDpro", p1.id, (d) => ((d.jenis = "kwitansi"), (d.judul = "KWITANSI PELUNASAN")))));
      pastikan(kwJudul.judul === "KWITANSI PELUNASAN", "judul dokumen mengalahkan judul template");
      const perekam = buatPerekam();
      const pnw = await pilihKopDanTemplate(db, dariDataPenjualan(data("proposalDpro", p1.id)), {}, perekam);
      pastikan(pnw.tataLetak === "HKA_BERMEREK" && perekam.peringatan.some((x) => x.includes("tidak bisa dipakai")), "template penawaran DPRO_INVOICE (tidak sah) jatuh ke tata letak umum dengan peringatan");
      await db.kopSurat.update({ where: { id: beta.id }, data: { gayaEntitas: null } });
      const tanpaGaya = await pilihKopDanTemplate(db, dariDataPenjualan(data("kwitansiDpro", p1.id, (d) => (d.jenis = "kwitansi"))));
      pastikan(tanpaGaya.tataLetak === "HKA_BERMEREK", "kwitansi entitas sesudah gaya kop dihapus jatuh ke tata letak umum");
      const nawa = await buatKop(p1.id, "Nawa", { gayaEntitas: "NAWASENA" });
      pastikan((await pilihKopDanTemplate(db, dariDataPenjualan(data("kwitansiDpro", p1.id, (d) => (d.jenis = "kwitansi"))), { kopId: nawa.id })).judul === "KUITANSI", "gaya NAWASENA: judul bawaan kwitansi KUITANSI");
      await db.kopSurat.update({ where: { id: beta.id }, data: { gayaEntitas: "DPRO" } });
    }

    // tampilan event
    {
      const ev = (opsi: Parameters<typeof pilihKopDanTemplate>[2] = {}) => pilihKopDanTemplate(db, dariDataPenjualan(data("hkaEvoked", p1.id)), opsi);
      pastikan((await ev()).tampilanEvent === null, "faktur event bertata letak DPRO_INVOICE: bukan tampilan event");
      await db.templateCetak.deleteMany({ where: { kopSuratId: beta.id, jenis: "FAKTUR" } });
      pastikan((await ev()).tampilanEvent === "RINGKAS" && (await ev({ tampilan: "RINCI" })).tampilanEvent === "RINCI", "faktur event bertata letak HKA: tampilan dokumen, ?tampilan mengalahkannya");
      const kw = await pilihKopDanTemplate(db, dariDataPenjualan(data("kwitansiDpro", p1.id, (d) => (d.event.mode = "EVENT"))), { tampilan: "RINCI" });
      pastikan(kw.tampilanEvent === null, "kwitansi selalu mode standar walau dokumennya event");
      const r = buatPerekam();
      const hasil = await renderPdfDokumenPenjualan(data("hkaEvoked", p1.id), pemilik, {}, { perekam: r });
      pastikan(halamanPdf(hasil.isi) === 2 && teksAda(r, "Sisa Tagihan", 1) && teksAda(r, "Rp 6.648.500", 1) && teksAda(r, "URAIAN", 2) && teksAda(r, "FREQ", 2), "faktur event ringkas Evoked: 2 halaman, Sisa Tagihan Rp 6.648.500 di halaman 1, RAB di halaman 2");
      const r2 = buatPerekam();
      await renderPdfDokumenPenjualan(data("hkaNawasena", p1.id), pemilik, { tampilan: "RINCI" }, { perekam: r2 });
      pastikan(teksAda(r2, "Management Fee 10%") && teksAda(r2, "Rp 79.975.500") && teksAda(r2, "TUJUH PULUH SEMBILAN JUTA") && teksAda(r2, "Event:") && !teksAda(r2, "<b>"), "faktur event rinci Nawasena: fee, grand total, terbilang, Event: tanpa <b>");
      const pnw = buatPerekam();
      const hp = await renderPdfDokumenPenjualan(
        data("hkaEvoked", p1.id, (d) => {
          d.jenis = "penawaran";
          d.termin = [{ no: 1, label: "DP", persen: "50.00", jumlah: "9974250.00", jumlahBruto: "9974250.00", jatuhTempo: null, status: "RENCANA" }];
        }),
        pemilik,
        {},
        { perekam: pnw },
      );
      pastikan(halamanPdf(hp.isi) === 1 && teksAda(pnw, "URAIAN") && teksAda(pnw, "Skema pembayaran:"), "penawaran event ringkas: satu halaman RAB, skema termin tetap tercetak");
    }

    console.log("=== 3. Tanda tangan, stempel, dan draf ===");
    await db.templateCetak.create({ data: { kopSuratId: beta.id, jenis: "FAKTUR", tataLetak: "DPRO_INVOICE", ukuran: "A4", tandaTanganBawaan: true } });
    await unggahAset(beta, "TANDA_TANGAN", pngPolos(1000 / 20, 560 / 20));
    {
      const admin = await sebagaiPeran("ADMIN", async (p) => {
        pastikan(punyaHak(p, "tanda-tangan-cetak.buat"), "ADMIN memegang tanda-tangan-cetak.buat");
        const r = buatPerekam();
        const hasil = await renderPdfDokumenPenjualan(faktur(), p, { ttd: true }, { perekam: r });
        return { hasil, r };
      });
      pastikan(admin.hasil.tandaTangan && slotAda(admin.r, "TANDA_TANGAN") && !teksAda(admin.r, "DRAF"), "ADMIN ttd=1 pada faktur bukan draf: tanda tangan dibubuhkan");
      const bawaan = await sebagaiPeran("ADMIN", (p) => renderPdfDokumenPenjualan(faktur(), p));
      pastikan(bawaan.tandaTangan, "ttd kosong: mengikuti tandaTanganBawaan template (ya)");
      const nol = await sebagaiPeran("ADMIN", (p) => renderPdfDokumenPenjualan(faktur(), p, { ttd: false }));
      pastikan(!nol.tandaTangan, "ttd=0: tanpa tanda tangan");
      const kasir = await sebagaiPeran("KASIR", async (p) => {
        pastikan(!punyaHak(p, "tanda-tangan-cetak.buat"), "KASIR tanpa tanda-tangan-cetak.buat");
        const r = buatPerekam();
        return { hasil: await renderPdfDokumenPenjualan(faktur(), p, { ttd: true }, { perekam: r }), r };
      });
      pastikan(!kasir.hasil.tandaTangan && !slotAda(kasir.r, "TANDA_TANGAN") && pdfSah(kasir.hasil.isi), "KASIR ttd=1: PDF tetap jadi tanpa tanda tangan");
      const draf = await sebagaiPeran("ADMIN", async (p) => {
        const r = buatPerekam();
        return { hasil: await renderPdfDokumenPenjualan(faktur((d) => (d.draf = true)), p, { ttd: true }, { perekam: r, stempel: "" }), r };
      });
      pastikan(!draf.hasil.tandaTangan && !slotAda(draf.r, "TANDA_TANGAN") && teksAda(draf.r, "DRAF") && draf.hasil.namaBerkas === "Invoice INV-HKA-0001 (DRAF).pdf", "draf: tanpa tanda tangan walau ADMIN ttd=1, stempel DRAF walau stempel kosong, nama berkas (DRAF)");
      const contoh = buatPerekam();
      await renderPdfDokumenPenjualan(faktur(), pemilik, {}, { perekam: contoh, stempel: "CONTOH" });
      pastikan(teksAda(contoh, "CONTOH") && !teksAda(contoh, "DRAF"), "stempel CONTOH untuk dokumen bukan draf");
      const contohDraf = buatPerekam();
      await renderPdfDokumenPenjualan(faktur((d) => (d.draf = true)), pemilik, {}, { perekam: contohDraf, stempel: "CONTOH" });
      pastikan(teksAda(contohDraf, "DRAF") && !teksAda(contohDraf, "CONTOH"), "dokumen draf tetap berstempel DRAF walau diminta stempel lain");
      // stempel null langsung di MasukanTataLetak tidak mematikan DRAF (catatan tinjauan P29)
      const m: MasukanTataLetak = {
        dok: dariDataPenjualan(data("proposalDpro", p1.id, (d) => (d.draf = true))),
        identitas: IDENTITAS_CONTOH.DPRO,
        judul: "PENAWARAN",
        ukuran: "A4",
        tandaTangan: false,
        perekam: buatPerekam(),
        stempel: null,
        tema: { ...WARNA_CONTOH.DPRO, gayaAngka: "KOMA", desimal: 0, tampilLogo: true, tampilWatermark: false, gayaEntitas: "DPRO", aset: petaAsetBawaan("DPRO") },
      };
      await renderDokumen(m, { tataLetak: "DPRO_PROPOSAL", tampilanEvent: null, judulBerkas: "Proposal" });
      pastikan(m.perekam!.teks.filter((t) => t.teks === "DRAF").map((t) => t.halaman).join() === "1,2", "stempel null pada dokumen draf: DRAF tetap di setiap halaman");
    }
    // stempel e-meterai di tampilan event rinci faktur
    await unggahAset(beta, "STEMPEL", pngPolos(40, 40));
    await db.templateCetak.deleteMany({ where: { kopSuratId: beta.id, jenis: "FAKTUR" } });
    {
      const r = buatPerekam();
      const hasil = await sebagaiPeran("ADMIN", (p) => renderPdfDokumenPenjualan(data("hkaNawasena", p1.id), p, { ttd: true }, { perekam: r }));
      pastikan(hasil.tandaTangan && slotAda(r, "STEMPEL") && slotAda(r, "TANDA_TANGAN"), "faktur event rinci: stempel dan tanda tangan untuk ADMIN ttd=1");
      const rk = buatPerekam();
      await sebagaiPeran("KASIR", (p) => renderPdfDokumenPenjualan(data("hkaNawasena", p1.id), p, { ttd: true }, { perekam: rk }));
      pastikan(!slotAda(rk, "STEMPEL") && !slotAda(rk, "TANDA_TANGAN"), "faktur event rinci: KASIR tanpa stempel dan tanda tangan");
      const rp = buatPerekam();
      await sebagaiPeran("ADMIN", (p) => renderPdfDokumenPenjualan(data("hkaNawasena", p1.id, (d) => (d.jenis = "penawaran")), p, { ttd: true, tampilan: "RINCI" }, { perekam: rp }));
      pastikan(!slotAda(rp, "STEMPEL") && slotAda(rp, "TANDA_TANGAN"), "penawaran event rinci: tanpa stempel, tanda tangan tetap");
    }

    console.log("=== 4. Aset kop dari Berkas dan aset bawaan repo ===");
    {
      const gamma = await buatKop(p1.id, "Gamma", { gayaEntitas: "TAPUSSA", tataLetakUmum: "HKA_BERMEREK" });
      const logo = (r: Perekam) => r.gambar.find((g) => g.slot === "LOGO")!;
      const render = async () => {
        const r = buatPerekam();
        await renderPdfDokumenPenjualan(faktur(), pemilik, { kopId: gamma.id }, { perekam: r });
        return r;
      };
      const bawaan = logo(await render());
      pastikan(!!bawaan && Math.abs(bawaan.w / bawaan.h - 1) > 0.5, "tanpa unggahan: logo bawaan Tapussa dipakai");
      const berkas = await unggahAset(gamma, "LOGO", pngPolos(32, 32));
      const unggah = logo(await render());
      pastikan(Math.abs(unggah.w / unggah.h - 1) < 0.01, "unggahan logo (persegi) mengalahkan logo bawaan");
      await db.isiBerkas.delete({ where: { berkasId: berkas.id } });
      await db.berkas.update({ where: { id: berkas.id }, data: { isiDihapusPada: new Date() } });
      const tanpaIsi = logo(await render());
      pastikan(Math.abs(tanpaIsi.w / tanpaIsi.h - bawaan.w / bawaan.h) < 0.01, "isi berkas aset sudah dihapus: jatuh ke logo bawaan repo");
      const b2 = await unggahAset(gamma, "LOGO", pngPolos(32, 32));
      await db.berkas.update({ where: { id: b2.id }, data: { dihapusPada: new Date() } });
      pastikan(Math.abs(logo(await render()).w / logo(await render()).h - 1) > 0.5, "berkas aset dibuang ke Sampah: jatuh ke logo bawaan");
      await unggahAset(gamma, "LOGO", pngPolos(32, 32), { entitasId: beta.id });
      pastikan(Math.abs(logo(await render()).w / logo(await render()).h - 1) > 0.5, "berkas yang terlampir ke kop lain tidak dipakai");
      await unggahAset(gamma, "LOGO", pngPolos(32, 32, { rusak: true }));
      const r = await render();
      pastikan(Math.abs(logo(r).w / logo(r).h - 1) > 0.5 && r.peringatan.some((x) => x.startsWith("Gambar LOGO kop tidak dipakai")), "gambar unggahan rusak dilewati dengan peringatan, proses tetap hidup, logo bawaan dipakai");
      const ttdBawaan = (["DPRO", "TAPUSSA", "BONANOVA", "SAHARA", "NAWASENA"] as GayaEntitas[]).some((g) => asetBawaan(g, "TANDA_TANGAN") || asetBawaan(g, "STEMPEL"));
      pastikan(!ttdBawaan && !existsSync("src/aset-cetak/dpro/tanda-tangan.png") && !existsSync("src/aset-cetak/dpro/ttd.png"), "tanda tangan dan stempel tidak pernah punya aset bawaan repo");
    }

    console.log("=== 5. Semua tata letak dan ukuran ===");
    {
      const contohJenis: Record<JenisDokumenCetak, NamaContoh> = { PENAWARAN: "proposalDpro", TAGIHAN_TERMIN: "invoiceDpro", FAKTUR: "invoiceDpro", KWITANSI: "kwitansiDpro", KWITANSI_DP: "kwitansiDpro" };
      const jenisData: Record<JenisDokumenCetak, DokumenCetakPenjualan["jenis"]> = { PENAWARAN: "penawaran", TAGIHAN_TERMIN: "tagihan-termin", FAKTUR: "faktur", KWITANSI: "kwitansi", "KWITANSI_DP": "kwitansi-dp" };
      let jumlah = 0;
      let terlama = 0;
      for (const [jenis, daftar] of Object.entries(TATA_LETAK_SAH) as [JenisDokumenCetak, readonly TataLetakCetak[]][]) {
        for (const tl of daftar) {
          for (const ukuran of UKURAN_SAH[tl]) {
            const gaya: GayaEntitas | null = tl === "KWITANSI_ENTITAS" || tl.startsWith("DPRO") ? "DPRO" : null;
            const kop = { ...kopPolos(p1.id), gayaEntitas: gaya };
            const dok = dariDataPenjualan(data(contohJenis[jenis], p1.id, (d) => (d.jenis = jenisData[jenis])));
            const perekam = buatPerekam();
            const m: MasukanTataLetak = {
              dok,
              identitas: identitasCetak(kop, p1),
              judul: "JUDUL UJI",
              ukuran,
              tandaTangan: false,
              perekam,
              tema: { ...temaKop(kop), gayaAngka: "TITIK", desimal: 0, aset: gaya ? petaAsetBawaan(gaya) : {} },
            };
            const t0 = performance.now();
            const isi = await renderDokumen(m, { tataLetak: tl, tampilanEvent: null, judulBerkas: "Uji" });
            const ms = performance.now() - t0;
            terlama = Math.max(terlama, ms);
            const tak = perekam.peringatan.filter((p) => p.startsWith("teks terpotong") || p.includes("lebih tinggi dari area"));
            if (!pdfSah(isi) || halamanPdf(isi) < 1 || tak.length || ms >= 1000) pastikan(false, `${jenis} ${tl} ${ukuran}: PDF sah, tanpa luapan, < 1 detik (${halamanPdf(isi)} hal, ${Math.round(ms)} ms, ${tak.join("; ")})`);
            jumlah++;
          }
        }
      }
      pastikan(jumlah >= 30, `${jumlah} kombinasi jenis, tata letak, dan ukuran menghasilkan PDF sah tanpa luapan, terlama ${Math.round(terlama)} ms (< 1 detik)`);
      // tata letak HKA dengan angka uji HKA (spec/02 §4)
      for (const tl of ["HKA_STANDAR", "HKA_BERMEREK", "HKA_SURAT", "HKA_MINIMAL"] as const) {
        for (const [jenis, nama] of [["faktur", "hkaStandar"], ["penawaran", "hkaStandar"], ["kwitansi", "kwitansiDpro"]] as const) {
          const kop = { ...kopPolos(p1.id), tataLetakUmum: tl };
          const r = buatPerekam();
          const m: MasukanTataLetak = {
            dok: dariDataPenjualan(data(nama, p1.id, (d) => ((d.jenis = jenis), (d.syaratPembayaran = "- Bayar 14 hari"), (d.catatan = "- Catatan uji")))),
            identitas: identitasCetak(kop, p1),
            judul: jenis === "kwitansi" ? "KWITANSI" : jenis === "faktur" ? "INVOICE" : "PENAWARAN",
            ukuran: "A4",
            tandaTangan: false,
            perekam: r,
            tema: { ...temaKop(kop), gayaAngka: "TITIK", desimal: 0, aset: {} },
          };
          await renderDokumen(m, { tataLetak: tl, tampilanEvent: null, judulBerkas: "Uji" });
          const isi = r.teks.map((t) => t.teks).join(" ");
          const angka = jenis === "kwitansi" ? "44.340.000" : "1.898.100";
          const kepada = jenis === "kwitansi" ? (tl === "HKA_SURAT" ? "Kepada" : "DITERIMA DARI") : tl === "HKA_SURAT" ? "Kepada" : "KEPADA";
          const rekeningAda = isi.includes("1112223334");
          const syarat = jenis !== "kwitansi" && tl !== "HKA_SURAT" ? isi.includes("Bayar 14 hari") : true;
          pastikan(
            isi.includes(angka) && isi.replace(/ /g, " ").replace(/ /g, "").includes(kepada.replace(/ /g, "")) && !isi.includes("BILL TO") && syarat && (tl === "HKA_SURAT" || jenis === "kwitansi" ? !rekeningAda : rekeningAda) && r.peringatan.length === 0,
            `${tl} ${jenis}: ${angka}, label ${kepada}, tanpa BILL TO, ${tl === "HKA_SURAT" ? "tanpa blok rekening" : "rekening dan syarat"}`,
          );
        }
      }
      // penawaran tagihan termin tanpa baris: baris dari konteks termin
      const r = buatPerekam();
      const tg = data("invoiceDpro", p1.id, (d) => {
        d.jenis = "tagihan-termin";
        d.baris = [];
        d.konteksTermin = { no: 2, jumlahButir: 3, label: "Termin 2", persen: "40.00", jumlah: "1000000.00", jumlahBruto: "1000000.00", nilaiKontrakBruto: "2500000.00", dibayarSebelumnya: "500000.00", sisaSetelahTermin: "1000000.00", nomorPesanan: "PSJ-0001" };
      });
      await renderPdfDokumenPenjualan(tg, pemilik, { kopId: beta.id }, { perekam: r });
      pastikan(teksAda(r, "Termin 2 dari 3") && teksAda(r, "Sisa tagihan setelah termin ini"), "tagihan termin tanpa baris: baris dibangun dari konteks termin");
    }

    console.log("=== 6. Konsistensi kop dokumen dan gambar kop ===");
    {
      const awal = await periksaKonsistensiPerusahaan(db);
      pastikan(awal.rincian.some((x) => x.kode === "KOP_DOKUMEN" && x.jumlah === 0), "KOP_DOKUMEN ada dan nol pada data uji");
      const dokumen = await dalamTxBatal(async (tx) => {
        const plg = await tx.pelanggan.create({ data: { kode: `${AWALAN}-PLG`, nama: "Pelanggan Uji Cetak" } });
        await tx.penawaranPenjualan.create({ data: { nomor: `${AWALAN}-PNW`, pelangganId: plg.id, perusahaanId: p1.id, kopSuratId: lain.id } });
        return periksaKonsistensiPerusahaan(tx);
      });
      pastikan(dokumen.rincian.find((x) => x.kode === "KOP_DOKUMEN")?.jumlah === 1 && dokumen.total === 1, "penawaran perusahaan satu dengan kop perusahaan dua: KOP_DOKUMEN 1");
      const gambar = await dalamTxBatal(async (tx) => {
        const b = await tx.berkas.create({ data: { perusahaanId: p1.id, folderKode: "KOP", namaBerkas: `${AWALAN}-salah.png`, tipeMime: "image/png", ukuran: 1, sha256: "x", jenisEntitas: "kop-surat", entitasId: alfa.id, diunggahOlehNama: "Skrip Uji" } });
        await tx.asetKopSurat.create({ data: { kopSuratId: beta.id, jenis: "KAKI", berkasId: b.id, lebarPx: 16, tinggiPx: 16 } });
        return periksaKonsistensiPerusahaan(tx);
      });
      pastikan(gambar.rincian.find((x) => x.kode === "KOP_DOKUMEN")?.jumlah === 1 && gambar.total === 1, "gambar kop yang berkasnya terlampir ke kop lain: KOP_DOKUMEN 1");
    }

    console.log("=== 7. Penjaga impor data contoh ===");
    {
      const sumber = semuaSumber("src");
      pastikan(
        direktifKlien('/* komponen */\n// catatan\n\n"use client";\nexport {}') && direktifKlien("'use client'") && !direktifKlien('const a = "use client";') && !direktifKlien('// "use client"\nexport {}'),
        "pengenal komponen klien melewati komentar dan baris kosong di awal berkas",
      );
      const klien = sumber.filter((f) => direktifKlien(readFileSync(f, "utf8")));
      const contoh = path.normalize("src/lib/cetak/contoh.ts");
      const dilihat = new Set<string>(klien);
      const antre = [...klien];
      while (antre.length) {
        for (const i of imporLokal(antre.pop()!)) {
          if (dilihat.has(i)) continue;
          dilihat.add(i);
          antre.push(i);
        }
      }
      pastikan(klien.length > 10 && dilihat.has(path.normalize("src/lib/hakAkses.ts")) && !dilihat.has(contoh), `contoh.ts (IDENTITAS_CONTOH, rekening asli) tidak terjangkau dari ${klien.length} komponen klien`);
      const pemakai = sumber.filter((f) => path.normalize(f) !== contoh && readFileSync(f, "utf8").includes("IDENTITAS_CONTOH"));
      pastikan(pemakai.length === 0, `IDENTITAS_CONTOH tidak dipakai kode aplikasi (${pemakai.join(", ") || "hanya uji"})`);
      const kopTs = readFileSync("src/lib/cetak/kop.ts", "utf8") + readFileSync("src/lib/cetak/index.ts", "utf8");
      pastikan(!kopTs.includes("@/lib/cetak/contoh") && !kopTs.includes('"use client"'), "penyaji dan kop tidak mengimpor data contoh dan bukan komponen klien");
      const hka = ["hkaStandar", "hkaBermerek", "hkaSurat", "hkaMinimal", "hkaEvent", "index"].map((f) => readFileSync(`src/lib/cetak/tataLetak/${f}.ts`, "utf8"));
      pastikan(hka.every((s) => !s.includes("@/lib/db") && !s.includes("@/prisma-klien/client") && !s.includes('"use client"')), "tata letak HKA dan dispatcher tidak membaca basis data");
    }

    console.log("=== 8. Perbaikan tinjauan P30: waktu render, potongan teks, rekening, alamat, warna ===");
    {
      const T = 841.89;
      const mm = (v: number) => (v * 72) / 25.4;
      const masukan = (kop: ReturnType<typeof kopPolos>, d: DokumenCetakPenjualan, lain: Partial<MasukanTataLetak> = {}): MasukanTataLetak => ({
        dok: dariDataPenjualan(d),
        identitas: identitasCetak(kop, p1),
        judul: "INVOICE",
        ukuran: "A4",
        tandaTangan: false,
        perekam: buatPerekam(),
        tema: { ...temaKop(kop), gayaAngka: "TITIK", desimal: 0, aset: {} },
        ...lain,
      });
      const panjang = (n: number) => "kata panjang sekali ".repeat(Math.ceil(n / 20)).slice(0, n);
      const banyakBaris = (nama: NamaContoh, n: number, desk: number) =>
        data(nama, p1.id, (d) => {
          const b0 = d.baris[0];
          d.baris = Array.from({ length: n }, (_, i) => ({ ...b0, no: i + 1, nama: `Item ${i}`, deskripsi: desk ? panjang(desk) : null }));
        });

      // T1: font terdaftar memakai cache pdfkit, jadi waktu render tidak lagi sebanding jumlah potongan teks. Penjaga
      // utamanya _fontCount di bawah; batas jam dinding 500 x 3.000 dilonggarkan ke 10 detik supaya mesin sibuk tidak
      // memberi kegagalan palsu, sedangkan regresi besar (puluhan detik) tetap tertangkap (tinjauan P32 S2).
      const waktu: string[] = [];
      for (const [tl, nama, n, desk, batas] of [
        ["HKA_STANDAR", "hkaStandar", 100, 300, 1000],
        ["DPRO_INVOICE", "invoiceDpro", 100, 300, 1000],
        ["HKA_STANDAR", "hkaStandar", 500, 3000, 10000],
        ["DPRO_INVOICE", "invoiceDpro", 500, 3000, 10000],
      ] as [TataLetakCetak, NamaContoh, number, number, number][]) {
        const kop = { ...kopPolos(p1.id), gayaEntitas: tl.startsWith("DPRO") ? ("DPRO" as const) : null };
        const m = masukan(kop, banyakBaris(nama, n, desk));
        const t0 = performance.now();
        const isi = await renderDokumen(m, { tataLetak: tl, tampilanEvent: null, judulBerkas: "Uji" });
        const ms = Math.round(performance.now() - t0);
        waktu.push(`${tl} ${n}x${desk} ${ms} ms`);
        pastikan(pdfSah(isi) && ms < batas, `${tl} ${n} baris x ${desk} huruf selesai ${ms} ms (< ${batas} ms, ${halamanPdf(isi)} hal)`);
      }
      console.log(`  waktu: ${waktu.join("; ")}`);
      {
        const k = new KanvasCetak({ judul: "a", subjek: "b", penulis: "c" });
        const fontKe = () => (k as unknown as { doc: { _fontCount: number } }).doc._fontCount;
        const awal = fontKe();
        for (let n = 0; n < 200; n++) k.ukur(n % 2 ? "Teks tebal" : "Teks biasa", { x: 0, lebar: 1e6, ukuran: 10, font: n % 2 ? "B" : "R" });
        pastikan(fontKe() === awal, `font R dan B tidak dibuka ulang di setiap pengukuran (${awal} lalu ${fontKe()})`);
        // lebar kata disimpan per kanvas: ukuran ulang memberi hasil yang sama dengan ukuran pertama
        const lebar = (t: string, ukuran: number) => k.ukur(t, { x: 0, lebar: 1e6, ukuran, font: "R" }).lebar;
        pastikan(lebar("Kata sama", 10) === lebar("Kata sama", 10) && lebar("Kata sama", 12) > lebar("Kata sama", 10), "simpanan lebar kata dipisah per ukuran font");
      }

      // T2: baris kosong di tengah yang melewati slot tidak menelan sisa teks diam-diam
      {
        const r = buatPerekam();
        const k = new KanvasCetak({ judul: "a", subjek: "b", penulis: "c", perekam: r });
        const opsi = { lebar: 200, ukuran: 10, font: "R" as const };
        const teks = "Baris satu\n\n\nBaris empat penting";
        pastikan(JSON.stringify(pecahBaris(k, teks, opsi)) === JSON.stringify(["Baris satu", "", "", "Baris empat penting"]), "pecahBaris tanpa batas tetap menyimpan baris kosong di tengah");
        pastikan(pecahBaris(k, teks, opsi, 2).length > 2, "pecahBaris yang berhenti di batas tidak membuang baris kosong di ujung hasil");
        const slot = isiSlotBaris(k, teks, 2, { ...opsi, ukuranMin: 9.5 });
        pastikan(slot.baris.length === 2 && slot.baris[1].endsWith("…") && r.peringatan.some((p) => p.startsWith("teks terpotong")), `baris kosong di tengah melewati slot: dipotong "…" dengan peringatan (${JSON.stringify(slot.baris)})`);
        const r2 = buatPerekam();
        const k2 = new KanvasCetak({ judul: "a", subjek: "b", penulis: "c", perekam: r2 });
        const akhir = isiSlotBaris(k2, "Baris satu\nBaris dua\n\n\n", 2, { ...opsi, ukuranMin: 9.5 });
        pastikan(JSON.stringify(akhir.baris) === JSON.stringify(["Baris satu", "Baris dua"]) && r2.peringatan.length === 0, "baris kosong di ujung teks tidak dianggap terpotong");
      }

      // T3: baris rekening pindah halaman utuh, tidak turun ke ikon sosial atau kaki
      {
        const kop = kopPolos(p1.id);
        const id = { ...identitasCetak(kop, p1), alamatKaki: "Jl. Contoh 1\nMalang", instagram: "@hka", email: "a@b.id" };
        for (const [tl, bawahMm, label] of [
          ["HKA_BERMEREK", 42, /^(Bank|No\. Rekening|Atas Nama|: )/],
          ["HKA_MINIMAL", 30, /^(B A N K|N O|A T A S|BCA$|1112223334$|PT Cetak Uji Satu$)/],
        ] as [TataLetakCetak, number, RegExp][]) {
          let terburuk = -Infinity;
          let pindah = 0;
          // R1 tinjauan P32: judul "BAYAR KE:" minimal selalu sehalaman dengan baris rekening pertamanya
          const yatim: number[] = [];
          let judulPindah = 0;
          for (let n = 1; n <= 40; n++) {
            const d = banyakBaris("hkaStandar", n, 0);
            d.catatan = null;
            d.syaratPembayaran = null;
            const m = masukan(kop, d, { identitas: id });
            await renderDokumen(m, { tataLetak: tl, tampilanEvent: null, judulBerkas: "Uji" });
            const rek = m.perekam!.teks.filter((t) => label.test(t.teks) && t.y > T / 2);
            for (const t of rek) terburuk = Math.max(terburuk, t.y + t.tinggi - (T - mm(bawahMm)));
            if (new Set(rek.map((t) => t.halaman)).size === 1 && rek.length && rek[0].halaman > 1) pindah++;
            if (tl === "HKA_MINIMAL") {
              const judul = m.perekam!.teks.filter((t) => /^B A Y A R/.test(t.teks));
              const bank = m.perekam!.teks.find((t) => /^B A N K/.test(t.teks));
              if (judul.length !== 1 || !bank || judul[0].halaman !== bank.halaman) yatim.push(n);
              else if (judul[0].halaman > 1) judulPindah++;
            }
          }
          pastikan(terburuk <= 0.5 && pindah > 0, `${tl}: rekening 1 sampai 40 baris tidak melewati margin bawah (paling dekat ${terburuk.toFixed(1)} pt) dan pindah halaman utuh (${pindah} kasus)`);
          if (tl === "HKA_MINIMAL") pastikan(yatim.length === 0 && judulPindah > 0, `HKA_MINIMAL: judul BAYAR KE ikut pindah halaman bersama rekening (${judulPindah} kasus pindah, yatim: ${yatim.join(", ") || "tidak ada"})`);
        }
      }

      // T4: alamat dan terima dari berbaris banyak tidak meluap keluar kertas
      {
        const kop = kopPolos(p1.id);
        const luap = (r: Perekam) => r.teks.filter((t) => t.y + t.tinggi > T + 0.5).length;
        const kasus: [TataLetakCetak, "RINCI" | null, NamaContoh, DokumenCetakPenjualan["jenis"]][] = [
          ["HKA_STANDAR", null, "hkaStandar", "faktur"],
          ["HKA_BERMEREK", null, "hkaStandar", "faktur"],
          ["HKA_MINIMAL", null, "hkaStandar", "faktur"],
          ["HKA_BERMEREK", "RINCI", "hkaNawasena", "faktur"],
        ];
        for (const [tl, tampilan, nama, jenis] of kasus) {
          const m = masukan(kop, data(nama, p1.id, (d) => ((d.jenis = jenis), (d.kepada.alamat = "a\n".repeat(250)))));
          await renderDokumen(m, { tataLetak: tl, tampilanEvent: tampilan, judulBerkas: "Uji" });
          const baris = m.perekam!.teks.filter((t) => t.teks.split("\n").every((s) => s === "a" || s === "a…") && t.halaman === 1);
          pastikan(luap(m.perekam!) === 0 && m.perekam!.peringatan.some((p) => p.startsWith("teks terpotong: alamat")) && baris.length <= MAKS_BARIS_ALAMAT, `${tl}${tampilan ? ` ${tampilan}` : ""}: alamat 250 baris dipotong ke ${MAKS_BARIS_ALAMAT} baris dengan peringatan, tidak ada teks di luar kertas`);
        }
        for (const tl of ["HKA_STANDAR", "HKA_BERMEREK", "HKA_MINIMAL"] as const) {
          const m = masukan(kop, data("kwitansiDpro", p1.id, (d) => ((d.jenis = "kwitansi"), (d.kwitansi!.terimaDari = "x\n".repeat(100)))), { judul: "KWITANSI" });
          await renderDokumen(m, { tataLetak: tl, tampilanEvent: null, judulBerkas: "Uji" });
          pastikan(luap(m.perekam!) === 0 && m.perekam!.teks.some((t) => t.teks.toLowerCase().includes("x x x")), `${tl} kwitansi: terima dari 100 baris dicetak satu baris, tidak ada teks di luar kertas`);
        }
      }

      // T5: awalan rupiah tabel surat seragam "Rp. "
      {
        const m = masukan(kopPolos(p1.id), data("hkaStandar", p1.id, (d) => (d.jenis = "faktur")));
        await renderDokumen(m, { tataLetak: "HKA_SURAT", tampilanEvent: null, judulBerkas: "Uji" });
        const tanpaTitik = m.perekam!.teks.filter((t) => /Rp \d/.test(t.teks)).map((t) => t.teks);
        pastikan(teksAda(m.perekam!, "Rp. 1.898.100") && tanpaTitik.length === 0, `surat faktur: semua nominal tabel berawalan "Rp. " (${tanpaTitik.join(", ") || "tanpa Rp polos"})`);
      }

      // T6: tinta minimal = warna aksen kop
      {
        const warna = new Map<string, string | undefined>();
        const asli = KanvasCetak.prototype.teks;
        KanvasCetak.prototype.teks = function (this: KanvasCetak, isi: Parameters<typeof asli>[0], opsi: OpsiTeks) {
          if (typeof isi === "string") warna.set(isi, opsi.warna);
          return asli.call(this, isi, opsi);
        };
        try {
          const kop = { ...kopPolos(p1.id), warnaAksen: "#CA1E1E", warnaTinta: "#1A1A1F" };
          const m = masukan(kop, data("hkaStandar", p1.id, (d) => (d.jenis = "faktur")));
          await renderDokumen(m, { tataLetak: "HKA_MINIMAL", tampilanEvent: null, judulBerkas: "Uji" });
        } finally {
          KanvasCetak.prototype.teks = asli;
        }
        const judul = [...warna.entries()].find(([t]) => t === "I N V O I C E");
        const pakaiTinta = [...warna.values()].filter((w) => w?.toUpperCase() === "#1A1A1F").length;
        pastikan(judul?.[1]?.toUpperCase() === "#CA1E1E" && pakaiTinta === 0, `minimal: judul dan teks memakai warna aksen kop, bukan warna tinta (${judul?.[1]}, ${pakaiTinta} teks bertinta)`);
      }

      // T7: retur tanpa pembayaran tercetak di tampilan event
      for (const tampilan of ["RINCI", "RINGKAS"] as const) {
        const m = masukan(
          kopPolos(p1.id),
          data(tampilan === "RINCI" ? "hkaNawasena" : "hkaEvoked", p1.id, (d) => {
            d.jenis = "faktur";
            d.ringkasan.terbayar = "0.00";
            d.ringkasan.uangMuka = "0.00";
            d.uangMukaDipakai = [];
            d.ringkasan.retur = "100000.00";
            d.ringkasan.sisa = new Prisma.Decimal(d.ringkasan.total).minus(100000).toFixed(2);
          }),
        );
        await renderDokumen(m, { tataLetak: "HKA_BERMEREK", tampilanEvent: tampilan, judulBerkas: "Uji" });
        pastikan(teksAda(m.perekam!, "Retur") && teksAda(m.perekam!, "Sisa Tagihan") && teksAda(m.perekam!, "100.000"), `faktur event ${tampilan}: retur tanpa pembayaran mencetak Retur dan Sisa Tagihan`);
      }
    }
  } finally {
    await bersihkan();
  }
  const sisa = await db.perusahaan.count({ where: { kode: { startsWith: AWALAN } } });
  pastikan(sisa === 0 && (await db.kopSurat.count({ where: { nama: { startsWith: AWALAN } } })) === 0, "data uji cetak dibersihkan");
  console.log("=== DONE, all cetak checks passed ===");
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await bersihkan().catch(() => {});
    await db.$disconnect();
    process.exit(1);
  });
