import type { Prisma, PrismaClient } from "@/prisma-klien/client";
import { punyaHak, type Hak, type PenggunaSesi } from "@/lib/hakAkses";
import { bacaWaktuLokal } from "@/lib/waktu";

/*
 * Log aktivitas diperluas (D7 §3.7). Berkas ini TIDAK "use server" dan tidak mengimpor db: klien basis data
 * selalu dikirim pemanggil (db atau tx), jadi pencatatan ikut transaksi perubahannya.
 * Pencatat lama (logAktivitas.create langsung di aksi lama) tidak diubah dan tetap menulis modul null.
 */

export type KlienDb = PrismaClient | Prisma.TransactionClient;

export type ModulLog =
  | "auth"
  | "pengguna"
  | "pengaturan"
  | "perusahaan"
  | "antar-perusahaan"
  | "penjualan"
  | "dokumen"
  | "crm"
  | "konten"
  | "tugas-desain"
  | "kampanye"
  | "proyek"
  | "anggaran-proyek"
  | "bagi-hasil"
  | "berkas";

/**
 * Label dan hak lihat tambahan tiap modul. Catatan bermodul hanya terlihat bagi pemegang log-aktivitas.lihat
 * yang juga memegang `hakLihat` (null = tanpa syarat tambahan). Catatan lama (modul null) terlihat bagi semua
 * pemegang log-aktivitas.lihat, seperti sebelum peleburan.
 */
export const MODUL_LOG: Record<ModulLog, { label: string; hakLihat: Hak | null }> = {
  auth: { label: "Masuk", hakLihat: null },
  pengguna: { label: "Pengguna & peran", hakLihat: "pengguna.kelola" },
  pengaturan: { label: "Pengaturan", hakLihat: null },
  perusahaan: { label: "Perusahaan", hakLihat: null },
  "antar-perusahaan": { label: "Transaksi antar perusahaan", hakLihat: "antar-perusahaan.lihat" },
  penjualan: { label: "Dokumen penjualan", hakLihat: null },
  dokumen: { label: "Cetak & PDF dokumen", hakLihat: null },
  crm: { label: "CRM", hakLihat: "lead.lihat" },
  konten: { label: "Konten media sosial", hakLihat: "konten.lihat" },
  "tugas-desain": { label: "Tugas desain", hakLihat: "tugas-desain.lihat" },
  kampanye: { label: "Iklan", hakLihat: "kampanye.lihat" },
  proyek: { label: "Proyek", hakLihat: "data-induk.lihat" },
  "anggaran-proyek": { label: "Anggaran proyek", hakLihat: "anggaran-proyek.lihat" },
  "bagi-hasil": { label: "Mitra & bagi hasil", hakLihat: "bagi-hasil.lihat" },
  berkas: { label: "Berkas", hakLihat: "berkas.lihat" },
};

export const DAFTAR_MODUL_LOG = Object.keys(MODUL_LOG) as ModulLog[];

/** Label catatan tanpa modul (catatan lama, akuntansi dan umum). */
export const LABEL_LOG_TANPA_MODUL = "Akuntansi & umum";

export function modulLogSah(nilai: string): nilai is ModulLog {
  return (DAFTAR_MODUL_LOG as readonly string[]).includes(nilai);
}

export const PANJANG_NOMOR_LOG = 120;
export const PANJANG_KETERANGAN_LOG = 500;

const potong = (teks: string, batas: number) => (teks.length > batas ? teks.slice(0, batas) : teks);

/** Pelaku log: pengguna sesi atau ringkasan { id, nama }. Pengguna semu skrip uji ditulis tanpa penggunaId. */
export type PelakuLog = { id: string; nama: string } | PenggunaSesi;

export type DataLog = {
  aksi: string;
  jenis: string;
  nomor: string;
  keterangan?: string | null;
  modul: ModulLog;
  entitasId?: string | null;
  meta?: Prisma.InputJsonValue;
  perusahaanId?: string | null;
};

/** Pencatat log baru (D7 §3.7.1). Panggil dengan tx yang sama dengan perubahan datanya. */
export async function catatAktivitas(klien: KlienDb, pelaku: PelakuLog, data: DataLog): Promise<void> {
  await klien.logAktivitas.create({
    data: {
      penggunaId: pelaku.id === "skrip-uji" ? null : pelaku.id,
      penggunaNama: pelaku.nama,
      aksi: data.aksi,
      jenis: data.jenis,
      nomor: potong(data.nomor, PANJANG_NOMOR_LOG),
      keterangan: data.keterangan == null ? null : potong(data.keterangan, PANJANG_KETERANGAN_LOG),
      modul: data.modul,
      entitasId: data.entitasId ?? null,
      meta: data.meta,
      perusahaanId: data.perusahaanId ?? null,
    },
  });
}

/**
 * Catatan masuk berhasil (D7 §3.7.3), dipanggil aksi `masuk` setelah sesi dibuat. Galat pencatatan tidak
 * pernah menggagalkan masuk: ditangkap, dicetak ke log server, lalu fungsi mengembalikan false.
 */
export async function catatMasuk(klien: KlienDb, pengguna: { id: string; nama: string; namaPengguna: string }): Promise<boolean> {
  try {
    await catatAktivitas(klien, pengguna, { aksi: "MASUK", jenis: "Sesi", nomor: pengguna.namaPengguna, keterangan: "Masuk berhasil", modul: "auth" });
    return true;
  } catch (galat) {
    console.error("Gagal mencatat log masuk", galat);
    return false;
  }
}

/**
 * Folder dan proyek berkas yang tersembunyi bagi pengguna (null = akses penuh). Dibentuk ruangTersembunyi di
 * src/lib/berkas.ts (P06); sampai berkas tersedia, pemanggil mengirim null.
 */
export type RuangTersembunyi = { folder: string[]; proyek: string[] } | null;

/**
 * Syarat Prisma catatan log yang boleh dilihat pengguna (D7 §3.7.4). Cabang { modul: null } wajib ada: tanpa itu
 * "modul" IN (...) membuang semua catatan lama. Baris berkas selalu punya meta.folder dan meta.proyekId, jadi
 * perbandingan path JSON tidak pernah bernilai NULL.
 */
export function syaratLogTerlihat(pengguna: PenggunaSesi, ruang: RuangTersembunyi): Prisma.LogAktivitasWhereInput {
  const boleh = DAFTAR_MODUL_LOG.filter((m) => {
    const h = MODUL_LOG[m].hakLihat;
    return !h || punyaHak(pengguna, h);
  });
  const syaratBerkas: Prisma.LogAktivitasWhereInput[] = ruang
    ? [...ruang.folder.map((f) => ({ NOT: { meta: { path: ["folder"], equals: f } } })), ...ruang.proyek.map((p) => ({ NOT: { meta: { path: ["proyekId"], equals: p } } }))]
    : [];
  return {
    OR: [
      { modul: null },
      { modul: { in: boleh.filter((m) => m !== "berkas") } },
      ...(boleh.includes("berkas") ? [{ AND: [{ modul: "berkas" }, ...syaratBerkas] }] : []),
    ],
  };
}

/** Lingkup log: satu perusahaan = catatan perusahaan itu ditambah catatan tingkat sistem (perusahaanId null). */
export function saringLogLingkup(perusahaanId: string | null): Prisma.LogAktivitasWhereInput {
  return perusahaanId ? { OR: [{ perusahaanId }, { perusahaanId: null }] } : {};
}

/*
 * Warna lencana aksi. Catatan tanpa modul memakai pemetaan panel Sistem DF5 (BUAT hijau, UBAH biru, HAPUS merah,
 * lainnya abu-abu). Catatan bermodul memakai pemetaan D7 §7.11, dengan BUAT tetap hijau seperti DF5.
 * Halaman Log Aktivitas sendiri tetap memakai lencana rose untuk catatan tanpa modul (tampilan lama).
 */
const WARNA_AKSI_TANPA_MODUL: Record<string, string> = { BUAT: "lencana-emerald", UBAH: "lencana-blue", HAPUS: "lencana-rose" };
const WARNA_AKSI_MODUL: Record<string, string> = {
  HAPUS: "lencana-rose",
  BUANG: "lencana-rose",
  HAPUS_PERMANEN: "lencana-rose",
  TOLAK: "lencana-rose",
  CABUT: "lencana-rose",
  ARSIP: "lencana-rose",
  ARSIPKAN: "lencana-rose",
  BUAT: "lencana-emerald",
  SETUJUI: "lencana-emerald",
  PULIHKAN: "lencana-emerald",
  AJUKAN: "lencana-amber",
  REVISI: "lencana-amber",
  STATUS: "lencana-amber",
  TUGASKAN: "lencana-amber",
  MASUK: "lencana-slate",
  UNGGAH: "lencana-slate",
  UNDUH: "lencana-slate",
  BAGIKAN: "lencana-slate",
};

/** Kelas lencana lengkap ("lencana lencana-...") untuk aksi log. */
export function gayaAksiLog(aksi: string, modul: string | null): string {
  const warna = modul ? (WARNA_AKSI_MODUL[aksi] ?? "lencana-blue") : (WARNA_AKSI_TANPA_MODUL[aksi] ?? "lencana-slate");
  return `lencana ${warna}`;
}

/** Label modul untuk tampilan; nilai yang tidak dikenal ditampilkan apa adanya. */
export function labelModulLog(modul: string | null): string {
  if (modul === null) return LABEL_LOG_TANPA_MODUL;
  return modulLogSah(modul) ? MODUL_LOG[modul].label : modul;
}

// ---------- Saringan halaman Pengaturan › Log Aktivitas (D7 §3.7.5) ----------

/** Nilai isian khusus: catatan tanpa modul, tanpa akun pengguna, dan tingkat sistem (tanpa perusahaan). */
export const NILAI_MODUL_UMUM = "umum";
export const NILAI_TANPA_AKUN = "tanpa-akun";
export const NILAI_TINGKAT_SISTEM = "sistem";

export type SaringanLog = {
  /** null = semua modul, NILAI_MODUL_UMUM = catatan tanpa modul */
  modul: ModulLog | typeof NILAI_MODUL_UMUM | null;
  aksi: string | null;
  /** id pengguna, NILAI_TANPA_AKUN, atau null (semua) */
  pengguna: string | null;
  /** id perusahaan, NILAI_TINGKAT_SISTEM, atau null (semua) */
  perusahaan: string | null;
  /** YYYY-MM-DD */
  dari: string | null;
  sampai: string | null;
};

type ParamMentah = Record<string, string | string[] | undefined>;

const ambilTeks = (p: ParamMentah, k: string): string | null => {
  const v = Array.isArray(p[k]) ? p[k][0] : p[k];
  const t = typeof v === "string" ? v.trim() : "";
  return t ? t : null;
};
const tanggalSah = (v: string | null): string | null => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) && bacaWaktuLokal(`${v}T00:00`) ? v : null);

/** Membaca saringan dari query string. Nilai yang tidak sah diabaikan (dianggap tanpa saringan). */
export function bacaSaringanLog(p: ParamMentah): SaringanLog {
  const modul = ambilTeks(p, "modul");
  return {
    modul: modul === NILAI_MODUL_UMUM || (modul && modulLogSah(modul)) ? (modul as SaringanLog["modul"]) : null,
    aksi: ambilTeks(p, "aksi"),
    pengguna: ambilTeks(p, "pengguna"),
    perusahaan: ambilTeks(p, "perusahaan"),
    dari: tanggalSah(ambilTeks(p, "dari")),
    sampai: tanggalSah(ambilTeks(p, "sampai")),
  };
}

/** Benar bila ada satu saja saringan yang aktif. */
export function adaSaringanLog(s: SaringanLog): boolean {
  return Object.values(s).some((v) => v !== null);
}

/** Parameter query saringan untuk dipertahankan paginasi dan pencarian (KontrolDaftar.tambahan). */
export function paramSaringanLog(s: SaringanLog): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v ?? undefined]));
}

/** Syarat Prisma dari saringan. Tanpa saringan = {} (semua catatan). Hari dibaca di zona waktu usaha. */
export function syaratSaringanLog(s: SaringanLog): Prisma.LogAktivitasWhereInput {
  const syarat: Prisma.LogAktivitasWhereInput[] = [];
  if (s.modul) syarat.push({ modul: s.modul === NILAI_MODUL_UMUM ? null : s.modul });
  if (s.aksi) syarat.push({ aksi: s.aksi });
  if (s.pengguna) syarat.push({ penggunaId: s.pengguna === NILAI_TANPA_AKUN ? null : s.pengguna });
  if (s.perusahaan) syarat.push({ perusahaanId: s.perusahaan === NILAI_TINGKAT_SISTEM ? null : s.perusahaan });
  if (s.dari) syarat.push({ waktu: { gte: bacaWaktuLokal(`${s.dari}T00:00`)! } });
  if (s.sampai) {
    // batas atas = awal hari berikutnya (eksklusif), supaya seluruh hari "sampai" ikut
    const [th, bl, tg] = s.sampai.split("-").map(Number);
    const besok = new Date(Date.UTC(th, bl - 1, tg + 1)).toISOString().slice(0, 10);
    syarat.push({ waktu: { lt: bacaWaktuLokal(`${besok}T00:00`)! } });
  }
  return syarat.length ? { AND: syarat } : {};
}
