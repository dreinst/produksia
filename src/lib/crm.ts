import { Prisma, type PrismaClient } from "@/prisma-klien/client";
import type { JenisAktivitasLead, JenisNotifikasi, JenisTahapLead, StatusTindakLanjut } from "@/prisma-klien/enums";
import { ZONA_WAKTU } from "@/lib/laporan";
import { D, uang, type Desimal } from "@/lib/uang";
import { bacaWaktuLokal, formatWaktu, tanggalIso } from "@/lib/waktu";
import { hitungHakPengguna, type PenggunaSesi } from "@/lib/hakAkses";
import { kirimNotifikasi, penggunaDenganHak, type PenerimaHak } from "@/lib/notifikasi";
import { catatAktivitas } from "@/lib/log";

/*
 * Pustaka CRM (D4 §6.3). Bukan "use server": konstanta, validator isian, bawaan tahap dan sumber per perusahaan,
 * invarian tahap, kueri daftar, konversi ke pelanggan, linimasa, notifikasi, dan log modul crm. Dipakai aksi
 * src/lib/aksi/crm.ts, halaman CRM (P32), aksi penjualan (P23), dan uji. Tidak boleh diimpor komponen klien.
 * Statistik dan tindak lanjut saya (bagian bawah) dibuat dashboard DF3 dan bentuknya tetap.
 */

// Pengingat tindak lanjut tinggal di pengingat.ts supaya pengingat.ts tidak mengimpor crm.ts (DESAIN L3, F9).
export { periksaPengingatTindakLanjut } from "@/lib/pengingat";

export type KlienDb = PrismaClient | Prisma.TransactionClient;

export const LABEL_JENIS_TAHAP: Record<JenisTahapLead, string> = { BERJALAN: "Berjalan", MENANG: "Menang", KALAH: "Kalah" };
export const LABEL_STATUS_TINDAK_LANJUT: Record<StatusTindakLanjut, string> = { MENUNGGU: "Menunggu", SELESAI: "Selesai", DIBATALKAN: "Dibatalkan" };

/**
 * Tindak lanjut milik lead terarsip disembunyikan (D4 §3.5). Selalu digabung lewat AND supaya tidak menimpa OR lain.
 */
export const SYARAT_TINDAK_LANJUT_TERLIHAT = { OR: [{ leadId: null }, { lead: { dihapusPada: null } }] } satisfies Prisma.TindakLanjutWhereInput;

const SATU_HARI_MS = 24 * 60 * 60 * 1000;
const NAMA_BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

/** Tampilan ringkas rupiah (padanan idrShort HKA): "Rp 1,5 M", "Rp 12,3 jt", selain itu "Rp 950.000". */
export function ringkasRupiah(n: Desimal | number | string): string {
  const x = Number(n);
  const satuDesimal = (v: number) => v.toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (Math.abs(x) >= 1e9) return `Rp ${satuDesimal(x / 1e9)} M`;
  if (Math.abs(x) >= 1e6) return `Rp ${satuDesimal(x / 1e6)} jt`;
  return `Rp ${x.toLocaleString("id-ID")}`;
}

/** Persen satu desimal, pembulatan setengah ke atas pada Decimal (D4 §3.12). */
function bulat1(pembilang: number, penyebut: number): Desimal {
  if (penyebut === 0) return D(0);
  return D(pembilang).mul(100).div(penyebut).toDecimalPlaces(1, Prisma.Decimal.ROUND_HALF_UP);
}

/** n bulan terakhir sampai bulan `sekarang` di zona usaha, urut lama ke baru: [{ bulan: "2026-06", label: "Jun 2026" }, ...]. */
export function bulanTerakhir(n: number, sekarang: Date = new Date()): { bulan: string; label: string }[] {
  const [th, bl] = tanggalIso(sekarang).split("-").map(Number);
  const k = th * 12 + (bl - 1);
  const hasil: { bulan: string; label: string }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const yyyy = Math.floor((k - i) / 12);
    const mm = ((k - i) % 12) + 1;
    hasil.push({ bulan: `${yyyy}-${String(mm).padStart(2, "0")}`, label: `${NAMA_BULAN[mm - 1]} ${yyyy}` });
  }
  return hasil;
}

export type StatistikCrm = {
  totalLead: number;
  leadBaru30Hari: number;
  nilaiPipeline: Desimal;
  menang: number;
  kalah: number;
  nilaiMenang: Desimal;
  tingkatKonversi: Desimal;
  tingkatClosing: Desimal;
  pendapatanLunas: Desimal;
  kinerjaSales: { picId: string | null; nama: string; lead: number; menang: number; nilaiMenang: Desimal }[];
  kinerjaSumber: { sumber: string; lead: number; menang: number; nilaiMenang: Desimal }[];
  corong: { perusahaanId: string; namaPerusahaan: string; tahapId: string; nama: string; jenis: JenisTahapLead; jumlah: number }[];
  bulanan: { bulan: string; label: string; dibuat: number; menang: number }[];
  tindakLanjutJatuhTempo: {
    id: string;
    judul: string;
    jatuhTempo: Date;
    leadId: string | null;
    namaLead: string | null;
    namaPenerima: string | null;
    perusahaanId: string;
  }[];
};

/**
 * Statistik dasbor CRM (D4 §3.12). perusahaanId null = gabungan (penjumlahan tanpa eliminasi).
 * Semua jumlah diagregasi di PostgreSQL; tidak ada lead yang dimuat ke memori untuk dijumlahkan.
 */
export async function statistikCrm(klien: KlienDb, sekarang: Date = new Date(), perusahaanId: string | null = null): Promise<StatistikCrm> {
  const saringP = perusahaanId ? { perusahaanId } : {};
  const base: Prisma.LeadWhereInput = { dihapusPada: null, ...saringP };
  const jendela = bulanTerakhir(6, sekarang);
  const awalJendela = bacaWaktuLokal(`${jendela[0].bulan}-01T00:00`) ?? new Date(0);
  const batasBaru = new Date(sekarang.getTime() - 30 * SATU_HARI_MS);
  const batasJatuhTempo = new Date(sekarang.getTime() + SATU_HARI_MS);
  const saringPSql = perusahaanId ? Prisma.sql`AND l."perusahaanId" = ${perusahaanId}` : Prisma.empty;

  const [perTahap, perPic, perSumber, leadBaru30Hari, pendapatan, daftarTahap, dibuatBulanan, menangBulanan, jatuhTempo] = await Promise.all([
    klien.lead.groupBy({ by: ["tahapId"], where: base, _count: { _all: true }, _sum: { nilaiEstimasi: true } }),
    klien.lead.groupBy({ by: ["picId", "tahapId"], where: base, _count: { _all: true }, _sum: { nilaiEstimasi: true } }),
    klien.lead.groupBy({ by: ["sumber", "tahapId"], where: base, _count: { _all: true }, _sum: { nilaiEstimasi: true } }),
    klien.lead.count({ where: { ...base, dibuatPada: { gte: batasBaru } } }),
    klien.fakturPenjualan.aggregate({ where: { status: "LUNAS", statusPersetujuan: "DISETUJUI", ...saringP }, _sum: { dpp: true } }),
    klien.tahapLead.findMany({
      where: saringP,
      select: { id: true, nama: true, jenis: true, urutan: true, perusahaanId: true, perusahaan: { select: { nama: true, urutan: true } } },
    }),
    klien.$queryRaw<{ bulan: string; jumlah: bigint }[]>`
      SELECT to_char((l."dibuatPada" AT TIME ZONE 'UTC') AT TIME ZONE ${ZONA_WAKTU}, 'YYYY-MM') AS bulan, COUNT(*) AS jumlah
      FROM "Lead" l
      WHERE l."dihapusPada" IS NULL AND l."dibuatPada" >= ${awalJendela} ${saringPSql}
      GROUP BY 1`,
    klien.$queryRaw<{ bulan: string; jumlah: bigint }[]>`
      SELECT to_char((l."ditutupPada" AT TIME ZONE 'UTC') AT TIME ZONE ${ZONA_WAKTU}, 'YYYY-MM') AS bulan, COUNT(*) AS jumlah
      FROM "Lead" l
      JOIN "TahapLead" t ON t."id" = l."tahapId" AND t."jenis" = 'MENANG'
      WHERE l."dihapusPada" IS NULL AND l."ditutupPada" IS NOT NULL AND l."ditutupPada" >= ${awalJendela} ${saringPSql}
      GROUP BY 1`,
    klien.tindakLanjut.findMany({
      where: { AND: [SYARAT_TINDAK_LANJUT_TERLIHAT, { status: "MENUNGGU", jatuhTempo: { lte: batasJatuhTempo }, ...saringP }] },
      orderBy: [{ jatuhTempo: "asc" }, { id: "asc" }],
      take: 10,
      select: { id: true, judul: true, jatuhTempo: true, leadId: true, perusahaanId: true, lead: { select: { nama: true } }, ditugaskanKe: { select: { nama: true } } },
    }),
  ]);

  const jenisTahap = new Map(daftarTahap.map((t) => [t.id, t.jenis]));
  const jenisDari = (tahapId: string): JenisTahapLead => jenisTahap.get(tahapId) ?? "BERJALAN";

  let totalLead = 0, menang = 0, kalah = 0;
  let nilaiPipeline = D(0), nilaiMenang = D(0);
  for (const g of perTahap) {
    const jumlah = g._count._all;
    const nilai = D(g._sum.nilaiEstimasi);
    totalLead += jumlah;
    const jenis = jenisDari(g.tahapId);
    if (jenis === "BERJALAN") nilaiPipeline = nilaiPipeline.plus(nilai);
    else if (jenis === "MENANG") { menang += jumlah; nilaiMenang = nilaiMenang.plus(nilai); }
    else kalah += jumlah;
  }

  // kinerja per PIC
  const perPicPeta = new Map<string | null, { lead: number; menang: number; nilaiMenang: Desimal }>();
  for (const g of perPic) {
    const isi = perPicPeta.get(g.picId) ?? { lead: 0, menang: 0, nilaiMenang: D(0) };
    isi.lead += g._count._all;
    if (jenisDari(g.tahapId) === "MENANG") { isi.menang += g._count._all; isi.nilaiMenang = isi.nilaiMenang.plus(D(g._sum.nilaiEstimasi)); }
    perPicPeta.set(g.picId, isi);
  }
  const idPic = [...perPicPeta.keys()].filter((x): x is string => !!x);
  const namaPic = new Map(
    idPic.length ? (await klien.pengguna.findMany({ where: { id: { in: idPic } }, select: { id: true, nama: true } })).map((p) => [p.id, p.nama]) : [],
  );
  const kinerjaSales = [...perPicPeta.entries()]
    .map(([picId, isi]) => ({ picId, nama: (picId ? namaPic.get(picId) : null) ?? "Belum ada PIC", ...isi }))
    .sort((a, b) => b.nilaiMenang.comparedTo(a.nilaiMenang) || b.lead - a.lead || a.nama.localeCompare(b.nama, "id"));

  // kinerja per sumber
  const perSumberPeta = new Map<string, { lead: number; menang: number; nilaiMenang: Desimal }>();
  for (const g of perSumber) {
    const kunci = g.sumber || "Tidak diketahui";
    const isi = perSumberPeta.get(kunci) ?? { lead: 0, menang: 0, nilaiMenang: D(0) };
    isi.lead += g._count._all;
    if (jenisDari(g.tahapId) === "MENANG") { isi.menang += g._count._all; isi.nilaiMenang = isi.nilaiMenang.plus(D(g._sum.nilaiEstimasi)); }
    perSumberPeta.set(kunci, isi);
  }
  const kinerjaSumber = [...perSumberPeta.entries()]
    .map(([sumber, isi]) => ({ sumber, ...isi }))
    .sort((a, b) => b.lead - a.lead || a.sumber.localeCompare(b.sumber, "id"));

  // corong: per perusahaan dalam lingkup, per tahap urut; tahap tanpa lead = 0
  const jumlahPerTahap = new Map(perTahap.map((g) => [g.tahapId, g._count._all]));
  const corong = [...daftarTahap]
    .sort((a, b) => a.perusahaan.urutan - b.perusahaan.urutan || a.perusahaan.nama.localeCompare(b.perusahaan.nama, "id") || a.urutan - b.urutan)
    .map((t) => ({ perusahaanId: t.perusahaanId, namaPerusahaan: t.perusahaan.nama, tahapId: t.id, nama: t.nama, jenis: t.jenis, jumlah: jumlahPerTahap.get(t.id) ?? 0 }));

  const petaDibuat = new Map(dibuatBulanan.map((r) => [r.bulan, Number(r.jumlah)]));
  const petaMenang = new Map(menangBulanan.map((r) => [r.bulan, Number(r.jumlah)]));
  const bulanan = jendela.map((b) => ({ ...b, dibuat: petaDibuat.get(b.bulan) ?? 0, menang: petaMenang.get(b.bulan) ?? 0 }));

  return {
    totalLead,
    leadBaru30Hari,
    nilaiPipeline,
    menang,
    kalah,
    nilaiMenang,
    tingkatKonversi: bulat1(menang, totalLead),
    tingkatClosing: bulat1(menang, menang + kalah),
    pendapatanLunas: D(pendapatan._sum.dpp),
    kinerjaSales,
    kinerjaSumber,
    corong,
    bulanan,
    tindakLanjutJatuhTempo: jatuhTempo.map((t) => ({
      id: t.id,
      judul: t.judul,
      jatuhTempo: t.jatuhTempo,
      leadId: t.leadId,
      namaLead: t.lead?.nama ?? null,
      namaPenerima: t.ditugaskanKe?.nama ?? null,
      perusahaanId: t.perusahaanId,
    })),
  };
}

export type TindakLanjutSaya = {
  id: string;
  judul: string;
  jatuhTempo: Date;
  catatan: string | null;
  leadId: string | null;
  namaLead: string | null;
  namaUsahaLead: string | null;
  perusahaanId: string;
};

/**
 * Tindak lanjut MENUNGGU yang ditugaskan ke pengguna, urut jatuh tempo naik, tanpa milik lead terarsip.
 * perusahaanId (tambahan di posisi terakhir, null = gabungan) dipakai beranda supaya ikut lingkup perusahaan.
 */
export async function tindakLanjutSaya(klien: KlienDb, penggunaId: string, batas = 10, perusahaanId: string | null = null): Promise<TindakLanjutSaya[]> {
  const daftar = await klien.tindakLanjut.findMany({
    where: { AND: [SYARAT_TINDAK_LANJUT_TERLIHAT, { ditugaskanKeId: penggunaId, status: "MENUNGGU", ...(perusahaanId ? { perusahaanId } : {}) }] },
    orderBy: [{ jatuhTempo: "asc" }, { id: "asc" }],
    take: batas,
    select: { id: true, judul: true, jatuhTempo: true, catatan: true, leadId: true, perusahaanId: true, lead: { select: { nama: true, namaUsaha: true } } },
  });
  return daftar.map((t) => ({
    id: t.id,
    judul: t.judul,
    jatuhTempo: t.jatuhTempo,
    catatan: t.catatan,
    leadId: t.leadId,
    namaLead: t.lead?.nama ?? null,
    namaUsahaLead: t.lead?.namaUsaha ?? null,
    perusahaanId: t.perusahaanId,
  }));
}

/** Terlambat tidak disimpan: MENUNGGU dan jatuh tempo sudah lewat (D4 §3.5). */
export function tindakLanjutTerlambat(t: { jatuhTempo: Date; status?: StatusTindakLanjut }, sekarang: Date = new Date()): boolean {
  return (t.status ?? "MENUNGGU") === "MENUNGGU" && t.jatuhTempo.getTime() < sekarang.getTime();
}


// ===================== Perluasan P22 (D4 §3, §6.3) =====================

const ID_SKRIP_UJI = "skrip-uji";
/** Id pengguna yang boleh disimpan sebagai FK (pengguna semu skrip uji = null). */
const idTersimpan = (pengguna: { id: string }) => (pengguna.id === ID_SKRIP_UJI ? null : pengguna.id);

// ---------- Konstanta ----------

export const TAHAP_BAWAAN: readonly { nama: string; jenis: JenisTahapLead }[] = [
  { nama: "Lead Baru", jenis: "BERJALAN" },
  { nama: "Terkualifikasi", jenis: "BERJALAN" },
  { nama: "Dihubungi", jenis: "BERJALAN" },
  { nama: "Pertemuan", jenis: "BERJALAN" },
  { nama: "Proposal", jenis: "BERJALAN" },
  { nama: "Negosiasi", jenis: "BERJALAN" },
  { nama: "Closing", jenis: "BERJALAN" },
  { nama: "Menang", jenis: "MENANG" },
  { nama: "Kalah", jenis: "KALAH" },
];

export const SUMBER_BAWAAN: readonly string[] = ["Instagram", "Website", "Referensi", "WhatsApp", "Meta Ads", "Event", "Lainnya"];

export const MAKS_TAHAP = 20;
export const MAKS_SUMBER = 50;
export const PANJANG_NAMA_TAHAP = 60;
export const PANJANG_NAMA_SUMBER = 60;
export const MAKS_TAG = 20;
export const PANJANG_TAG = 40;
export const MAKS_FIELD_TAMBAHAN = 30;
export const PANJANG_CATATAN_LEAD = 5000;
export const PANJANG_ALASAN = 1000;
export const PANJANG_JUDUL_TINDAK_LANJUT = 160;
export const PANJANG_CATATAN_TINDAK_LANJUT = 2000;
/** Batas nilai estimasi sama dengan batas uang data induk (Decimal(18, 2)). */
export const NILAI_ESTIMASI_MAKS = D("9999999999999999.99");

/** Lencana jenis aktivitas linimasa (D4 §3.6). */
export const LABEL_JENIS_AKTIVITAS: Record<JenisAktivitasLead, { label: string; cls: string }> = {
  DIBUAT: { label: "Dibuat", cls: "lencana lencana-slate" },
  DIUBAH: { label: "Diubah", cls: "lencana lencana-slate" },
  TAHAP_DIUBAH: { label: "Tahap", cls: "lencana lencana-blue" },
  MENANG: { label: "Menang", cls: "lencana lencana-emerald" },
  KALAH: { label: "Kalah", cls: "lencana lencana-rose" },
  CATATAN: { label: "Catatan", cls: "lencana lencana-indigo" },
  TINDAK_LANJUT_DIJADWALKAN: { label: "Tindak lanjut", cls: "lencana lencana-amber" },
  TINDAK_LANJUT_STATUS: { label: "Tindak lanjut", cls: "lencana lencana-amber" },
  DIKONVERSI: { label: "Konversi", cls: "lencana lencana-cyan" },
  PENAWARAN_DIBUAT: { label: "Penawaran", cls: "lencana lencana-blue" },
  DIARSIPKAN: { label: "Arsip", cls: "lencana lencana-rose" },
  DIPULIHKAN: { label: "Arsip", cls: "lencana lencana-emerald" },
};

/** Bidang lead yang dibandingkan saat ubah, berurutan (D4 §3.4), dengan label linimasa. */
export const LABEL_BIDANG_LEAD = {
  nama: "Nama kontak",
  namaUsaha: "Perusahaan/usaha",
  telepon: "Telepon",
  whatsapp: "WhatsApp",
  email: "Email",
  instagram: "Instagram",
  website: "Situs web",
  industri: "Industri",
  lokasi: "Lokasi",
  sumber: "Sumber lead",
  picId: "PIC",
  nilaiEstimasi: "Perkiraan nilai",
  catatan: "Catatan",
  tag: "Tag",
  fieldTambahan: "Field tambahan",
} as const;
export type BidangLead = keyof typeof LABEL_BIDANG_LEAD;
const BIDANG_LEAD = Object.keys(LABEL_BIDANG_LEAD) as BidangLead[];

export const STATUS_TINDAK_LANJUT: readonly StatusTindakLanjut[] = ["MENUNGGU", "SELESAI", "DIBATALKAN"];
export const JENIS_TAHAP: readonly JenisTahapLead[] = ["BERJALAN", "MENANG", "KALAH"];

// ---------- Teks isian ----------

/** Teks dipangkas; kosong = null. */
function teks(v: FormDataEntryValue | null | undefined): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? null : s;
}
/** Panjang per code point (emoji dihitung satu). */
const panjang = (s: string) => Array.from(s).length;
/** Spasi ganda dirapikan (nama tahap, sumber, tag). */
const rapikanSpasi = (s: string) => s.trim().replace(/\s+/g, " ");
/** Kunci pembanding tanpa beda huruf besar. */
export const kunciNama = (s: string) => rapikanSpasi(s).toLocaleLowerCase("id-ID");

function teksWajib(v: FormDataEntryValue | null, maks: number, pesanKosong: string, pesanPanjang: string): string {
  const s = teks(v);
  if (!s) throw new Error(pesanKosong);
  if (panjang(s) > maks) throw new Error(pesanPanjang);
  return s;
}
function teksOpsional(v: FormDataEntryValue | null, maks: number, pesanPanjang: string): string | null {
  const s = teks(v);
  if (s && panjang(s) > maks) throw new Error(pesanPanjang);
  return s;
}
function teksRentang(v: FormDataEntryValue | null, min: number, maks: number, pesan: string): string {
  const s = teks(v);
  if (!s || panjang(s) < min || panjang(s) > maks) throw new Error(pesan);
  return s;
}

const POLA_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Tag: dipisah koma, dirapikan, huruf kecil, tanpa duplikat; maksimal 20, tiap tag maksimal 40 karakter. */
export function bacaTag(v: FormDataEntryValue | null): string[] {
  const hasil: string[] = [];
  for (const mentah of (typeof v === "string" ? v : "").split(",")) {
    const t = rapikanSpasi(mentah).toLocaleLowerCase("id-ID");
    if (!t || hasil.includes(t)) continue;
    if (panjang(t) > PANJANG_TAG) throw new Error(`Tag "${t}" lebih dari ${PANJANG_TAG} karakter`);
    hasil.push(t);
  }
  if (hasil.length > MAKS_TAG) throw new Error(`Tag maksimal ${MAKS_TAG}`);
  return hasil;
}

/**
 * Field tambahan: satu pasangan per baris "Nama: Nilai" (dipisah titik dua pertama). Baris kosong dilewati. Nama sama
 * tanpa beda huruf besar: yang terakhir menimpa (HKA). Maksimal 30 pasangan.
 */
export function bacaFieldTambahan(v: FormDataEntryValue | null): Record<string, string> {
  const hasil = new Map<string, { nama: string; nilai: string }>();
  const baris = (typeof v === "string" ? v : "").split(/\r\n|\r|\n/);
  baris.forEach((b, i) => {
    if (!b.trim()) return;
    const titik = b.indexOf(":");
    const nama = titik < 0 ? "" : rapikanSpasi(b.slice(0, titik));
    if (!nama) throw new Error(`Field tambahan baris ${i + 1} harus berformat Nama: Nilai`);
    const nilai = b.slice(titik + 1).trim();
    if (panjang(nama) > 60) throw new Error("Nama field tambahan maksimal 60 karakter");
    if (panjang(nilai) > 500) throw new Error("Nilai field tambahan maksimal 500 karakter");
    const kunci = nama.toLocaleLowerCase("id-ID");
    hasil.delete(kunci);
    hasil.set(kunci, { nama, nilai });
  });
  if (hasil.size > MAKS_FIELD_TAMBAHAN) throw new Error(`Field tambahan maksimal ${MAKS_FIELD_TAMBAHAN} baris`);
  return Object.fromEntries([...hasil.values()].map((x) => [x.nama, x.nilai]));
}

/** Field tambahan tersimpan (JSON) sebagai pasangan teks; nilai bukan teks diabaikan. */
export function pasanganFieldTambahan(json: unknown): [string, string][] {
  if (!json || typeof json !== "object" || Array.isArray(json)) return [];
  return Object.entries(json as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string");
}

/** Isi textarea field tambahan untuk formulir ubah (kebalikan bacaFieldTambahan). */
export function teksFieldTambahan(json: unknown): string {
  return pasanganFieldTambahan(json).map(([k, v]) => `${k}: ${v}`).join("\n");
}

/** Nilai estimasi: kosong = 0, uang() 2 desimal, tidak negatif, paling besar 9999999999999999,99. */
export function bacaNilaiEstimasi(v: FormDataEntryValue | null): Desimal {
  const s = teks(v);
  if (!s) return D(0);
  let n: Desimal;
  try {
    n = uang(s);
  } catch {
    throw new Error("Perkiraan nilai deal tidak valid");
  }
  if (n.isNegative()) throw new Error("Perkiraan nilai deal tidak boleh negatif");
  if (n.gt(NILAI_ESTIMASI_MAKS)) throw new Error("Perkiraan nilai deal terlalu besar");
  return n;
}

export type IsianLead = {
  nama: string;
  namaUsaha: string;
  telepon: string;
  whatsapp: string;
  email: string | null;
  instagram: string | null;
  website: string | null;
  industri: string | null;
  lokasi: string | null;
  /** Mentah dari formulir; nama baku dicocokkan validasiRujukanLead */
  sumber: string;
  /** "" = bawaan, "-" = tanpa PIC, selain itu id pengguna */
  picId: string;
  nilaiEstimasi: Desimal;
  catatan: string | null;
  tag: string[];
  fieldTambahan: Record<string, string>;
  /** Hanya saat buat; "" = tahap urutan terkecil */
  tahapId: string;
};

/** Validasi murni isian lead (D4 §3.1), tanpa rujukan basis data. Mode ubah mengabaikan tahapId. */
export function bacaIsianLead(dataFormulir: FormData, mode: "buat" | "ubah"): IsianLead {
  const g = (k: string) => dataFormulir.get(k);
  const nama = teksWajib(g("nama"), 120, "Nama kontak wajib diisi", "Nama kontak maksimal 120 karakter");
  const namaUsaha = teksWajib(g("namaUsaha"), 120, "Perusahaan/usaha wajib diisi", "Perusahaan/usaha maksimal 120 karakter");
  const telepon = teksRentang(g("telepon"), 3, 40, "Telepon wajib diisi, 3-40 karakter");
  const whatsapp = teksRentang(g("whatsapp"), 3, 40, "WhatsApp wajib diisi, 3-40 karakter");
  const email = teksOpsional(g("email"), 120, "Email maksimal 120 karakter");
  if (email && !POLA_EMAIL.test(email)) throw new Error("Format email tidak valid");
  const instagram = teksOpsional(g("instagram"), 200, "Instagram maksimal 200 karakter");
  const website = teksOpsional(g("website"), 200, "Situs web maksimal 200 karakter");
  const industri = teksOpsional(g("industri"), 120, "Industri maksimal 120 karakter");
  const lokasi = teksOpsional(g("lokasi"), 200, "Lokasi maksimal 200 karakter");
  const sumber = teks(g("sumber"));
  if (!sumber) throw new Error("Sumber lead wajib dipilih");
  const picId = teks(g("picId")) ?? "";
  const nilaiEstimasi = bacaNilaiEstimasi(g("nilaiEstimasi"));
  const catatan = teksOpsional(g("catatan"), PANJANG_CATATAN_LEAD, `Catatan maksimal ${PANJANG_CATATAN_LEAD} karakter`);
  const tag = bacaTag(g("tag"));
  const fieldTambahan = bacaFieldTambahan(g("fieldTambahan"));
  const tahapId = mode === "buat" ? (teks(g("tahapId")) ?? "") : "";
  return { nama, namaUsaha, telepon, whatsapp, email, instagram, website, industri, lokasi, sumber, picId, nilaiEstimasi, catatan, tag, fieldTambahan, tahapId };
}

// ---------- Pengguna CRM ----------

/** Pengguna aktif yang hak efektifnya memuat lead.lihat (termasuk peran tambahan), urut nama (DESAIN F8). */
export async function daftarPenggunaCrm(klien: KlienDb): Promise<PenerimaHak[]> {
  return penggunaDenganHak(klien, "lead.lihat");
}

/**
 * Pengguna `id` harus ada, aktif, dan memegang lead.lihat. `label` = "PIC" atau "Penerima tindak lanjut" (awal pesan).
 * Mengembalikan { id, nama }.
 */
export async function pastikanPenggunaCrm(klien: KlienDb, id: string, label: string): Promise<{ id: string; nama: string }> {
  const p = await klien.pengguna.findUnique({ where: { id }, select: { id: true, nama: true, aktif: true, peran: true, peranTambahan: true } });
  if (!p || !p.aktif) throw new Error(`${label} tidak ditemukan atau sudah nonaktif`);
  const penyesuaian = await klien.hakAksesPeran.findMany({ where: { peran: { in: [p.peran, ...p.peranTambahan] } }, select: { peran: true, hak: true, boleh: true } });
  if (!hitungHakPengguna(p.peran, p.peranTambahan, penyesuaian).includes("lead.lihat")) throw new Error(`${label} ${p.nama} belum punya hak melihat lead`);
  return { id: p.id, nama: p.nama };
}

/** Pembuat sebagai PIC atau penerima bawaan: hanya bila pengguna nyata yang memenuhi syarat; selain itu null. */
async function penggunaBawaan(klien: KlienDb, pengguna: PenggunaSesi): Promise<string | null> {
  const id = idTersimpan(pengguna);
  if (!id) return null;
  try {
    return (await pastikanPenggunaCrm(klien, id, "Pengguna")).id;
  } catch {
    return null;
  }
}

// ---------- Tahap dan sumber per perusahaan ----------

/**
 * Tahap dan sumber bawaan dibuat malas per perusahaan (D4 §3.2): bila perusahaan belum punya tahap, 9 tahap bawaan;
 * bila belum punya sumber, 7 sumber bawaan. Idempoten: unik (perusahaanId, nama) dan skipDuplicates membuat dua
 * panggilan serentak tetap menghasilkan 9 tahap dan 7 sumber. Hapus tahap dan sumber tidak pernah menyisakan nol.
 */
export async function pastikanBawaanCrm(klien: KlienDb, perusahaanId: string): Promise<void> {
  const [tahap, sumber] = await Promise.all([klien.tahapLead.count({ where: { perusahaanId } }), klien.sumberLead.count({ where: { perusahaanId } })]);
  if (tahap === 0) {
    await klien.tahapLead.createMany({ data: TAHAP_BAWAAN.map((t, i) => ({ perusahaanId, nama: t.nama, jenis: t.jenis, urutan: i + 1 })), skipDuplicates: true });
  }
  if (sumber === 0) {
    await klien.sumberLead.createMany({ data: SUMBER_BAWAAN.map((nama, i) => ({ perusahaanId, nama, urutan: i + 1 })), skipDuplicates: true });
  }
}

/**
 * Kunci advisory pengaturan CRM satu perusahaan sampai transaksi selesai. Eksklusif untuk ubah tahap atau sumber,
 * bersama untuk aksi lead yang membaca jenis tahap (buat, pindah tahap), supaya jenis tahap tidak berubah di tengahnya.
 */
export async function kunciPengaturanCrm(tx: KlienDb, perusahaanId: string, eksklusif: boolean): Promise<void> {
  if (eksklusif) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('crm-pengaturan'), hashtext(${perusahaanId}))`;
  else await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext('crm-pengaturan'), hashtext(${perusahaanId}))`;
}

/** Urutan tahap dirapatkan menjadi 1..N mengikuti urutan sekarang (lalu waktu dibuat). */
export async function rapikanUrutanTahap(tx: KlienDb, perusahaanId: string): Promise<void> {
  const daftar = await tx.tahapLead.findMany({ where: { perusahaanId }, orderBy: [{ urutan: "asc" }, { dibuatPada: "asc" }, { id: "asc" }], select: { id: true, urutan: true } });
  for (const [i, t] of daftar.entries()) {
    if (t.urutan !== i + 1) await tx.tahapLead.update({ where: { id: t.id }, data: { urutan: i + 1 } });
  }
}

/**
 * Invarian daftar tahap satu perusahaan (D4 §3.2), diperiksa di dalam transaksi sebelum commit: minimal satu Menang
 * dan satu Kalah, tahap pertama Berjalan, nama unik tanpa beda huruf besar, urutan rapat 1..N, paling banyak 20.
 */
export async function periksaInvarianTahap(tx: KlienDb, perusahaanId: string): Promise<void> {
  const daftar = await tx.tahapLead.findMany({ where: { perusahaanId }, orderBy: [{ urutan: "asc" }, { id: "asc" }], select: { nama: true, jenis: true, urutan: true } });
  if (daftar.length > MAKS_TAHAP) throw new Error(`Pipeline maksimal ${MAKS_TAHAP} tahap`);
  if (!daftar.some((t) => t.jenis === "MENANG") || !daftar.some((t) => t.jenis === "KALAH")) throw new Error("Pipeline wajib punya minimal satu tahap Menang dan satu tahap Kalah");
  if (daftar[0].jenis !== "BERJALAN") throw new Error("Tahap pertama harus berjenis Berjalan karena menjadi tahap awal lead baru");
  const terlihat = new Set<string>();
  for (const t of daftar) {
    const k = kunciNama(t.nama);
    if (terlihat.has(k)) throw new Error(`Nama tahap "${t.nama}" sudah dipakai`);
    terlihat.add(k);
  }
  if (daftar.some((t, i) => t.urutan !== i + 1)) throw new Error("Urutan tahap tidak rapat. Muat ulang halaman lalu coba lagi");
}

/** Nama tahap atau sumber baru: dirapikan, 1-60 karakter. */
export function bacaNamaPengaturan(v: FormDataEntryValue | null, apa: "tahap" | "sumber"): string {
  const s = rapikanSpasi(typeof v === "string" ? v : "");
  if (!s) throw new Error(`Nama ${apa} wajib diisi`);
  if (panjang(s) > 60) throw new Error(`Nama ${apa} maksimal 60 karakter`);
  return s;
}

export function bacaJenisTahap(v: FormDataEntryValue | null): JenisTahapLead {
  const s = typeof v === "string" ? v.trim() : "";
  if (!(JENIS_TAHAP as readonly string[]).includes(s)) throw new Error("Jenis tahap tidak dikenal");
  return s as JenisTahapLead;
}

// ---------- Rujukan lead ----------

export type RujukanLead = { sumber: string; picId: string | null; tahap: { id: string; nama: string; jenis: JenisTahapLead } | null };

/**
 * Rujukan isian lead (D4 §3.1): sumber dicocokkan tanpa beda huruf besar ke SumberLead perusahaan lead (nama baku
 * yang disimpan; saat ubah nilai yang sama persis dengan sumber lama tetap diterima), PIC ("" = bawaan, "-" = tanpa),
 * dan tahap awal (hanya saat buat: kosong = urutan terkecil, harus milik perusahaan dan berjenis Berjalan).
 */
export async function validasiRujukanLead(
  klien: KlienDb,
  isian: IsianLead,
  o: { perusahaanId: string; leadLama?: { sumber: string; picId: string | null } | null; pengguna: PenggunaSesi },
): Promise<RujukanLead> {
  let sumber: string;
  if (o.leadLama && isian.sumber === o.leadLama.sumber) sumber = o.leadLama.sumber;
  else {
    const daftar = await klien.sumberLead.findMany({ where: { perusahaanId: o.perusahaanId }, select: { nama: true } });
    const cocok = daftar.find((x) => kunciNama(x.nama) === kunciNama(isian.sumber));
    if (!cocok) throw new Error(`Sumber lead "${isian.sumber}" tidak ada di daftar sumber perusahaan ini`);
    sumber = cocok.nama;
  }
  let picId: string | null;
  if (isian.picId === "-") picId = null;
  else if (isian.picId === "") picId = o.leadLama ? o.leadLama.picId : await penggunaBawaan(klien, o.pengguna);
  else picId = (await pastikanPenggunaCrm(klien, isian.picId, "PIC")).id;
  let tahap: RujukanLead["tahap"] = null;
  if (!o.leadLama) {
    const t = isian.tahapId
      ? await klien.tahapLead.findFirst({ where: { id: isian.tahapId, perusahaanId: o.perusahaanId }, select: { id: true, nama: true, jenis: true } })
      : await klien.tahapLead.findFirst({ where: { perusahaanId: o.perusahaanId }, orderBy: [{ urutan: "asc" }, { id: "asc" }], select: { id: true, nama: true, jenis: true } });
    if (!t) throw new Error("Tahap tidak ditemukan di pipeline perusahaan ini");
    if (t.jenis !== "BERJALAN") throw new Error("Lead baru hanya boleh di tahap berjenis Berjalan");
    tahap = t;
  }
  return { sumber, picId, tahap };
}

type LeadBanding = {
  nama: string;
  namaUsaha: string;
  telepon: string;
  whatsapp: string;
  email: string | null;
  instagram: string | null;
  website: string | null;
  industri: string | null;
  lokasi: string | null;
  sumber: string;
  picId: string | null;
  nilaiEstimasi: Desimal | number | string;
  catatan: string | null;
  tag: readonly string[];
  fieldTambahan: unknown;
};

/**
 * Bidang yang berubah, berurutan (D4 §3.4): teks kosong = null, nilai estimasi dengan Decimal.equals, tag sebagai
 * himpunan, field tambahan sebagai himpunan pasangan (urutan diabaikan).
 */
export function bedaLead(lama: LeadBanding, baru: LeadBanding): BidangLead[] {
  const tk = (v: string | null) => (v == null || v.trim() === "" ? null : v);
  const himpunanTag = (t: readonly string[]) => [...new Set(t)].sort().join("\u0000");
  const himpunanField = (j: unknown) => pasanganFieldTambahan(j).map(([k, v]) => `${k}\u0001${v}`).sort().join("\u0000");
  return BIDANG_LEAD.filter((b) => {
    if (b === "nilaiEstimasi") return !D(lama.nilaiEstimasi).equals(D(baru.nilaiEstimasi));
    if (b === "tag") return himpunanTag(lama.tag) !== himpunanTag(baru.tag);
    if (b === "fieldTambahan") return himpunanField(lama.fieldTambahan) !== himpunanField(baru.fieldTambahan);
    return tk(lama[b]) !== tk(baru[b]);
  });
}

// ---------- Linimasa ----------

/** Satu entri linimasa lead. `pengguna` boleh pengguna semu skrip uji (disimpan tanpa penggunaId). */
export async function catatAktivitasLead(
  klien: KlienDb,
  a: { leadId: string; jenis: JenisAktivitasLead; meta?: Prisma.InputJsonValue; isi?: string | null; pengguna: { id: string; nama: string } },
): Promise<void> {
  await klien.aktivitasLead.create({
    data: { leadId: a.leadId, jenis: a.jenis, meta: a.meta ?? {}, isi: a.isi ?? null, penggunaId: idTersimpan(a.pengguna), penggunaNama: a.pengguna.nama },
  });
}

export function labelAktivitas(jenis: JenisAktivitasLead): string {
  return LABEL_JENIS_AKTIVITAS[jenis]?.label ?? jenis;
}

const LABEL_STATUS_TINDAK_LANJUT_KECIL: Record<StatusTindakLanjut, string> = { MENUNGGU: "menunggu", SELESAI: "selesai", DIBATALKAN: "dibatalkan" };

/**
 * Teks tampil entri linimasa (D4 §3.6), dirangkai dari jenis dan meta. Meta yang rusak atau tidak lengkap tidak
 * melempar: kunci yang hilang tampil "?".
 */
export function teksAktivitas(a: { jenis: JenisAktivitasLead; meta: unknown; isi?: string | null }): string {
  const m = a.meta && typeof a.meta === "object" && !Array.isArray(a.meta) ? (a.meta as Record<string, unknown>) : {};
  const s = (k: string) => {
    const v = m[k];
    return typeof v === "string" && v !== "" ? v : typeof v === "number" ? String(v) : "?";
  };
  const alasan = typeof m.alasan === "string" && m.alasan.trim() ? m.alasan.trim() : null;
  const waktu = (k: string) => {
    const v = m[k];
    const d = typeof v === "string" || typeof v === "number" ? new Date(v) : null;
    return d && !Number.isNaN(d.getTime()) ? formatWaktu(d) : "?";
  };
  switch (a.jenis) {
    case "DIBUAT":
      return `Lead dibuat di tahap ${s("tahapNama")}`;
    case "DIUBAH": {
      const bidang = Array.isArray(m.bidang) ? m.bidang.map((b) => (typeof b === "string" && b in LABEL_BIDANG_LEAD ? LABEL_BIDANG_LEAD[b as BidangLead] : String(b))) : [];
      return `Lead diubah: ${bidang.length ? bidang.join(", ") : "?"}`;
    }
    case "TAHAP_DIUBAH":
      return `Tahap diubah: ${s("dariNama")} → ${s("keNama")}${alasan ? ` (alasan: ${alasan})` : ""}`;
    case "MENANG":
      return `Deal menang: ${s("dariNama")} → ${s("keNama")}${alasan ? ` (alasan: ${alasan})` : ""}`;
    case "KALAH":
      return `Deal kalah: ${s("dariNama")} → ${s("keNama")} (alasan: ${alasan ?? "?"})`;
    case "CATATAN":
      return a.isi?.trim() ? a.isi : "?";
    case "TINDAK_LANJUT_DIJADWALKAN":
      return `Tindak lanjut dijadwalkan: ${s("judul")}, jatuh tempo ${waktu("jatuhTempo")}`;
    case "TINDAK_LANJUT_STATUS": {
      const ke = typeof m.ke === "string" && m.ke in LABEL_STATUS_TINDAK_LANJUT_KECIL ? LABEL_STATUS_TINDAK_LANJUT_KECIL[m.ke as StatusTindakLanjut] : "?";
      return `Tindak lanjut "${s("judul")}" ditandai ${ke}`;
    }
    case "DIKONVERSI":
      return m.baru === false ? `Ditautkan ke pelanggan ${s("kode")} ${s("nama")}` : `Dijadikan pelanggan baru ${s("kode")} ${s("nama")}`;
    case "PENAWARAN_DIBUAT":
      return `Penawaran ${s("nomor")} dibuat`;
    case "DIARSIPKAN":
      return "Lead diarsipkan";
    case "DIPULIHKAN":
      return "Lead dipulihkan";
    default:
      return "?";
  }
}

// ---------- Notifikasi dan log ----------

/**
 * Tautan notifikasi lead. Rute /crm lahir di P32; sampai itu null supaya notifikasi tidak menaut ke halaman yang belum
 * ada (notifikasi dibuka ke /notifikasi). P32 mengganti isi fungsi ini dengan `/crm/lead/${leadId}` (D4 §3.14).
 */
export function tautanLeadNotifikasi(leadId: string): string | null {
  void leadId;
  return null;
}

/** Tautan notifikasi tindak lanjut: lead bila ada, selain itu daftar tindak lanjut. null sampai P32 (lihat atas). */
export function tautanTindakLanjutNotifikasi(leadId: string | null): string | null {
  return leadId ? tautanLeadNotifikasi(leadId) : null;
}

/**
 * Notifikasi CRM (D4 §3.14) di transaksi aksi pemicu. Penerima null, "skrip-uji", duplikat, dan pelaku dibuang
 * (kirimNotifikasi); daftar kosong tidak menulis apa pun.
 */
export async function beritahu(
  tx: KlienDb,
  pengguna: { id: string },
  n: { penerima: readonly (string | null | undefined)[]; judul: string; isi?: string | null; tautan?: string | null; jenis: JenisNotifikasi; perusahaanId: string | null },
): Promise<number> {
  return kirimNotifikasi(tx, { penggunaIds: n.penerima, judul: n.judul, isi: n.isi, tautan: n.tautan, jenis: n.jenis, perusahaanId: n.perusahaanId, kecuali: pengguna.id });
}

/** Log aktivitas modul crm (D4 §3.15). Panggil dengan tx yang sama dengan perubahan datanya. */
export async function catatLogCrm(
  tx: KlienDb,
  pengguna: { id: string; nama: string },
  l: { aksi: string; jenis: string; nomor: string; keterangan?: string | null; entitasId?: string | null; meta?: Prisma.InputJsonValue; perusahaanId?: string | null },
): Promise<void> {
  await catatAktivitas(tx, pengguna, { ...l, modul: "crm" });
}

// ---------- Daftar, cari, filter ----------

export type FilterLead = {
  q?: string | null;
  tahap?: string | null;
  status?: string | null;
  sumber?: string | null;
  /** id pengguna, "saya", atau "tanpa" */
  pic?: string | null;
  tag?: string | null;
  /** true = hanya lead terarsip (halaman memastikan hak lead.hapus) */
  arsip?: boolean;
};

/**
 * Klausa daftar lead (D4 §3.10): semua saringan digabung AND, ditambah perusahaan lingkup bila bukan gabungan.
 * Nilai yang tidak dikenal diabaikan. Pencarian teks pada nama, nama usaha, email, telepon, WhatsApp, dan tag utuh.
 */
export function whereLead(f: FilterLead, o: { perusahaanId: string | null; penggunaId: string | null }): Prisma.LeadWhereInput {
  const dan: Prisma.LeadWhereInput[] = [{ dihapusPada: f.arsip ? { not: null } : null }];
  if (o.perusahaanId) dan.push({ perusahaanId: o.perusahaanId });
  const q = f.q?.trim();
  if (q) {
    const ci = { contains: q, mode: "insensitive" as const };
    dan.push({ OR: [{ nama: ci }, { namaUsaha: ci }, { email: ci }, { telepon: ci }, { whatsapp: ci }, { tag: { has: q.toLocaleLowerCase("id-ID") } }] });
  }
  if (f.tahap) dan.push({ tahapId: f.tahap });
  if (f.status && (JENIS_TAHAP as readonly string[]).includes(f.status)) dan.push({ tahap: { jenis: f.status as JenisTahapLead } });
  if (f.sumber) dan.push({ sumber: f.sumber });
  if (f.pic === "tanpa") dan.push({ picId: null });
  else if (f.pic === "saya") dan.push({ picId: o.penggunaId ?? "__tanpa-pengguna" });
  else if (f.pic) dan.push({ picId: f.pic });
  const tag = f.tag?.trim();
  if (tag) dan.push({ tag: { has: rapikanSpasi(tag).toLocaleLowerCase("id-ID") } });
  return { AND: dan };
}

/** Urutan daftar lead (D4 §3.10); nilai lain = terbaru. */
export const URUTAN_LEAD = {
  terbaru: [{ dibuatPada: "desc" }, { id: "desc" }],
  terlama: [{ dibuatPada: "asc" }, { id: "asc" }],
  nilai: [{ nilaiEstimasi: "desc" }, { dibuatPada: "desc" }, { id: "desc" }],
  nama: [{ nama: "asc" }, { dibuatPada: "desc" }, { id: "desc" }],
} as const satisfies Record<string, Prisma.LeadOrderByWithRelationInput[]>;
export type UrutanLead = keyof typeof URUTAN_LEAD;
export function urutanLead(nilai: string | null | undefined): Prisma.LeadOrderByWithRelationInput[] {
  return [...URUTAN_LEAD[nilai && Object.prototype.hasOwnProperty.call(URUTAN_LEAD, nilai) ? (nilai as UrutanLead) : "terbaru"]];
}

export type HasilCariLead = { id: string; nama: string; namaUsaha: string; perusahaanId: string; tahap: { nama: string; jenis: JenisTahapLead } };

/**
 * Pencarian global lead (D4 §8 no. 17, D7): minimal 2 karakter, tanpa lead terarsip, mengikuti lingkup (null =
 * gabungan), 10 terbaru. Pemanggil memeriksa hak lead.lihat.
 */
export async function cariLead(klien: KlienDb, q: string, perusahaanId: string | null = null): Promise<HasilCariLead[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const ci = { contains: term, mode: "insensitive" as const };
  return klien.lead.findMany({
    where: { dihapusPada: null, ...(perusahaanId ? { perusahaanId } : {}), OR: [{ nama: ci }, { namaUsaha: ci }, { email: ci }, { telepon: ci }, { whatsapp: ci }] },
    select: { id: true, nama: true, namaUsaha: true, perusahaanId: true, tahap: { select: { nama: true, jenis: true } } },
    orderBy: [{ dibuatPada: "desc" }, { id: "desc" }],
    take: 10,
  });
}

// ---------- Lead aktif, penawaran ----------

/**
 * Mengunci baris lead (FOR SHARE) di transaksi pemanggil lalu memastikan lead ada dan tidak terarsip. Arsip lead
 * (update) menunggu sampai transaksi ini selesai, jadi data yang ditulis bersama lead tidak bisa menyusul arsip.
 */
export async function kunciLeadAktif(tx: KlienDb, leadId: string) {
  await tx.$queryRaw`SELECT 1 FROM "Lead" WHERE "id" = ${leadId} FOR SHARE`;
  const lead = await tx.lead.findUnique({ where: { id: leadId }, select: { id: true, nama: true, namaUsaha: true, perusahaanId: true, picId: true, dihapusPada: true, pelangganId: true } });
  if (!lead) throw new Error("Lead tidak ditemukan");
  if (lead.dihapusPada) throw new Error("Lead sudah diarsipkan; pulihkan dulu");
  return lead;
}

/**
 * Penawaran dari lead (D4 §3.8, dipakai buatPenawaran P23 di dalam transaksinya): lead ada dan tidak terarsip, dan
 * milik perusahaan penawaran. perusahaanId null = pemeriksaan perusahaan dilewati.
 */
export async function pastikanLeadUntukPenawaran(klien: KlienDb, leadId: string, perusahaanId: string | null) {
  await klien.$queryRaw`SELECT 1 FROM "Lead" WHERE "id" = ${leadId} FOR SHARE`;
  const lead = await klien.lead.findUnique({ where: { id: leadId }, select: { id: true, nama: true, perusahaanId: true, pelangganId: true, dihapusPada: true, perusahaan: { select: { nama: true } } } });
  if (!lead || lead.dihapusPada) throw new Error("Lead tidak ditemukan atau sudah diarsipkan");
  if (perusahaanId && lead.perusahaanId !== perusahaanId) throw new Error(`Lead milik ${lead.perusahaan.nama}; penawaran harus atas nama perusahaan yang sama`);
  return lead;
}

// ---------- Konversi ke pelanggan ----------

export const POLA_KODE_PELANGGAN_MANUAL = /^\S{1,30}$/;
/**
 * Pola kode otomatis. Kode manual berpola ini ditolak saat konversi (tinjauan P22 R4): kode manual seperti
 * PLG-2026-999999999 membuat nomor berikutnya 10 digit, di luar jangkauan MAX, sehingga setiap konversi otomatis
 * tahun itu bentrok.
 */
export const POLA_KODE_PELANGGAN_OTOMATIS = /^PLG-\d{4}-\d+$/;
export const PESAN_KODE_POLA_OTOMATIS = "Kode berpola PLG-tahun-nomor dipakai penomoran otomatis. Kosongkan kode untuk memakai nomor otomatis, atau pakai kode lain";
/** Nomor terbesar yang dibaca MAX (9 digit, muat di INTEGER). */
export const MAKS_NOMOR_PELANGGAN_OTOMATIS = 999_999_999;

/**
 * Kode pelanggan otomatis PLG-{tahun}-{NNNN}; tahun dari zona usaha (bukan jam server). Bila nomor terbesar sudah
 * mencapai batas 9 digit (kode itu dibuat manual dari Data Induk), galat menyebut kodenya alih-alih bentrok berulang.
 */
export async function kodePelangganBerikutnya(tx: KlienDb, sekarang: Date = new Date()): Promise<string> {
  const awalan = `PLG-${tanggalIso(sekarang).slice(0, 4)}-`;
  const mulai = awalan.length + 1;
  // posisi wajib ::int: substring(teks FROM teks) adalah bentuk pola regex, bukan posisi
  const [baris] = await tx.$queryRaw<{ maks: number | null }[]>`
    SELECT MAX(CAST(substring("kode" FROM ${mulai}::int) AS INTEGER)) AS "maks"
    FROM "Pelanggan" WHERE "kode" LIKE ${`${awalan}%`} AND substring("kode" FROM ${mulai}::int) ~ '^[0-9]{1,9}$'`;
  const maks = baris?.maks ?? 0;
  if (maks >= MAKS_NOMOR_PELANGGAN_OTOMATIS) {
    throw new Error(`Nomor kode pelanggan otomatis ${awalan} sudah habis karena ada pelanggan berkode ${awalan}${maks}. Isi kode pelanggan lain secara manual, atau ganti kode pelanggan itu di Data Induk`);
  }
  return `${awalan}${String(maks + 1).padStart(4, "0")}`;
}

/** Angka telepon untuk pembanding: hanya digit, awalan 62 menjadi 0. */
export function angkaTelepon(t: string | null | undefined): string {
  return (t ?? "").replace(/\D/g, "").replace(/^62/, "0");
}

export type PelangganMirip = { id: string; kode: string; nama: string };

/**
 * Pelanggan yang mirip lead (D4 §3.7), maksimal 5: nama sama setelah huruf kecil dan spasi dirapikan, telepon sama
 * (hanya digit, 62 menjadi 0) dengan telepon atau WhatsApp lead bila lead punya minimal 7 digit, atau email sama
 * tanpa beda huruf besar.
 */
export async function cariPelangganMirip(
  klien: KlienDb,
  lead: { namaUsaha: string; telepon: string | null; whatsapp: string | null; email: string | null },
): Promise<PelangganMirip[]> {
  const nama = lead.namaUsaha.trim().replace(/\s+/g, " ").toLowerCase();
  const angka = [angkaTelepon(lead.telepon), angkaTelepon(lead.whatsapp)].filter((x) => x.length >= 7);
  const email = lead.email?.trim().toLowerCase() || null;
  const syaratTelepon = angka.length
    ? Prisma.sql`OR regexp_replace(regexp_replace(coalesce("telepon", ''), '\\D', '', 'g'), '^62', '0') IN (${Prisma.join(angka)})`
    : Prisma.empty;
  const syaratEmail = email ? Prisma.sql`OR lower(btrim(coalesce("email", ''))) = ${email}` : Prisma.empty;
  return klien.$queryRaw<PelangganMirip[]>`
    SELECT "id", "kode", "nama" FROM "Pelanggan"
    WHERE lower(regexp_replace(btrim("nama"), '\\s+', ' ', 'g')) = ${nama} ${syaratTelepon} ${syaratEmail}
    ORDER BY "kode" ASC
    LIMIT 5`;
}

// ---------- Waktu tindak lanjut ----------

/** Jatuh tempo tindak lanjut dari isian datetime-local (jam dinding zona usaha), tahun 2000-2100. */
export function bacaJatuhTempoTindakLanjut(v: FormDataEntryValue | null): Date {
  const s = typeof v === "string" ? v.trim() : "";
  const d = s ? bacaWaktuLokal(s) : null;
  const tahun = d ? Number(tanggalIso(d).slice(0, 4)) : 0;
  if (!d || tahun < 2000 || tahun > 2100) throw new Error("Tanggal/jam tindak lanjut tidak valid");
  return d;
}
