import type { Prisma, PrismaClient } from "@/prisma-klien/client";
import type { JenisNotifikasi } from "@/prisma-klien/enums";
import { hitungHakPengguna, labelHak, type Hak, type PenggunaSesi } from "@/lib/hakAkses";
import { catatAktivitas, type ModulLog } from "@/lib/log";
import { kirimNotifikasi, penggunaDenganHak } from "@/lib/notifikasi";
import { JENIS_KONTEN_BAWAAN, LABEL_PLATFORM, PILAR_KONTEN_BAWAAN, STATUS_DESAIN, STATUS_KAMPANYE, STATUS_KONTEN } from "@/lib/labelPemasaran";
import { saringPerusahaan } from "@/lib/perusahaan";
import { bacaUang, uang, type Desimal } from "@/lib/uang";
import { tanggalIso } from "@/lib/waktu";
import { cocokTeks } from "@/lib/daftar";

/*
 * Pembantu bersama modul Pemasaran (D6 §3.0, §3.4, §3.5, §6.1): pembaca isian, penanggung jawab, notifikasi, log,
 * pengaturan daftar jenis dan pilar, URL kembali, dan pencarian. Bukan "use server" dan tidak memakai db langsung:
 * klien basis data selalu dikirim pemanggil. Tidak mengimpor konten.ts maupun desain.ts (L4), jadi keduanya boleh
 * memakai berkas ini tanpa siklus impor.
 */

type Klien = PrismaClient | Prisma.TransactionClient;

/** Pengguna semu skrip regresi tidak ada di tabel Pengguna, jadi tidak boleh ditulis sebagai kunci asing (D6 §3.0 no. 8). */
export function idTersimpan(pengguna: { id: string }): string | null {
  return pengguna.id === "skrip-uji" ? null : pengguna.id;
}

// ---------- Pembaca isian (D6 §3.0 no. 2) ----------

const mentah = (fd: FormData, nama: string) => String(fd.get(nama) ?? "").trim();

/** Teks wajib 1 sampai `maks` karakter setelah dipangkas. */
export function teksWajib(fd: FormData, nama: string, label: string, maks: number): string {
  const t = mentah(fd, nama);
  if (!t) throw new Error(`${label} wajib diisi`);
  if (t.length > maks) throw new Error(`${label} maksimal ${maks} karakter`);
  return t;
}

/** Teks opsional; kosong = null. */
export function teksOpsional(fd: FormData, nama: string, label: string, maks: number): string | null {
  const t = mentah(fd, nama);
  if (!t) return null;
  if (t.length > maks) throw new Error(`${label} maksimal ${maks} karakter`);
  return t;
}

const POLA_TANGGAL = /^\d{4}-\d{2}-\d{2}$/;

/** "2026-12-10" menjadi Date pukul 12.00 waktu server (pola tanggal dokumen lain); null bila tidak sah. */
export function tanggalDariIso(t: string): Date | null {
  if (!POLA_TANGGAL.test(t)) return null;
  const d = new Date(`${t}T12:00:00`);
  if (Number.isNaN(d.getTime()) || tanggalIso(d) !== t) return null;
  return d;
}

/** Tanggal opsional berformat YYYY-MM-DD yang benar-benar ada (2026-02-30 ditolak); kosong = null. */
export function tanggalOpsional(fd: FormData, nama: string, label: string): Date | null {
  const t = mentah(fd, nama);
  if (!t) return null;
  const d = tanggalDariIso(t);
  if (!d) throw new Error(`${label} tidak valid`);
  return d;
}

/** Jam terbit JJ:MM; kosong = null. */
export function jamOpsional(fd: FormData, nama: string): string | null {
  const t = mentah(fd, nama);
  if (!t) return null;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) throw new Error("Jam terbit tidak valid (format JJ:MM)");
  return t;
}

/** Nilai enum; kosong = `bawaan`, di luar daftar = "<label> tidak dikenal". */
export function enumWajib<T extends string>(fd: FormData, nama: string, daftar: readonly T[], bawaan: T, label: string): T {
  const t = mentah(fd, nama);
  if (!t) return bawaan;
  if (!(daftar as readonly string[]).includes(t)) throw new Error(`${label} tidak dikenal`);
  return t as T;
}

/** Batas angka uang yang muat di Decimal(18, 2). */
const UANG_MAKS = uang("9999999999999999.99");

/** Uang opsional 0 atau lebih; kosong = 0. */
export function uangOpsional(fd: FormData, nama: string, label: string): Desimal {
  const t = mentah(fd, nama);
  if (!t) return uang(0);
  const d = bacaUang(t, label, { allowZero: true });
  if (d.gt(UANG_MAKS)) throw new Error(`${label} terlalu besar`);
  return d;
}

/** Uang opsional yang boleh kosong (null), mis. nilai CTR/CPC/CPM manual. */
export function uangBolehKosong(fd: FormData, nama: string, label: string): Desimal | null {
  return mentah(fd, nama) ? uangOpsional(fd, nama, label) : null;
}

const BULAT_MAKS = 2_000_000_000;

/** Bilangan bulat 0 atau lebih; kosong = 0, atau null bila `bolehKosong`. */
export function bulatOpsional(fd: FormData, nama: string, label: string, opsi: { bolehKosong: true }): number | null;
export function bulatOpsional(fd: FormData, nama: string, label: string, opsi?: { bolehKosong?: false }): number;
export function bulatOpsional(fd: FormData, nama: string, label: string, opsi: { bolehKosong?: boolean } = {}): number | null {
  const t = mentah(fd, nama);
  if (!t) return opsi.bolehKosong ? null : 0;
  if (!/^\d+$/.test(t)) throw new Error(`${label} harus bilangan bulat 0 atau lebih`);
  const n = Number(t);
  if (n > BULAT_MAKS) throw new Error(`${label} terlalu besar`);
  return n;
}

/** Id opsional dari isian (kosong = null), dipangkas. */
export function idOpsional(fd: FormData, nama: string): string | null {
  return mentah(fd, nama) || null;
}

// ---------- Penanggung jawab (D6 §3.0 no. 3) ----------

/**
 * Penanggung jawab (SMM, desainer) harus pengguna yang ada, aktif, dan hak efektifnya (peran utama dan tambahan beserta
 * penyesuaian Hak Akses) memuat `hak`. Kosong = null. Pengganti check_member HKA.
 */
export async function pastikanPenanggungJawab(klien: Klien, id: string | null | undefined, hak: Hak, label: string): Promise<string | null> {
  if (!id) return null;
  const p = await klien.pengguna.findUnique({ where: { id }, select: { id: true, aktif: true, peran: true, peranTambahan: true } });
  const gagal = `${label} harus pengguna aktif yang berhak ${labelHak(hak)}`;
  // Superadmin (admin IT) tidak pernah menjadi penanggung jawab, sama dengan pilihan formulir (perbaikan tinjauan P41 R6).
  // Pemanggil tidak memeriksa ulang nilai lama, jadi aturan ini hanya berlaku untuk pilihan baru.
  if (!p || !p.aktif || p.peran === "SUPERADMIN") throw new Error(gagal);
  const penyesuaian = await klien.hakAksesPeran.findMany({ where: { peran: { in: [p.peran, ...p.peranTambahan] } }, select: { peran: true, hak: true, boleh: true } });
  if (!hitungHakPengguna(p.peran, p.peranTambahan, penyesuaian).includes(hak)) throw new Error(gagal);
  return p.id;
}

/** Pilihan penanggung jawab di formulir: pengguna aktif yang memegang `hak`, tanpa peran utama SUPERADMIN, urut nama. */
export async function pilihanPenanggungJawab(klien: Klien, hak: Hak): Promise<{ id: string; nama: string }[]> {
  const daftar = await penggunaDenganHak(klien, hak);
  return daftar.filter((p) => p.peran !== "SUPERADMIN").map((p) => ({ id: p.id, nama: p.nama }));
}

/**
 * Penerima "semua pemegang hak X" untuk N2 dan N6 (D6 §3.4): pengguna aktif yang memegang hak itu tanpa peran utama
 * SUPERADMIN, kecuali bila hanya Superadmin yang memegangnya (kontrak P05, penerima tidak pernah nol).
 */
export async function penerimaMenurutHak(klien: Klien, hak: Hak): Promise<string[]> {
  return (await penggunaDenganHak(klien, hak, { tanpaSuperadmin: true })).map((p) => p.id);
}

// ---------- Notifikasi dan log (D6 §3.4, §3.5) ----------

export type NotifikasiPemasaran = {
  penerima: readonly (string | null | undefined)[];
  pelaku: { id: string };
  judul: string;
  isi?: string | null;
  tautan: string;
  jenis: JenisNotifikasi;
  perusahaanId: string;
};

/**
 * Notifikasi modul Pemasaran di transaksi aksi pemicu. kirimNotifikasi membuang null, pelaku, duplikat, dan pengguna
 * yang tidak aktif, lalu memotong judul (120) dan isi (500). Mengembalikan jumlah notifikasi yang tersimpan.
 */
export async function kirimNotifikasiPemasaran(tx: Klien, n: NotifikasiPemasaran): Promise<number> {
  const hak = hakTautanPemasaran(n.tautan);
  const penerima = hak ? await penerimaBerhak(tx, n.penerima, hak) : n.penerima;
  return kirimNotifikasi(tx, { penggunaIds: penerima, judul: n.judul, isi: n.isi, tautan: n.tautan, jenis: n.jenis, perusahaanId: n.perusahaanId, kecuali: n.pelaku.id });
}

/** Hak lihat halaman tujuan tautan notifikasi Pemasaran; null untuk tautan lain. */
export function hakTautanPemasaran(tautan: string): Hak | null {
  if (tautan.startsWith("/pemasaran/konten")) return "konten.lihat";
  if (tautan.startsWith("/pemasaran/desain")) return "tugas-desain.lihat";
  if (tautan.startsWith("/pemasaran/iklan")) return "kampanye.lihat";
  return null;
}

/**
 * Penerima tersimpan (SMM, desainer, pembuat konten) yang sekarang masih memegang hak lihat halaman tautannya, menurut
 * hak efektif (peran utama dan tambahan beserta penyesuaian Hak Akses). Penerima yang haknya sudah dicabut tidak lagi
 * menerima judul konten atau masukan penyetuju (perbaikan tinjauan P41 R5, pola penerima CRM).
 */
async function penerimaBerhak(tx: Klien, ids: readonly (string | null | undefined)[], hak: Hak): Promise<string[]> {
  const unik = [...new Set(ids.filter((x): x is string => !!x))];
  if (unik.length === 0) return [];
  const calon = await tx.pengguna.findMany({ where: { id: { in: unik }, aktif: true }, select: { id: true, peran: true, peranTambahan: true } });
  if (calon.length === 0) return [];
  const peran = [...new Set(calon.flatMap((p) => [p.peran, ...p.peranTambahan]))];
  const penyesuaian = await tx.hakAksesPeran.findMany({ where: { peran: { in: peran } }, select: { peran: true, hak: true, boleh: true } });
  return calon.filter((p) => hitungHakPengguna(p.peran, p.peranTambahan, penyesuaian).includes(hak)).map((p) => p.id);
}

export type ModulPemasaran = Extract<ModulLog, "konten" | "tugas-desain" | "kampanye">;

export type LogPemasaran = {
  modul: ModulPemasaran;
  aksi: string;
  /** label manusiawi, mis. "Konten Media Sosial" */
  jenis: string;
  /** judul atau nama data saat kejadian (kolom nomor log, dipotong 120) */
  label: string;
  entitasId: string;
  keterangan?: string | null;
  meta?: Prisma.InputJsonValue;
  perusahaanId: string;
};

/** Log aktivitas modul Pemasaran (D6 §3.5). Panggil dengan tx yang sama dengan perubahan datanya. */
export async function catatLogPemasaran(tx: Klien, pengguna: { id: string; nama: string }, l: LogPemasaran): Promise<void> {
  await catatAktivitas(tx, pengguna, { aksi: l.aksi, jenis: l.jenis, nomor: l.label, keterangan: l.keterangan ?? null, modul: l.modul, entitasId: l.entitasId, meta: l.meta, perusahaanId: l.perusahaanId });
}

/** Label jenis log per modul (D6 §3.5). */
export const JENIS_LOG_KONTEN = "Konten Media Sosial";
export const JENIS_LOG_TUGAS = "Tugas Desain";
export const JENIS_LOG_KAMPANYE = "Kampanye Iklan";
export const JENIS_LOG_PENGATURAN = "Pengaturan Pemasaran";

/** Tautan notifikasi dan pencarian (D6 §3.4). */
export const tautanKonten = (id: string) => `/pemasaran/konten?konten=${id}`;
export const tautanTugasDesain = (id: string) => `/pemasaran/desain?tugas=${id}`;
export const tautanKampanye = (id: string) => `/pemasaran/iklan/${id}`;

// ---------- Pengaturan daftar jenis dan pilar konten (D6 §6.5, §7.9) ----------

export type PengaturanPemasaranData = { jenisKonten: string[]; pilarKonten: string[] };

/** Daftar jenis dan pilar konten perusahaan; bawaan bila perusahaan belum punya baris. Selalu dua larik (M-5). */
export async function ambilPengaturanPemasaran(klien: Klien, perusahaanId: string): Promise<PengaturanPemasaranData> {
  const p = await klien.pengaturanPemasaran.findUnique({ where: { perusahaanId }, select: { jenisKonten: true, pilarKonten: true } });
  if (!p) return { jenisKonten: [...JENIS_KONTEN_BAWAAN], pilarKonten: [...PILAR_KONTEN_BAWAAN] };
  return { jenisKonten: p.jenisKonten ?? [], pilarKonten: p.pilarKonten ?? [] };
}

export const MAKS_BUTIR_DAFTAR = 50;
export const PANJANG_BUTIR_DAFTAR = 60;

/**
 * Normalisasi satu daftar dari textarea (seperti item_sections HKA): pisah baris, pangkas, spasi ganda jadi satu,
 * potong 60 karakter, buang kosong, buang duplikat tanpa beda huruf besar (yang pertama menang), paling banyak 50 butir.
 */
export function rapikanDaftarPilihan(teks: string): string[] {
  const hasil: string[] = [];
  const terpakai = new Set<string>();
  for (const baris of teks.split(/\r?\n/)) {
    const butir = baris.trim().replace(/\s+/g, " ").slice(0, PANJANG_BUTIR_DAFTAR).trim();
    if (!butir) continue;
    const kunci = butir.toLocaleLowerCase("id-ID");
    if (terpakai.has(kunci)) continue;
    terpakai.add(kunci);
    hasil.push(butir);
  }
  if (hasil.length > MAKS_BUTIR_DAFTAR) throw new Error(`Maksimal ${MAKS_BUTIR_DAFTAR} butir per daftar`);
  return hasil;
}

// ---------- Tanggal dan URL (D6 §6.1) ----------

/** "2026-11-09" + n hari, dihitung dengan Date.UTC supaya bebas zona proses. */
export function geserHari(iso: string, hari: number): string {
  const [th, bl, tg] = iso.split("-").map(Number);
  return new Date(Date.UTC(th, bl - 1, tg + hari)).toISOString().slice(0, 10);
}

/** Kunci query string tampilan yang boleh diteruskan saat kembali dari laci (D6 §6.1). */
export const KUNCI_KEMBALI = ["tampilan", "bulan", "platform", "status", "persetujuan", "proyek", "prioritas", "saya", "q", "hal"] as const;

/**
 * URL tujuan sesudah buat: `dasar` ditambah kunci tampilan yang dikenal dari isian tersembunyi `kembali` (query string
 * tampilan saat ini), lalu `tambah`. Nilai isian tidak pernah dipakai sebagai URL, jadi tidak ada pengalihan terbuka.
 */
export function urlKembali(fd: FormData, dasar: string, tambah: Record<string, string> = {}): string {
  const asal = new URLSearchParams(mentah(fd, "kembali").replace(/^\?/, ""));
  const qs = new URLSearchParams();
  for (const k of KUNCI_KEMBALI) {
    const v = asal.get(k);
    if (v) qs.set(k, v.slice(0, 200));
  }
  for (const [k, v] of Object.entries(tambah)) qs.set(k, v);
  const s = qs.toString();
  return s ? `${dasar}?${s}` : dasar;
}

// ---------- Pencarian global (D6 §6.6, dipasang P46 di /cari) ----------

export type HasilCariPemasaran = { id: string; judul: string; keterangan: string; perusahaanId: string; tautan: string };
export type KelompokCariPemasaran = {
  /** null = pengguna tidak punya hak lihat modul itu (kelompok tidak ditampilkan) */
  konten: HasilCariPemasaran[] | null;
  tugas: HasilCariPemasaran[] | null;
  kampanye: HasilCariPemasaran[] | null;
};

export const BATAS_CARI_PEMASARAN = 10;

/**
 * Tiga kelompok hasil pencarian: konten (judul, caption, tagar), tugas desain (judul, deskripsi), kampanye (nama).
 * Data arsip tidak ikut. perusahaanId null/undefined = gabungan.
 */
export async function cariPemasaran(klien: Klien, q: string, pengguna: PenggunaSesi, perusahaanId?: string | null): Promise<KelompokCariPemasaran> {
  const kata = q.trim();
  const boleh = (h: Hak) => pengguna.hak.includes(h);
  const lingkup = { diarsipkanPada: null, ...saringPerusahaan(perusahaanId) };
  const kosong = (h: Hak) => (boleh(h) ? [] : null);
  if (!kata) return { konten: kosong("konten.lihat"), tugas: kosong("tugas-desain.lihat"), kampanye: kosong("kampanye.lihat") };
  const c = cocokTeks(kata);
  const [konten, tugas, kampanye] = await Promise.all([
    boleh("konten.lihat")
      ? klien.konten.findMany({
          where: { ...lingkup, OR: [{ judul: c }, { caption: c }, { tagar: c }] },
          orderBy: [{ dibuatPada: "desc" }, { id: "asc" }],
          take: BATAS_CARI_PEMASARAN,
          select: { id: true, judul: true, platform: true, status: true, perusahaanId: true },
        })
      : null,
    boleh("tugas-desain.lihat")
      ? klien.tugasDesain.findMany({
          where: { ...lingkup, OR: [{ judul: c }, { deskripsi: c }] },
          orderBy: [{ dibuatPada: "desc" }, { id: "asc" }],
          take: BATAS_CARI_PEMASARAN,
          select: { id: true, judul: true, status: true, perusahaanId: true },
        })
      : null,
    boleh("kampanye.lihat")
      ? klien.kampanye.findMany({
          where: { ...lingkup, nama: c },
          orderBy: [{ dibuatPada: "desc" }, { id: "asc" }],
          take: BATAS_CARI_PEMASARAN,
          select: { id: true, nama: true, status: true, perusahaanId: true },
        })
      : null,
  ]);
  return {
    konten: konten?.map((k) => ({ id: k.id, judul: k.judul, keterangan: `${LABEL_PLATFORM[k.platform]} · ${STATUS_KONTEN[k.status].label}`, perusahaanId: k.perusahaanId, tautan: tautanKonten(k.id) })) ?? null,
    tugas: tugas?.map((t) => ({ id: t.id, judul: t.judul, keterangan: STATUS_DESAIN[t.status].label, perusahaanId: t.perusahaanId, tautan: tautanTugasDesain(t.id) })) ?? null,
    kampanye: kampanye?.map((k) => ({ id: k.id, judul: k.nama, keterangan: STATUS_KAMPANYE[k.status].label, perusahaanId: k.perusahaanId, tautan: tautanKampanye(k.id) })) ?? null,
  };
}
