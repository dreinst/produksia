import type { Prisma, PrismaClient } from "@/prisma-klien/client";
import type { JenisNilai, ModeDokumen, TampilanEvent } from "@/prisma-klien/enums";
import { D, bacaUang, format, jumlahkan, terbesar, terkecil, uang, type Desimal } from "@/lib/uang";
import { bobotBaris, nilaiBaris, subtotalBaris, type BarisNilai } from "@/lib/nilaiBaris";
import { hitungPpn, tanggalJatuhTempo } from "@/lib/pengaturanPerusahaan";
import { punyaHak, type PenggunaSesi } from "@/lib/hakAkses";
import { catatAktivitas, type DataLog, type KlienDb, type PelakuLog } from "@/lib/log";
import { tanggalIso } from "@/lib/waktu";

/*
 * Pustaka dokumen penjualan gaya HKA dan D'Pro (D2 §3). Pembantu murni dan berbasis transaksi untuk aksi penjualan
 * (P21, P23, P25) dan halaman (P26 sampai P28). Berkas ini bukan "use server", jadi fungsinya tidak menjadi endpoint
 * publik. Aturan impor L1: berkas ini boleh mengimpor akuntansi.ts, tetapi akuntansi.ts tidak boleh mengimpor berkas
 * ini. Pratinjau di peramban memakai salinan angka biasa di hitungDokumenKlien.ts; server tetap sumber kebenaran.
 */

// Satu fungsi nilai baris untuk semua titik hitung (D2 §3.2, DESAIN §3.1): letaknya di nilaiBaris.ts (aman untuk klien)
export { nilaiBaris, bobotBaris, subtotalBaris, type BarisNilai };

type Klien = PrismaClient | Prisma.TransactionClient;
type Angka = Desimal | number | string;

const NOL = D(0);

// ---------- Jenis dokumen dan label ----------

export const JENIS_DOKUMEN_PENJUALAN = ["penawaran", "pesanan", "faktur", "penerimaan", "uangMuka"] as const;
export type JenisDokumenPenjualan = (typeof JENIS_DOKUMEN_PENJUALAN)[number];

/** Label log, sama dengan LABEL di src/lib/aksi/hapusDokumen.ts. */
export const LABEL_DOKUMEN_PENJUALAN: Record<JenisDokumenPenjualan, string> = {
  penawaran: "Penawaran Penjualan",
  pesanan: "Pesanan Penjualan",
  faktur: "Faktur Penjualan",
  penerimaan: "Penerimaan Penjualan",
  uangMuka: "Uang Muka Pelanggan",
};

export function jenisDokumenPenjualanSah(nilai: string): nilai is JenisDokumenPenjualan {
  return (JENIS_DOKUMEN_PENJUALAN as readonly string[]).includes(nilai);
}

// ---------- Isian awal teks (D2 §3.3) ----------

export const TEKS_PEMBUKA_BAWAAN =
  "Bersama ini akan kami sampaikan anggaran yang diperlukan untuk acara yang saudara selenggarakan. Anggaran yang kami ajukan adalah sebagai berikut:";
export const TEKS_PENUTUP_BAWAAN =
  "Demikian pengajuan anggaran dari kami. Besar harapan kami untuk bisa bekerjasama dengan anda. Atas perhatian dan kerjasamanya kami ucapkan terima kasih.";
/** Pilihan seksi bawaan bila PengaturanDokumenPenjualan.daftarSeksi kosong (padanan item_sections HKA). */
export const SEKSI_BAWAAN = ["Transportasi", "Akomodasi", "Venue", "Produksi", "Talent / Artis", "Kru / Tenaga", "Konsumsi", "Pemasaran", "Lain-lain"] as const;
export const MAKS_SEKSI = 60;
export const PANJANG_SEKSI_PENGATURAN = 60;

/** Panjang teks dalam code point (emoji dihitung satu). */
const panjang = (s: string) => Array.from(s).length;
const potongKodeTitik = (s: string, batas: number) => (panjang(s) > batas ? Array.from(s).slice(0, batas).join("") : s);
const rapikanSpasi = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Daftar seksi pengaturan dokumen (textarea satu per baris, aturan HKA): spasi dirapikan, dipotong 60 karakter, baris
 * kosong dan duplikat tanpa beda huruf besar dibuang, paling banyak 60 butir.
 */
export function rapikanDaftarSeksi(teks: string | null | undefined): string[] {
  const hasil: string[] = [];
  const sudah = new Set<string>();
  for (const baris of String(teks ?? "").split(/\r\n?|\n/)) {
    const s = potongKodeTitik(rapikanSpasi(baris), PANJANG_SEKSI_PENGATURAN);
    const kunci = s.toLocaleLowerCase("id-ID");
    if (!s || sudah.has(kunci)) continue;
    sudah.add(kunci);
    hasil.push(s);
    if (hasil.length >= MAKS_SEKSI) break;
  }
  return hasil;
}

// ---------- Validasi teks (D2 §3.1) ----------

export const ATURAN_TEKS = {
  judulCetak: { label: "Judul cetak", batas: 60 },
  perihal: { label: "Perihal", batas: 200 },
  lampiran: { label: "Lampiran", batas: 60 },
  referensi: { label: "Referensi", batas: 120 },
  teksPembuka: { label: "Teks pembuka", batas: 3000 },
  teksPenutup: { label: "Teks penutup", batas: 3000 },
  catatan: { label: "Catatan", batas: 3000 },
  catatanKanan: { label: "Catatan kanan", batas: 3000 },
  syaratPembayaran: { label: "Syarat pembayaran", batas: 3000 },
  infoBank: { label: "Info rekening", batas: 1000 },
  kepada: { label: "Kepada", batas: 200 },
  kepadaUp: { label: "U.p.", batas: 120 },
  kepadaAlamat: { label: "Alamat tujuan", batas: 500 },
  kepadaTelepon: { label: "Telepon tujuan", batas: 40 },
  kepadaEmail: { label: "Email tujuan", batas: 120 },
  namaEvent: { label: "Nama event", batas: 160 },
  venue: { label: "Venue", batas: 160 },
  tanggalEvent: { label: "Tanggal event", batas: 80 },
  keteranganAddOn: { label: "Keterangan add on", batas: 200 },
  terimaDari: { label: "Terima dari", batas: 200 },
  keperluan: { label: "Keperluan", batas: 300 },
} as const satisfies Record<string, { label: string; batas: number }>;
export type KolomTeks = keyof typeof ATURAN_TEKS;

/** Teks surat penawaran, pesanan, dan faktur (bisa diwarisi pesanan ke faktur). */
export const KOLOM_TEKS_SURAT = [
  "perihal", "lampiran", "referensi", "teksPembuka", "teksPenutup", "catatan", "catatanKanan", "syaratPembayaran", "infoBank",
  "kepada", "kepadaUp", "kepadaAlamat", "kepadaTelepon", "kepadaEmail",
] as const satisfies readonly KolomTeks[];
export const KOLOM_TEKS_EVENT = ["namaEvent", "venue", "tanggalEvent"] as const satisfies readonly KolomTeks[];
export const KOLOM_TEKS_PENAWARAN = [...KOLOM_TEKS_SURAT, ...KOLOM_TEKS_EVENT, "judulCetak", "keteranganAddOn"] as const satisfies readonly KolomTeks[];
export const KOLOM_TEKS_PESANAN = [...KOLOM_TEKS_SURAT, ...KOLOM_TEKS_EVENT] as const satisfies readonly KolomTeks[];
/** Faktur: teks surat diwarisi pesanan bila kuncinya tidak ada di formulir; judul cetak tidak diwarisi (pesanan tidak punya). */
export const KOLOM_TEKS_FAKTUR = [...KOLOM_TEKS_SURAT, "judulCetak"] as const satisfies readonly KolomTeks[];
export const KOLOM_TEKS_PENERIMAAN = ["judulCetak", "terimaDari", "keperluan", "catatan"] as const satisfies readonly KolomTeks[];
export const KOLOM_TEKS_UANG_MUKA = ["judulCetak", "terimaDari", "keperluan"] as const satisfies readonly KolomTeks[];

const POLA_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Dipangkas, CRLF dan CR menjadi LF, kosong menjadi null. */
export function rapikanTeks(nilai: unknown): string | null {
  if (nilai === null || nilai === undefined) return null;
  const s = String(nilai).replace(/\r\n?/g, "\n").trim();
  return s === "" ? null : s;
}

/** Satu isian teks dokumen menurut ATURAN_TEKS: batas panjang, dan pola email untuk kepadaEmail. */
export function bacaTeks(nilai: unknown, kolom: KolomTeks): string | null {
  const s = rapikanTeks(nilai);
  if (s === null) return null;
  const { label, batas } = ATURAN_TEKS[kolom];
  if (panjang(s) > batas) throw new Error(`${label} maksimal ${batas} karakter`);
  if (kolom === "kepadaEmail" && !POLA_EMAIL.test(s)) throw new Error("Email tujuan tidak valid");
  return s;
}

/**
 * Teks dokumen dari formulir. Kunci yang ADA di formulir menimpa warisan (string kosong = sengaja dikosongkan), kunci
 * yang tidak ada memakai warisan (faktur dari pesanan, D2 §3.5). `bawaanSyarat` mengisi syaratPembayaran bila kuncinya
 * tidak ada dan warisannya kosong. Tanpa warisan, kunci yang tidak ada bernilai null: server tidak menambah teks sendiri.
 */
export function bacaTeksDokumen<K extends KolomTeks>(
  dataFormulir: FormData,
  kolom: readonly K[],
  opsi: { warisan?: Partial<Record<KolomTeks, string | null>> | null; bawaanSyarat?: string | null } = {},
): Record<K, string | null> {
  const hasil = {} as Record<K, string | null>;
  for (const k of kolom) {
    if (dataFormulir.has(k)) hasil[k] = bacaTeks(dataFormulir.get(k), k);
    else {
      const warisan = rapikanTeks(opsi.warisan?.[k] ?? null);
      hasil[k] = warisan ?? (k === "syaratPembayaran" ? rapikanTeks(opsi.bawaanSyarat ?? null) : null);
    }
  }
  return hasil;
}

// ---------- Enum dan angka ----------

/** Mode dokumen; kosong = STANDAR. */
export function bacaModeDokumen(nilai: unknown): ModeDokumen {
  const s = rapikanTeks(nilai);
  if (s === null || s === "STANDAR") return "STANDAR";
  if (s === "EVENT") return "EVENT";
  throw new Error("Mode dokumen tidak dikenal");
}

/** Tampilan event; kosong = bawaan pengaturan dokumen (RINCI bila belum diatur). */
export function bacaTampilanEvent(nilai: unknown, bawaan: TampilanEvent = "RINCI"): TampilanEvent {
  const s = rapikanTeks(nilai);
  if (s === null) return bawaan;
  if (s === "RINCI" || s === "RINGKAS") return s;
  throw new Error("Tampilan event tidak dikenal");
}

/** Jenis diskon (bawaan NOMINAL) atau management fee (bawaan PERSEN), mengikuti bawaan kolom skema. */
export function bacaJenisNilai(nilai: unknown, untuk: "diskon" | "fee"): JenisNilai {
  const s = rapikanTeks(nilai);
  if (s === null) return untuk === "diskon" ? "NOMINAL" : "PERSEN";
  if (s === "NOMINAL" || s === "PERSEN") return s;
  throw new Error(untuk === "diskon" ? "Jenis diskon tidak dikenal" : "Jenis management fee tidak dikenal");
}

/** Angka uang opsional: kosong = 0, selain angka sah ditolak dengan nama bidang. Tanda negatif diperiksa pemanggil. */
export function bacaAngka(nilai: unknown, label: string): Desimal {
  const s = rapikanTeks(nilai);
  if (s === null) return NOL;
  try {
    return uang(s);
  } catch {
    throw new Error(`${label} tidak valid`);
  }
}

/** Add on penawaran (informasi di bawah grand total, tidak dijumlahkan): kosong = null, tidak boleh negatif. */
export function bacaNilaiAddOn(nilai: unknown): Desimal | null {
  if (rapikanTeks(nilai) === null) return null;
  const d = bacaAngka(nilai, "Add on");
  if (d.isNegative()) throw new Error("Add on tidak boleh negatif");
  return d;
}

// ---------- Tanggal ----------

/** "YYYY-MM-DD" dibaca jam 12.00 (pola aksi lama, mis. prive); kosong = null; selain itu galat dengan pesan pemanggil. */
export function bacaTanggalIsian(nilai: unknown, pesanTidakValid: string): Date | null {
  const s = rapikanTeks(nilai);
  if (s === null) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new Error(pesanTidakValid);
  const t = new Date(`${s}T12:00:00`);
  if (Number.isNaN(t.getTime()) || t.getFullYear() !== Number(m[1]) || t.getMonth() + 1 !== Number(m[2]) || t.getDate() !== Number(m[3])) throw new Error(pesanTidakValid);
  return t;
}

/** Berlaku sampai (penawaran). Saat buat tidak boleh sebelum hari ini (per hari di ZONA_WAKTU). */
export function bacaBerlakuSampai(nilai: unknown, opsi: { saatBuat: boolean; hariIni?: Date }): Date | null {
  const t = bacaTanggalIsian(nilai, "Tanggal berlaku tidak valid");
  if (t && opsi.saatBuat && tanggalIso(t) < tanggalIso(opsi.hariIni ?? new Date())) throw new Error("Berlaku sampai tidak boleh sebelum hari ini");
  return t;
}

/**
 * Jatuh tempo faktur (D2 §3.5): isian ada dan sah dipakai, tidak boleh sebelum tanggal faktur. Tanpa isian, termin
 * pengaturan perusahaan seperti aksi lama (tanggalJatuhTempo).
 */
export function bacaJatuhTempo(dataFormulir: FormData, terminHari: number, tanggalFaktur: Date = new Date()): Date {
  const t = bacaTanggalIsian(dataFormulir.get("jatuhTempo"), "Jatuh tempo tidak valid");
  if (!t) return tanggalJatuhTempo(terminHari, tanggalFaktur);
  if (tanggalIso(t) < tanggalIso(tanggalFaktur)) throw new Error("Jatuh tempo tidak boleh sebelum tanggal faktur");
  return t;
}

// ---------- Kop surat ----------

/** Isian kopSuratId mentah (dipangkas); kosong = null (kop bawaan perusahaan). */
export function bacaKopSuratId(dataFormulir: FormData): string | null {
  return rapikanTeks(dataFormulir.get("kopSuratId"));
}

/** Kop harus ada, belum dihapus, dan milik perusahaan dokumen (D2 §3.1). null dibiarkan (kop bawaan). */
export async function pastikanKopSuratDokumen(klien: Klien, kopSuratId: string | null, perusahaanId: string): Promise<string | null> {
  if (!kopSuratId) return null;
  const kop = await klien.kopSurat.findFirst({ where: { id: kopSuratId, perusahaanId, dihapusPada: null }, select: { id: true } });
  if (!kop) throw new Error("Kop surat tidak ditemukan atau bukan milik perusahaan dokumen");
  return kop.id;
}

// ---------- Baris penawaran dan pesanan (D2 §3.3) ----------

export const MAKS_BARIS_DOKUMEN = 500;
export const FREKUENSI_MAKS = D(1_000_000);

export const ATURAN_TEKS_BARIS = {
  nama: { label: "nama", batas: 200 },
  deskripsi: { label: "deskripsi", batas: 3000 },
  satuan: { label: "satuan", batas: 20 },
  satuanFrekuensi: { label: "satuan frekuensi", batas: 20 },
  bagian: { label: "seksi", batas: 80 },
  keterangan: { label: "keterangan", batas: 300 },
} as const satisfies Record<string, { label: string; batas: number }>;
export type KolomTeksBaris = keyof typeof ATURAN_TEKS_BARIS;

/** Satu baris hasil baca. barangId null = baris bebas (diselesaikan ke Barang JASA-LAIN di transaksi). */
export type BarisDokumen = {
  barangId: string | null;
  nama: string | null;
  deskripsi: string | null;
  jumlah: Desimal;
  satuan: string | null;
  frekuensi: Desimal;
  satuanFrekuensi: string | null;
  harga: Desimal;
  bagian: string | null;
  keterangan: string | null;
  urutan: number;
};

function teksBaris(nilai: unknown, kolom: KolomTeksBaris, n: number): string | null {
  let s = rapikanTeks(nilai);
  if (s === null) return null;
  if (kolom === "bagian") s = rapikanSpasi(s);
  const { label, batas } = ATURAN_TEKS_BARIS[kolom];
  if (panjang(s) > batas) throw new Error(`Baris ${n}: ${label} maksimal ${batas} karakter`);
  return s;
}

function bacaJsonBaris(raw: FormDataEntryValue | null, pesanKosong: string): unknown[] {
  if (typeof raw !== "string" || !raw) throw new Error(pesanKosong);
  let hasil: unknown;
  try {
    hasil = JSON.parse(raw);
  } catch {
    throw new Error("Format baris barang tidak valid");
  }
  if (!Array.isArray(hasil)) throw new Error(pesanKosong);
  return hasil;
}

const objek = (x: unknown): Record<string, unknown> => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {});
const idTeks = (x: unknown): string | null => (typeof x === "string" && x.trim() ? x.trim() : typeof x === "number" ? String(x) : null);
const angkaMentah = (x: unknown): string | number | null | undefined => (typeof x === "string" || typeof x === "number" ? x : x == null ? undefined : String(x));

/**
 * Membaca larik baris penawaran atau pesanan (superset bacaBaris lama). Baris tanpa barang dan tanpa nama dibuang
 * diam-diam, juga baris berjumlah 0 atau kurang. Mode STANDAR memaksa frekuensi 1 dan mengosongkan satuan frekuensi
 * serta seksi tanpa galat. `{n}` di pesan = nomor baris pada kiriman (mulai 1); urutan = posisi di antara baris yang
 * dipakai (0, 1, 2, ...).
 */
export function uraiBarisDokumen(larik: readonly unknown[], opsi: { mode: ModeDokumen }): BarisDokumen[] {
  if (larik.length > MAKS_BARIS_DOKUMEN) throw new Error(`Maksimal ${MAKS_BARIS_DOKUMEN} baris per dokumen`);
  const event = opsi.mode === "EVENT";
  const hasil: BarisDokumen[] = [];
  larik.forEach((mentah, i) => {
    const n = i + 1;
    const l = objek(mentah);
    const barangId = idTeks(l.barangId);
    const nama = teksBaris(l.nama, "nama", n);
    if (!barangId && !nama) return;
    const jumlah = uang(angkaMentah(l.jumlah));
    if (jumlah.lte(0)) return;
    let frekuensi = D(1);
    if (event && rapikanTeks(l.frekuensi) !== null) {
      frekuensi = uang(angkaMentah(l.frekuensi));
      if (frekuensi.lte(0)) throw new Error(`Baris ${n}: frekuensi harus lebih dari 0`);
      if (frekuensi.gt(FREKUENSI_MAKS)) throw new Error(`Baris ${n}: frekuensi maksimal 1.000.000`);
    }
    hasil.push({
      barangId,
      nama,
      deskripsi: teksBaris(l.deskripsi, "deskripsi", n),
      jumlah,
      satuan: teksBaris(l.satuan, "satuan", n),
      frekuensi,
      satuanFrekuensi: event ? teksBaris(l.satuanFrekuensi, "satuanFrekuensi", n) : null,
      harga: uang(angkaMentah(l.harga)),
      bagian: event ? teksBaris(l.bagian, "bagian", n) : null,
      keterangan: teksBaris(l.keterangan, "keterangan", n),
      urutan: hasil.length,
    });
  });
  if (hasil.length === 0) throw new Error("Minimal 1 baris barang dengan jumlah > 0 wajib diisi");
  if (hasil.some((l) => l.harga.isNegative())) throw new Error("Harga tidak boleh negatif");
  return hasil;
}

/** Isian `baris` (JSON larik) formulir penawaran atau pesanan, D2 §3.3. */
export function bacaBarisDokumen(dataFormulir: FormData, opsi: { mode: ModeDokumen }): BarisDokumen[] {
  return uraiBarisDokumen(bacaJsonBaris(dataFormulir.get("baris"), "Minimal 1 baris barang wajib diisi"), opsi);
}

export function adaBarisBebas(baris: readonly { barangId: string | null }[]): boolean {
  return baris.some((b) => !b.barangId);
}

/** Baris bebas tidak punya harga katalog, jadi harganya harga nego: wajib hak harga.nego (D2 §3.3). */
export function pastikanHakBarisBebas(pengguna: PenggunaSesi, baris: readonly { barangId: string | null }[]) {
  if (adaBarisBebas(baris) && !punyaHak(pengguna, "harga.nego")) {
    throw new Error('Baris bebas (tanpa barang katalog) butuh hak "Harga jual · boleh nego"');
  }
}

/** Data Prisma baris penawaran atau pesanan (nested create); subtotal = nilaiBaris. barangId sudah diselesaikan. */
export function dataBarisDokumen(baris: readonly (BarisDokumen & { barangId: string })[]) {
  return baris.map((l) => ({
    barangId: l.barangId,
    jumlah: l.jumlah,
    harga: l.harga,
    subtotal: nilaiBaris(l),
    frekuensi: l.frekuensi,
    satuanFrekuensi: l.satuanFrekuensi,
    bagian: l.bagian,
    urutan: l.urutan,
    nama: l.nama,
    deskripsi: l.deskripsi,
    satuan: l.satuan,
    keterangan: l.keterangan,
  }));
}

// ---------- Ringkasan nilai: diskon, fee, PPN, total (D2 §3.4) ----------

export const FEE_NOMINAL_MAKS = D("100000000000000");

export function hitungDiskon(subtotal: Desimal, jenis: JenisNilai, nilai: Desimal): Desimal {
  if (nilai.isNegative()) throw new Error("Diskon tidak boleh negatif");
  if (jenis === "PERSEN") {
    if (nilai.gt(100)) throw new Error("Persen diskon tidak boleh lebih dari 100");
    return uang(subtotal.mul(nilai).div(100));
  }
  return uang(nilai);
}

export function hitungFee(dasar: Desimal, jenis: JenisNilai, nilai: Desimal): Desimal {
  if (nilai.isNegative()) throw new Error("Management fee tidak boleh negatif");
  if (jenis === "PERSEN") {
    if (nilai.gt(100)) throw new Error("Persen management fee tidak boleh lebih dari 100");
    return uang(dasar.mul(nilai).div(100));
  }
  if (nilai.gt(FEE_NOMINAL_MAKS)) throw new Error("Management fee terlalu besar");
  return uang(nilai);
}

export type RingkasanDokumen = { subtotal: Desimal; diskon: Desimal; fee: Desimal; total: Desimal };

/**
 * Penawaran dan pesanan: total = subtotal - diskon + fee, TANPA PPN (arti kolom total lama). Fee dihitung dari subtotal
 * setelah diskon. PPN hanya tampilan dan nilai termin. Add on tidak ikut apa pun.
 */
export function ringkasanDokumen(p: {
  subtotal: Desimal;
  jenisDiskon: JenisNilai;
  nilaiDiskon: Desimal;
  jenisFee: JenisNilai;
  nilaiFee: Desimal;
  dokumen: "penawaran" | "pesanan";
}): RingkasanDokumen {
  const subtotal = uang(p.subtotal);
  const diskon = hitungDiskon(subtotal, p.jenisDiskon, p.nilaiDiskon);
  if (diskon.gt(subtotal)) throw new Error(`Diskon (${format(diskon)}) melebihi subtotal ${p.dokumen} (${format(subtotal)})`);
  const fee = hitungFee(subtotal.minus(diskon), p.jenisFee, p.nilaiFee);
  return { subtotal, diskon, fee, total: subtotal.minus(diskon).plus(fee) };
}

/** Isian diskon dan fee formulir penawaran atau pesanan lalu ringkasan nilainya. */
export function bacaRingkasanDokumen(dataFormulir: FormData, baris: readonly BarisNilai[], dokumen: "penawaran" | "pesanan") {
  const jenisDiskon = bacaJenisNilai(dataFormulir.get("jenisDiskon"), "diskon");
  const nilaiDiskon = bacaAngka(dataFormulir.get("nilaiDiskon"), "Diskon");
  const jenisFee = bacaJenisNilai(dataFormulir.get("jenisFee"), "fee");
  const nilaiFee = bacaAngka(dataFormulir.get("nilaiFee"), "Management fee");
  return { jenisDiskon, nilaiDiskon, jenisFee, nilaiFee, ...ringkasanDokumen({ subtotal: subtotalBaris(baris), jenisDiskon, nilaiDiskon, jenisFee, nilaiFee, dokumen }) };
}

/** Identitas kepala dokumen yang selalu benar (D2 §3.4): subtotal = total + diskon - fee. Tidak ada kolom subtotal. */
export function subtotalDokumen(d: { total: Angka; diskon: Angka; fee: Angka }): Desimal {
  return D(d.total).plus(D(d.diskon)).minus(D(d.fee));
}

/** Faktur: dpp = subtotal - diskon + fee, PPN dari dpp, total = dpp + PPN. */
export function ringkasanFaktur(p: { subtotal: Desimal; diskon: Desimal; fee: Desimal; ppnPersen: Desimal }): { dpp: Desimal; ppn: Desimal; total: Desimal } {
  const dpp = p.subtotal.minus(p.diskon).plus(p.fee);
  const ppn = hitungPpn(dpp, p.ppnPersen);
  return { dpp, ppn, total: dpp.plus(ppn) };
}

// ---------- Faktur: jalur per id baris dan jalur lama (D2 §3.5) ----------

export type MasukanBarisFaktur =
  | { jalur: "ID"; baris: { barisPesananId: string; barangId?: string | null; jumlah: Desimal }[] }
  | { jalur: "LAMA"; baris: { barangId: string; jumlah: Desimal; harga: Desimal }[] };

/**
 * Isian `baris` faktur. Semua baris dengan barisPesananId = jalur ID (komposer baru); tidak satu pun = jalur lama
 * (skrip uji dan seed, perilaku bacaBaris lama); campuran ditolak. Baris tanpa barang dan tanpa id dibuang.
 */
export function bacaBarisFaktur(dataFormulir: FormData): MasukanBarisFaktur {
  const larik = bacaJsonBaris(dataFormulir.get("baris"), "Minimal 1 baris barang wajib diisi").map(objek);
  const dipakai = larik.filter((l) => idTeks(l.barisPesananId) || idTeks(l.barangId));
  const berId = dipakai.filter((l) => idTeks(l.barisPesananId));
  if (berId.length > 0 && berId.length < dipakai.length) throw new Error("Baris faktur harus semuanya memakai baris pesanan atau semuanya tidak");
  if (berId.length > 0) {
    const baris = berId.map((l) => ({ barisPesananId: idTeks(l.barisPesananId)!, barangId: idTeks(l.barangId), jumlah: uang(angkaMentah(l.jumlah)) })).filter((l) => l.jumlah.gt(0));
    if (baris.length === 0) throw new Error("Minimal 1 baris barang dengan jumlah > 0 wajib diisi");
    return { jalur: "ID", baris };
  }
  const baris = dipakai.map((l) => ({ barangId: idTeks(l.barangId)!, jumlah: uang(angkaMentah(l.jumlah)), harga: uang(angkaMentah(l.harga)) })).filter((l) => l.jumlah.gt(0));
  if (baris.length === 0) throw new Error("Minimal 1 baris barang dengan jumlah > 0 wajib diisi");
  if (baris.some((l) => l.harga.isNegative())) throw new Error("Harga tidak boleh negatif");
  return { jalur: "LAMA", baris };
}

/** Baris pesanan yang dibutuhkan pembantu faktur (urut sesuai tampilan: urutan, lalu id). */
export type BarisPesananSumber = {
  id: string;
  barangId: string;
  jumlah: Angka;
  jumlahDifaktur: Angka;
  harga: Angka;
  frekuensi: Angka;
  satuanFrekuensi: string | null;
  bagian: string | null;
  urutan: number;
  nama: string | null;
  deskripsi: string | null;
  satuan: string | null;
  keterangan: string | null;
};

export type PesananSumber = {
  mode: ModeDokumen;
  baris: readonly BarisPesananSumber[];
  jenisDiskon: JenisNilai;
  nilaiDiskon: Angka;
  diskon: Angka;
  jenisFee: JenisNilai;
  nilaiFee: Angka;
  fee: Angka;
  /** faktur lain pesanan ini, semua status (draf juga sudah mengonsumsi baris) */
  faktur?: readonly { fee: Angka; diskon: Angka }[];
};

/** Baris faktur siap disimpan; nilainya nilaiBaris(baris). */
export type BarisFakturSiap = {
  barisPesananId: string | null;
  barangId: string;
  jumlah: Desimal;
  harga: Desimal;
  frekuensi: Desimal;
  satuanFrekuensi: string | null;
  bagian: string | null;
  urutan: number;
  nama: string | null;
  deskripsi: string | null;
  satuan: string | null;
  keterangan: string | null;
};

const urutBarisPesanan = (baris: readonly BarisPesananSumber[]) => [...baris].sort((a, b) => a.urutan - b.urutan || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/**
 * Jalur ID: tiap id harus baris pesanan ini; jumlah dijumlahkan per id lalu dibandingkan dengan sisa yang belum
 * ditagih. Harga, frekuensi, dan teks diambil dari baris pesanan (nilai klien diabaikan), satu baris faktur per id,
 * urut seperti pesanan.
 */
export function siapkanBarisJalurId(pesanan: Pick<PesananSumber, "baris">, masukan: readonly { barisPesananId: string; jumlah: Desimal }[]): BarisFakturSiap[] {
  const peta = new Map(pesanan.baris.map((b) => [b.id, b]));
  const diminta = new Map<string, Desimal>();
  for (const l of masukan) {
    if (!peta.has(l.barisPesananId)) throw new Error("Baris pesanan tidak ditemukan di pesanan ini");
    diminta.set(l.barisPesananId, (diminta.get(l.barisPesananId) ?? NOL).plus(l.jumlah));
  }
  const hasil: BarisFakturSiap[] = [];
  for (const b of urutBarisPesanan(pesanan.baris)) {
    const jumlah = diminta.get(b.id);
    if (!jumlah) continue;
    const sisa = D(b.jumlah).minus(D(b.jumlahDifaktur));
    if (jumlah.gt(sisa)) throw new Error(`Kuantitas faktur melebihi sisa yang belum ditagih (sisa ${format(sisa)}, diminta ${format(jumlah)})`);
    hasil.push({
      barisPesananId: b.id,
      barangId: b.barangId,
      jumlah,
      harga: D(b.harga),
      frekuensi: D(b.frekuensi),
      satuanFrekuensi: b.satuanFrekuensi,
      bagian: b.bagian,
      urutan: b.urutan,
      nama: b.nama,
      deskripsi: b.deskripsi,
      satuan: b.satuan,
      keterangan: b.keterangan,
    });
  }
  return hasil;
}

/** Jalur lama hanya untuk pesanan STANDAR bergaya lama: frekuensi 1, tanpa baris bernama, tanpa barang ganda. */
export function jalurLamaBolehUntuk(pesanan: Pick<PesananSumber, "mode" | "baris">): boolean {
  if (pesanan.mode !== "STANDAR") return false;
  const barang = new Set<string>();
  for (const b of pesanan.baris) {
    if (!D(b.frekuensi).equals(1) || b.nama || barang.has(b.barangId)) return false;
    barang.add(b.barangId);
  }
  return true;
}

/**
 * Jalur lama (kompatibilitas): validasi sisa per baris kiriman seperti kode lama (tidak kumulatif, pesan sama),
 * harga dari kiriman, frekuensi 1, teks baris kosong, dan barisPesananId diisi baris pesanan satu-satunya dengan
 * barang itu.
 */
export function siapkanBarisJalurLama(pesanan: Pick<PesananSumber, "mode" | "baris">, masukan: readonly { barangId: string; jumlah: Desimal; harga: Desimal }[]): BarisFakturSiap[] {
  if (!jalurLamaBolehUntuk(pesanan)) throw new Error("Faktur pesanan ini wajib dibuat dari komposer faktur (baris pesanan per id)");
  return masukan.map((l, i) => {
    const b = pesanan.baris.find((x) => x.barangId === l.barangId);
    if (!b) throw new Error("Barang tidak ada di pesanan ini");
    const sisa = D(b.jumlah).minus(D(b.jumlahDifaktur));
    if (l.jumlah.gt(sisa)) throw new Error(`Kuantitas faktur melebihi sisa yang belum ditagih (sisa ${format(sisa)}, diminta ${format(l.jumlah)})`);
    return { barisPesananId: b.id, barangId: l.barangId, jumlah: l.jumlah, harga: l.harga, frekuensi: D(1), satuanFrekuensi: null, bagian: null, urutan: i, nama: null, deskripsi: null, satuan: null, keterangan: null };
  });
}

export function siapkanBarisFaktur(pesanan: Pick<PesananSumber, "mode" | "baris">, masukan: MasukanBarisFaktur): BarisFakturSiap[] {
  return masukan.jalur === "ID" ? siapkanBarisJalurId(pesanan, masukan.baris) : siapkanBarisJalurLama(pesanan, masukan.baris);
}

/** Data Prisma baris faktur (nested create); nilaiTransit dihitung aksi saat konsumsi surat jalan. */
export function dataBarisFaktur(baris: readonly BarisFakturSiap[], nilaiTransit: readonly Desimal[] = []) {
  return baris.map((l, i) => ({
    barangId: l.barangId,
    jumlah: l.jumlah,
    harga: l.harga,
    subtotal: nilaiBaris(l),
    nilaiTransit: nilaiTransit[i] ?? NOL,
    frekuensi: l.frekuensi,
    satuanFrekuensi: l.satuanFrekuensi,
    bagian: l.bagian,
    urutan: l.urutan,
    nama: l.nama,
    deskripsi: l.deskripsi,
    satuan: l.satuan,
    keterangan: l.keterangan,
    barisPesananId: l.barisPesananId,
  }));
}

export type KonteksProrata = { subtotalPesanan: Desimal; feeLain: Desimal; diskonLain: Desimal; menutup: boolean };

/**
 * Konteks prorata diskon dan fee nominal pesanan (D2 §3.4). `menutup` = sesudah faktur ini setiap baris pesanan sudah
 * ditagih penuh, sehingga faktur ini mengambil sisa pembulatan. `pesanan.baris.jumlahDifaktur` adalah nilai SEBELUM
 * faktur ini (dibaca sebelum transaksi).
 */
export function konteksProrata(pesanan: Pick<PesananSumber, "baris" | "faktur">, daftarBaris: readonly Pick<BarisFakturSiap, "barisPesananId" | "jumlah">[]): KonteksProrata {
  const tambahan = new Map<string, Desimal>();
  for (const l of daftarBaris) if (l.barisPesananId) tambahan.set(l.barisPesananId, (tambahan.get(l.barisPesananId) ?? NOL).plus(l.jumlah));
  const menutup = pesanan.baris.every((b) => D(b.jumlahDifaktur).plus(tambahan.get(b.id) ?? NOL).gte(D(b.jumlah)));
  return {
    subtotalPesanan: subtotalBaris(pesanan.baris),
    feeLain: jumlahkan((pesanan.faktur ?? []).map((f) => f.fee)),
    diskonLain: jumlahkan((pesanan.faktur ?? []).map((f) => f.diskon)),
    menutup,
  };
}

/** Bagian nilai nominal pesanan untuk satu faktur: prorata subtotal, faktur penutup mengambil sisa, tidak melebihi sisa. */
export function bagianProrata(nilaiPesanan: Desimal, subtotalFaktur: Desimal, subtotalPesanan: Desimal, sudahLain: Desimal, menutup: boolean): Desimal {
  const sisa = terbesar(nilaiPesanan.minus(sudahLain), NOL);
  if (nilaiPesanan.isZero() || subtotalPesanan.lte(0)) return NOL;
  if (menutup) return sisa;
  return terkecil(uang(nilaiPesanan.mul(subtotalFaktur).div(subtotalPesanan)), sisa);
}

/** Fee faktur dari pesanan (server, bukan formulir): PERSEN dari subtotal faktur setelah diskon, NOMINAL prorata. */
export function feeFaktur(p: Pick<PesananSumber, "jenisFee" | "nilaiFee" | "fee">, subtotal: Desimal, diskon: Desimal, ctx: KonteksProrata): Desimal {
  if (p.jenisFee === "PERSEN") return hitungFee(subtotal.minus(diskon), "PERSEN", D(p.nilaiFee));
  return bagianProrata(D(p.fee), subtotal, ctx.subtotalPesanan, ctx.feeLain, ctx.menutup);
}

/** Diskon warisan pesanan bila formulir faktur tidak mengirim diskon: PERSEN dari subtotal faktur, NOMINAL prorata. */
export function diskonWarisan(p: Pick<PesananSumber, "jenisDiskon" | "nilaiDiskon" | "diskon">, subtotal: Desimal, ctx: KonteksProrata): Desimal {
  if (p.jenisDiskon === "PERSEN") return hitungDiskon(subtotal, "PERSEN", D(p.nilaiDiskon));
  return bagianProrata(D(p.diskon), subtotal, ctx.subtotalPesanan, ctx.diskonLain, ctx.menutup);
}

/**
 * Diskon faktur menurut prioritas isian (D2 §3.4): (a) jenisDiskon + nilaiDiskon, (b) isian lama `diskon` nominal
 * (uji-diskon), (c) warisan pesanan. Diskon melebihi subtotal ditolak dengan pesan lama.
 */
export function bacaDiskonFaktur(
  dataFormulir: FormData,
  subtotal: Desimal,
  pesanan: Pick<PesananSumber, "jenisDiskon" | "nilaiDiskon" | "diskon">,
  ctx: KonteksProrata,
): { jenisDiskon: JenisNilai; nilaiDiskon: Desimal; diskon: Desimal } {
  let hasil: { jenisDiskon: JenisNilai; nilaiDiskon: Desimal; diskon: Desimal };
  const diskonLama = dataFormulir.get("diskon");
  if (rapikanTeks(dataFormulir.get("jenisDiskon")) !== null) {
    const jenisDiskon = bacaJenisNilai(dataFormulir.get("jenisDiskon"), "diskon");
    const nilaiDiskon = bacaAngka(dataFormulir.get("nilaiDiskon"), "Diskon");
    hasil = { jenisDiskon, nilaiDiskon, diskon: hitungDiskon(subtotal, jenisDiskon, nilaiDiskon) };
  } else if (typeof diskonLama === "string" && diskonLama.trim() !== "") {
    const diskon = bacaUang(diskonLama, "Diskon", { allowZero: true });
    hasil = { jenisDiskon: "NOMINAL", nilaiDiskon: diskon, diskon };
  } else {
    const diskon = diskonWarisan(pesanan, subtotal, ctx);
    hasil = { jenisDiskon: pesanan.jenisDiskon, nilaiDiskon: pesanan.jenisDiskon === "PERSEN" ? uang(pesanan.nilaiDiskon) : diskon, diskon };
  }
  if (hasil.diskon.gt(subtotal)) throw new Error(`Diskon (${format(hasil.diskon)}) melebihi subtotal faktur (${format(subtotal)})`);
  return hasil;
}

// ---------- Retur: jalur per id baris faktur dan jalur lama (D2 §3.6) ----------

export type MasukanBarisRetur =
  | { jalur: "ID"; baris: { barisFakturId: string; barangId?: string | null; jumlah: Desimal }[] }
  | { jalur: "LAMA"; baris: { barangId: string; jumlah: Desimal }[] };

/** Isian `baris` retur; pesan kosong sama dengan aksi lama. Campuran berid dan tidak ditolak. */
export function bacaBarisRetur(dataFormulir: FormData, pesanKosong = "Minimal 1 baris barang wajib diretur"): MasukanBarisRetur {
  const larik = bacaJsonBaris(dataFormulir.get("baris"), pesanKosong).map(objek);
  const dipakai = larik.filter((l) => idTeks(l.barisFakturId) || idTeks(l.barangId));
  const berId = dipakai.filter((l) => idTeks(l.barisFakturId));
  if (berId.length > 0 && berId.length < dipakai.length) throw new Error("Baris retur harus semuanya memakai baris faktur atau semuanya tidak");
  if (berId.length > 0) {
    const baris = berId.map((l) => ({ barisFakturId: idTeks(l.barisFakturId)!, barangId: idTeks(l.barangId), jumlah: uang(angkaMentah(l.jumlah)) })).filter((l) => l.jumlah.gt(0));
    if (baris.length === 0) throw new Error(pesanKosong);
    return { jalur: "ID", baris };
  }
  const baris = dipakai.map((l) => ({ barangId: idTeks(l.barangId)!, jumlah: uang(angkaMentah(l.jumlah)) })).filter((l) => l.jumlah.gt(0));
  if (baris.length === 0) throw new Error(pesanKosong);
  return { jalur: "LAMA", baris };
}

export type BarisFakturSumber = { id: string; barangId: string; jumlah: Angka; harga: Angka; frekuensi: Angka };
export type BarisReturSebelumnya = { barisFakturId: string | null; barangId: string; jumlah: Angka };
export type BarisReturSiap = { barisFakturId: string; barangId: string; jumlah: Desimal; harga: Desimal; frekuensi: Desimal };

/**
 * Sisa yang bisa diretur per baris faktur: jumlah baris - retur yang menunjuk baris itu - bagian retur lama tanpa
 * barisFakturId. Retur lama (data sebelum migrasi yang ambigu) dibagi ke baris berbarang sama urut id naik sampai habis.
 */
export function sisaReturPerBaris(barisFaktur: readonly BarisFakturSumber[], returSebelumnya: readonly BarisReturSebelumnya[]): Map<string, Desimal> {
  const sisa = new Map<string, Desimal>();
  for (const b of barisFaktur) {
    const langsung = jumlahkan(returSebelumnya.filter((r) => r.barisFakturId === b.id).map((r) => r.jumlah));
    sisa.set(b.id, D(b.jumlah).minus(langsung));
  }
  const lamaPerBarang = new Map<string, Desimal>();
  for (const r of returSebelumnya) if (!r.barisFakturId) lamaPerBarang.set(r.barangId, (lamaPerBarang.get(r.barangId) ?? NOL).plus(D(r.jumlah)));
  for (const [barangId, total] of lamaPerBarang) {
    let tersisa = total;
    for (const b of [...barisFaktur].filter((x) => x.barangId === barangId).sort((a, c) => (a.id < c.id ? -1 : a.id > c.id ? 1 : 0))) {
      if (tersisa.lte(0)) break;
      const ruang = terbesar(sisa.get(b.id) ?? NOL, NOL);
      const alok = terkecil(ruang, tersisa);
      sisa.set(b.id, (sisa.get(b.id) ?? NOL).minus(alok));
      tersisa = tersisa.minus(alok);
    }
  }
  return sisa;
}

/** Jalur ID: id harus baris faktur ini, jumlah kumulatif per id dibatasi sisa, harga dan frekuensi dari baris itu. */
export function siapkanReturJalurId(
  faktur: { baris: readonly BarisFakturSumber[] },
  returSebelumnya: readonly BarisReturSebelumnya[],
  masukan: readonly { barisFakturId: string; jumlah: Desimal }[],
): BarisReturSiap[] {
  const peta = new Map(faktur.baris.map((b) => [b.id, b]));
  const diminta = new Map<string, Desimal>();
  for (const l of masukan) {
    if (!peta.has(l.barisFakturId)) throw new Error("Baris faktur tidak ditemukan di faktur ini");
    diminta.set(l.barisFakturId, (diminta.get(l.barisFakturId) ?? NOL).plus(l.jumlah));
  }
  const sisa = sisaReturPerBaris(faktur.baris, returSebelumnya);
  const hasil: BarisReturSiap[] = [];
  for (const [id, jumlah] of diminta) {
    const b = peta.get(id)!;
    const maks = terbesar(sisa.get(id) ?? NOL, NOL);
    if (jumlah.gt(maks)) throw new Error(`Kuantitas retur melebihi yang bisa diretur (maks ${format(maks)}, diminta ${format(jumlah)})`);
    hasil.push({ barisFakturId: id, barangId: b.barangId, jumlah, harga: D(b.harga), frekuensi: D(b.frekuensi) });
  }
  return hasil;
}

/**
 * Jalur lama: hanya bila tiap barang yang diretur tunggal di faktur. Batas per baris kiriman seperti kode lama
 * (difaktur - semua retur barang itu, tidak kumulatif, pesan sama); harga dan frekuensi dari baris faktur itu.
 */
export function siapkanReturJalurLama(
  faktur: { baris: readonly BarisFakturSumber[] },
  returSebelumnya: readonly BarisReturSebelumnya[],
  masukan: readonly { barangId: string; jumlah: Desimal }[],
): BarisReturSiap[] {
  return masukan.map((l) => {
    const cocok = faktur.baris.filter((b) => b.barangId === l.barangId);
    if (cocok.length === 0) throw new Error("Barang tidak ada di faktur ini");
    if (cocok.length > 1) throw new Error("Faktur ini punya barang yang sama di beberapa baris; pilih baris faktur yang diretur");
    const b = cocok[0];
    const diretur = jumlahkan(returSebelumnya.filter((r) => r.barangId === l.barangId).map((r) => r.jumlah));
    const sisa = D(b.jumlah).minus(diretur);
    if (l.jumlah.gt(sisa)) throw new Error(`Kuantitas retur melebihi yang bisa diretur (maks ${format(sisa)}, diminta ${format(l.jumlah)})`);
    return { barisFakturId: b.id, barangId: l.barangId, jumlah: l.jumlah, harga: D(b.harga), frekuensi: D(b.frekuensi) };
  });
}

export function siapkanBarisRetur(faktur: { baris: readonly BarisFakturSumber[] }, returSebelumnya: readonly BarisReturSebelumnya[], masukan: MasukanBarisRetur): BarisReturSiap[] {
  return masukan.jalur === "ID" ? siapkanReturJalurId(faktur, returSebelumnya, masukan.baris) : siapkanReturJalurLama(faktur, returSebelumnya, masukan.baris);
}

/**
 * Nilai retur (D2 §3.6): bruto dari nilaiBaris baris faktur yang dicocokkan; diskon dan fee faktur dibalik prorata
 * terhadap subtotal faktur (= dpp + diskon - fee, sama dengan bruto lama bila tanpa fee); PPN dari dpp retur.
 */
export function nilaiRetur(faktur: { dpp: Angka; diskon: Angka; fee: Angka; ppnPersen: Angka }, baris: readonly BarisNilai[]) {
  const bruto = subtotalBaris(baris);
  const subtotalFaktur = D(faktur.dpp).plus(D(faktur.diskon)).minus(D(faktur.fee));
  const diskon = subtotalFaktur.gt(0) ? uang(D(faktur.diskon).mul(bruto).div(subtotalFaktur)) : NOL;
  const fee = subtotalFaktur.gt(0) ? uang(D(faktur.fee).mul(bruto).div(subtotalFaktur)) : NOL;
  const dpp = bruto.minus(diskon).plus(fee);
  const ppn = hitungPpn(dpp, D(faktur.ppnPersen));
  return { bruto, diskon, fee, dpp, ppn, total: dpp.plus(ppn) };
}

// ---------- Konversi dan pewarisan kolom (D2 §3.9) ----------

/** Kolom kepala penawaran yang disalin ke pesanan saat konversi (selain nomor, tanggal, status, dan persetujuan). */
export const KOLOM_SALIN_PENAWARAN_KE_PESANAN = [
  "pelangganId", "proyekId", "perusahaanId",
  "mode", "tampilanEvent", "namaEvent", "venue", "tanggalEvent",
  "jenisDiskon", "nilaiDiskon", "diskon", "jenisFee", "nilaiFee", "fee", "ppnPersen", "total",
  "perihal", "lampiran", "referensi", "teksPembuka", "teksPenutup", "catatan", "catatanKanan", "syaratPembayaran", "infoBank",
  "kepada", "kepadaUp", "kepadaAlamat", "kepadaTelepon", "kepadaEmail", "kopSuratId", "leadId",
] as const;

/** Kolom baris penawaran yang disalin ke baris pesanan. */
export const KOLOM_SALIN_BARIS = ["barangId", "jumlah", "harga", "frekuensi", "satuanFrekuensi", "bagian", "urutan", "nama", "deskripsi", "satuan", "keterangan"] as const;

/** Kolom kepala pesanan yang diwarisi faktur di server (tidak dari formulir); teks surat lewat bacaTeksDokumen. */
export const KOLOM_WARISAN_FAKTUR = ["mode", "tampilanEvent", "namaEvent", "venue", "tanggalEvent", "jenisFee", "nilaiFee"] as const;

/** Mengambil kolom tertentu dari objek sumber (konversi dan warisan). */
export function salinKolom<T extends object, K extends keyof T>(sumber: T, kolom: readonly K[]): Pick<T, K> {
  const hasil = {} as Pick<T, K>;
  for (const k of kolom) hasil[k] = sumber[k];
  return hasil;
}

// ---------- Ubah tampilan setelah simpan (D2 §3.11) ----------

const TAMPILAN_SURAT = [...KOLOM_TEKS_SURAT, "kopSuratId", "namaEvent", "venue", "tanggalEvent", "tampilanEvent"] as const;

/** Daftar putih ubahTampilanDokumen. Kunci di luar daftar diabaikan diam-diam, jadi total atau diskon tidak pernah tertulis. */
export const KOLOM_TAMPILAN = {
  penawaran: ["judulCetak", "nomorCetak", ...TAMPILAN_SURAT, "nilaiAddOn", "keteranganAddOn", "berlakuSampai"],
  pesanan: [...TAMPILAN_SURAT],
  faktur: [...TAMPILAN_SURAT, "judulCetak", "nomorCetak", "jatuhTempo"],
  penerimaan: ["judulCetak", "nomorCetak", "terimaDari", "keperluan", "catatan", "kopSuratId"],
  uangMuka: ["judulCetak", "nomorCetak", "terimaDari", "keperluan", "kopSuratId"],
} as const satisfies Record<JenisDokumenPenjualan, readonly string[]>;

/** Kolom teks baris yang boleh diubah lewat ubahTampilanDokumen (penawaran, pesanan, faktur). */
export const KOLOM_TAMPILAN_BARIS = ["nama", "deskripsi", "satuan", "keterangan", "bagian", "urutan"] as const;

const kolomTeksSah = (k: string): k is KolomTeks => Object.prototype.hasOwnProperty.call(ATURAN_TEKS, k);

/**
 * Isian ubahTampilanDokumen yang ada di formulir, hanya dari daftar putih jenis itu. Teks divalidasi ATURAN_TEKS,
 * tampilanEvent dan nilaiAddOn dibaca seperti saat buat, tanggal dibaca tanpa syarat hari ini. nomorCetak dan
 * kopSuratId dikembalikan apa adanya (dipangkas) untuk diperiksa pemanggil (bacaNomorCetakManual, pastikanKopSuratDokumen).
 */
export function bacaIsianTampilan(jenis: JenisDokumenPenjualan, dataFormulir: FormData): { kolom: string[]; data: Record<string, unknown> } {
  const kolom: string[] = [];
  const data: Record<string, unknown> = {};
  for (const k of KOLOM_TAMPILAN[jenis] as readonly string[]) {
    if (!dataFormulir.has(k)) continue;
    const v = dataFormulir.get(k);
    if (kolomTeksSah(k)) data[k] = bacaTeks(v, k);
    else if (k === "tampilanEvent") data[k] = bacaTampilanEvent(v);
    else if (k === "nilaiAddOn") data[k] = bacaNilaiAddOn(v);
    else if (k === "berlakuSampai") data[k] = bacaTanggalIsian(v, "Tanggal berlaku tidak valid");
    else if (k === "jatuhTempo") data[k] = bacaTanggalIsian(v, "Jatuh tempo tidak valid");
    else data[k] = rapikanTeks(v);
    kolom.push(k);
  }
  return { kolom, data };
}

export type IsianBarisTampilan = { id: string; data: Partial<Record<(typeof KOLOM_TAMPILAN_BARIS)[number], string | number | null>> };

/** Isian `baris` ubahTampilanDokumen (JSON [{ id, nama, ... }]); hanya kolom teks dan urutan yang kuncinya ada. */
export function bacaBarisTampilan(dataFormulir: FormData): IsianBarisTampilan[] {
  const raw = dataFormulir.get("baris");
  if (typeof raw !== "string" || !raw.trim()) return [];
  const larik = bacaJsonBaris(raw, "Format baris barang tidak valid");
  if (larik.length > MAKS_BARIS_DOKUMEN) throw new Error(`Maksimal ${MAKS_BARIS_DOKUMEN} baris per dokumen`);
  return larik.map((mentah, i) => {
    const n = i + 1;
    const l = objek(mentah);
    const id = idTeks(l.id);
    if (!id) throw new Error("Baris tidak ditemukan di dokumen ini");
    const data: IsianBarisTampilan["data"] = {};
    for (const k of KOLOM_TAMPILAN_BARIS) {
      if (!(k in l)) continue;
      if (k === "urutan") {
        const u = Number(l.urutan);
        if (!Number.isInteger(u) || u < 0 || u > 100_000) throw new Error(`Baris ${n}: urutan tidak valid`);
        data.urutan = u;
      } else data[k] = teksBaris(l[k], k, n);
    }
    return { id, data };
  });
}

/** Batas panjang nilai teks di meta log perubahan. */
export const PANJANG_META_LOG = 200;

function nilaiMeta(v: unknown): string | number | boolean | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "number" || typeof v === "boolean") return v;
  return potongKodeTitik(String(v), PANJANG_META_LOG);
}

/** Meta log UBAH_TAMPILAN: { kolom, dari, ke } untuk kolom yang dikirim; teks dipotong 200 karakter. */
export function ringkasPerubahan(lama: Record<string, unknown>, baru: Record<string, unknown>, kolom: readonly string[]) {
  const dari: Record<string, string | number | boolean | null> = {};
  const ke: Record<string, string | number | boolean | null> = {};
  for (const k of kolom) {
    dari[k] = nilaiMeta(lama[k]);
    ke[k] = nilaiMeta(baru[k]);
  }
  return { kolom: [...kolom], dari, ke };
}

// ---------- Log ----------

/** Log aktivitas modul penjualan (D2 §6). Panggil dengan tx yang sama dengan perubahan datanya. */
export async function catatLogPenjualan(klien: KlienDb, pelaku: PelakuLog, data: Omit<DataLog, "modul">): Promise<void> {
  await catatAktivitas(klien, pelaku, { ...data, modul: "penjualan" });
}
