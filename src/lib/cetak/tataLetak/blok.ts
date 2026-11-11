import { Prisma } from "@/prisma-klien/browser";
import { GayaEntitas, JenisAsetKop, type UkuranKertas } from "@/prisma-klien/enums";
import type { Desimal } from "@/lib/uang";
import { asetBawaan } from "@/lib/cetak/aset";
import { formatAngka, formatJumlah, formatRupiah, formatTanggalPanjang, formatTanggalPendek } from "@/lib/cetak/format";
import { GalatIsiTerlaluTinggi, KanvasCetak, SKALA_KERTAS, type BarisTeksCetak, type OpsiTeks, type Perekam, type Segmen } from "@/lib/cetak/mesin/kanvas";
import type { BarisCetak, DokumenCetak, IdentitasCetak, TemaCetak } from "@/lib/cetak/tipe";
import { uraiTeksBerbutir } from "@/lib/teksBerbutir";

/*
 * Blok bersama tata letak cetak (D3 §3.10) di atas KanvasCetak: masukan tata letak, dekorasi gambar per slot, aliran
 * teks yang pindah halaman per baris, teks berbutir, format uang per tema, baris tagihan termin, dan pemecah baris
 * untuk isian kwitansi. Tata letak tidak pernah membaca basis data: semua masukan datang lewat MasukanTataLetak.
 */

/** Satu permintaan render untuk fungsi tata letak (dispatcher renderDokumen milik P30 menyusunnya). */
export type MasukanTataLetak = {
  dok: DokumenCetak;
  tema: TemaCetak;
  identitas: IdentitasCetak;
  /** judul hasil D3 §3.1 langkah 8: dok.judul ?? template.judul ?? judul bawaan jenis */
  judul: string;
  ukuran: UkuranKertas;
  /**
   * Tanda tangan diminta dan pengguna berhak (D3 §3.3 butir a dan c). Draf dan aset TANDA_TANGAN kosong diperiksa
   * tata letak sendiri (tandaTanganDipakai), jadi gambar tidak pernah dibubuhkan di draf.
   */
  tandaTangan: boolean;
  perekam?: Perekam;
  /** teks stempel diagonal; undefined = "DRAF" bila dok.draf, null = tanpa stempel */
  stempel?: string | null;
};

export const PUTIH = "#FFFFFF";
export const HITAM = "#000000";

/** Gambar tanda tangan yang benar-benar dibubuhkan: diminta, bukan draf, dan kop punya asetnya. */
export function tandaTanganDipakai(m: MasukanTataLetak): Uint8Array | null {
  if (!m.tandaTangan || m.dok.draf) return null;
  return m.tema.aset.TANDA_TANGAN ?? null;
}

/** Kanvas baru dengan metadata, skala desain kertas, dan stempel draf. */
export function buatKanvas(m: MasukanTataLetak, judulBerkas: string): KanvasCetak {
  const k = new KanvasCetak({ judul: `${judulBerkas} ${m.dok.nomorTampil}`, subjek: m.judul, penulis: m.identitas.namaLegal || m.identitas.nama, perekam: m.perekam });
  k.skala = SKALA_KERTAS[m.ukuran];
  const stempel = m.stempel === undefined ? (m.dok.draf ? "DRAF" : null) : m.stempel;
  if (stempel) k.stempelStatus(stempel);
  return k;
}

/** Peta aset bawaan repo untuk satu gaya entitas (tanpa TANDA_TANGAN dan STEMPEL, yang hanya dari unggahan). */
export function petaAsetBawaan(gaya: GayaEntitas | null): TemaCetak["aset"] {
  const peta: TemaCetak["aset"] = {};
  if (!gaya) return peta;
  for (const slot of Object.values(JenisAsetKop)) {
    const isi = asetBawaan(gaya, slot);
    if (isi) peta[slot] = isi;
  }
  return peta;
}

/** Menggambar aset slot bila ada; mengembalikan ukuran tergambar atau null. */
export function gambarSlot(k: KanvasCetak, m: MasukanTataLetak, slot: JenisAsetKop, kotak: Parameters<KanvasCetak["gambar"]>[1]): { w: number; h: number } | null {
  const isi = m.tema.aset[slot];
  return isi ? k.gambar(isi, kotak, slot) : null;
}

/** Ukuran gambar slot bila digambar selebar w (rasio asli), tanpa menggambar. */
export function tinggiGambarSlot(m: MasukanTataLetak, slot: JenisAsetKop, w: number): number | null {
  const isi = m.tema.aset[slot];
  if (!isi) return null;
  const ukuran = ukuranPng(isi);
  return ukuran ? (w * ukuran.tinggi) / ukuran.lebar : null;
}

/** Lebar/tinggi piksel dari kepala PNG atau JPEG (sudah lolos periksaGambar saat digambar). */
export function ukuranPng(isi: Uint8Array): { lebar: number; tinggi: number } | null {
  const b = Buffer.from(isi.buffer, isi.byteOffset, isi.byteLength);
  if (b.length >= 24 && b[0] === 0x89 && b.toString("latin1", 12, 16) === "IHDR") return { lebar: b.readUInt32BE(16), tinggi: b.readUInt32BE(20) };
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const penanda = b[i + 1];
      const panjang = b.readUInt16BE(i + 2);
      if (penanda >= 0xc0 && penanda <= 0xcf && penanda !== 0xc4 && penanda !== 0xc8 && penanda !== 0xcc) return { lebar: b.readUInt16BE(i + 7), tinggi: b.readUInt16BE(i + 5) };
      i += 2 + panjang;
    }
  }
  return null;
}

// ---------- Angka dan teks ----------

export const angka = (m: MasukanTataLetak, d: Desimal) => formatAngka(d, m.tema.gayaAngka, m.tema.desimal);
export const rupiah = (m: MasukanTataLetak, d: Desimal, akhiran = "") => formatRupiah(d, m.tema.gayaAngka, m.tema.desimal, { akhiran });
/** Persen tanpa nol di belakang: 11.00 jadi "11", 2.5 jadi "2,5" (TITIK). */
export const persen = (m: MasukanTataLetak, d: Desimal) => formatJumlah(d, m.tema.gayaAngka);
export const bukanNol = (d: Desimal | null | undefined) => !!d && !d.isZero();

/** Huruf besar di awal tiap kata ("TAGIHAN TERMIN" jadi "Tagihan Termin"). */
export const hurufJudul = (s: string) => s.toLocaleLowerCase("id-ID").replace(/(^|\s)(\S)/g, (_, spasi: string, huruf: string) => spasi + huruf.toLocaleUpperCase("id-ID"));

/** Judul sama dengan judul bawaan gambar (tanpa beda huruf besar), D3 §3.1 "Judul gambar". */
export const judulSama = (judul: string, ...bawaan: string[]) => bawaan.some((b) => judul.trim().toLocaleUpperCase("id-ID") === b);

/** "{kota}, {tanggal panjang}", tanpa kota bila kosong. */
export const kotaTanggal = (m: MasukanTataLetak, d: Date) => (m.identitas.kota ? `${m.identitas.kota}, ${formatTanggalPanjang(d)}` : formatTanggalPanjang(d));

/** Token rekening identitas; token kosong dibuang beserta spasi gandanya (D3 §3.7 blok bawah). */
export function isiTokenRekening(teks: string, i: IdentitasCetak): string {
  const nilai: Record<string, string | null> = {
    singkatanBank: i.singkatanBank ?? i.namaBank,
    namaBank: i.namaBank,
    cabangBank: i.cabangBank,
    nomorRekening: i.nomorRekening,
    atasNamaRekening: i.atasNamaRekening,
  };
  return teks
    .replace(/\{(\w+)\}/g, (_, kunci: string) => nilai[kunci] ?? "")
    .split("\t")
    .map((s) => s.replace(/ {2,}/g, " ").trim())
    .join("\t");
}

/** Teks berbutir D2 dalam bentuk mesin. */
export const berbutir = (teks: string | null | undefined): BarisTeksCetak[] => uraiTeksBerbutir(teks);

/** Isi sel uraian: nama, lalu deskripsi berbutir di bawahnya bila ada. */
export function isiUraian(b: BarisCetak): string | BarisTeksCetak[] {
  const deskripsi = berbutir(b.deskripsi);
  if (!deskripsi.length) return b.nama;
  return [{ jenis: "paragraf", isi: [{ teks: b.nama, tebal: false }] }, ...deskripsi];
}

/**
 * Baris yang dicetak. Tagihan termin tanpa baris dari D2: satu baris dibangun dari konteksTermin (D3 §3.2), dengan
 * deskripsi butir posisi termin di kontrak.
 */
export function barisDicetak(m: MasukanTataLetak): BarisCetak[] {
  const { dok } = m;
  const kt = dok.konteksTermin;
  if (dok.jenis !== "tagihan-termin" || dok.baris.length || !kt) return dok.baris;
  const satu = new Prisma.Decimal(1);
  const nama = `${kt.label} - ${dok.surat.perihal ?? dok.event.namaEvent ?? dok.kepada.nama}`.slice(0, 200);
  const rp = (d: Desimal) => formatRupiah(d, m.tema.gayaAngka, m.tema.desimal);
  const deskripsi = [
    `- Termin ${kt.no} dari ${kt.jumlahButir} (${persen(m, kt.persen)}% dari nilai kontrak)`,
    `- Ref. pesanan ${kt.nomorPesanan}`,
    `- Nilai kontrak (termasuk PPN): ${rp(kt.nilaiKontrakBruto)}`,
    `- Sudah dibayar (termin sebelumnya): ${rp(kt.dibayarSebelumnya)}`,
    `- Sisa tagihan setelah termin ini: ${rp(kt.sisaSetelahTermin)}`,
  ].join("\n");
  return [{ no: 1, nama, deskripsi, bagian: null, keterangan: null, jumlah: satu, satuan: "termin", frekuensi: satu, satuanFrekuensi: null, harga: kt.jumlah, nilai: kt.jumlah }];
}

/**
 * Syarat pembayaran untuk cetak: penawaran bertermin mendapat "Skema pembayaran:" dan satu butir per termin
 * (D3 §3.2), tanpa mengubah data dokumen.
 */
export function syaratDicetak(m: MasukanTataLetak): string | null {
  const { dok } = m;
  const dasar = dok.surat.syaratPembayaran?.trim() || null;
  if (dok.jenis !== "penawaran" || !dok.skemaTermin.length) return dasar;
  const skema = dok.skemaTermin.map((t) => `- ${t.label} (${persen(m, t.persen)}%): ${rupiah(m, t.jumlahBruto)}${t.jatuhTempo ? `, jatuh tempo ${formatTanggalPendek(t.jatuhTempo)}` : ""}`);
  return [dasar, "Skema pembayaran:", ...skema].filter(Boolean).join("\n");
}

/** Daftar uang muka yang dipotong faktur (D3 §3.2). */
export function teksUangMukaDipotong(m: MasukanTataLetak): string | null {
  const daftar = m.dok.uangMukaDipakai;
  if (!daftar.length) return null;
  return ["Uang muka yang dipotong:", ...daftar.map((u) => `- ${u.nomor}${u.labelTermin ? ` (${u.labelTermin})` : ""}: ${rupiah(m, u.jumlah)}`)].join("\n");
}

// ---------- Aliran teks ----------

/** Turunkan kursor sejauh `tinggi` pt (jarak antarblok); tidak memicu halaman baru. */
export function jarak(k: KanvasCetak, tinggi: number): void {
  k.y += tinggi;
}

/**
 * Blok yang tidak boleh terpotong (blok tanda tangan, kotak Nb): pindah halaman bila tidak muat di sisa halaman. Bila
 * tetap tidak muat di halaman kosong, GalatIsiTerlaluTinggi dilempar supaya isi tidak menimpa kaki diam-diam.
 */
export function ruangUtuh(k: KanvasCetak, tinggi: number): void {
  if (k.pastikanRuang(tinggi, { ketat: true })) k.pastikanRuang(tinggi, { ketat: true });
}

/**
 * Teks mengalir di kursor dan pindah halaman per baris bila tidak muat. Satu baris yang lebih tinggi dari area
 * halaman kosong melempar GalatIsiTerlaluTinggi.
 */
export function alirTeks(k: KanvasCetak, isi: string | Segmen[], opsi: Omit<OpsiTeks, "y" | "rentang">): void {
  const u = k.ukur(isi, opsi);
  if (!u.jumlahBaris) return;
  const tb = u.tinggi / u.jumlahBaris;
  for (let i = 0; i < u.jumlahBaris; ) {
    if (k.sisa() < tb - 0.01) {
      if (k.halamanKosong()) throw new GalatIsiTerlaluTinggi();
      k.lanjutHalaman();
    }
    const sampai = Math.min(u.jumlahBaris, i + Math.max(1, Math.floor((k.sisa() + 0.01) / tb)));
    k.teks(isi, { ...opsi, rentang: { dari: i, sampai } });
    i = sampai;
  }
}

/** Teks berbutir mengalir: tiap butir dijaga utuh bila muat, butir yang lebih tinggi dari sisa dipecah per baris. */
export function alirBerbutir(k: KanvasCetak, daftar: BarisTeksCetak[], opsi: Omit<OpsiTeks, "y" | "rentang">): void {
  for (const b of daftar) {
    const u = k.ukurBerbutir([b], opsi);
    if (!u.jumlahBaris) continue;
    const tb = u.tinggi / u.jumlahBaris;
    if (u.tinggi <= k.tinggiArea) k.pastikanRuang(u.tinggi);
    for (let i = 0; i < u.jumlahBaris; ) {
      if (k.sisa() < tb - 0.01) {
        if (k.halamanKosong()) throw new GalatIsiTerlaluTinggi();
        k.lanjutHalaman();
      }
      const sampai = Math.min(u.jumlahBaris, i + Math.max(1, Math.floor((k.sisa() + 0.01) / tb)));
      k.teksBerbutir([b], { ...opsi, rentang: { dari: i, sampai } });
      i = sampai;
    }
  }
}

/**
 * Pecah teks menjadi baris selebar `lebar` dengan pengukur kanvas (kata utuh; kata yang lebih lebar dari baris
 * dipotong per huruf). "\n" memaksa baris baru. Dipakai isian kwitansi yang barisnya punya posisi tetap.
 */
export function pecahBaris(k: KanvasCetak, teks: string, opsi: Pick<OpsiTeks, "lebar" | "ukuran" | "font" | "jarakHuruf">): string[] {
  // diukur sebagai satu baris (lebar tak terbatas), lalu dibandingkan dengan lebar kolom
  const muat = (s: string) => k.ukur(s, { x: 0, ...opsi, lebar: 1e6 }).lebar <= opsi.lebar + 0.01;
  const hasil: string[] = [];
  for (const paragraf of teks.split("\n")) {
    const kata = paragraf.split(/ +/).filter(Boolean);
    let baris = "";
    for (let w of kata) {
      const coba = baris ? `${baris} ${w}` : w;
      if (muat(coba)) {
        baris = coba;
        continue;
      }
      if (baris) hasil.push(baris);
      baris = "";
      // kata yang lebih lebar dari satu baris dipotong per huruf
      while (!muat(w)) {
        let n = w.length - 1;
        while (n > 1 && !muat(w.slice(0, n))) n--;
        hasil.push(w.slice(0, n));
        w = w.slice(n);
      }
      baris = w;
    }
    if (baris || !kata.length) hasil.push(baris);
  }
  // paragraf kosong di ujung tidak menambah baris
  while (hasil.length > 1 && hasil[hasil.length - 1] === "") hasil.pop();
  return hasil;
}

/**
 * Isi teks ke sejumlah slot baris berposisi tetap: ukuran turun 0,5 pt sampai `ukuranMin`; bila tetap lebih banyak
 * dari slot, baris terakhir dipotong dengan "…" dan peringatan "teks terpotong" dicatat (D3 §3.7).
 */
export function isiSlotBaris(k: KanvasCetak, teks: string, slot: number, opsi: Pick<OpsiTeks, "lebar" | "ukuran" | "font" | "jarakHuruf"> & { ukuranMin: number }): { baris: string[]; ukuran: number } {
  let ukuran = opsi.ukuran;
  let baris = pecahBaris(k, teks, { ...opsi, ukuran });
  while (baris.length > slot && ukuran - 0.5 >= opsi.ukuranMin) {
    ukuran -= 0.5;
    baris = pecahBaris(k, teks, { ...opsi, ukuran });
  }
  if (baris.length > slot) {
    k.peringatan(`teks terpotong: ${teks.slice(0, 60)}`);
    const awal = baris.slice(0, slot - 1);
    let akhir = baris.slice(slot - 1).join(" ");
    const muat = (s: string) => k.ukur(s, { x: 0, ...opsi, ukuran, lebar: 1e6 }).lebar <= opsi.lebar + 0.01;
    while (akhir && !muat(`${akhir}…`)) akhir = akhir.slice(0, -1).trimEnd();
    baris = [...awal, `${akhir}…`];
  }
  return { baris, ukuran };
}

/**
 * Satu baris teks di tengah kotak secara tegak: ukuran turun sampai `ukuranMin`, lalu dipotong per huruf dengan "…"
 * dan peringatan "teks terpotong" (nomor, nominal, judul kwitansi). Kata panjang tanpa spasi tetap terbaca awalnya.
 */
export function teksKotak(k: KanvasCetak, teks: string, kotak: { x: number; y: number; w: number; h: number }, opsi: Omit<OpsiTeks, "x" | "y" | "lebar"> & { ukuranMin?: number }): void {
  const { ukuranMin = 6, ...gaya } = opsi;
  const { baris, ukuran } = isiSlotBaris(k, teks, 1, { lebar: kotak.w, ukuran: gaya.ukuran, font: gaya.font, jarakHuruf: gaya.jarakHuruf, ukuranMin });
  const tinggi = k.ukur("X", { ...gaya, x: 0, lebar: 1e6, ukuran }).tinggi;
  k.teks(baris[0] ?? "", { ...gaya, ukuran, x: kotak.x, lebar: kotak.w, y: kotak.y + (kotak.h - tinggi) / 2 });
}
