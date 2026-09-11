import { createHash } from "node:crypto";
import { D, uang, type Desimal } from "@/lib/uang";

/*
 * Impor mutasi rekening koran (CSV / HTML tabel / TSV) dengan kolom terstruktur.
 * Praktik yang dipakai:
 *  - pemetaan kolom lewat nama tajuk (bahasa Indonesia/Inggris), pembatas CSV dideteksi otomatis (, ; tab)
 *  - tanggal: yyyy-mm-dd, dd/mm/yyyy, dd-mm-yyyy, dd MMM yyyy; angka: "1.234.567,89" maupun "1,234,567.89"
 *  - kolom jumlah boleh Debit/Kredit terpisah atau satu kolom bertanda (+/−, DB/CR)
 *  - setiap baris diberi sidik jari (akun + tanggal + masuk + keluar + keterangan) supaya impor ulang tidak menggandakan
 */
export type BarisMutasi = { tanggal: Date; keterangan: string; referensi: string | null; masuk: Desimal; keluar: Desimal; saldo: Desimal | null };
/**
 * Sudut pandang kolom Debit/Kredit:
 *  - "bank"  = rekening koran: KREDIT bank = uang masuk ke kita (= DEBIT akun kas/bank di buku), DEBIT bank = uang keluar
 *  - "buku"  = sudah dari sisi akuntansi kita: DEBIT = uang masuk, KREDIT = uang keluar
 *  - "otomatis" = ditebak dari pergerakan kolom Saldo (bila ada); tanpa saldo dianggap "bank"
 * Hasil bacaan SELALU disimpan dari sisi buku: `masuk` → Dr akun kas/bank, `keluar` → Cr akun kas/bank.
 */
export type SudutPandang = "otomatis" | "bank" | "buku";
export type HasilBaca = {
  tajuk: string[];
  peta: PetaKolom;
  baris: BarisMutasi[];
  diabaikan: { nomor: number; alasan: string; isi: string }[];
  format: "csv" | "html";
  /** sudut pandang yang dipakai setelah deteksi */
  sudutPandang: "bank" | "buku";
  /** penjelasan deteksi untuk ditampilkan ke pengguna */
  keteranganSudut: string;
};
export type PetaKolom = { tanggal: number; keterangan: number; referensi: number | null; masuk: number | null; keluar: number | null; jumlah: number | null; saldo: number | null };

const NAMA_KOLOM: Record<keyof PetaKolom, RegExp> = {
  tanggal: /^(tanggal|tgl|date|posting date|transaction date|value date|tanggal transaksi|tgl transaksi)$/i,
  keterangan: /^(keterangan|uraian|deskripsi|description|remark|remarks|narrative|transaksi|berita|memo|keterangan transaksi)$/i,
  referensi: /^(referensi|ref|reference|no ref|no\. ref|nomor referensi|cheque|no cek|ref no)$/i,
  masuk: /^(kredit|credit|cr|masuk|uang masuk|dana masuk|setoran|deposit|pemasukan|kredit \(idr\))$/i,
  keluar: /^(debit|debet|dr|db|keluar|uang keluar|dana keluar|penarikan|withdrawal|pengeluaran|debit \(idr\))$/i,
  jumlah: /^(jumlah|amount|nominal|mutasi|nilai|amount \(idr\))$/i,
  saldo: /^(saldo|balance|saldo akhir|running balance|ending balance)$/i,
};

/** Menebak pembatas CSV dari baris tajuk. */
function tebakPembatas(barisPertama: string): string {
  const kandidat = [";", ",", "\t", "|"];
  let terbaik = ",", terbanyak = -1;
  for (const c of kandidat) {
    const n = barisPertama.split(c).length;
    if (n > terbanyak) { terbanyak = n; terbaik = c; }
  }
  return terbaik;
}

/** Memecah satu baris CSV dengan dukungan tanda kutip. */
function pecahCsv(baris: string, pembatas: string): string[] {
  const hasil: string[] = [];
  let sekarang = "", dalamKutip = false;
  for (let i = 0; i < baris.length; i++) {
    const ch = baris[i];
    if (ch === '"') {
      if (dalamKutip && baris[i + 1] === '"') { sekarang += '"'; i++; }
      else dalamKutip = !dalamKutip;
    } else if (ch === pembatas && !dalamKutip) {
      hasil.push(sekarang); sekarang = "";
    } else sekarang += ch;
  }
  hasil.push(sekarang);
  return hasil.map((s) => s.trim());
}

function bersihkanHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, " ")
    // pola non-backtracking ([^<>] menolak '<' di dalam tag) agar tidak kuadratik untuk deretan '<' tanpa penutup
    .replace(/<[^<>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Memindai potongan HTML dari `buka` sampai penutup `tutup`, satu blok per kemunculan, secara linear.
 * Memakai indexOf (bukan regex lazy `[\s\S]*?`) supaya masukan patologis — banyak tag pembuka tanpa
 * penutup — tidak memicu pemindaian ulang O(n^2) yang bisa membekukan event loop (DoS).
 */
function potongBlok(teks: string, bawah: string, buka: string, tutup: string, mulai: number): { isi: string; berikut: number } | null {
  const a = bawah.indexOf(buka, mulai);
  if (a < 0) return null;
  const b = bawah.indexOf(tutup, a + buka.length);
  if (b < 0) return null;
  return { isi: teks.slice(a + buka.length, b), berikut: b + tutup.length };
}

/** Mengambil sel <td>/<th> dari satu baris secara linear (tanpa regex lazy bertumpuk). */
function ambilSel(baris: string): string[] {
  const bawah = baris.toLowerCase();
  const sel: string[] = [];
  let i = 0;
  while (i < baris.length) {
    const td = bawah.indexOf("<td", i), th = bawah.indexOf("<th", i);
    const a = td < 0 ? th : th < 0 ? td : Math.min(td, th);
    if (a < 0) break;
    const buka = baris.indexOf(">", a);
    if (buka < 0) break;
    const etd = bawah.indexOf("</td>", buka), eth = bawah.indexOf("</th>", buka);
    const b = etd < 0 ? eth : eth < 0 ? etd : Math.min(etd, eth);
    if (b < 0) break;
    sel.push(bersihkanHtml(baris.slice(buka + 1, b)));
    i = b + 5; // panjang "</td>" / "</th>"
  }
  return sel;
}

/** Mengambil baris tabel dari HTML (tabel dengan baris terbanyak yang dianggap tabel mutasi). */
function bacaTabelHtml(teks: string): string[][] {
  const bawah = teks.toLowerCase();
  // Kumpulkan blok <table>...</table> secara linear; bila tak ada yang lengkap, pakai seluruh teks.
  const tabel: string[] = [];
  for (let i = 0; ; ) {
    const blok = potongBlok(teks, bawah, "<table", "</table>", i);
    if (!blok) break;
    tabel.push(blok.isi);
    i = blok.berikut;
  }
  let terbaik: string[][] = [];
  for (const t of tabel.length ? tabel : [teks]) {
    const bawahT = t.toLowerCase();
    const baris: string[][] = [];
    for (let j = 0; ; ) {
      const bl = potongBlok(t, bawahT, "<tr", "</tr>", j);
      if (!bl) break;
      baris.push(ambilSel(bl.isi));
      j = bl.berikut;
    }
    if (baris.length > terbaik.length) terbaik = baris;
  }
  return terbaik;
}

const BULAN: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, mei: 4, may: 4, jun: 5, jul: 6, agu: 7, aug: 7, agt: 7, sep: 8, okt: 9, oct: 9, nov: 10, des: 11, dec: 11 };

export function bacaTanggal(teks: string): Date | null {
  const t = teks.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/.exec(t);
  if (m) {
    const tahun = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return new Date(tahun, Number(m[2]) - 1, Number(m[1]), 12);
  }
  m = /^(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{2,4})/.exec(t);
  if (m && BULAN[m[2].toLowerCase()] !== undefined) {
    const tahun = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return new Date(tahun, BULAN[m[2].toLowerCase()], Number(m[1]), 12);
  }
  return null;
}

/** "1.234.567,89" → 1234567.89; "1,234,567.89" → 1234567.89; "(500)" atau "-500" → -500; "500 DB" → -500; "500 CR" → 500. */
export function bacaAngka(teks: string): Desimal | null {
  let t = teks.trim();
  if (!t || t === "-" || t === "-") return null;
  let negatif = false;
  if (/\bDB\b|\bDR\b/i.test(t)) negatif = true;
  t = t.replace(/\b(DB|DR|CR|IDR|Rp)\b/gi, "").replace(/\s/g, "");
  if (/^\(.*\)$/.test(t)) { negatif = true; t = t.slice(1, -1); }
  if (t.startsWith("-") || t.startsWith("−")) { negatif = true; t = t.slice(1); }
  if (t.startsWith("+")) t = t.slice(1);
  const titikAkhir = t.lastIndexOf("."), komaAkhir = t.lastIndexOf(",");
  if (titikAkhir >= 0 && komaAkhir >= 0) {
    // pemisah desimal = yang muncul terakhir
    t = komaAkhir > titikAkhir ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  } else if (komaAkhir >= 0) {
    // hanya koma: desimal bila tepat 2 digit di belakang, selain itu ribuan
    t = /,\d{2}$/.test(t) && (t.match(/,/g) ?? []).length === 1 ? t.replace(",", ".") : t.replace(/,/g, "");
  } else if (titikAkhir >= 0) {
    t = /\.\d{2}$/.test(t) && (t.match(/\./g) ?? []).length === 1 ? t : t.replace(/\./g, "");
  }
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const nilai = uang(t);
  return negatif ? nilai.neg() : nilai;
}

/** Memetakan tajuk ke kolom yang dikenal; bisa ditimpa pengguna lewat pemetaan manual. */
export function petakanKolom(tajuk: string[], manual: Partial<Record<keyof PetaKolom, number | null>> = {}): PetaKolom {
  const cari = (k: keyof PetaKolom) => {
    if (manual[k] !== undefined) return manual[k] as number | null;
    const i = tajuk.findIndex((h) => NAMA_KOLOM[k].test(h.trim()));
    return i >= 0 ? i : null;
  };
  return { tanggal: cari("tanggal") ?? 0, keterangan: cari("keterangan") ?? 1, referensi: cari("referensi"), masuk: cari("masuk"), keluar: cari("keluar"), jumlah: cari("jumlah"), saldo: cari("saldo") };
}

/** Batas ukuran isi mutasi yang boleh diproses (2 MB), berlaku untuk semua jalur (unggah maupun tempel). */
export const BATAS_ISI_MUTASI = 2 * 1024 * 1024;

/** Membaca isi berkas (CSV/TSV/HTML) menjadi baris mutasi ternormalisasi. */
export function bacaMutasi(isi: string, namaBerkas: string, manual: Partial<Record<keyof PetaKolom, number | null>> = {}, sudutPandang: SudutPandang = "otomatis"): HasilBaca {
  // Batasi ukuran sebelum parsing supaya masukan besar tidak membebani event loop (cegah DoS); berlaku untuk pratinjau maupun impor.
  if (isi.length > BATAS_ISI_MUTASI) throw new Error("Isi mutasi terlalu besar (maksimal 2 MB)");
  const teks = isi.replace(/^﻿/, "");
  const html = /<table/i.test(teks) || /\.html?$/i.test(namaBerkas);
  let sel: string[][];
  if (html) sel = bacaTabelHtml(teks);
  else {
    const barisTeks = teks.split(/\r?\n/).filter((b) => b.trim() !== "");
    const pembatas = tebakPembatas(barisTeks[0] ?? "");
    sel = barisTeks.map((b) => pecahCsv(b, pembatas));
  }
  if (sel.length === 0) throw new Error("Berkas kosong atau tidak berisi tabel");
  // tajuk = baris pertama yang memuat kolom tanggal & (debit/kredit/jumlah)
  let indeksTajuk = sel.findIndex((b) => b.some((h) => NAMA_KOLOM.tanggal.test(h)) && b.some((h) => NAMA_KOLOM.masuk.test(h) || NAMA_KOLOM.keluar.test(h) || NAMA_KOLOM.jumlah.test(h)));
  if (indeksTajuk < 0) indeksTajuk = 0;
  const tajuk = sel[indeksTajuk];
  const peta = petakanKolom(tajuk, manual);
  if (peta.masuk === null && peta.keluar === null && peta.jumlah === null) {
    throw new Error(`Kolom jumlah tidak ditemukan. Tajuk terbaca: ${tajuk.join(" | ")}. Pakai tajuk Debit/Kredit atau Jumlah.`);
  }
  // Baca dulu apa adanya: `kolomA` = kolom masuk/kredit, `kolomB` = kolom keluar/debit (sudut bank); dibalik nanti bila perlu
  const mentah: (BarisMutasi & { dariJumlah: boolean })[] = [];
  const diabaikan: HasilBaca["diabaikan"] = [];
  for (let i = indeksTajuk + 1; i < sel.length; i++) {
    const r = sel[i];
    const isi = r.join(" | ");
    const tanggal = bacaTanggal(r[peta.tanggal] ?? "");
    if (!tanggal) { diabaikan.push({ nomor: i + 1, alasan: "tanggal tidak terbaca", isi }); continue; }
    let masuk = D(0), keluar = D(0);
    if (peta.jumlah !== null && peta.masuk === null && peta.keluar === null) {
      const j = bacaAngka(r[peta.jumlah] ?? "");
      if (j === null) { diabaikan.push({ nomor: i + 1, alasan: "jumlah tidak terbaca", isi }); continue; }
      if (j.gte(0)) masuk = j; else keluar = j.neg();
    } else {
      const m = peta.masuk !== null ? bacaAngka(r[peta.masuk] ?? "") : null;
      const k = peta.keluar !== null ? bacaAngka(r[peta.keluar] ?? "") : null;
      if (m === null && k === null) { diabaikan.push({ nomor: i + 1, alasan: "debit & kredit kosong", isi }); continue; }
      masuk = m ? m.abs() : D(0);
      keluar = k ? k.abs() : D(0);
    }
    if (masuk.isZero() && keluar.isZero()) { diabaikan.push({ nomor: i + 1, alasan: "nominal nol", isi }); continue; }
    const saldo = peta.saldo !== null ? bacaAngka(r[peta.saldo] ?? "") : null;
    mentah.push({ tanggal, keterangan: (r[peta.keterangan] ?? "").trim() || "(tanpa keterangan)", referensi: peta.referensi !== null ? (r[peta.referensi] ?? "").trim() || null : null, masuk, keluar, saldo, dariJumlah: peta.jumlah !== null && peta.masuk === null && peta.keluar === null });
  }
  // Tentukan sudut pandang kolom Debit/Kredit. Kolom Jumlah bertanda selalu: positif = uang masuk.
  const pakaiKolomTerpisah = mentah.some((b) => !b.dariJumlah);
  let sudut: "bank" | "buku" = sudutPandang === "buku" ? "buku" : "bank";
  let keteranganSudut = sudutPandang === "buku"
    ? "Dibaca sebagai buku kas: Debit = uang masuk, Kredit = uang keluar."
    : sudutPandang === "bank"
      ? "Dibaca sebagai rekening koran: Kredit = uang masuk, Debit = uang keluar."
      : "Tidak ada kolom Saldo. Dibaca sebagai rekening koran: Kredit = uang masuk, Debit = uang keluar.";
  if (sudutPandang === "otomatis" && pakaiKolomTerpisah) {
    // Bandingkan pergerakan saldo antar baris berurutan dengan (masuk − keluar) versi bank vs versi buku
    let cocokBank = 0, cocokBuku = 0;
    for (let i = 1; i < mentah.length; i++) {
      const a = mentah[i - 1].saldo, b = mentah[i].saldo;
      if (a === null || b === null) continue;
      const gerak = b.minus(a);
      const bank = mentah[i].masuk.minus(mentah[i].keluar);
      if (gerak.equals(bank)) cocokBank++;
      else if (gerak.equals(bank.neg())) cocokBuku++;
    }
    if (cocokBank + cocokBuku > 0) {
      sudut = cocokBuku > cocokBank ? "buku" : "bank";
      keteranganSudut = sudut === "buku"
        ? "Terdeteksi dari kolom Saldo: berkas memakai sudut buku kas. Debit = uang masuk, Kredit = uang keluar."
        : "Terdeteksi dari kolom Saldo: rekening koran. Kredit = uang masuk, Debit = uang keluar.";
    }
  }
  if (!pakaiKolomTerpisah) keteranganSudut = "Kolom Jumlah: positif = uang masuk, negatif = uang keluar.";
  const baris: BarisMutasi[] = mentah.map(({ dariJumlah, ...b }) => (sudut === "buku" && !dariJumlah ? { ...b, masuk: b.keluar, keluar: b.masuk } : b));
  return { tajuk, peta, baris, diabaikan, format: html ? "html" : "csv", sudutPandang: sudut, keteranganSudut };
}

/** Sidik jari baris untuk menolak impor ganda. */
export function sidikMutasi(akunId: string, b: { tanggal: Date; masuk: Desimal; keluar: Desimal; keterangan: string; referensi?: string | null }): string {
  const kunci = [akunId, b.tanggal.toISOString().slice(0, 10), b.masuk.toFixed(2), b.keluar.toFixed(2), b.keterangan.toLowerCase().replace(/\s+/g, " "), b.referensi ?? ""].join("|");
  return createHash("sha256").update(kunci).digest("hex").slice(0, 40);
}

/** Contoh CSV yang diterima (tajuk bahasa Indonesia, pembatas titik koma, angka format Indonesia). */
export const CONTOH_CSV = `Tanggal;Keterangan;Referensi;Debit;Kredit;Saldo
01/09/2026;TRF DARI PT CAHAYA NUSANTARA DP EVENT;TRX001;;1.000.000,00;11.000.000,00
03/09/2026;BIAYA ADMIN BULANAN;ADM;6.500,00;;10.993.500,00
05/09/2026;PEMBAYARAN CV SINAR DEKORASI;TRX002;600.000,00;;10.393.500,00`;
