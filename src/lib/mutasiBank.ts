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
export type HasilBaca = { tajuk: string[]; peta: PetaKolom; baris: BarisMutasi[]; diabaikan: { nomor: number; alasan: string; isi: string }[]; format: "csv" | "html" };
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
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Mengambil baris tabel dari HTML (tabel dengan baris terbanyak yang dianggap tabel mutasi). */
function bacaTabelHtml(teks: string): string[][] {
  const tabel = [...teks.matchAll(/<table[\s\S]*?<\/table>/gi)].map((m) => m[0]);
  let terbaik: string[][] = [];
  for (const t of tabel.length ? tabel : [teks]) {
    const baris = [...t.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((m) => [...m[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => bersihkanHtml(c[1])));
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
  if (!t || t === "-" || t === "—") return null;
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

/** Membaca isi berkas (CSV/TSV/HTML) menjadi baris mutasi ternormalisasi. */
export function bacaMutasi(isi: string, namaBerkas: string, manual: Partial<Record<keyof PetaKolom, number | null>> = {}): HasilBaca {
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
  const baris: BarisMutasi[] = [];
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
    baris.push({ tanggal, keterangan: (r[peta.keterangan] ?? "").trim() || "(tanpa keterangan)", referensi: peta.referensi !== null ? (r[peta.referensi] ?? "").trim() || null : null, masuk, keluar, saldo });
  }
  return { tajuk, peta, baris, diabaikan, format: html ? "html" : "csv" };
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
