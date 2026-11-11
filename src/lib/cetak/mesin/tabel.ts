import { GalatIsiTerlaluTinggi, type BarisTeksCetak, type Font, type KanvasCetak, type OpsiTeks, type Segmen } from "@/lib/cetak/mesin/kanvas";

/*
 * Tabel di atas KanvasCetak (D3 §3.10): sel gabung (span), latar, garis per sel, perataan mendatar dan tegak,
 * sel uang "Rp" kiri dan angka kanan (pola tab_cell generator D'Pro), zebra, baris total, dan kepala yang diulang di
 * setiap halaman. Baris tidak pernah terpotong: bila tidak muat di sisa halaman, seluruh baris pindah ke halaman
 * berikutnya. Jalan terakhir (tinjauan P09 temuan 3): baris yang lebih tinggi dari satu halaman penuh dipecah per baris
 * teks di setiap sel, dan sel yang isinya sudah habis kosong di lanjutannya. Bila satu baris teks pun tidak muat di
 * halaman kosong, GalatIsiTerlaluTinggi dilempar. Satuan pt. Kursor kanvas berada di bawah tabel setelah selesai.
 */

export type SelTabel = {
  isi: string | Segmen[] | BarisTeksCetak[];
  /** Jumlah kolom yang digabung, bawaan 1. */
  span?: number;
  rata?: "kiri" | "tengah" | "kanan";
  valign?: "atas" | "tengah" | "bawah";
  font?: Font;
  ukuran: number;
  warna?: string;
  latar?: string;
  /** undefined = garisBawaan tabel; null = tanpa garis. */
  garis?: { warna: string; tebal: number } | null;
  /** [atas, kanan, bawah, kiri] dalam pt, bawaan [2, 3, 2, 3]. */
  pad?: [number, number, number, number];
  /** "Rp" rata kiri dan isi (angka) rata kanan di sel yang sama. */
  rpKiri?: boolean;
  /** Tinggi baris teks, diteruskan ke OpsiTeks. */
  tinggiBaris?: OpsiTeks["tinggiBaris"];
};

export type BarisTabel = { sel: SelTabel[]; tinggiMin?: number; tinggiPasti?: number };

export type DefTabel = {
  x: number;
  /** Lebar tiap kolom dalam pt. */
  kolom: number[];
  kepala?: BarisTabel;
  /** Ulang kepala di halaman lanjutan, bawaan true. */
  ulangKepala?: boolean;
  baris: BarisTabel[];
  garisBawaan?: { warna: string; tebal: number };
  /** Latar baris data ganjil (kedua, keempat, ...) yang selnya tidak berlatar. */
  zebra?: string;
  /** Baris terakhir dianggap baris total: latar untuk sel tanpa latar dan garis atas setebal garisAtas selebar tabel. */
  barisTotal?: { latar: string; garisAtas: number };
};

const PAD_BAWAAN: [number, number, number, number] = [2, 3, 2, 3];

type SelTerukur = { sel: SelTabel; x: number; w: number; pad: [number, number, number, number]; tinggiIsi: number; jumlahBaris: number };
type BarisTerukur = { baris: BarisTabel; sel: SelTerukur[]; tinggi: number };

const berbutir = (isi: SelTabel["isi"]): isi is BarisTeksCetak[] => Array.isArray(isi) && isi.length > 0 && "jenis" in isi[0];

function opsiTeks(s: SelTerukur): OpsiTeks {
  return { x: s.x + s.pad[3], lebar: Math.max(0, s.w - s.pad[1] - s.pad[3]), ukuran: s.sel.ukuran, font: s.sel.font, warna: s.sel.warna, rata: s.sel.rata ?? "kiri", tinggiBaris: s.sel.tinggiBaris };
}

function ukurIsi(k: KanvasCetak, s: SelTerukur): { tinggi: number; jumlahBaris: number } {
  const o = opsiTeks(s);
  const isi = s.sel.isi;
  if (s.sel.rpKiri) return k.ukur(typeof isi === "string" ? isi : "", { ...o, rata: "kanan" });
  if (berbutir(isi)) return k.ukurBerbutir(isi, o);
  return k.ukur(isi as string | Segmen[], o);
}

function ukurBaris(k: KanvasCetak, def: DefTabel, baris: BarisTabel): BarisTerukur {
  const kolom = def.kolom;
  let indeks = 0;
  let x = def.x;
  const sel = baris.sel.map((s) => {
    const span = Math.max(1, s.span ?? 1);
    if (indeks + span > kolom.length) throw new Error(`gambarTabel: jumlah span sel (${indeks + span}) melebihi ${kolom.length} kolom`);
    const w = kolom.slice(indeks, indeks + span).reduce((n, v) => n + v, 0);
    const terukur: SelTerukur = { sel: s, x, w, pad: s.pad ?? PAD_BAWAAN, tinggiIsi: 0, jumlahBaris: 0 };
    const u = ukurIsi(k, terukur);
    terukur.tinggiIsi = u.tinggi;
    terukur.jumlahBaris = u.jumlahBaris;
    indeks += span;
    x += w;
    return terukur;
  });
  if (indeks !== kolom.length) throw new Error(`gambarTabel: baris mengisi ${indeks} dari ${kolom.length} kolom`);
  const tinggiSel = Math.max(0, ...sel.map((s) => s.tinggiIsi + s.pad[0] + s.pad[2]));
  const tinggi = baris.tinggiPasti ?? Math.max(baris.tinggiMin ?? 0, tinggiSel);
  return { baris, sel, tinggi };
}

type GayaBaris = { zebra?: string; total?: { latar: string; garisAtas: number } };

/**
 * Menggambar baris di kursor. Tanpa `potongan`: seluruh baris setinggi b.tinggi. Dengan `potongan`: sepotong baris
 * yang dipecah, setinggi `tinggi`, dan sel ke-i hanya menggambar baris teks rentang[i] dengan perataan atas.
 */
function gambarBaris(k: KanvasCetak, def: DefTabel, b: BarisTerukur, gaya: GayaBaris, potongan?: { tinggi: number; rentang: { dari: number; sampai: number }[] }): void {
  const y = k.y;
  const tinggi = potongan?.tinggi ?? b.tinggi;
  for (const s of b.sel) {
    const latar = s.sel.latar ?? gaya.total?.latar ?? gaya.zebra;
    if (latar) k.kotak(s.x, y, s.w, tinggi, { isi: latar });
  }
  b.sel.forEach((s, i) => {
    const rentang = potongan?.rentang[i];
    if (rentang && rentang.sampai <= rentang.dari) return;
    const o: OpsiTeks = { ...opsiTeks(s), rentang };
    const ruangIsi = b.tinggi - s.pad[0] - s.pad[2];
    const valign = potongan ? "atas" : (s.sel.valign ?? "atas");
    const yIsi = y + s.pad[0] + (valign === "tengah" ? (ruangIsi - s.tinggiIsi) / 2 : valign === "bawah" ? ruangIsi - s.tinggiIsi : 0);
    const isi = s.sel.isi;
    if (s.sel.rpKiri) {
      if (!rentang || rentang.dari === 0) k.teks("Rp", { ...o, y: yIsi, rata: "kiri", rentang: undefined });
      k.teks(typeof isi === "string" ? isi : "", { ...o, y: yIsi, rata: "kanan" });
    } else if (berbutir(isi)) {
      k.teksBerbutir(isi, { ...o, y: yIsi });
    } else {
      k.teks(isi as string | Segmen[], { ...o, y: yIsi });
    }
  });
  for (const s of b.sel) {
    const g = s.sel.garis === undefined ? def.garisBawaan : s.sel.garis;
    if (g && g.tebal > 0) k.kotak(s.x, y, s.w, tinggi, { garis: g });
  }
  if (gaya.total && gaya.total.garisAtas > 0) {
    const lebar = def.kolom.reduce((n, v) => n + v, 0);
    k.garis(def.x, y, def.x + lebar, y, { warna: def.garisBawaan?.warna ?? "#000000", tebal: gaya.total.garisAtas });
  }
  k.y = y + tinggi;
}

/** Tinggi satu baris teks sel (semua baris teks satu sel setinggi sama). */
const tinggiBarisSel = (s: SelTerukur) => (s.jumlahBaris > 0 ? s.tinggiIsi / s.jumlahBaris : 0);

/**
 * Baris yang lebih tinggi dari satu halaman penuh: digambar sepotong demi sepotong mulai di kursor. Tiap potongan
 * memuat sebanyak mungkin baris teks utuh per sel di sisa halaman (pad atas dan bawah sel diulang), lalu pindah
 * halaman dan mengulang kepala. Potongan terakhir setinggi sisa isi terpanjang.
 */
function gambarBarisTerpecah(k: KanvasCetak, def: DefTabel, b: BarisTerukur, gaya: GayaBaris, kepala: BarisTerukur | null): void {
  const mulai = b.sel.map(() => 0);
  const sisaTinggi = () => Math.max(0, ...b.sel.map((s, i) => (mulai[i] < s.jumlahBaris ? s.pad[0] + (s.jumlahBaris - mulai[i]) * tinggiBarisSel(s) + s.pad[2] : 0)));
  let pertama = true;
  for (;;) {
    const ruang = k.sisa();
    const rentang = b.sel.map((s, i) => {
      const tb = tinggiBarisSel(s);
      const muat = tb > 0 ? Math.floor((ruang - s.pad[0] - s.pad[2] + 0.01) / tb) : 0;
      return { dari: mulai[i], sampai: Math.min(s.jumlahBaris, mulai[i] + Math.max(0, muat)) };
    });
    const terakhir = sisaTinggi() <= ruang + 0.01;
    const maju = rentang.some((r) => r.sampai > r.dari);
    if (!terakhir && !maju) {
      if (k.halamanKosong()) throw new GalatIsiTerlaluTinggi();
      k.lanjutHalaman();
      if (kepala && (def.ulangKepala ?? true)) gambarBaris(k, def, kepala, {});
      continue;
    }
    const tinggi = terakhir ? Math.max(sisaTinggi(), pertama ? (b.baris.tinggiMin ?? 0) : 0) : ruang;
    // garis atas baris total hanya di potongan pertama; latarnya tetap di lanjutan
    const gayaPotongan = pertama ? gaya : { zebra: gaya.zebra, total: gaya.total && { latar: gaya.total.latar, garisAtas: 0 } };
    gambarBaris(k, def, b, gayaPotongan, { tinggi, rentang });
    pertama = false;
    rentang.forEach((r, i) => (mulai[i] = r.sampai));
    if (terakhir) return;
    k.peringatan(`Baris tabel lebih tinggi dari satu halaman dipecah di halaman ${k.halamanKe}`);
    k.lanjutHalaman();
    if (kepala && (def.ulangKepala ?? true)) gambarBaris(k, def, kepala, {});
  }
}

/** Menggambar tabel mulai di kursor kanvas, pindah halaman bila perlu, lalu kursor diletakkan di bawah tabel. */
export function gambarTabel(k: KanvasCetak, def: DefTabel): void {
  const kepala = def.kepala ? ukurBaris(k, def, def.kepala) : null;
  const ulang = def.ulangKepala ?? true;
  const baris = def.baris.map((b) => ukurBaris(k, def, b));

  // baris yang tidak muat di halaman penuh (sesudah kepala yang diulang) dipecah; tinggi awalnya = satu baris teks
  const ruangPenuh = k.tinggiArea - (kepala && ulang ? kepala.tinggi : 0);
  const terlaluTinggi = (b: BarisTerukur) => b.tinggi > ruangPenuh + 0.01;
  const tinggiAwal = (b: BarisTerukur) => (terlaluTinggi(b) ? Math.max(0, ...b.sel.map((s) => s.pad[0] + tinggiBarisSel(s) + s.pad[2])) : b.tinggi);

  // kepala tidak boleh sendirian di dasar halaman: kepala dan baris pertama dipindah bersama
  k.pastikanRuang((kepala?.tinggi ?? 0) + (baris[0] ? tinggiAwal(baris[0]) : 0));
  if (kepala) gambarBaris(k, def, kepala, {});
  baris.forEach((b, i) => {
    const total = def.barisTotal && i === baris.length - 1 ? def.barisTotal : undefined;
    const gaya = { zebra: def.zebra && i % 2 === 1 ? def.zebra : undefined, total };
    if (terlaluTinggi(b)) {
      gambarBarisTerpecah(k, def, b, gaya, kepala);
      return;
    }
    if (k.sisa() < b.tinggi - 0.01) {
      const pindah = k.pastikanRuang(b.tinggi + (kepala && ulang ? kepala.tinggi : 0));
      if (pindah && kepala && ulang) gambarBaris(k, def, kepala, {});
    }
    gambarBaris(k, def, b, gaya);
  });
}
