import type {
  AksiRiwayatKonten,
  GenderAudiens,
  KeputusanRevisiDesain,
  PlatformKonten,
  PrioritasDesain,
  StatusKampanye,
  StatusKonten,
  StatusPersetujuanKonten,
  StatusTugasDesain,
  TujuanKampanye,
} from "@/prisma-klien/enums";

/*
 * Label, urutan, dan warna lencana modul Pemasaran (D6 §7.12). Sumber tunggal untuk panel beranda, halaman, dan
 * komponen. Tanpa impor db, jadi aman untuk komponen klien. Kelas lencana memakai `lencana lencana-<warna>` yang sudah
 * ada di globals.css.
 */

export type WarnaLencana = "slate" | "blue" | "cyan" | "amber" | "emerald" | "indigo" | "rose";
export type GayaLabel = { label: string; warna: WarnaLencana };

/** Hari sebelum tanggal terbit yang dipakai sebagai tenggat bawaan tugas desain dari konten (D6 §3.1.5). */
export const HARI_TENGGAT_DESAIN = 2;

export const URUTAN_STATUS_KONTEN: readonly StatusKonten[] = ["IDE", "DRAF", "DESAIN", "DITINJAU", "DISETUJUI", "TERJADWAL", "TERBIT"];
export const STATUS_KONTEN: Record<StatusKonten, GayaLabel> = {
  IDE: { label: "Ide", warna: "slate" },
  DRAF: { label: "Draf", warna: "slate" },
  DESAIN: { label: "Desain", warna: "blue" },
  DITINJAU: { label: "Ditinjau", warna: "amber" },
  DISETUJUI: { label: "Disetujui", warna: "emerald" },
  TERJADWAL: { label: "Terjadwal", warna: "cyan" },
  TERBIT: { label: "Terbit", warna: "indigo" },
};

/** TIDAK_ADA tidak ditampilkan sebagai lencana. */
export const STATUS_PERSETUJUAN_KONTEN: Record<StatusPersetujuanKonten, GayaLabel | null> = {
  TIDAK_ADA: null,
  MENUNGGU: { label: "Menunggu persetujuan", warna: "amber" },
  DISETUJUI: { label: "Disetujui", warna: "emerald" },
  DITOLAK: { label: "Ditolak", warna: "rose" },
};

export const AKSI_RIWAYAT_KONTEN: Record<AksiRiwayatKonten, GayaLabel> = {
  DIAJUKAN: { label: "Diajukan", warna: "blue" },
  DISETUJUI: { label: "Disetujui", warna: "emerald" },
  DITOLAK: { label: "Ditolak", warna: "rose" },
  DITARIK: { label: "Ditarik", warna: "slate" },
};

export const URUTAN_PLATFORM: readonly PlatformKonten[] = ["INSTAGRAM", "FACEBOOK", "TIKTOK", "THREADS"];
export const LABEL_PLATFORM: Record<PlatformKonten, string> = { INSTAGRAM: "Instagram", FACEBOOK: "Facebook", TIKTOK: "TikTok", THREADS: "Threads" };
/** Warna titik platform di kalender dan kanban. */
export const TITIK_PLATFORM: Record<PlatformKonten, string> = { INSTAGRAM: "bg-pink-500", FACEBOOK: "bg-blue-600", TIKTOK: "bg-slate-900", THREADS: "bg-slate-400" };

export const URUTAN_STATUS_DESAIN: readonly StatusTugasDesain[] = ["PERMINTAAN", "DITUGASKAN", "DIKERJAKAN", "DITINJAU", "REVISI", "DISETUJUI", "SELESAI"];
export const STATUS_DESAIN: Record<StatusTugasDesain, GayaLabel> = {
  PERMINTAAN: { label: "Permintaan", warna: "slate" },
  DITUGASKAN: { label: "Ditugaskan", warna: "blue" },
  DIKERJAKAN: { label: "Dikerjakan", warna: "cyan" },
  DITINJAU: { label: "Ditinjau", warna: "amber" },
  REVISI: { label: "Revisi", warna: "rose" },
  DISETUJUI: { label: "Disetujui", warna: "emerald" },
  SELESAI: { label: "Selesai", warna: "indigo" },
};

export const URUTAN_PRIORITAS: readonly PrioritasDesain[] = ["RENDAH", "SEDANG", "TINGGI", "MENDESAK"];
export const PRIORITAS_DESAIN: Record<PrioritasDesain, GayaLabel> = {
  RENDAH: { label: "Rendah", warna: "slate" },
  SEDANG: { label: "Sedang", warna: "blue" },
  TINGGI: { label: "Tinggi", warna: "amber" },
  MENDESAK: { label: "Mendesak", warna: "rose" },
};

export const KEPUTUSAN_REVISI: Record<KeputusanRevisiDesain, GayaLabel> = {
  DISETUJUI: { label: "Disetujui", warna: "emerald" },
  MINTA_REVISI: { label: "Minta revisi", warna: "amber" },
};

export const URUTAN_TUJUAN: readonly TujuanKampanye[] = ["KESADARAN", "TRAFFIC", "INTERAKSI", "PROSPEK", "PROMOSI_APLIKASI", "PENJUALAN"];
export const LABEL_TUJUAN: Record<TujuanKampanye, string> = {
  KESADARAN: "Kesadaran",
  TRAFFIC: "Traffic",
  INTERAKSI: "Interaksi",
  PROSPEK: "Prospek (leads)",
  PROMOSI_APLIKASI: "Promosi aplikasi",
  PENJUALAN: "Penjualan",
};

export const URUTAN_STATUS_KAMPANYE: readonly StatusKampanye[] = ["DIRENCANAKAN", "AKTIF", "DIJEDA", "SELESAI"];
export const STATUS_KAMPANYE: Record<StatusKampanye, GayaLabel> = {
  DIRENCANAKAN: { label: "Direncanakan", warna: "slate" },
  AKTIF: { label: "Aktif", warna: "emerald" },
  DIJEDA: { label: "Dijeda", warna: "amber" },
  SELESAI: { label: "Selesai", warna: "indigo" },
};

export const LABEL_GENDER: Record<GenderAudiens, string> = { SEMUA: "Semua", PEREMPUAN: "Perempuan", LAKI_LAKI: "Laki-laki" };

/** Daftar pilihan bawaan bila perusahaan belum punya baris PengaturanPemasaran (D6 §7.9). */
export const JENIS_KONTEN_BAWAAN: readonly string[] = ["Feed", "Carousel", "Reels", "Story", "Video", "Thread"];
export const PILAR_KONTEN_BAWAAN: readonly string[] = ["Edukasi", "Promosi", "Engagement", "Brand Awareness", "Testimoni"];

/** Kelas CSS lencana untuk satu warna. */
export function kelasLencana(warna: WarnaLencana): string {
  return `lencana lencana-${warna}`;
}

/** Warna isi batang (BatangStatus) yang sejalan dengan warna lencana. */
export const KELAS_BATANG: Record<WarnaLencana, string> = {
  slate: "bg-slate-400",
  blue: "bg-blue-600",
  cyan: "bg-cyan-600",
  amber: "bg-amber-500",
  emerald: "bg-emerald-600",
  indigo: "bg-indigo-600",
  rose: "bg-rose-500",
};

/** Komponen Kanban D4 hanya mengenal lima nada: cyan menjadi blue dan indigo menjadi emerald. */
export function nadaKanban(warna: WarnaLencana): "blue" | "emerald" | "rose" | "amber" | "slate" {
  if (warna === "cyan") return "blue";
  if (warna === "indigo") return "emerald";
  return warna;
}
