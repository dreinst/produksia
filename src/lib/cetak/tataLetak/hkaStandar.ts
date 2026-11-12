import { KERTAS, type KanvasCetak, type OpsiTeks, type Segmen } from "@/lib/cetak/mesin/kanvas";
import { gambarTabel, type BarisTabel, type SelTabel } from "@/lib/cetak/mesin/tabel";
import { formatJumlah, formatRupiah, formatTanggalPendek } from "@/lib/cetak/format";
import type { BarisCetak, JenisCetak } from "@/lib/cetak/tipe";
import type { Desimal } from "@/lib/uang";
import {
  PUTIH,
  alirBerbutir,
  alirTeks,
  barisDicetak,
  berbutir,
  bukanNol,
  buatKanvas,
  jarak,
  persen,
  ruangUtuh,
  satuBaris,
  syaratDicetak,
  tandaTanganDipakai,
  teksUangMukaDipotong,
  type MasukanTataLetak,
} from "@/lib/cetak/tataLetak/blok";

/*
 * Tata letak generik HKA (D3 §3.8, spec/02 §11-§15) dan blok bersamanya. Geometri, ukuran huruf, dan urutan blok
 * mengikuti generator HKA (ReportLab, Helvetica) apa adanya di atas KanvasCetak, dengan Carlito pada ukuran pt yang
 * sama dan label berbahasa Indonesia. Kertas selalu A4, margin kiri dan kanan 18 mm, atas 12 mm, bawah 18 mm (30 mm
 * bila ada ikon sosial, 42 mm untuk kaki bergelombang yang berisi ikon atau alamat kaki). Blok bersama di berkas ini
 * dipakai tata letak bermerek, surat, minimal, dan tampilan event.
 */

/** Jarak baris paragraf HKA: ukuran × 1,35 (P() generator). */
export const SPASI_HKA = 1.35;
/** Ascender Carlito (hhea 1950/2048): jarak puncak kotak baris ke garis dasar per pt ukuran huruf. */
const ASCENDER = 1950 / 2048;
export const ABU = { label: "#777777", teks: "#444444", sedang: "#555555", gelap: "#333333", garisTipis: "#DDDDDD" } as const;

/** Campur warna HEX ke putih sebanyak `jumlah` (0,85 = sangat muda), seperti tint() generator HKA. */
export function tint(hex: string, jumlah: number): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  const n = parseInt(hex.slice(1), 16);
  const campur = (v: number) => Math.round(v + (255 - v) * jumlah);
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => campur(v).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

/** Huruf dipisah satu spasi, antarkata tiga spasi tak putus: "INVOICE" jadi "I N V O I C E" (spaced() HKA). */
export const berspasi = (t: string) =>
  t
    .split(/\s+/)
    .filter(Boolean)
    .map((kata) => Array.from(kata).join(" "))
    .join("   ");

export type Hka = {
  k: KanvasCetak;
  m: MasukanTataLetak;
  /** tepi kiri dan lebar isi (174 mm) dalam pt */
  x0: number;
  W: number;
  mm: (v: number) => number;
  aksen: string;
  tinta: string;
};

export type OpsiDekorasi = {
  /** gelombang kaki warna aksen dengan alamat kaki (bermerek, surat) */
  gelombang: boolean;
  /** ikon sosial di kiri bawah (dokumen biasa; tampilan event hanya bila kaki bergelombang) */
  ikon: boolean;
};

type Ikon = { huruf: string; nilai: string };

/** Ikon sosial berurutan: IG (Instagram), @ (email), f (Facebook), T (telepon), hanya yang terisi. */
export function ikonSosial(m: MasukanTataLetak): Ikon[] {
  const i = m.identitas;
  return [
    { huruf: "IG", nilai: i.instagram },
    { huruf: "@", nilai: i.email },
    { huruf: "f", nilai: i.facebook },
    { huruf: "T", nilai: i.telepon },
  ].filter((x): x is Ikon => !!x.nilai?.trim());
}

/** Opsi teks HKA: jarak baris 1,35 × ukuran. */
export function o(h: Hka, ukuran: number, lain: Partial<OpsiTeks> = {}): OpsiTeks {
  return { x: h.x0, lebar: h.W, ukuran, warna: h.tinta, tinggiBaris: { pasti: SPASI_HKA * ukuran }, ...lain };
}

/**
 * Kanvas HKA: A4, area isi, dan dekorasi setiap halaman (watermark logo 22%, ikon sosial, gelombang dan alamat kaki,
 * atau teks kaki). Halaman pertama sudah dibuat dan kursor di atas area isi.
 */
export function mulaiHka(m: MasukanTataLetak, judulBerkas: string, d: OpsiDekorasi): Hka {
  const k = buatKanvas({ ...m, ukuran: "A4" }, judulBerkas);
  const mm = (v: number) => k.mm(v);
  const ikon = d.ikon ? ikonSosial(m) : [];
  const deko = d.gelombang && (ikon.length > 0 || !!m.identitas.alamatKaki?.trim());
  // bawah 30 mm bila ada ikon sosial tanpa gelombang (D3 §3.8: ikon HKA menimpa isi di margin 18 mm);
  // gelombang tanpa ikon dan alamat tetap 19 mm tingginya, jadi margin 22 mm supaya isi tidak tertutup
  const bawah = d.gelombang ? (deko ? 42 : 22) : ikon.length ? 30 : 18;
  const h: Hka = { k, m, x0: mm(18), W: mm(174), mm, aksen: m.tema.warnaAksen, tinta: m.tema.warnaTinta };
  k.aturArea({ atas: mm(12), bawah: mm(bawah), kiri: mm(18), kanan: mm(18) });
  k.halamanBaru(KERTAS.A4, { belakang: (kk) => dekorasiHka(kk, h, d, ikon) });
  return h;
}

/** Dekorasi halaman HKA (page_deco, spec/02 §11.4), digambar di lapisan belakang setiap halaman. */
function dekorasiHka(k: KanvasCetak, h: Hka, d: OpsiDekorasi, ikon: Ikon[]): void {
  const { m } = h;
  const mm = (v: number) => k.mm(v);
  const L = k.lebarKertas;
  const T = k.tinggiKertas;
  const logo = m.tema.aset.LOGO;
  if (m.tema.tampilWatermark && logo) {
    const u = k.ukuranGambar(logo);
    const w = mm(120);
    const tinggi = (w * u.tinggi) / u.lebar;
    k.gambar(logo, { x: (L - w) / 2, y: T / 2 + mm(10) - tinggi / 2, w, h: tinggi, opasitas: 0.22 }, "WATERMARK");
  }
  // y dari bawah kertas seperti ReportLab, diubah ke koordinat kanvas
  const dariBawah = (v: number) => T - v;
  ikon.forEach((ik, i) => {
    const x = mm(22 + (i % 2) * 62);
    const y = mm(22 - Math.floor(i / 2) * 9);
    const cy = dariBawah(y + mm(1.2));
    k.lingkaran(x, cy, mm(3), { isi: h.aksen });
    const uHuruf = 6.5;
    k.teks(ik.huruf, { x: x - mm(3), y: cy - 0.6 * uHuruf, lebar: mm(6), ukuran: uHuruf, font: "B", warna: PUTIH, rata: "tengah" });
    k.teks(ik.nilai, { x: x + mm(5), y: dariBawah(y) - ASCENDER * 9, lebar: mm(56), ukuran: 9, warna: ABU.teks });
  });
  if (d.gelombang) {
    k.bentuk(
      [
        { ke: [0, T] },
        { garis: [0, dariBawah(mm(5))] },
        { garis: [L * 0.6, dariBawah(mm(5))] },
        { kurva: [L * 0.66, dariBawah(mm(5)), L * 0.66, dariBawah(mm(19)), L * 0.72, dariBawah(mm(19))] },
        { garis: [L, dariBawah(mm(19))] },
        { garis: [L, T] },
      ],
      { isi: h.aksen },
    );
    const alamat = (m.identitas.alamatKaki ?? "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 3);
    alamat.forEach((baris, n) => {
      k.teks(baris.slice(0, 45), { x: L * 0.74, y: dariBawah(mm(14.5 - n * 4)) - ASCENDER * 8.5, lebar: L * 0.26 - mm(4), ukuran: 8.5, font: "B", warna: PUTIH });
    });
  } else if (m.identitas.teksKaki?.trim()) {
    k.teks(m.identitas.teksKaki.trim().slice(0, 150), { x: mm(10), y: dariBawah(mm(9)) - ASCENDER * 7.5, lebar: L - mm(20), ukuran: 7.5, warna: ABU.label, rata: "tengah" });
  }
}

/** Judul merek diisi sendiri (bukan cadangan nama perusahaan). */
const merekEksplisit = (m: MasukanTataLetak) => m.identitas.judulMerek !== m.identitas.nama;

/** Kepala tengah (centered_header, spec/02 §11.5): logo 22 mm, judul merek, teks kepala. */
export function kepalaTengah(h: Hka): void {
  const { k, m, x0, W } = h;
  const logo = m.tema.aset.LOGO;
  if (logo) {
    k.pastikanRuang(h.mm(22));
    k.gambar(logo, { x: x0, y: k.y, muat: [W, h.mm(22)] }, "LOGO");
    k.y += h.mm(22);
  }
  if (merekEksplisit(m) || !logo) k.teks(m.identitas.judulMerek, o(h, 13, { font: "B", warna: h.aksen, rata: "tengah" }));
  if (m.identitas.teksKepala?.trim()) k.teks(m.identitas.teksKepala.trim(), o(h, 10, { font: "B", warna: tint(h.aksen, 0.35), rata: "tengah" }));
}

// ---------- Label dan angka ----------

export const LABEL_NOMOR_HKA: Record<JenisCetak, string> = {
  penawaran: "No. Penawaran",
  "tagihan-termin": "No. Tagihan",
  faktur: "No. Invoice",
  kwitansi: "No. Kwitansi",
  "kwitansi-dp": "No. Kwitansi",
};

/** Batas baris alamat pelanggan di blok KEPADA (textarea 500 karakter, baris baru disimpan apa adanya). */
export const MAKS_BARIS_ALAMAT = 6;

/**
 * Alamat pelanggan paling banyak MAKS_BARIS_ALAMAT baris. Sisanya dibuang, baris terakhir ditutup "…", dan peringatan
 * "teks terpotong" dicatat, supaya blok KEPADA yang digambar ber-y tetap tidak meluap keluar kertas.
 */
export function alamatHka(h: Hka, alamat: string | null | undefined): string | null {
  const baris = (alamat ?? "").trim().split("\n").map((s) => s.trimEnd());
  if (!baris.join("").trim()) return null;
  if (baris.length <= MAKS_BARIS_ALAMAT) return baris.join("\n");
  h.k.peringatan(`teks terpotong: alamat ${baris[0].slice(0, 50)}`);
  const sisa = baris.slice(0, MAKS_BARIS_ALAMAT);
  sisa[MAKS_BARIS_ALAMAT - 1] = `${sisa[MAKS_BARIS_ALAMAT - 1]}…`;
  return sisa.join("\n");
}

/** Nama penerima kwitansi (terima dari) atau nama pelanggan, selalu satu baris. */
export const penerimaHka = (m: MasukanTataLetak, kw: boolean) => satuBaris(kw ? (m.dok.kwitansi?.terimaDari ?? m.dok.kepada.nama) : m.dok.kepada.nama);

/**
 * Baris label dan nilai berposisi tetap (rekening): tinggi seluruh baris diukur dulu, lalu pindah halaman bila tidak
 * muat (ruangUtuh), supaya tidak turun ke kaki halaman.
 */
export function barisLabelHka(h: Hka, daftar: [string, string][], label: (teks: string, y: number) => OpsiTeks, nilai: (teks: string, y: number) => OpsiTeks): void {
  const { k } = h;
  const tinggi = daftar.reduce((n, [a, b]) => n + Math.max(k.ukur(a, label(a, 0)).tinggi, k.ukur(b, nilai(b, 0)).tinggi), 0);
  ruangUtuh(k, tinggi);
  for (const [a, b] of daftar) {
    const y = k.y;
    k.y = y + Math.max(k.teks(a, label(a, y)), k.teks(b, nilai(b, y)));
  }
}

export const kwitansiHka = (m: MasukanTataLetak) => m.dok.jenis === "kwitansi" || m.dok.jenis === "kwitansi-dp";

/** Rupiah dengan awalan pilihan ("Rp ", "Rp. ", "Rp.", atau ""). */
export const rpHka = (m: MasukanTataLetak, d: Desimal, awalan = "Rp ") => formatRupiah(d, m.tema.gayaAngka, m.tema.desimal, { awalan });
export const qtyHka = (m: MasukanTataLetak, d: Desimal) => formatJumlah(d, m.tema.gayaAngka);

/** Jumlah baris; frekuensi selain 1 ditulis sesudahnya supaya jumlah × harga tetap terbaca. */
export function qtyBaris(m: MasukanTataLetak, b: BarisCetak, denganSatuan = false): string {
  const dasar = denganSatuan ? `${qtyHka(m, b.jumlah)} ${b.satuan}` : qtyHka(m, b.jumlah);
  return b.frekuensi.equals(1) ? dasar : `${dasar} × ${qtyHka(m, b.frekuensi)}${b.satuanFrekuensi ? ` ${b.satuanFrekuensi}` : ""}`;
}

/** Nama penerbit huruf besar di blok tanda tangan: nama legal (cadangan nama perusahaan). */
export const namaPenerbit = (m: MasukanTataLetak) => (m.identitas.namaLegal || m.identitas.nama).toLocaleUpperCase("id-ID");

export type BarisTotalHka = { label: string; nilai: Desimal; kurang?: boolean };

/**
 * Baris ringkasan (totals_rows HKA dengan penyesuaian D3 §3.8): Subtotal, Diskon (bila ada), Management Fee (bila
 * ada; HKA hanya mencetaknya di event, tetapi tanpa baris ini Total tidak sama dengan jumlah barisnya), PPN (bila
 * tidak 0), lalu Total, dan baris tambahan faktur (Uang muka, Pembayaran diterima, Retur, Sisa tagihan, D3 §3.2).
 */
export function ringkasanHka(m: MasukanTataLetak): { rinci: BarisTotalHka[]; total: Desimal; tambahan: BarisTotalHka[] } {
  const r = m.dok.ringkasan;
  const rinci: BarisTotalHka[] = [{ label: "Subtotal", nilai: r.subtotal }];
  if (bukanNol(r.diskon)) rinci.push({ label: "Diskon", nilai: r.diskon, kurang: true });
  if (bukanNol(r.fee)) rinci.push({ label: r.feePersen ? `Management Fee ${persen(m, r.feePersen)}%` : "Management Fee", nilai: r.fee });
  if (bukanNol(r.ppn)) rinci.push({ label: `PPN ${persen(m, r.ppnPersen)}%`, nilai: r.ppn });
  const tambahan: BarisTotalHka[] = [];
  if (m.dok.jenis === "faktur") {
    const diterima = r.terbayar.minus(r.uangMuka);
    if (bukanNol(r.uangMuka)) tambahan.push({ label: "Uang muka", nilai: r.uangMuka });
    if (diterima.greaterThan(0)) tambahan.push({ label: "Pembayaran diterima", nilai: diterima });
    if (r.retur.greaterThan(0)) tambahan.push({ label: "Retur", nilai: r.retur });
    if (tambahan.length) tambahan.push({ label: "Sisa tagihan", nilai: r.sisa });
  }
  if (m.dok.jenis === "penawaran" && r.addOn && bukanNol(r.addOn.nilai)) tambahan.push({ label: `Add on${r.addOn.keterangan ? ` (${satuBaris(r.addOn.keterangan)})` : ""}`, nilai: r.addOn.nilai });
  return { rinci, total: r.total, tambahan };
}

/** Nilai baris total: "- Rp ..." untuk pengurang. */
export const nilaiTotal = (m: MasukanTataLetak, b: BarisTotalHka, awalan = "Rp ") => (b.kurang ? `- ${rpHka(m, b.nilai, awalan)}` : rpHka(m, b.nilai, awalan));

/** Rekening penerbit (entity_bank): null bila dokumen punya info bank sendiri. */
export function rekeningHka(m: MasukanTataLetak): [string, string][] | null {
  if (m.dok.surat.infoBank?.trim()) return null;
  const i = m.identitas;
  return [
    ["Bank", i.namaBank ?? ""],
    ["No. Rekening", i.nomorRekening ?? ""],
    ["Atas Nama", i.atasNamaRekening ?? ""],
  ];
}

/** Baris rekening sebagai teks: info bank dokumen, atau bank, nomor, dan "a.n. pemilik" (yang kosong dibuang). */
export function teksRekeningHka(m: MasukanTataLetak): string {
  const info = m.dok.surat.infoBank?.trim();
  if (info) return info;
  const i = m.identitas;
  return [i.namaBank, i.nomorRekening, i.atasNamaRekening ? `a.n. ${i.atasNamaRekening}` : null].filter((s): s is string => !!s?.trim()).join("\n");
}

/** Syarat pembayaran cetak (skema termin penawaran) ditambah daftar uang muka yang dipotong faktur. */
export function syaratHka(m: MasukanTataLetak): string | null {
  const bagian = [syaratDicetak(m), teksUangMukaDipotong(m)].filter((s): s is string => !!s);
  return bagian.length ? bagian.join("\n") : null;
}

/** Teks berbutir mengalir di kursor selebar isi (atau kolom). */
export function butirHka(h: Hka, teks: string | null | undefined, ukuran: number, warna: string, lain: Partial<OpsiTeks> = {}): boolean {
  const daftar = berbutir(teks);
  if (!daftar.length) return false;
  alirBerbutir(h.k, daftar, o(h, ukuran, { warna, ...lain }));
  return true;
}

/** Paragraf biasa yang mengalir antarhalaman. */
export function paragrafHka(h: Hka, teks: string | Segmen[], ukuran: number, lain: Partial<OpsiTeks> = {}): void {
  alirTeks(h.k, teks, o(h, ukuran, lain));
}

/** Tanggal kedua dan labelnya untuk meta: Berlaku sampai, Jatuh tempo, atau tanggal bayar kwitansi. */
export function tanggalKeduaHka(m: MasukanTataLetak, labelKwitansi: string): { label: string; nilai: string } {
  if (kwitansiHka(m)) return { label: labelKwitansi, nilai: formatTanggalPendek(m.dok.tanggal) };
  const t = m.dok.tanggalKedua;
  const label = t?.label ?? (m.dok.jenis === "penawaran" ? "Berlaku sampai" : "Jatuh tempo");
  return { label, nilai: t ? formatTanggalPendek(t.tanggal) : "-" };
}

/** Uraian kwitansi: keperluan, atau "Pembayaran {dokumen}". */
export function uraianKwitansiHka(m: MasukanTataLetak): string {
  const kw = m.dok.kwitansi;
  return satuBaris(kw?.keperluan) || (kw?.untukDokumen ? `Pembayaran invoice ${kw.untukDokumen}` : `Pembayaran ${m.dok.nomorTampil}`);
}

/** Jumlah kwitansi (jumlah diterima termasuk potongan pajak, D2 §6.3), atau total dokumen bila tanpa data kwitansi. */
export const jumlahKwitansiHka = (m: MasukanTataLetak) => m.dok.kwitansi?.jumlah ?? m.dok.ringkasan.total;

/** Catatan potongan PPh 23 di bawah nominal kwitansi (D3 §3.2). */
export function catatanPotonganHka(h: Hka, ukuran = 9): void {
  const pot = h.m.dok.kwitansi?.potonganPajak;
  if (bukanNol(pot)) paragrafHka(h, `Termasuk PPh 23 dipotong pelanggan: ${rpHka(h.m, pot!)}`, ukuran, { warna: ABU.teks });
}

// ---------- Tanda tangan ----------

/**
 * Blok tanda tangan HKA (signature_block, spec/02 §11.3) di kolom kanan 62 mm: salam, nama penerbit huruf besar,
 * gambar 22 mm atau ruang 18 mm, nama bergaris bawah, jabatan. Tidak terpotong antarhalaman.
 */
export function tandaTanganHka(h: Hka): void {
  const { k, m } = h;
  const lebar = h.mm(62);
  const x = h.x0 + h.W - lebar;
  const opsi = (lain: Partial<OpsiTeks> = {}) => o(h, 9.5, { x, lebar, rata: "tengah", ...lain });
  const ttd = tandaTanganDipakai(m);
  const nama = m.identitas.penandaTangan?.trim();
  const jabatan = m.identitas.jabatanPenandaTangan?.trim();
  const tSalam = k.ukur(m.identitas.teksSalam, opsi()).tinggi;
  const tPenerbit = k.ukur(namaPenerbit(m), opsi()).tinggi;
  const ruang = ttd ? h.mm(22) : h.mm(18);
  const tinggi = tSalam + tPenerbit + ruang + (nama ? k.ukur(nama, opsi()).tinggi : 0) + (jabatan ? k.ukur(jabatan, opsi()).tinggi : 0);
  ruangUtuh(k, tinggi);
  let y = k.y;
  y += k.teks(m.identitas.teksSalam, opsi({ y }));
  y += k.teks(namaPenerbit(m), opsi({ y }));
  if (ttd) k.gambar(ttd, { x, y, muat: [lebar, ruang] }, "TANDA_TANGAN");
  y += ruang;
  if (nama) y += k.teks(nama, opsi({ y, garisBawah: true }));
  if (jabatan) y += k.teks(jabatan, opsi({ y }));
  k.y = y;
}

// ---------- Tabel bantu ----------

/** Sel tabel HKA dengan bawaan ukuran dan warna tinta. */
export function sel(h: Hka, isi: SelTabel["isi"], ukuran: number, lain: Partial<SelTabel> = {}): SelTabel {
  return { isi, ukuran, warna: h.tinta, tinggiBaris: { pasti: SPASI_HKA * ukuran }, ...lain };
}

/**
 * Garis sel hanya di sisi tertentu. Tipe garis sel mesin hanya { warna, tebal }; kotak() kanvas yang menggambarnya
 * menerima `sisi` juga, jadi objek ini diteruskan apa adanya.
 */
export function garisSisi(warna: string, tebal: number, sisi: ("atas" | "bawah" | "kiri" | "kanan")[]): SelTabel["garis"] {
  const g: { warna: string; tebal: number; sisi: typeof sisi } = { warna, tebal, sisi };
  return g;
}

/** Isi sel uraian: nama (opsional tebal) lalu deskripsi berbutir. */
export function uraianBaris(b: BarisCetak, denganNama: boolean): SelTabel["isi"] {
  const deskripsi = berbutir(b.deskripsi);
  if (!denganNama) return deskripsi.length ? deskripsi : "-";
  if (!deskripsi.length) return b.nama;
  return [{ jenis: "paragraf", isi: [{ teks: b.nama, tebal: false }] }, ...deskripsi];
}

/** Tabel ringkasan rata kanan: label | nilai. */
export function tabelTotalKanan(h: Hka, kolom: [number, number], baris: BarisTabel[], garis?: { warna: string; tebal: number }): void {
  const lebar = kolom[0] + kolom[1];
  gambarTabel(h.k, { x: h.x0 + h.W - lebar, kolom, baris, garisBawaan: garis, ulangKepala: false });
}

// ---------- Tata letak standar (spec/02 §15) ----------

/**
 * Tata letak standar: kepala tiga kolom (logo bila tampilLogo, identitas penerbit, judul dan nomor), pelanggan dan
 * meta, tabel item, ringkasan, syarat, rekening, catatan, tanda tangan, kaki teks. Kolom diskon baris HKA tidak ada
 * karena baris Produksia tidak menyimpan diskon per baris; lebarnya masuk ke kolom uraian.
 */
export async function renderHkaStandar(m: MasukanTataLetak, judulBerkas: string): Promise<Uint8Array> {
  const h = mulaiHka(m, judulBerkas, { gelombang: false, ikon: true });
  const { k, x0, W, mm, aksen } = h;
  const { dok, identitas: i } = m;
  const kw = kwitansiHka(m);

  // 1. Kepala tiga kolom, garis bawah aksen 1,2 pt
  {
    const logo = m.tema.tampilLogo ? m.tema.aset.LOGO : undefined;
    const wLogo = logo ? mm(22) : 1;
    const wTengah = 0.55 * W - wLogo;
    const wKanan = 0.45 * W;
    const y = k.y;
    let hLogo = 0;
    if (logo) {
      k.gambar(logo, { x: x0, y, muat: [wLogo - mm(2), mm(16)], rata: "kiri" }, "LOGO");
      hLogo = mm(16);
    }
    const xT = x0 + wLogo;
    let yT = y;
    yT += k.teks(i.nama, o(h, 14, { x: xT, y: yT, lebar: wTengah, font: "B" }));
    if (i.teksKepala?.trim()) yT += k.teks(i.teksKepala.trim(), o(h, 8, { x: xT, y: yT, lebar: wTengah, warna: ABU.sedang }));
    const kontak = [i.telepon, i.email, i.website].filter((s): s is string => !!s?.trim()).join(" · ");
    const detail = [i.alamat, kontak, i.npwp ? `NPWP: ${i.npwp}` : null].filter((s): s is string => !!s?.trim()).join("\n");
    if (detail) yT += k.teks(detail, o(h, 8, { x: xT, y: yT, lebar: wTengah, warna: ABU.sedang }));
    const xK = x0 + W - wKanan;
    let yK = y;
    yK += k.teks(m.judul, o(h, 18, { x: xK, y: yK, lebar: wKanan, font: "B", warna: aksen, rata: "kanan" }));
    yK += k.teks(dok.nomorTampil, o(h, 10, { x: xK, y: yK, lebar: wKanan, font: "B", rata: "kanan" }));
    const bawah = Math.max(y + hLogo, yT, yK) + 8;
    k.garis(x0, bawah, x0 + W, bawah, { warna: aksen, tebal: 1.2 });
    k.y = bawah;
    jarak(k, mm(6));
  }

  // 2. Pelanggan (kiri) dan meta (kanan 28 + 42 mm)
  {
    const wMeta = mm(72);
    const wKiri = W - wMeta;
    const y = k.y;
    let yL = y;
    yL += k.teks(kw ? "DITERIMA DARI" : "KEPADA", o(h, 7, { y: yL, lebar: wKiri, font: "B", warna: ABU.label }));
    yL += k.teks(penerimaHka(m, kw), o(h, 10, { y: yL, lebar: wKiri, font: "B" }));
    const kontak = [dok.kepada.up, dok.kepada.email, dok.kepada.telepon, alamatHka(h, dok.kepada.alamat)].filter((s): s is string => !!s?.trim()).join("\n");
    if (kontak) yL += k.teks(kontak, o(h, 8.5, { y: yL, lebar: wKiri, warna: ABU.teks }));
    const kedua = tanggalKeduaHka(m, "Tanggal bayar");
    const meta: [string, string][] = [["Tanggal", formatTanggalPendek(dok.tanggal)], [kedua.label, kedua.nilai]];
    if (dok.referensi?.trim()) meta.push(["Referensi", dok.referensi.trim()]);
    let yR = y;
    const xM = x0 + W - mm(70);
    for (const [label, nilai] of meta) {
      const tl = k.teks(label, o(h, 8, { x: xM, y: yR, lebar: mm(28), warna: ABU.label }));
      const tn = k.teks(nilai, o(h, 8.5, { x: xM + mm(28), y: yR, lebar: mm(42), font: "B", rata: "kanan" }));
      yR += Math.max(tl, tn) + 2;
    }
    k.y = Math.max(yL, yR);
    jarak(k, mm(6));
  }

  // 3. Tabel item
  const garisBaris = garisSisi(ABU.garisTipis, 0.4, ["bawah"]);
  const kepalaSel = (isi: string, rata: SelTabel["rata"] = "kiri") => sel(h, isi, 8, { font: "B", warna: PUTIH, latar: aksen, rata, pad: [5, 5, 5, 5], garis: null });
  const isiSel = (isi: SelTabel["isi"], ukuran: number, lain: Partial<SelTabel> = {}) => sel(h, isi, ukuran, { pad: [5, 5, 5, 5], garis: garisBaris, ...lain });
  if (kw) {
    gambarTabel(k, {
      x: x0,
      kolom: [W - mm(45), mm(45)],
      kepala: { sel: [kepalaSel("Uraian"), kepalaSel("Jumlah", "kanan")] },
      baris: [{ sel: [isiSel(uraianKwitansiHka(m), 8.5), isiSel(rpHka(m, jumlahKwitansiHka(m)), 8.5, { font: "B", rata: "kanan" })] }],
    });
  } else {
    const kolom = [0.2, 0.33, 0.07, 0.08, 0.15, 0.17].map((p) => p * W);
    gambarTabel(k, {
      x: x0,
      kolom,
      kepala: { sel: [kepalaSel("Item"), kepalaSel("Uraian"), kepalaSel("Qty", "kanan"), kepalaSel("Satuan", "kanan"), kepalaSel("Harga satuan", "kanan"), kepalaSel("Jumlah", "kanan")] },
      baris: barisDicetak(m).map((b) => ({
        sel: [
          isiSel(b.nama, 8.5, { font: "B" }),
          isiSel(uraianBaris(b, false), 8, { warna: ABU.teks }),
          isiSel(qtyBaris(m, b), 8.5, { rata: "kanan" }),
          isiSel(b.satuan, 8.5, { rata: "kanan" }),
          isiSel(rpHka(m, b.harga), 8.5, { rata: "kanan" }),
          isiSel(rpHka(m, b.nilai), 8.5, { rata: "kanan", font: "B" }),
        ],
      })),
    });
  }
  jarak(k, mm(4));

  // 4. Ringkasan, syarat, rekening (kwitansi: metode pembayaran)
  if (kw) {
    paragrafHka(h, `Metode pembayaran: ${satuBaris(dok.kwitansi?.metodeBayar) || "-"}`, 9);
    catatanPotonganHka(h);
  } else {
    const r = ringkasanHka(m);
    const baris = (label: string, nilai: string, tebal = false, besar = 9): BarisTabel => ({
      sel: [sel(h, label, 9, { font: tebal ? "B" : "R", rata: "kanan", pad: [3, 3, 0, 3], garis: null }), sel(h, nilai, besar, { font: tebal ? "B" : "R", rata: "kanan", pad: [3, 0, 0, 3], garis: null })],
    });
    tabelTotalKanan(h, [mm(35), mm(45)], [
      ...r.rinci.map((b) => baris(b.label, nilaiTotal(m, b))),
      baris("Total", rpHka(m, r.total), true, 11),
      ...r.tambahan.map((b) => baris(b.label, nilaiTotal(m, b), b.label === "Sisa tagihan")),
    ]);
    jarak(k, mm(6));
    const syarat = syaratHka(m);
    if (syarat) {
      paragrafHka(h, "SYARAT PEMBAYARAN", 7, { font: "B", warna: ABU.label });
      butirHka(h, syarat, 8.5, h.tinta);
      jarak(k, mm(3));
    }
    const rekening = teksRekeningHka(m);
    if (rekening) {
      paragrafHka(h, "INFORMASI REKENING", 7, { font: "B", warna: ABU.label });
      paragrafHka(h, rekening, 8.5);
      jarak(k, mm(3));
    }
  }

  // 5. Catatan
  if (berbutir(dok.surat.catatan).length) {
    paragrafHka(h, "CATATAN", 7, { font: "B", warna: ABU.label });
    butirHka(h, dok.surat.catatan, 8.5, h.tinta);
    jarak(k, mm(3));
  }

  // 6. Tanda tangan
  jarak(k, mm(6));
  tandaTanganHka(h);
  return k.selesai();
}
