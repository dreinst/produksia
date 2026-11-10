import type { Hak, PenggunaSesi } from "@/lib/hakAkses";

/*
 * Tab beranda (D7 §3.5). Murni: tanpa db, jadi aman diimpor halaman, komponen, dan skrip uji.
 * Tab ditentukan dari hak efektif pengguna, bukan dari nama peran, supaya peran yang disesuaikan
 * di Pengaturan › Hak Akses ikut mendapat tab modul yang haknya ia pegang.
 */

export type TabBeranda = "keuangan" | "saya" | "penjualan" | "pemasaran" | "proyek" | "sistem";

export type DefinisiTab = {
  kode: TabBeranda;
  label: string;
  /** Tampil bila pengguna memegang salah satu hak ini (kosong = tidak disyaratkan). */
  salahSatu: readonly Hak[];
  /** Tampil hanya bila pengguna memegang semua hak ini (kosong = tidak disyaratkan). */
  semua: readonly Hak[];
  /** false = panelnya belum dibangun; tab tidak pernah muncul walau haknya ada. */
  tersedia: boolean;
};

/** Urutan tetap (D7 §3.5 no. 2). Tab bawaan = tab pertama yang boleh. */
export const TAB_BERANDA: readonly DefinisiTab[] = [
  { kode: "keuangan", label: "Keuangan", salahSatu: ["beranda-keuangan.lihat"], semua: [], tersedia: true },
  { kode: "saya", label: "Tugas Saya", salahSatu: ["lead.ubah", "konten.ubah", "tugas-desain.ubah"], semua: [], tersedia: true },
  { kode: "penjualan", label: "Penjualan & CRM", salahSatu: ["lead.lihat"], semua: [], tersedia: true },
  // Tab proyek memuat angka keuangan proyek, jadi dijaga anggaran-proyek.lihat (HAK.md), bukan proyek.lihat yang
  // juga dipegang KASIR, SOSMED, IKLAN, dan DESAINER (daftar proyek tanpa angka keuangan).
  { kode: "pemasaran", label: "Pemasaran", salahSatu: ["konten.lihat", "tugas-desain.lihat", "kampanye.lihat"], semua: [], tersedia: true },
  { kode: "proyek", label: "Keuangan Proyek", salahSatu: ["anggaran-proyek.lihat"], semua: [], tersedia: true },
  { kode: "sistem", label: "Sistem", salahSatu: [], semua: ["pengguna.kelola", "log-aktivitas.lihat"], tersedia: true },
];

const KODE_TAB = new Set<string>(TAB_BERANDA.map((t) => t.kode));

export function labelTab(kode: TabBeranda): string {
  return TAB_BERANDA.find((t) => t.kode === kode)?.label ?? kode;
}

/**
 * Tab yang boleh dibuka pengguna, urut tetap. Kosong = beranda kosong. `definisi` bawaan TAB_BERANDA; uji memakai daftar
 * lain (mis. dengan tab `tersedia: false`) untuk memeriksa aturan tersedia tanpa mengubah daftar tab aplikasi.
 */
export function tabBeranda(pengguna: Pick<PenggunaSesi, "hak">, definisi: readonly DefinisiTab[] = TAB_BERANDA): TabBeranda[] {
  const boleh = (h: Hak) => pengguna.hak.includes(h);
  return definisi.filter(
    (t) => t.tersedia && (t.salahSatu.length === 0 || t.salahSatu.some(boleh)) && t.semua.every(boleh),
  ).map((t) => t.kode);
}

/** Tab aktif dari ?tab=. Nilai di luar daftar (atau tab yang tidak boleh) jatuh ke tab bawaan; null bila tidak ada tab. */
export function pilihTab(daftar: readonly TabBeranda[], nilai: string | string[] | undefined): TabBeranda | null {
  const teks = Array.isArray(nilai) ? nilai[0] : nilai;
  if (teks && KODE_TAB.has(teks) && daftar.includes(teks as TabBeranda)) return teks as TabBeranda;
  return daftar[0] ?? null;
}

/** Kalimat pembuka kartu Integritas & Sinkronisasi sebelum multi perusahaan. */
export const KALIMAT_INTEGRITAS_LAMA = "Buku besar dicocokkan dengan dokumen dan stok fisik setiap kali beranda dibuka:";

/**
 * Kalimat pembuka kartu Integritas di tab keuangan. Kalimat lama dipakai di lingkup gabungan dan bila lingkup adalah
 * satu-satunya perusahaan aktif (instalasi satu perusahaan tampil seperti sebelum peleburan). Selain itu kalimat
 * menyebut nama perusahaan lingkup. `idPerusahaanAktif` = id semua perusahaan aktif.
 */
export function kalimatIntegritas(lingkup: { perusahaanId: string | null; nama: string | null }, idPerusahaanAktif: readonly string[]): string {
  const satuSatunya = idPerusahaanAktif.length === 1 && idPerusahaanAktif[0] === lingkup.perusahaanId;
  if (lingkup.perusahaanId === null || satuSatunya) return KALIMAT_INTEGRITAS_LAMA;
  return `Buku besar ${lingkup.nama ?? "perusahaan ini"} dicocokkan dengan dokumen dan stok barang miliknya setiap kali beranda dibuka:`;
}
