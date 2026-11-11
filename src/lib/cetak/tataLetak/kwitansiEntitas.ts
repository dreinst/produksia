import type { GayaEntitas, JenisAsetKop } from "@/prisma-klien/enums";
import { KERTAS, type KanvasCetak } from "@/lib/cetak/mesin/kanvas";
import { gambarTabel, type BarisTabel, type SelTabel } from "@/lib/cetak/mesin/tabel";
import { formatJumlah, formatRupiah, formatTanggalPanjang } from "@/lib/cetak/format";
import { terbilangRupiah } from "@/lib/cetak/terbilang";
import type { Desimal } from "@/lib/uang";
import {
  HITAM,
  PUTIH,
  barisDicetak,
  bukanNol,
  buatKanvas,
  isiSlotBaris,
  isiTokenRekening,
  pecahBaris,
  judulSama,
  kotaTanggal,
  rupiah,
  tandaTanganDipakai,
  teksKotak,
  type MasukanTataLetak,
} from "@/lib/cetak/tataLetak/blok";

/*
 * Kwitansi dan invoice tulisan per entitas (D3 §3.7, spec/10 §5.3), setia dengan build di
 * dpro-docgen/kwitansi.py. Semua posisi dalam piksel frame lebar 2480; tinggi frame H = 1748 (A5 landscape) atau
 * 3508 (A4). Posisi isi sama untuk kedua ukuran, hanya dekorasi yang menempel bawah bergeser H - tinggi. Isian
 * mengalir ke baris berposisi tetap: bila tidak muat, ukuran turun sampai 6 pt lalu baris terakhir dipotong dengan
 * peringatan "teks terpotong". Jenis faktur dan tagihan termin dicetak sebagai invoice tulisan.
 */

type Isi = "TERIMA_DARI" | "TERBILANG" | "KEPERLUAN" | null;
type Teks = { y: number; x: number; teks: string; ukuran: number; tebal?: boolean; garisBawah?: boolean };
type Bagian = { jenis: "kota" | "kotaTipis" | "salam" | "ttd" | "nama" | "namaGaris" | "jabatan"; teks?: string; y: number; ukuran: number };
type GambarKw = { slot: JenisAsetKop; x: number; y: (H: number) => number; w: number | null; h: number; belakang: boolean; hanyaHal1?: boolean };

export type ParamKwitansi = {
  kiri: number;
  tinta: string;
  warnaLabel: string;
  gambar: GambarKw[];
  garisPersegi?: { x: number; y: number; w: number; h: number };
  nomor:
    | { jenis: "kotak"; x: number; y: number; w: number; h: number; ukuran: number; garis: string | null; latar: string | null; warna: string; isi: ("nomor" | "tanggal")[] }
    | { jenis: "judul"; x: number; w: number; y: number; ukuranJudul: number; ukuran: number }
    | { jenis: "noTanggal"; y: number; h: number; tab: number; kotakX: number; kotakW: number; ukuran: number };
  baris: {
    mulai: number;
    labelX: number;
    titikDuaX: number;
    nilaiX: number;
    akhir: number;
    ukuran: number;
    garis: { gaya: "titik" | "putus" | "penuh"; warna: string; tebal: number } | null;
    daftar: { y: number; label: string; isi: Isi }[];
  };
  nominal: { x: number; y: number; w: number; ukuran: number; latar: string; akhiran: string };
  bawah: { kiri: Teks[]; tab?: number; ttdX: number; ttdW: number; ttdBergaris?: boolean; bagian: Bagian[] };
  lampiranItem?: boolean;
};

export const PARAMETER_KWITANSI: Record<GayaEntitas, ParamKwitansi> = {
  DPRO: {
    kiri: 216,
    tinta: "#1A1A1F",
    warnaLabel: "#0B2144",
    gambar: [
      { slot: "WATERMARK", x: 731, y: (H) => (H > 2000 ? (H - 860) / 2 : 538), w: 1017, h: 860, belakang: true },
      { slot: "KOP", x: 0, y: () => 0, w: 2480, h: 415, belakang: false },
      { slot: "KAKI", x: 0, y: (H) => H - 242, w: 2480, h: 242, belakang: false },
    ],
    nomor: { jenis: "kotak", x: 216, y: 440, w: 560, h: 82, ukuran: 32, garis: "#0B2144", latar: null, warna: "#0B2144", isi: ["nomor"] },
    baris: {
      mulai: 590,
      labelX: 216,
      titikDuaX: 690,
      nilaiX: 744,
      akhir: 2264,
      ukuran: 34,
      garis: { gaya: "titik", warna: "#555555", tebal: 0.5 },
      daftar: [
        { y: 646, label: "Telah Terima Dari", isi: "TERIMA_DARI" },
        { y: 722, label: "Uang sejumlah", isi: "TERBILANG" },
        { y: 798, label: "", isi: null },
        { y: 874, label: "Digunakan untuk", isi: "KEPERLUAN" },
        { y: 950, label: "", isi: null },
        { y: 1026, label: "", isi: null },
      ],
    },
    nominal: { x: 216, y: 1075, w: 460, ukuran: 38, latar: "#0B2144", akhiran: "" },
    bawah: {
      kiri: [
        { y: 1210, x: 216, teks: "NB : Transfer {singkatanBank} {cabangBank}", ukuran: 32, tebal: true },
        { y: 1260, x: 290, teks: "{nomorRekening} an {atasNamaRekening}", ukuran: 32, tebal: true },
      ],
      ttdX: 1700,
      ttdW: 600,
      bagian: [
        { jenis: "kota", y: 1075, ukuran: 32 },
        { jenis: "ttd", y: 1120, ukuran: 302 },
        { jenis: "namaGaris", y: 1420, ukuran: 34 },
      ],
    },
  },
  TAPUSSA: {
    kiri: 214,
    tinta: HITAM,
    warnaLabel: HITAM,
    gambar: [
      { slot: "KOP", x: 0, y: () => 0, w: 2480, h: 283, belakang: false },
      { slot: "LOGO", x: 1260, y: () => 150, w: 1012, h: 217, belakang: false },
      // mode invoice: JUDUL_INVOICE
      { slot: "JUDUL_KWITANSI", x: 1867, y: () => 366, w: 383, h: 76, belakang: false, hanyaHal1: true },
      { slot: "KAKI", x: 0, y: (H) => H - 204, w: 2480, h: 204, belakang: false },
    ],
    nomor: { jenis: "kotak", x: 214, y: 285, w: 617, h: 91, ukuran: 30, garis: HITAM, latar: null, warna: HITAM, isi: ["nomor", "tanggal"] },
    baris: {
      mulai: 548,
      labelX: 319,
      titikDuaX: 640,
      nilaiX: 673,
      akhir: 2238,
      ukuran: 34,
      garis: { gaya: "putus", warna: HITAM, tebal: 0.5 },
      daftar: [
        { y: 610, label: "Telah Terima Dari", isi: "TERIMA_DARI" },
        { y: 688, label: "Uang sejumlah", isi: "TERBILANG" },
        { y: 788, label: "Digunakan untuk", isi: "KEPERLUAN" },
        { y: 878, label: "", isi: null },
      ],
    },
    nominal: { x: 285, y: 965, w: 420, ukuran: 34, latar: HITAM, akhiran: "" },
    bawah: {
      kiri: [
        { y: 1090, x: 285, teks: "NB : Transfer {singkatanBank} {cabangBank}", ukuran: 32, tebal: true },
        { y: 1162, x: 285, teks: "{nomorRekening} {atasNamaRekening}", ukuran: 32, tebal: true },
      ],
      ttdX: 1600,
      ttdW: 600,
      bagian: [
        { jenis: "salam", teks: "Hormat Kami", y: 1050, ukuran: 32 },
        { jenis: "ttd", y: 1095, ukuran: 336 },
        { jenis: "nama", y: 1430, ukuran: 32 },
      ],
    },
  },
  BONANOVA: {
    kiri: 299,
    tinta: HITAM,
    warnaLabel: HITAM,
    gambar: [
      // A4 memakai { x: 1925, y: H - 2450, w: 555, h: 2450 } (lihat posisiGambar)
      { slot: "WATERMARK", x: 2084, y: () => 0, w: 396, h: 1747, belakang: true },
      { slot: "LOGO", x: 136, y: () => 110, w: 600, h: 230, belakang: false },
    ],
    nomor: { jenis: "kotak", x: 1659, y: 184, w: 625, h: 119, ukuran: 34, garis: null, latar: "#BDD7EE", warna: HITAM, isi: ["nomor"] },
    baris: {
      mulai: 400,
      labelX: 303,
      titikDuaX: 719,
      nilaiX: 772,
      akhir: 2180,
      ukuran: 38,
      garis: { gaya: "penuh", warna: HITAM, tebal: 0.75 },
      daftar: [
        { y: 465, label: "Terima dari", isi: "TERIMA_DARI" },
        { y: 528, label: "Uang sejumlah", isi: "TERBILANG" },
        { y: 592, label: "", isi: null },
        { y: 655, label: "Digunakan untuk", isi: "KEPERLUAN" },
        { y: 717, label: "", isi: null },
        { y: 780, label: "", isi: null },
        { y: 842, label: "", isi: null },
        { y: 904, label: "", isi: null },
      ],
    },
    nominal: { x: 299, y: 1010, w: 360, ukuran: 38, latar: HITAM, akhiran: ",-" },
    bawah: {
      kiri: [
        { y: 1130, x: 299, teks: "Payment :", ukuran: 34, tebal: true, garisBawah: true },
        { y: 1180, x: 299, teks: "Bank Transfer\t: {singkatanBank}", ukuran: 34, tebal: true },
        { y: 1228, x: 299, teks: "Account Name\t: {atasNamaRekening}", ukuran: 34, tebal: true },
        { y: 1276, x: 299, teks: "Account No\t: {nomorRekening}", ukuran: 34, tebal: true },
      ],
      tab: 560,
      ttdX: 1394,
      ttdW: 700,
      bagian: [
        { jenis: "kota", y: 1080, ukuran: 36 },
        { jenis: "ttd", y: 1115, ukuran: 300 },
        { jenis: "namaGaris", y: 1420, ukuran: 36 },
        { jenis: "jabatan", y: 1468, ukuran: 36 },
      ],
    },
  },
  SAHARA: {
    kiri: 170,
    tinta: HITAM,
    warnaLabel: HITAM,
    garisPersegi: { x: 80, y: 378, w: 2297, h: 9 },
    gambar: [{ slot: "LOGO", x: 164, y: () => 200, w: 594, h: 151, belakang: false }],
    nomor: { jenis: "judul", x: 738, w: 1000, y: 215, ukuranJudul: 60, ukuran: 42 },
    baris: {
      mulai: 540,
      labelX: 181,
      titikDuaX: 640,
      nilaiX: 707,
      akhir: 2299,
      ukuran: 40,
      garis: { gaya: "putus", warna: "#555555", tebal: 0.5 },
      daftar: [
        { y: 613, label: "Telah Terima Dari", isi: "TERIMA_DARI" },
        { y: 697, label: "Uang sejumlah", isi: "TERBILANG" },
        { y: 770, label: "", isi: null },
        { y: 850, label: "Digunakan untuk", isi: "KEPERLUAN" },
        { y: 922, label: "", isi: null },
        { y: 994, label: "", isi: null },
      ],
    },
    nominal: { x: 170, y: 1070, w: 420, ukuran: 42, latar: HITAM, akhiran: "" },
    bawah: {
      kiri: [
        { y: 1210, x: 358, teks: "PAYMENT :", ukuran: 38, tebal: true },
        { y: 1284, x: 358, teks: "REK {singkatanBank} an {atasNamaRekening}", ukuran: 38, tebal: true },
        { y: 1356, x: 358, teks: "No {nomorRekening}", ukuran: 38, tebal: true },
      ],
      ttdX: 1612,
      ttdW: 700,
      bagian: [
        { jenis: "kotaTipis", y: 1190, ukuran: 38 },
        { jenis: "ttd", y: 1225, ukuran: 270 },
        { jenis: "namaGaris", y: 1500, ukuran: 38 },
      ],
    },
    lampiranItem: true,
  },
  NAWASENA: {
    kiri: 233,
    tinta: HITAM,
    warnaLabel: HITAM,
    gambar: [
      { slot: "KOP", x: 0, y: () => 0, w: 2480, h: 702, belakang: true },
      { slot: "JUDUL_KWITANSI", x: 300, y: () => 102, w: null, h: 96, belakang: false },
    ],
    nomor: { jenis: "noTanggal", y: 470, h: 80, tab: 733, kotakX: 1700, kotakW: 550, ukuran: 34 },
    baris: {
      mulai: 560,
      labelX: 233,
      titikDuaX: 733,
      nilaiX: 775,
      akhir: 2250,
      ukuran: 34,
      garis: null,
      daftar: [
        { y: 636, label: "Telah Diterima Dari", isi: "TERIMA_DARI" },
        { y: 712, label: "Uang Sejumlah", isi: "TERBILANG" },
        { y: 788, label: "", isi: null },
        { y: 864, label: "Digunakan Untuk", isi: "KEPERLUAN" },
        { y: 940, label: "", isi: null },
      ],
    },
    nominal: { x: 233, y: 1030, w: 520, ukuran: 38, latar: "#006699", akhiran: "" },
    bawah: {
      kiri: [
        { y: 1180, x: 233, teks: "NB : Transfer {singkatanBank} {cabangBank}", ukuran: 32, tebal: true },
        { y: 1240, x: 320, teks: "{nomorRekening} An {atasNamaRekening}", ukuran: 32, tebal: true },
      ],
      ttdX: 1500,
      ttdW: 800,
      ttdBergaris: true,
      bagian: [
        { jenis: "salam", teks: "Hormat Kami,", y: 1140, ukuran: 32 },
        { jenis: "ttd", y: 1190, ukuran: 280 },
        { jenis: "nama", y: 1480, ukuran: 32 },
      ],
    },
  },
};

/** Lampiran item Sahara (DG:kwitansi.py tambah_lampiran_item). */
const LAMPIRAN_SAHARA = { jarakAtas: 400, judul: 52, jarakJudul: 50, x: 170, kolom: [130, 900, 160, 200, 360, 390], tinggi: 99, ukuran: 40, merah: "#EE0000" } as const;
const KANAN_PX = 120;
const BAWAH_PX = 150;
/** Lebar gambar judul Nawasena yang lebarnya mengikuti rasio, bila gambarnya tidak ada (judul teks). */
const LEBAR_JUDUL_TEKS = 500;
const UKURAN_MIN_ISIAN = 6;
/** Pola garis isian D3 §3.7 dalam pt (panjang, jarak), tidak bergantung tebal garis. */
const POLA_GARIS = { titik: [0.5, 1.5], putus: [3, 1.5] } as const satisfies Record<string, [number, number]>;
/** Gabungan nama baris untuk keperluan invoice tulisan paling banyak sekian baris di ukuran isian (D3 §3.7). */
const BARIS_KEPERLUAN_INVOICE = 2;

/** Mode invoice tulisan untuk faktur dan tagihan termin (D3 §3.7). */
export const modeInvoiceTulisan = (m: MasukanTataLetak) => m.dok.jenis === "faktur" || m.dok.jenis === "tagihan-termin";

/** Jumlah kwitansi: nilai kwitansi; invoice tulisan memakai total dokumen (tagihan termin: total termin). */
export function jumlahKwitansi(m: MasukanTataLetak): Desimal {
  return !modeInvoiceTulisan(m) && m.dok.kwitansi ? m.dok.kwitansi.jumlah : m.dok.ringkasan.total;
}

/**
 * Keperluan invoice tulisan: perihal, nama baris digabung "; ", atau "Tagihan {nomor}". Nama baris ditambahkan satu
 * per satu selama gabungannya paling banyak dua baris di ukuran isian; bila ada yang tidak muat, ditutup "; dll."
 * (D3 §3.7 "≤ 2 baris"). Satu nama yang sendirian lebih dari dua baris tetap dipakai dan diatur isiSlotBaris.
 */
function keperluan(m: MasukanTataLetak, k: KanvasCetak, opsi: { lebar: number; ukuran: number }): string {
  if (!modeInvoiceTulisan(m)) return m.dok.kwitansi?.keperluan ?? "";
  const perihal = m.dok.surat.perihal?.trim();
  if (perihal) return perihal;
  const nama = barisDicetak(m)
    .map((b) => b.nama.trim())
    .filter(Boolean);
  if (!nama.length) return `Tagihan ${m.dok.nomorTampil}`;
  const muat = (s: string) => pecahBaris(k, s, { ...opsi, font: "B" }, BARIS_KEPERLUAN_INVOICE).length <= BARIS_KEPERLUAN_INVOICE;
  let hasil = nama[0];
  for (let i = 1; i < nama.length; i++) {
    const coba = `${hasil}; ${nama[i]}`;
    const tutup = i < nama.length - 1 ? "; dll." : "";
    if (!muat(coba + tutup)) return muat(`${hasil}; dll.`) ? `${hasil}; dll.` : hasil;
    hasil = coba;
  }
  return hasil;
}

/** Posisi gambar per ukuran; pengecualian watermark Bonanova A4 (D3 §3.7). */
function posisiGambar(gaya: GayaEntitas, g: GambarKw, H: number): { x: number; y: number; w: number | null; h: number } {
  if (gaya === "BONANOVA" && g.slot === "WATERMARK" && H > 2000) return { x: 1925, y: H - 2450, w: 555, h: 2450 };
  return { x: g.x, y: g.y(H), w: g.w, h: g.h };
}

export async function renderKwitansiEntitas(m: MasukanTataLetak, gaya: GayaEntitas): Promise<Uint8Array> {
  const P = PARAMETER_KWITANSI[gaya];
  const A4 = m.ukuran === "A4";
  const ukuran = A4 ? "A4" : "A5_LANDSCAPE";
  const H = A4 ? 3508 : 1748;
  const invoice = modeInvoiceTulisan(m);
  const k = buatKanvas({ ...m, ukuran }, invoice ? (m.dok.jenis === "tagihan-termin" ? "Tagihan Termin" : "Invoice") : "Kwitansi");
  const px = (v: number) => k.px(v);
  const pt = (v: number) => k.ukuranHuruf(v);
  const { dok, identitas } = m;
  const tinta = P.tinta;
  const label = P.warnaLabel;
  const jumlah = jumlahKwitansi(m);

  // gambar judul: varian INVOICE di mode invoice, dipakai hanya bila judulnya judul bawaan gambar (D3 §3.1)
  const slotJudul: JenisAsetKop = invoice ? "JUDUL_INVOICE" : "JUDUL_KWITANSI";
  const pakaiGambarJudul = (invoice ? judulSama(m.judul, "INVOICE") : judulSama(m.judul, "KWITANSI", "KUITANSI")) && !!m.tema.aset[slotJudul];
  const gambarDekorasi = (kk: KanvasCetak, belakang: boolean, ke: number) => {
    for (const g of P.gambar) {
      if (g.belakang !== belakang || (g.hanyaHal1 && ke !== 1)) continue;
      const pos = posisiGambar(gaya, g, H);
      if (g.slot === "JUDUL_KWITANSI") {
        if (pakaiGambarJudul) {
          const isi = m.tema.aset[slotJudul]!;
          const ukuranAsli = kk.ukuranGambar(isi);
          const w = pos.w ?? (pos.h * ukuranAsli.lebar) / ukuranAsli.tinggi;
          kk.gambar(isi, { x: px(pos.x), y: px(pos.y), w: px(w), h: px(pos.h) }, slotJudul);
        } else {
          teksKotak(kk, m.judul, { x: px(pos.x), y: px(pos.y), w: px(pos.w ?? LEBAR_JUDUL_TEKS), h: px(pos.h) }, { ukuran: pt(60), ukuranMin: UKURAN_MIN_ISIAN, font: "B", warna: m.tema.warnaUtama, rata: "tengah", jarakHuruf: 1 });
        }
        continue;
      }
      const isi = m.tema.aset[g.slot];
      if (!isi) continue;
      kk.gambar(isi, { x: px(pos.x), y: px(pos.y), w: px(pos.w ?? 0), h: px(pos.h) }, g.slot);
    }
  };

  k.aturArea({ atas: 0, bawah: px(BAWAH_PX), kiri: px(P.kiri), kanan: px(KANAN_PX) });
  k.halamanBaru(KERTAS[ukuran], {
    belakang: (kk) => gambarDekorasi(kk, true, kk.halamanKe),
    depan: (kk, ke) => {
      gambarDekorasi(kk, false, ke);
      if (P.garisPersegi) kk.kotak(px(P.garisPersegi.x), px(P.garisPersegi.y), px(P.garisPersegi.w), px(P.garisPersegi.h), { isi: HITAM });
    },
  });

  // ---------- Blok nomor ----------
  const nb = P.nomor;
  if (nb.jenis === "kotak") {
    nb.isi.forEach((isi, i) => {
      const kotak = { x: px(nb.x), y: px(nb.y + i * nb.h), w: px(nb.w), h: px(nb.h) };
      k.kotak(kotak.x, kotak.y, kotak.w, kotak.h, { isi: nb.latar ?? undefined, garis: nb.garis ? { warna: nb.garis, tebal: 0.75 } : undefined });
      const teks = isi === "nomor" ? dok.nomorTampil : formatTanggalPanjang(dok.tanggal);
      teksKotak(k, teks, { ...kotak, x: kotak.x + px(10), w: kotak.w - px(20) }, { ukuran: pt(nb.ukuran), ukuranMin: UKURAN_MIN_ISIAN, font: "B", warna: nb.warna, rata: "tengah" });
    });
  } else if (nb.jenis === "judul") {
    const area = { x: px(nb.x), w: px(nb.w) };
    teksKotak(k, m.judul, { x: area.x, y: px(nb.y), w: area.w, h: px(90) }, { ukuran: pt(nb.ukuranJudul), ukuranMin: UKURAN_MIN_ISIAN, font: "B", warna: tinta, rata: "tengah" });
    teksKotak(k, `NO : ${dok.nomorTampil}`, { x: area.x, y: px(nb.y + 90), w: area.w, h: px(60) }, { ukuran: pt(nb.ukuran), ukuranMin: UKURAN_MIN_ISIAN, warna: tinta, rata: "tengah" });
  } else {
    const kotak = { x: px(nb.kotakX), y: px(nb.y), w: px(nb.kotakW), h: px(nb.h) };
    const opsi = { ukuran: pt(nb.ukuran), ukuranMin: UKURAN_MIN_ISIAN, font: "B" as const, warna: tinta };
    teksKotak(k, "NO", { x: px(P.kiri), y: kotak.y, w: px(nb.tab - P.kiri), h: kotak.h }, opsi);
    teksKotak(k, `: ${dok.nomorTampil}`, { x: px(nb.tab), y: kotak.y, w: px(nb.kotakX - nb.tab), h: kotak.h }, opsi);
    k.kotak(kotak.x, kotak.y, kotak.w, kotak.h, { garis: { warna: HITAM, tebal: 0.75 } });
    teksKotak(k, formatTanggalPanjang(dok.tanggal), kotak, { ...opsi, rata: "tengah" });
  }

  // ---------- Baris isian bergaris ----------
  const rw = P.baris;
  const lebarNilai = px(rw.akhir - rw.nilaiX);
  const ukuranBaris = pt(rw.ukuran);
  const nilaiIsi: Record<Exclude<Isi, null>, string> = {
    TERIMA_DARI: invoice ? dok.kepada.nama : (dok.kwitansi?.terimaDari ?? dok.kepada.nama),
    TERBILANG: `# ${terbilangRupiah(jumlah, "JUDUL")} #`,
    KEPERLUAN: keperluan(m, k, { lebar: lebarNilai, ukuran: ukuranBaris }),
  };
  rw.daftar.forEach((b, i) => {
    const yBawah = px(b.y);
    const teksLabel = b.isi === "TERIMA_DARI" && invoice ? "Kepada" : b.label;
    if (teksLabel) {
      const yAtas = yBawah - 1.25 * ukuranBaris;
      k.teks(teksLabel, { x: px(rw.labelX), y: yAtas, lebar: px(rw.titikDuaX - rw.labelX), ukuran: ukuranBaris, font: "B", warna: label });
      k.teks(":", { x: px(rw.titikDuaX), y: yAtas, lebar: px(rw.nilaiX - rw.titikDuaX), ukuran: ukuranBaris, font: "B", warna: label });
    }
    if (rw.garis) k.garis(px(rw.nilaiX), yBawah, px(rw.akhir), yBawah, rw.garis.gaya === "penuh" ? rw.garis : { ...rw.garis, pola: [...POLA_GARIS[rw.garis.gaya]] });
    if (!b.isi) return;
    // baris lanjutan (isi null) sesudah baris ini menampung sisa teksnya
    let slot = 1;
    while (rw.daftar[i + slot] && rw.daftar[i + slot].isi === null) slot++;
    const { baris, ukuran } = isiSlotBaris(k, nilaiIsi[b.isi], slot, { lebar: lebarNilai, ukuran: ukuranBaris, font: "B", ukuranMin: UKURAN_MIN_ISIAN });
    baris.forEach((t, j) => {
      k.teks(t, { x: px(rw.nilaiX), y: px(rw.daftar[i + j].y) - 1.25 * ukuran, lebar: lebarNilai, ukuran, font: "B", warna: tinta });
    });
  });

  // ---------- Kotak nominal ----------
  const nm = P.nominal;
  const kotakNominal = { x: px(nm.x), y: px(nm.y), w: px(nm.w), h: px(nm.ukuran * 1.6) };
  k.kotak(kotakNominal.x, kotakNominal.y, kotakNominal.w, kotakNominal.h, { isi: nm.latar });
  // nominal selalu bergaya TITIK seperti generator (DG:kwitansi.py), apa pun gaya angka template (D3 §3.7)
  teksKotak(k, formatRupiah(jumlah, "TITIK", m.tema.desimal, { akhiran: nm.akhiran }), kotakNominal, { ukuran: pt(nm.ukuran), ukuranMin: UKURAN_MIN_ISIAN, font: "B", warna: PUTIH, rata: "tengah" });
  const potongan = !invoice ? dok.kwitansi?.potonganPajak : null;
  if (bukanNol(potongan)) {
    k.teks(`Termasuk PPh 23 dipotong pelanggan: ${rupiah(m, potongan!)}`, { x: kotakNominal.x, y: kotakNominal.y + kotakNominal.h + px(8), lebar: px(P.bawah.ttdX - nm.x), ukuran: pt(28), warna: tinta });
  }

  // ---------- Blok bawah: pembayaran (kiri) | tanda tangan (kanan) ----------
  const bt = P.bawah;
  const infoBank = dok.surat.infoBank?.trim() || null;
  // batas bawah kolom kiri: margin bawah atau tepi atas kaki gaya ini (kaki digambar di lapisan depan)
  const kaki = m.tema.aset.KAKI ? P.gambar.find((g) => g.slot === "KAKI") : undefined;
  const batasKiri = px(Math.min(H - BAWAH_PX, kaki ? kaki.y(H) : Infinity));
  if (infoBank) {
    // info rekening dokumen: tab jadi spasi, turun ukuran sampai 6 pt, lalu dipotong dengan peringatan
    const t = bt.kiri[0];
    const y0 = px(t.y);
    const lebarKiri = px(bt.ttdX - t.x);
    const font = t.tebal ? ("B" as const) : ("R" as const);
    const { baris, ukuran } = isiSlotBaris(k, infoBank.replace(/\t/g, " "), (u) => Math.floor((batasKiri - y0 + 0.01) / (1.25 * u)), { lebar: lebarKiri, ukuran: pt(t.ukuran), font, ukuranMin: UKURAN_MIN_ISIAN });
    baris.forEach((isi, j) => k.teks(isi, { x: px(t.x), y: y0 + j * 1.25 * ukuran, lebar: lebarKiri, ukuran, font, warna: label, tinggiBaris: { pasti: 1.25 * ukuran } }));
  }
  const kiri = infoBank ? [] : bt.kiri.map((t) => ({ ...t, teks: isiTokenRekening(t.teks, identitas) }));
  for (const t of kiri) {
    const u = pt(t.ukuran);
    const lebarKiri = px(bt.ttdX - t.x);
    const [sebelumTab, sesudahTab] = t.teks.split("\t");
    const opsi = { x: px(t.x), y: px(t.y), lebar: lebarKiri, ukuran: u, font: t.tebal ? ("B" as const) : ("R" as const), warna: label, garisBawah: t.garisBawah, tinggiBaris: { pasti: 1.25 * u } };
    if (sesudahTab !== undefined && bt.tab) {
      k.teks(sebelumTab, { ...opsi, lebar: px(bt.tab - t.x) });
      k.teks(sesudahTab, { ...opsi, x: px(bt.tab), lebar: px(bt.ttdX - bt.tab) });
    } else k.teks(t.teks.replace(/\t/g, " "), opsi);
  }

  const xTtd = px(bt.ttdX);
  const wTtd = px(bt.ttdW);
  const ttd = tandaTanganDipakai(m);
  let bawahKanan = 0;
  for (const b of bt.bagian) {
    const y = px(b.y);
    if (b.jenis === "ttd") {
      const h = px(b.ukuran);
      // rasio gambar tanda tangan 1000:560; tanpa gambar ruangnya tetap disisakan
      if (ttd) {
        // kotak 1000:560 di tengah kolom tanda tangan (sumbu sama dengan kota, salam, dan nama)
        const lebarTtd = Math.min(wTtd, (h * 1000) / 560);
        k.gambar(ttd, { x: xTtd + (wTtd - lebarTtd) / 2, y, muat: [lebarTtd, h] }, "TANDA_TANGAN");
      }
      bawahKanan = Math.max(bawahKanan, y + h);
      continue;
    }
    const u = pt(b.ukuran);
    const teks =
      b.jenis === "kota" || b.jenis === "kotaTipis" ? kotaTanggal(m, dok.tanggal) : b.jenis === "salam" ? (b.teks ?? identitas.teksSalam) : b.jenis === "jabatan" ? (identitas.jabatanPenandaTangan ?? "") : (identitas.penandaTangan ?? "");
    const warna = b.jenis === "namaGaris" || b.jenis === "salam" ? label : tinta;
    k.teks(teks, { x: xTtd, y, lebar: wTtd, ukuran: u, font: b.jenis === "kotaTipis" ? "R" : "B", warna, rata: "tengah", garisBawah: b.jenis === "namaGaris", tinggiBaris: { pasti: 1.25 * u } });
    bawahKanan = Math.max(bawahKanan, y + 1.25 * u);
  }
  if (bt.ttdBergaris) {
    const atas = px(Math.min(...bt.bagian.map((b) => b.y), ...bt.kiri.map((t) => t.y)));
    k.kotak(xTtd, atas, wTtd, bawahKanan - atas, { garis: { warna: HITAM, tebal: 0.75 } });
  }
  // ruang tanda tangan sengaja dibiarkan kosong tanpa gambar (bisa ditandatangani basah, D3 §3.3)
  // isi kwitansi tidak boleh menimpa batas bawah; peringatan bila terjadi (mis. data contoh berubah)
  if (bawahKanan > k.tinggiKertas - px(BAWAH_PX) + 0.01) k.peringatan(`Blok tanda tangan melewati margin bawah di ${bawahKanan.toFixed(1)} pt`);

  // ---------- Lampiran item (Sahara) ----------
  if (P.lampiranItem && dok.lampiranItem.length) gambarLampiran(k, m);

  return k.selesai();
}

/** Halaman LAMPIRAN Sahara: tabel item dengan kepala dan baris TOTAL merah. */
function gambarLampiran(k: KanvasCetak, m: MasukanTataLetak): void {
  const L = LAMPIRAN_SAHARA;
  const px = (v: number) => k.px(v);
  const pt = (v: number) => k.ukuranHuruf(v);
  const g = m.tema.gayaAngka;
  const rp = (d: Desimal) => formatRupiah(d, g, m.tema.desimal);
  k.lanjutHalaman();
  // halaman lanjutan lampiran mulai di bawah dekorasi (jarak 400 px), sama untuk halaman berikutnya bila tabel panjang
  k.aturArea({ atas: px(L.jarakAtas + 19), bawah: px(BAWAH_PX), kiri: px(L.x), kanan: px(KANAN_PX) });
  k.teks("LAMPIRAN", { x: px(L.x), lebar: px(1000), ukuran: pt(L.judul), font: "B", warna: HITAM, tinggiBaris: { pasti: 1.25 * pt(L.judul) } });
  k.y += px(L.jarakJudul);
  const ukuran = pt(L.ukuran);
  const garis = { warna: HITAM, tebal: 1.5 };
  const pad: [number, number, number, number] = [0, px(12), 0, px(12)];
  const sel = (isi: string, rata: SelTabel["rata"], latar?: string, span = 1): SelTabel => ({ isi, span, rata, valign: "tengah", ukuran, font: latar ? "B" : "R", warna: latar ? PUTIH : HITAM, latar, pad });
  const tinggi = px(L.tinggi);
  const kepala: BarisTabel = { tinggiPasti: tinggi, sel: [sel("No.", "tengah", L.merah), sel("ITEM", "tengah", L.merah), sel("QTY", "tengah", L.merah, 2), sel("UNIT COST", "tengah", L.merah), sel("JUMLAH", "tengah", L.merah)] };
  const item = m.dok.lampiranItem;
  const baris: BarisTabel[] = item.map((b, i) => ({
    tinggiPasti: tinggi,
    sel: [sel(String(i + 1), "tengah"), sel(b.nama, "kiri"), sel(formatJumlah(b.jumlah, g), "tengah"), sel(b.satuan, "tengah"), sel(rp(b.harga), "kanan"), sel(rp(b.nilai), "kanan")],
  }));
  const jumlah = item.reduce((n, b) => n.plus(b.nilai), item[0].nilai.minus(item[0].nilai));
  baris.push({ tinggiPasti: tinggi, sel: [sel("TOTAL", "tengah", L.merah, 5), sel(rp(jumlah), "kanan", L.merah)] });
  gambarTabel(k, { x: px(L.x), kolom: L.kolom.map(px), kepala, baris, garisBawaan: garis });
}

