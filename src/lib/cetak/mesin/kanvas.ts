import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import type { UkuranKertas } from "@/prisma-klien/enums";
import { bersihkanTeks } from "@/lib/cetak/format";
import { DIR_ASET_CETAK, jalurFont, periksaGambar, type Font } from "@/lib/cetak/aset";

/*
 * KanvasCetak (D3 §3.10): pembungkus pdfkit untuk tata letak setia. Semua koordinat dalam pt dari tepi kiri atas
 * kertas. pdfkit tidak pernah dibiarkan menambah halaman atau membungkus teks sendiri: kanvas memecah baris dengan
 * pengukur pdfkit (widthOfString), menggambar per potongan dengan lineBreak: false, dan memutuskan pindah halaman
 * lewat pastikanRuang. Gambar hanya yang lolos periksaGambar (sekali per objek), atau berkas di src/aset-cetak.
 */

export type { Font };
export type Segmen = { teks: string; tebal?: boolean; miring?: boolean };

/** Bentuk BarisTeks D2 (src/lib/teksBerbutir.ts, P20); ditulis struktural supaya mesin tidak bergantung pada D2. */
export type BarisTeksCetak = { jenis: "paragraf" | "butir" | "subbutir"; isi: { teks: string; tebal: boolean }[] };

export type OpsiTeks = {
  x: number;
  /** Tanpa y: digambar di kursor dan kursor turun setinggi teks. Dengan y: kursor tidak berubah. */
  y?: number;
  lebar: number;
  ukuran: number;
  font?: Font;
  warna?: string;
  rata?: "kiri" | "tengah" | "kanan" | "rata";
  /** Angka = kelipatan spasi tunggal (1,3 = spasi 1,3 Word); { pasti } = tinggi baris dalam pt. Bawaan 1. */
  tinggiBaris?: number | { pasti: number };
  indenPertama?: number;
  hurufBesar?: boolean;
  garisBawah?: boolean;
  /** Jarak antarhuruf dalam pt. */
  jarakHuruf?: number;
  /**
   * Hanya baris hasil pemecahan dengan indeks dari <= i < sampai yang digambar; baris `dari` diletakkan di y (atau di
   * kursor). Dipakai gambarTabel untuk memecah baris tabel yang lebih tinggi dari satu halaman. Diabaikan oleh ukur.
   */
  rentang?: { dari: number; sampai: number };
};

/**
 * Isi yang tetap tidak muat walau sudah di halaman kosong (mis. satu baris teks atau gambar yang lebih tinggi dari
 * area halaman). Pesannya aman ditampilkan ke pengguna; pemanggil (rute cetak, aksi simpan PDF) menangkapnya.
 */
export class GalatIsiTerlaluTinggi extends Error {
  constructor(message = "Isi dokumen terlalu tinggi untuk satu halaman dan tidak bisa dipecah. Perpendek uraiannya atau pilih kertas yang lebih besar.") {
    super(message);
    this.name = "GalatIsiTerlaluTinggi";
  }
}

export type Perekam = {
  halaman: number;
  teks: { halaman: number; teks: string; x: number; y: number; lebar: number; tinggi: number; ukuran: number }[];
  gambar: { halaman: number; slot: string | null; x: number; y: number; w: number; h: number }[];
  peringatan: string[];
};

export const buatPerekam = (): Perekam => ({ halaman: 0, teks: [], gambar: [], peringatan: [] });

export type Kertas = { lebarMm: number; tinggiMm: number };
export const KERTAS: Record<UkuranKertas, Kertas> = {
  A4: { lebarMm: 210, tinggiMm: 297 },
  A5: { lebarMm: 148, tinggiMm: 210 },
  A5_LANDSCAPE: { lebarMm: 210, tinggiMm: 148 },
};
/** Skala desain D'Pro: 1 untuk A4 dan A5 landscape, 1748/2480 untuk A5 potret (D3 §3.6). */
export const SKALA_KERTAS: Record<UkuranKertas, number> = { A4: 1, A5: 1748 / 2480, A5_LANDSCAPE: 1 };

type Lapisan = { belakang?: (k: KanvasCetak) => void; depan?: (k: KanvasCetak, ke: number, dari: number) => void };
/**
 * Garis. `pola` = [panjang garis, jarak] dalam pt, mengalahkan pola bawaan `gaya` yang sebanding tebal (dipakai bila
 * desain menetapkan pola tetap, mis. titik 0,5/1,5 pt dan putus 3/1,5 pt di kwitansi D3 §3.7).
 */
export type GayaGaris = { warna: string; tebal: number; gaya?: "penuh" | "putus" | "titik"; pola?: [number, number] };

/** Potongan teks satu font di dalam satu baris. */
type Potongan = { teks: string; font: Font };
type Token = { spasi: boolean; potongan: Potongan[]; lebar: number };
type BarisJadi = { token: Token[]; lebar: number; akhirParagraf: boolean; inden: number };

const PT_PER_MM = 72 / 25.4;
const LEBAR_FRAME_PX = 2480;
const MM_FRAME = 210;
const SEMUA_FONT: Font[] = ["R", "B", "I", "BI"];

type GambarTerbuka = { width: number; height: number; orientation?: number };
type DokumenPdf = PDFKit.PDFDocument & {
  openImage(src: Buffer): GambarTerbuka;
  _font: { ascender: number; font: { hasGlyphForCodePoint(c: number): boolean } };
  _fontFamilies: Record<string, unknown>;
};

const fontSegmen = (dasar: Font, s: { tebal?: boolean; miring?: boolean }): Font => {
  const tebal = s.tebal || dasar === "B" || dasar === "BI";
  const miring = s.miring || dasar === "I" || dasar === "BI";
  return tebal && miring ? "BI" : tebal ? "B" : miring ? "I" : "R";
};

export class KanvasCetak {
  private readonly doc: DokumenPdf;
  private readonly potongan: Buffer[] = [];
  private readonly perekam?: Perekam;
  private readonly glyph = new Map<Font, { hasGlyphForCodePoint(c: number): boolean }>();
  private readonly ascender = new Map<Font, number>();
  private readonly pemeriksaGlyph = new Map<Font, (c: number) => boolean>();
  private readonly gambarTerbuka = new WeakMap<Uint8Array, GambarTerbuka>();
  private readonly isiBerkas = new Map<string, Uint8Array>();
  private readonly halaman: { kertas: Kertas; lapisan: Lapisan }[] = [];
  private indeks = -1;
  private _y = 0;
  private area = { atas: 0, bawah: 0, kiri: 0, kanan: 0 };
  private stempel: string | null = null;
  private sudahSelesai = false;
  /** Skala bawaan untuk px() dan ukuranHuruf() bila argumen s tidak diberikan (tata letak A5 potret: 1748/2480). */
  skala = 1;

  constructor(opsi: { judul: string; subjek: string; penulis: string; perekam?: Perekam }) {
    this.doc = new PDFDocument({
      autoFirstPage: false,
      bufferPages: true,
      margin: 0,
      font: jalurFont("R"),
      lang: "id-ID",
      displayTitle: true,
      info: { Title: bersihkanTeks(opsi.judul), Subject: bersihkanTeks(opsi.subjek), Author: bersihkanTeks(opsi.penulis), Creator: "Produksia" },
    } as PDFKit.PDFDocumentOptions) as DokumenPdf;
    this.perekam = opsi.perekam;
    this.doc.on("data", (b: Buffer) => this.potongan.push(b));
    for (const f of SEMUA_FONT) {
      this.doc.registerFont(f, jalurFont(f));
      this.doc.font(f);
      // pdfkit tidak menyimpan font di kunci nama terdaftar bila font bernama sama sudah ada (Regular dari opsi
      // `font`), sehingga setiap font("R") membuka dan mengurai TTF lagi. Simpan sendiri supaya font() memakai cache.
      this.doc._fontFamilies[f] = this.doc._font;
      this.glyph.set(f, this.doc._font.font);
      this.ascender.set(f, this.doc._font.ascender / 1000);
    }
    this.doc.font("R");
  }

  // ---------- Satuan ----------

  mm(v: number): number {
    return v * PT_PER_MM;
  }

  /** Piksel frame desain (lebar 2480 = 210 mm) ke pt: mm = px × 210 / 2480 × s. */
  px(v: number, s: number = this.skala): number {
    return this.mm((v * MM_FRAME * s) / LEBAR_FRAME_PX);
  }

  /** Ukuran huruf dari piksel frame: round(px × 0,24003 × s × 2) / 2. */
  ukuranHuruf(px: number, s: number = this.skala): number {
    return Math.round(px * 0.24003 * s * 2) / 2;
  }

  // ---------- Halaman dan kursor ----------

  get halamanKe(): number {
    return this.indeks + 1;
  }

  get jumlahHalaman(): number {
    return this.halaman.length;
  }

  get lebarKertas(): number {
    return this.mm(this.kertasSekarang().lebarMm);
  }

  get tinggiKertas(): number {
    return this.mm(this.kertasSekarang().tinggiMm);
  }

  private kertasSekarang(): Kertas {
    const h = this.halaman[this.indeks];
    if (!h) throw new Error("KanvasCetak: belum ada halaman (panggil halamanBaru dulu)");
    return h.kertas;
  }

  /** Halaman baru dengan lapisan belakang (digambar sekarang) dan depan (digambar saat selesai, per halaman). */
  halamanBaru(kertas: Kertas, lapisan: Lapisan = {}): void {
    if (this.sudahSelesai) throw new Error("KanvasCetak sudah selesai");
    this.doc.addPage({ size: [this.mm(kertas.lebarMm), this.mm(kertas.tinggiMm)], margin: 0 });
    this.halaman.push({ kertas, lapisan });
    this.indeks = this.halaman.length - 1;
    if (this.perekam) this.perekam.halaman = this.halaman.length;
    this._y = this.area.atas;
    lapisan.belakang?.(this);
  }

  /** Area isi dalam pt dari tepi kertas; berlaku untuk halaman ini dan halaman lanjutan. Kursor ke atas area. */
  aturArea(area: { atas: number; bawah: number; kiri: number; kanan: number }): void {
    this.area = { ...area };
    this._y = area.atas;
  }

  get areaIsi(): { atas: number; bawah: number; kiri: number; kanan: number; lebar: number } {
    return { ...this.area, lebar: this.lebarKertas - this.area.kiri - this.area.kanan };
  }

  get y(): number {
    return this._y;
  }

  set y(v: number) {
    this._y = v;
  }

  /** Tinggi tersisa di area isi halaman ini. */
  sisa(): number {
    return this.tinggiKertas - this.area.bawah - this._y;
  }

  /**
   * Pindah ke halaman lanjutan (kertas dan lapisan sama) bila sisa() < tinggi. Mengembalikan true bila halaman
   * ditambah. Halaman yang masih kosong tidak ditambah lagi walau isinya lebih tinggi dari satu halaman: tanpa
   * `ketat` hanya peringatan dicatat, dengan `ketat` dilempar GalatIsiTerlaluTinggi supaya isi tidak terpotong diam-diam.
   */
  pastikanRuang(tinggi: number, opsi: { ketat?: boolean } = {}): boolean {
    if (this.sisa() >= tinggi - 0.01) return false;
    if (this.halamanKosong()) {
      if (opsi.ketat) throw new GalatIsiTerlaluTinggi();
      this.peringatan(`Isi setinggi ${tinggi.toFixed(1)} pt lebih tinggi dari area halaman ${this.halamanKe}`);
      return false;
    }
    const { kertas, lapisan } = this.halaman[this.indeks];
    this.halamanBaru(kertas, lapisan);
    return true;
  }

  /** Kursor masih di atas area isi (belum ada isi yang mengalir di halaman ini). */
  halamanKosong(): boolean {
    return this._y <= this.area.atas + 0.01;
  }

  /** Tinggi area isi satu halaman penuh. */
  get tinggiArea(): number {
    return this.tinggiKertas - this.area.atas - this.area.bawah;
  }

  /** Pindah ke halaman lanjutan dengan kertas dan lapisan halaman ini. */
  lanjutHalaman(): void {
    const { kertas, lapisan } = this.halaman[this.indeks] ?? {};
    if (!kertas) throw new Error("KanvasCetak: belum ada halaman (panggil halamanBaru dulu)");
    this.halamanBaru(kertas, lapisan);
  }

  peringatan(pesan: string): void {
    this.perekam?.peringatan.push(pesan);
  }

  // ---------- Teks ----------

  /** Pemeriksa glyph per font dengan simpanan per titik kode (pencarian cmap fontkit mahal bila diulang per huruf). */
  private adaGlyph(font: Font): (c: number) => boolean {
    let cek = this.pemeriksaGlyph.get(font);
    if (!cek) {
      const f = this.glyph.get(font)!;
      const simpan = new Map<number, boolean>();
      cek = (c) => {
        let ada = simpan.get(c);
        if (ada === undefined) simpan.set(c, (ada = f.hasGlyphForCodePoint(c)));
        return ada;
      };
      this.pemeriksaGlyph.set(font, cek);
    }
    return cek;
  }

  private aturFont(font: Font, ukuran: number): void {
    this.doc.font(font).fontSize(ukuran);
  }

  private lebarTeks(teks: string, font: Font, ukuran: number, jarakHuruf: number): number {
    if (!teks) return 0;
    this.aturFont(font, ukuran);
    return this.doc.widthOfString(teks, { characterSpacing: jarakHuruf });
  }

  private tinggiBaris(opsi: OpsiTeks): number {
    const t = opsi.tinggiBaris ?? 1;
    if (typeof t === "object") return t.pasti;
    this.aturFont("R", opsi.ukuran);
    return this.doc.currentLineHeight(true) * t;
  }

  /** Teks atau segmen dibersihkan (bersihkanTeks dengan glyph Carlito font masing-masing) dan dipecah per font. */
  private potongSegmen(isi: string | Segmen[], opsi: OpsiTeks): Potongan[] {
    const dasar = opsi.font ?? "R";
    const daftar = typeof isi === "string" ? [{ teks: isi }] : isi;
    return daftar.map((s) => {
      const font = fontSegmen(dasar, s);
      const teks = opsi.hurufBesar ? s.teks.toLocaleUpperCase("id-ID") : s.teks;
      return { teks: bersihkanTeks(teks, this.adaGlyph(font)), font };
    });
  }

  /** Pemecah baris: paragraf per "\n", kata dipisah spasi, kata yang lebih lebar dari baris dipotong per huruf. */
  private susunBaris(isi: string | Segmen[], opsi: OpsiTeks): BarisJadi[] {
    const jarak = opsi.jarakHuruf ?? 0;
    const inden = opsi.indenPertama ?? 0;
    const lebarPot = (p: Potongan) => this.lebarTeks(p.teks, p.font, opsi.ukuran, jarak) + (p.teks ? jarak : 0);
    const buatToken = (potongan: Potongan[], spasi: boolean): Token => ({ spasi, potongan, lebar: potongan.reduce((n, p) => n + lebarPot(p), 0) });

    // paragraf berisi deret token (kata atau spasi), dengan kata yang boleh melintasi beberapa segmen
    const paragraf: Token[][] = [[]];
    let kata: Potongan[] = [];
    const tutupKata = () => {
      if (kata.length) paragraf[paragraf.length - 1].push(buatToken(kata, false));
      kata = [];
    };
    for (const p of this.potongSegmen(isi, opsi)) {
      for (const bagian of p.teks.split(/(\n| +)/)) {
        if (!bagian) continue;
        if (bagian === "\n") {
          tutupKata();
          paragraf.push([]);
        } else if (bagian[0] === " ") {
          tutupKata();
          paragraf[paragraf.length - 1].push(buatToken([{ teks: bagian, font: p.font }], true));
        } else {
          kata.push({ teks: bagian, font: p.font });
        }
      }
    }
    tutupKata();

    const hasil: BarisJadi[] = [];
    for (const token of paragraf) {
      let baris: Token[] = [];
      let lebar = 0;
      // indenPertama berlaku untuk baris pertama setiap paragraf, seperti inden baris pertama Word
      let pertama = true;
      const batas = () => opsi.lebar - (pertama ? inden : 0);
      const tutupBaris = (akhirParagraf: boolean) => {
        while (baris.length && baris[baris.length - 1].spasi) lebar -= baris.pop()!.lebar;
        hasil.push({ token: baris, lebar, akhirParagraf, inden: pertama ? inden : 0 });
        pertama = false;
        baris = [];
        lebar = 0;
      };
      const antre = [...token];
      while (antre.length) {
        const t = antre.shift()!;
        if (t.spasi) {
          if (baris.length) {
            baris.push(t);
            lebar += t.lebar;
          }
          continue;
        }
        if (lebar + t.lebar <= batas() + 0.01) {
          baris.push(t);
          lebar += t.lebar;
          continue;
        }
        if (baris.length) {
          tutupBaris(false);
          antre.unshift(t);
          continue;
        }
        // satu kata lebih lebar dari baris: potong per huruf
        const [muat, sisa] = this.potongKata(t, batas(), opsi);
        baris.push(muat);
        lebar += muat.lebar;
        tutupBaris(false);
        if (sisa) antre.unshift(sisa);
      }
      // paragraf kosong atau hanya spasi tetap satu baris kosong (jarak antarparagraf dari Word atau textarea)
      if (baris.length || !token.some((t) => !t.spasi)) tutupBaris(true);
      else if (hasil.length) hasil[hasil.length - 1].akhirParagraf = true;
    }
    // teks kosong sama sekali: nol baris
    if (hasil.length === 1 && hasil[0].token.length === 0 && paragraf.length === 1) return [];
    return hasil;
  }

  private potongKata(t: Token, batas: number, opsi: OpsiTeks): [Token, Token | null] {
    const jarak = opsi.jarakHuruf ?? 0;
    const huruf: Potongan[] = t.potongan.flatMap((p) => Array.from(p.teks).map((c) => ({ teks: c, font: p.font })));
    let lebar = 0;
    let n = 0;
    for (; n < huruf.length; n++) {
      const w = this.lebarTeks(huruf[n].teks, huruf[n].font, opsi.ukuran, jarak) + jarak;
      if (n > 0 && lebar + w > batas + 0.01) break;
      lebar += w;
    }
    const gabung = (daftar: Potongan[]): Token => {
      const potongan: Potongan[] = [];
      for (const h of daftar) {
        const akhir = potongan[potongan.length - 1];
        if (akhir && akhir.font === h.font) akhir.teks += h.teks;
        else potongan.push({ ...h });
      }
      return { spasi: false, potongan, lebar: potongan.reduce((s, p) => s + this.lebarTeks(p.teks, p.font, opsi.ukuran, jarak) + jarak, 0) };
    };
    return [gabung(huruf.slice(0, n)), n < huruf.length ? gabung(huruf.slice(n)) : null];
  }

  /** Ukuran teks bila digambar dengan opsi ini (tanpa menggambar). */
  ukur(isi: string | Segmen[], opsi: OpsiTeks): { lebar: number; tinggi: number; jumlahBaris: number } {
    const baris = this.susunBaris(isi, opsi);
    return { lebar: baris.reduce((m, b) => Math.max(m, b.lebar + b.inden), 0), tinggi: baris.length * this.tinggiBaris(opsi), jumlahBaris: baris.length };
  }

  /** Menggambar teks dan mengembalikan tingginya. Tidak pernah memicu halaman baru. */
  teks(isi: string | Segmen[], opsi: OpsiTeks): number {
    const baris = this.susunBaris(isi, opsi);
    return this.gambarBaris(opsi.rentang ? baris.slice(opsi.rentang.dari, opsi.rentang.sampai) : baris, opsi);
  }

  private gambarBaris(baris: BarisJadi[], opsi: OpsiTeks): number {
    const y0 = opsi.y ?? this._y;
    const tb = this.tinggiBaris(opsi);
    const jarak = opsi.jarakHuruf ?? 0;
    const warna = opsi.warna ?? "#000000";
    const rata = opsi.rata ?? "kiri";
    baris.forEach((b, i) => {
      const yb = y0 + i * tb;
      const ruang = opsi.lebar - b.inden;
      const jumlahSpasi = b.token.filter((t) => t.spasi).length;
      const tambahSpasi = rata === "rata" && !b.akhirParagraf && jumlahSpasi > 0 ? (ruang - b.lebar) / jumlahSpasi : 0;
      let x = opsi.x + b.inden + (rata === "tengah" ? (ruang - b.lebar) / 2 : rata === "kanan" ? ruang - b.lebar : 0);
      const xAwal = x;
      let ascender = 0;
      for (const t of b.token) {
        if (t.spasi) {
          x += t.lebar + tambahSpasi;
          continue;
        }
        for (const p of t.potongan) {
          if (!p.teks) continue;
          this.aturFont(p.font, opsi.ukuran);
          this.doc.fillColor(warna).text(p.teks, x, yb, { lineBreak: false, characterSpacing: jarak });
          ascender = Math.max(ascender, this.ascender.get(p.font)!);
          x += this.lebarTeks(p.teks, p.font, opsi.ukuran, jarak) + jarak;
        }
      }
      if (opsi.garisBawah && b.token.length) {
        const yGaris = yb + ascender * opsi.ukuran + opsi.ukuran * 0.1;
        this.garis(xAwal, yGaris, xAwal + b.lebar + (tambahSpasi * jumlahSpasi), yGaris, { warna, tebal: Math.max(0.5, opsi.ukuran * 0.06) });
      }
      this.perekam?.teks.push({ halaman: this.halamanKe, teks: b.token.map((t) => t.potongan.map((p) => p.teks).join("")).join(""), x: xAwal, y: yb, lebar: b.lebar, tinggi: tb, ukuran: opsi.ukuran });
    });
    const tinggi = baris.length * tb;
    if (opsi.y === undefined) this._y += tinggi;
    return tinggi;
  }

  /** Teks berbutir D2: butir inden 3 mm dengan "•", sub-butir inden 8 mm dengan "▪" (Carlito tidak punya "■"). */
  private butir(b: BarisTeksCetak): { inden: number; penanda: string | null } {
    if (b.jenis === "butir") return { inden: this.mm(3), penanda: "•" };
    if (b.jenis === "subbutir") return { inden: this.mm(8), penanda: "▪" };
    return { inden: 0, penanda: null };
  }

  ukurBerbutir(daftar: BarisTeksCetak[], opsi: OpsiTeks): { lebar: number; tinggi: number; jumlahBaris: number } {
    let tinggi = 0;
    let lebar = 0;
    let jumlahBaris = 0;
    for (const b of daftar) {
      const { inden } = this.butir(b);
      const u = this.ukur(b.isi.map((p) => ({ teks: p.teks, tebal: p.tebal })), { ...opsi, lebar: opsi.lebar - inden, indenPertama: 0 });
      tinggi += u.tinggi;
      lebar = Math.max(lebar, u.lebar + inden);
      jumlahBaris += u.jumlahBaris;
    }
    return { lebar, tinggi, jumlahBaris };
  }

  /** Menggambar teks berbutir, mengembalikan tinggi. Tanpa y: dimulai di kursor dan kursor turun. */
  teksBerbutir(daftar: BarisTeksCetak[], opsi: OpsiTeks): number {
    let y = opsi.y ?? this._y;
    // indeks baris dihitung lintas butir; penanda hanya digambar bersama baris pertama butirnya
    let ke = 0;
    for (const b of daftar) {
      const { inden, penanda } = this.butir(b);
      const isi = b.isi.map((p) => ({ teks: p.teks, tebal: p.tebal }));
      const o: OpsiTeks = { ...opsi, x: opsi.x + inden, y, lebar: opsi.lebar - inden, indenPertama: 0, rentang: undefined };
      const n = opsi.rentang ? this.susunBaris(isi, o).length : 0;
      const dari = opsi.rentang ? Math.max(0, opsi.rentang.dari - ke) : 0;
      const sampai = opsi.rentang ? Math.min(n, opsi.rentang.sampai - ke) : Infinity;
      ke += n;
      if (opsi.rentang && sampai <= dari) continue;
      if (penanda && dari === 0) this.teks(penanda, { ...o, x: opsi.x + inden - this.mm(3), lebar: this.mm(3), rata: "kiri", garisBawah: false });
      y += this.teks(isi, opsi.rentang ? { ...o, rentang: { dari, sampai } } : o);
    }
    const tinggi = y - (opsi.y ?? this._y);
    if (opsi.y === undefined) this._y += tinggi;
    return tinggi;
  }

  /**
   * Teks yang harus muat di kotak: ukuran diturunkan 0,5 pt sampai paling banyak `baris` baris dan setinggi kotak,
   * tidak di bawah ukuranMin. Bila tetap tidak muat, baris berlebih dibuang dan diakhiri "…" (peringatan dicatat).
   * Isi diletakkan di tengah kotak secara vertikal.
   */
  teksMuat(isi: string, kotak: { x: number; y: number; w: number; h: number }, opsi: OpsiTeks & { ukuranMin: number; baris: number }): void {
    let ukuran = opsi.ukuran;
    const dasar = { ...opsi, x: kotak.x, lebar: kotak.w };
    const muat = (u: number) => {
      const hasil = this.ukur(isi, { ...dasar, ukuran: u });
      return hasil.jumlahBaris <= opsi.baris && hasil.tinggi <= kotak.h + 0.01;
    };
    while (ukuran - 0.5 >= opsi.ukuranMin && !muat(ukuran)) ukuran -= 0.5;
    const final = { ...dasar, ukuran };
    let baris = this.susunBaris(isi, final);
    const maks = Math.max(1, Math.min(opsi.baris, Math.floor((kotak.h + 0.01) / this.tinggiBaris(final))));
    if (baris.length > maks) {
      this.peringatan(`Teks dipotong agar muat di kotak: ${isi.slice(0, 40)}`);
      baris = baris.slice(0, maks);
      const akhir = baris[maks - 1];
      const elipsis: Token = { spasi: false, potongan: [{ teks: "…", font: opsi.font ?? "R" }], lebar: this.lebarTeks("…", opsi.font ?? "R", ukuran, opsi.jarakHuruf ?? 0) };
      while (akhir.token.length && akhir.lebar + elipsis.lebar > kotak.w) akhir.lebar -= akhir.token.pop()!.lebar;
      akhir.token.push(elipsis);
      akhir.lebar += elipsis.lebar;
      akhir.akhirParagraf = true;
    }
    const tinggi = baris.length * this.tinggiBaris(final);
    this.gambarBaris(baris, { ...final, y: kotak.y + Math.max(0, (kotak.h - tinggi) / 2) });
  }

  // ---------- Garis, kotak, gambar ----------

  private gayaDash(g: GayaGaris): void {
    if (g.pola && (g.gaya ?? "penuh") !== "penuh") this.doc.dash(g.pola[0], { space: g.pola[1] });
    else if (g.gaya === "putus") this.doc.dash(g.tebal * 3, { space: g.tebal * 2 });
    else if (g.gaya === "titik") this.doc.dash(g.tebal, { space: g.tebal * 1.5 });
    else this.doc.undash();
  }

  garis(x1: number, y1: number, x2: number, y2: number, gaya: GayaGaris): void {
    this.doc.save();
    this.doc.lineWidth(gaya.tebal).strokeColor(gaya.warna);
    this.gayaDash(gaya);
    this.doc.moveTo(x1, y1).lineTo(x2, y2).stroke();
    this.doc.restore();
  }

  kotak(x: number, y: number, w: number, h: number, gaya: { isi?: string; garis?: GayaGaris & { sisi?: ("atas" | "bawah" | "kiri" | "kanan")[] } }): void {
    if (gaya.isi) {
      this.doc.save();
      this.doc.rect(x, y, w, h).fill(gaya.isi);
      this.doc.restore();
    }
    const g = gaya.garis;
    if (!g || g.tebal <= 0) return;
    const sisi = g.sisi ?? ["atas", "bawah", "kiri", "kanan"];
    if (sisi.length === 4 && (g.gaya ?? "penuh") === "penuh") {
      this.doc.save();
      this.doc.lineWidth(g.tebal).strokeColor(g.warna).undash();
      this.doc.rect(x, y, w, h).stroke();
      this.doc.restore();
      return;
    }
    if (sisi.includes("atas")) this.garis(x, y, x + w, y, g);
    if (sisi.includes("bawah")) this.garis(x, y + h, x + w, y + h, g);
    if (sisi.includes("kiri")) this.garis(x, y, x, y + h, g);
    if (sisi.includes("kanan")) this.garis(x + w, y, x + w, y + h, g);
  }

  /** Lingkaran berisi warna (ikon sosial tata letak HKA). */
  lingkaran(cx: number, cy: number, r: number, gaya: { isi: string }): void {
    this.doc.save();
    this.doc.circle(cx, cy, r).fill(gaya.isi);
    this.doc.restore();
  }

  /**
   * Bidang tertutup berisi warna dari deret langkah: `ke` memulai, `garis` menarik garis lurus, `kurva` menarik kurva
   * Bezier kubik [kontrol1 x, y, kontrol2 x, y, ujung x, y]. Dipakai gelombang kaki tata letak HKA.
   */
  bentuk(langkah: ({ ke: [number, number] } | { garis: [number, number] } | { kurva: [number, number, number, number, number, number] })[], gaya: { isi: string }): void {
    this.doc.save();
    for (const l of langkah) {
      if ("ke" in l) this.doc.moveTo(...l.ke);
      else if ("garis" in l) this.doc.lineTo(...l.garis);
      else this.doc.bezierCurveTo(...l.kurva);
    }
    this.doc.closePath().fill(gaya.isi);
    this.doc.restore();
  }

  /**
   * Gambar PNG/JPEG. Uint8Array harus lolos periksaGambar (diperiksa sekali per objek di sini juga); string harus
   * jalur di dalam src/aset-cetak. Objek yang sama ditanam sekali per PDF walau digambar di banyak halaman.
   * Ukuran: w saja atau h saja menjaga rasio; w dan h meregang; muat [w, h] memasukkan gambar ke kotak dengan rasio
   * tetap, diratakan `rata` (bawaan tengah) secara mendatar dan di tengah secara tegak.
   */
  gambar(
    isi: Uint8Array | string,
    kotak: { x: number; y: number; w?: number; h?: number; muat?: [number, number]; rata?: "tengah" | "kiri" | "kanan"; opasitas?: number },
    slot?: string,
  ): { w: number; h: number } {
    const data = typeof isi === "string" ? this.bacaAset(isi) : isi;
    const gbr = this.bukaGambar(data);
    const putar = (gbr.orientation ?? 1) > 4;
    const lebarAsli = putar ? gbr.height : gbr.width;
    const tinggiAsli = putar ? gbr.width : gbr.height;
    let { x, y } = kotak;
    let w: number;
    let h: number;
    if (kotak.muat) {
      const [mw, mh] = kotak.muat;
      const s = Math.min(mw / lebarAsli, mh / tinggiAsli);
      w = lebarAsli * s;
      h = tinggiAsli * s;
      const rata = kotak.rata ?? "tengah";
      x += rata === "tengah" ? (mw - w) / 2 : rata === "kanan" ? mw - w : 0;
      y += (mh - h) / 2;
    } else if (kotak.w && kotak.h) {
      w = kotak.w;
      h = kotak.h;
    } else if (kotak.w) {
      w = kotak.w;
      h = (tinggiAsli * kotak.w) / lebarAsli;
    } else if (kotak.h) {
      h = kotak.h;
      w = (lebarAsli * kotak.h) / tinggiAsli;
    } else {
      w = lebarAsli;
      h = tinggiAsli;
    }
    this.doc.save();
    if (kotak.opasitas !== undefined && kotak.opasitas < 1) this.doc.opacity(kotak.opasitas);
    this.doc.image(gbr as unknown as Buffer, x, y, { width: w, height: h });
    this.doc.restore();
    this.perekam?.gambar.push({ halaman: this.halamanKe, slot: slot ?? null, x, y, w, h });
    return { w, h };
  }

  /** Gambar terbuka (periksaGambar sekali per objek), dipakai ulang di setiap halaman. */
  private bukaGambar(data: Uint8Array): GambarTerbuka {
    let gbr = this.gambarTerbuka.get(data);
    if (!gbr) {
      periksaGambar(data);
      gbr = this.doc.openImage(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
      this.gambarTerbuka.set(data, gbr);
    }
    return gbr;
  }

  /**
   * Lebar dan tinggi piksel gambar seperti yang akan digambar `gambar` (sisi ditukar bila orientasi EXIF JPEG lebih
   * dari 4), tanpa menggambar. Dipakai tata letak untuk menyisakan ruang yang sama persis dengan gambarnya.
   */
  ukuranGambar(isi: Uint8Array | string): { lebar: number; tinggi: number } {
    const gbr = this.bukaGambar(typeof isi === "string" ? this.bacaAset(isi) : isi);
    const putar = (gbr.orientation ?? 1) > 4;
    return { lebar: putar ? gbr.height : gbr.width, tinggi: putar ? gbr.width : gbr.height };
  }

  private bacaAset(jalur: string): Uint8Array {
    const penuh = path.resolve(DIR_ASET_CETAK, jalur);
    if (penuh !== DIR_ASET_CETAK && !penuh.startsWith(DIR_ASET_CETAK + path.sep)) throw new Error("Gambar harus berada di src/aset-cetak");
    let data = this.isiBerkas.get(penuh);
    if (!data) {
      data = new Uint8Array(fs.readFileSync(penuh));
      this.isiBerkas.set(penuh, data);
    }
    return data;
  }

  /** Teks diagonal (mis. DRAF) di tengah setiap halaman sebagai lapisan paling depan (D3 §3.3). */
  stempelStatus(teks: string): void {
    this.stempel = teks;
  }

  private gambarStempel(): void {
    if (!this.stempel) return;
    const { lebarMm, tinggiMm } = this.kertasSekarang();
    const a5Potret = lebarMm < tinggiMm && lebarMm <= 148.5;
    const ukuran = 72 * (a5Potret ? 1748 / 2480 : 1);
    const teks = bersihkanTeks(this.stempel, this.adaGlyph("B"));
    const lebar = this.lebarTeks(teks, "B", ukuran, 0);
    this.aturFont("B", ukuran);
    const tinggi = this.doc.currentLineHeight();
    const cx = this.lebarKertas / 2;
    const cy = this.tinggiKertas / 2;
    this.doc.save();
    this.doc.fillColor("#DC2626").fillOpacity(0.15);
    // sudut negatif di sistem koordinat pdfkit (y ke bawah) = naik dari kiri bawah ke kanan atas
    this.doc.rotate(-35, { origin: [cx, cy] });
    this.doc.text(teks, cx - lebar / 2, cy - tinggi / 2, { lineBreak: false });
    this.doc.restore();
    this.perekam?.teks.push({ halaman: this.halamanKe, teks, x: cx - lebar / 2, y: cy - tinggi / 2, lebar, tinggi, ukuran });
  }

  /** Menggambar lapisan depan dan stempel setiap halaman, menutup dokumen, dan mengembalikan isi PDF. */
  async selesai(): Promise<Uint8Array> {
    if (this.sudahSelesai) throw new Error("KanvasCetak sudah selesai");
    if (this.halaman.length === 0) throw new Error("KanvasCetak: dokumen tanpa halaman");
    this.sudahSelesai = true;
    const dari = this.halaman.length;
    for (let i = 0; i < dari; i++) {
      this.doc.switchToPage(i);
      this.indeks = i;
      this.halaman[i].lapisan.depan?.(this, i + 1, dari);
      this.gambarStempel();
    }
    const akhir = new Promise<void>((lanjut, gagal) => {
      this.doc.on("end", () => lanjut());
      this.doc.on("error", gagal);
    });
    this.doc.end();
    await akhir;
    const isi = Buffer.concat(this.potongan);
    return new Uint8Array(isi.buffer, isi.byteOffset, isi.byteLength);
  }
}
