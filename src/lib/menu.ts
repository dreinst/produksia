import type { PeranPengguna } from "@/prisma-klien/enums";
import { punyaHak, type Hak, type PenggunaSesi } from "@/lib/hakAkses";

/*
 * Data menu bilah samping, tanpa basis data dan tanpa React (dipakai BilahSamping.tsx dan skrip/uji-menu.ts).
 * Paket yang menambah halaman memasang entri menunya di sini bersamaan dengan halamannya; uji-menu.ts menolak
 * tautan yang rutenya belum ada dan perubahan menu peran lama yang tidak tercatat.
 * Penyaringan di sini hanya menyembunyikan tautan; pengaman sesungguhnya tetap wajibHak di tiap halaman.
 */

/** Jenis dokumen yang sudah tersambung ke alur persetujuan (lihat BERKAS di src/lib/persetujuan.ts). */
export const DOKUMEN_PERSETUJUAN = ["faktur", "faktur-pembelian", "kas-masuk", "kas-keluar", "penyesuaian", "peminjaman", "kerusakan", "aset", "penggajian"] as const;

export type TautanNavigasi = { href: string; label: string; kode?: string; hak: Hak; ikon?: string };
export type Grup = { judul: string; ikon: string; tautan: TautanNavigasi[] };
export type TautanBerikon = TautanNavigasi & { ikon: string };
/** Tautan tunggal di blok atas (Beranda, Persetujuan, ...): syarat tampilnya tidak selalu satu kunci hak. */
export type TautanAtas = { href: string; label: string; ikon: string; boleh: (pengguna: PenggunaSesi) => boolean };

export const GRUP_OPERASIONAL: Grup[] = [
  {
    judul: "Penjualan",
    ikon: "point_of_sale",
    tautan: [
      { href: "/penjualan/penawaran", label: "Penawaran", kode: "PNW", hak: "penawaran.lihat" },
      { href: "/penjualan/pesanan", label: "Pesanan", kode: "PSJ", hak: "pesanan.lihat" },
      { href: "/penjualan/uang-muka", label: "Uang Muka", kode: "UM", hak: "uang-muka.lihat" },
      { href: "/penjualan/pengiriman", label: "Pengiriman", kode: "SJ", hak: "pengiriman.lihat" },
      { href: "/penjualan/faktur", label: "Faktur Penjualan", kode: "FJ", hak: "faktur.lihat" },
      { href: "/penjualan/penerimaan", label: "Penerimaan", kode: "TRM", hak: "penerimaan.lihat" },
      { href: "/penjualan/retur", label: "Retur Penjualan", kode: "RJ", hak: "retur-penjualan.lihat" },
    ],
  },
  // CRM (D4 §7.1, D7 §7.8, DESAIN R2/R3): Pengaturan CRM ada di tautan pengaturan, bukan di grup ini
  {
    judul: "CRM",
    ikon: "handshake",
    tautan: [
      { href: "/crm/dasbor", label: "Dasbor CRM", hak: "lead.lihat" },
      { href: "/crm/lead", label: "Lead", hak: "lead.lihat" },
      { href: "/crm/pipeline", label: "Pipeline", hak: "lead.lihat" },
      { href: "/crm/tindak-lanjut", label: "Tindak Lanjut", hak: "lead.lihat" },
    ],
  },
  // Pemasaran (D6 §7.1, D7 §7.8, DESAIN R4): Konten dan Desain dipasang P42
  {
    judul: "Pemasaran",
    ikon: "campaign",
    tautan: [
      { href: "/pemasaran/konten", label: "Konten", hak: "konten.lihat" },
      { href: "/pemasaran/desain", label: "Desain", hak: "tugas-desain.lihat" },
    ],
  },
  {
    judul: "Pembelian",
    ikon: "shopping_bag",
    tautan: [
      { href: "/pembelian/pesanan", label: "Pesanan", kode: "PSB", hak: "pesanan-pembelian.lihat" },
      { href: "/pembelian/penerimaan-barang", label: "Penerimaan Barang", kode: "TB", hak: "penerimaan-barang.lihat" },
      { href: "/pembelian/faktur", label: "Faktur Pembelian", kode: "FB", hak: "faktur-pembelian.lihat" },
      { href: "/pembelian/pembayaran", label: "Pembayaran", kode: "BYR", hak: "pembayaran.lihat" },
      { href: "/pembelian/retur", label: "Retur Pembelian", kode: "RB", hak: "retur-pembelian.lihat" },
    ],
  },
  {
    judul: "Kas & Bank",
    ikon: "account_balance",
    tautan: [
      { href: "/kas-bank/masuk", label: "Kas Masuk", kode: "KM", hak: "kas-masuk.lihat" },
      { href: "/kas-bank/keluar", label: "Kas Keluar", kode: "KK", hak: "kas-keluar.lihat" },
      { href: "/kas-bank/prive", label: "Prive", kode: "PRV", hak: "prive.lihat" },
    ],
  },
  {
    judul: "Buku Besar",
    ikon: "menu_book",
    tautan: [
      { href: "/buku-besar/jurnal", label: "Jurnal Umum", kode: "JU", hak: "jurnal.lihat" },
      { href: "/buku-besar/antar-perusahaan", label: "Transaksi Antar Perusahaan", kode: "AP", hak: "antar-perusahaan.lihat" },
      { href: "/buku-besar/mutasi", label: "Buku Besar Mutasi", hak: "buku-besar.lihat" },
      { href: "/buku-besar/tutup-buku", label: "Tutup Buku", kode: "TUTUP", hak: "buku-besar.lihat" },
    ],
  },
  {
    judul: "Laporan",
    ikon: "monitoring",
    tautan: [
      { href: "/buku-besar/neraca-saldo", label: "Neraca Saldo", hak: "buku-besar.lihat" },
      { href: "/laporan/piutang", label: "Laporan Piutang", hak: "buku-besar.lihat" },
      { href: "/laporan/hutang", label: "Laporan Hutang", hak: "buku-besar.lihat" },
      { href: "/buku-besar/neraca", label: "Neraca", hak: "buku-besar.lihat" },
      { href: "/buku-besar/laba-rugi", label: "Laba Rugi (per event / per waktu)", hak: "buku-besar.lihat" },
      { href: "/laporan/pendapatan", label: "Ringkasan Pendapatan", hak: "buku-besar.lihat" },
      { href: "/laporan/perubahan-modal", label: "Perubahan Modal", hak: "buku-besar.lihat" },
      { href: "/laporan/prive", label: "Laporan Prive", hak: "buku-besar.lihat" },
      { href: "/buku-besar/arus-kas", label: "Arus Kas", hak: "buku-besar.lihat" },
      { href: "/buku-besar/pajak", label: "Pajak & SPT", hak: "buku-besar.lihat" },
    ],
  },
  {
    judul: "Rekonsiliasi",
    ikon: "fact_check",
    tautan: [
      { href: "/rekonsiliasi", label: "Rekonsiliasi Event (LPJ)", kode: "LPJ", hak: "rekonsiliasi.lihat" },
      { href: "/rekonsiliasi/kas-bank", label: "Rekonsiliasi Kas/Bank", hak: "rekonsiliasi.lihat" },
      { href: "/rekonsiliasi/mutasi", label: "Impor Mutasi Rekening", kode: "CSV", hak: "rekonsiliasi.tulis" },
    ],
  },
  {
    judul: "Aset Tetap",
    ikon: "domain",
    tautan: [
      { href: "/aset-tetap", label: "Daftar Aset", hak: "aset.lihat" },
      { href: "/aset-tetap/penyusutan", label: "Hitung Penyusutan", kode: "PNY", hak: "penyusutan.lihat" },
    ],
  },
  {
    judul: "SDM",
    ikon: "group",
    tautan: [
      { href: "/data-induk/karyawan", label: "Karyawan", hak: "sdm.lihat" },
      { href: "/data-induk/departemen", label: "Departemen", hak: "sdm.lihat" },
      { href: "/sdm/penggajian", label: "Penggajian", kode: "GJ", hak: "penggajian.lihat" },
    ],
  },
];

export const GRUP_PERSEDIAAN: Grup = {
  judul: "Persediaan",
  ikon: "inventory_2",
  tautan: [
    { href: "/persediaan", label: "Stok per Gudang", hak: "persediaan.lihat" },
    { href: "/persediaan/penyesuaian", label: "Penyesuaian Stok", kode: "PS", hak: "penyesuaian.lihat" },
    { href: "/persediaan/pindah", label: "Pindah Barang", kode: "PB", hak: "pindah-barang.lihat" },
    { href: "/persediaan/peminjaman", label: "Peminjaman Barang", kode: "PJ", hak: "peminjaman.lihat" },
    { href: "/persediaan/kerusakan", label: "Laporan Kerusakan Barang", kode: "BR", hak: "kerusakan.lihat" },
  ],
};

export const GRUP_DATA_INDUK: Grup = {
  judul: "Data Induk",
  ikon: "dataset",
  tautan: [
    { href: "/data-induk/pelanggan", label: "Pelanggan", hak: "data-induk.lihat" },
    { href: "/data-induk/pemasok", label: "Pemasok", hak: "data-induk.lihat" },
    { href: "/data-induk/barang", label: "Barang & Jasa", hak: "stok-induk.lihat" },
    { href: "/data-induk/kelompok-barang", label: "Kategori Barang", hak: "stok-induk.lihat" },
    { href: "/data-induk/gudang", label: "Gudang", hak: "stok-induk.lihat" },
    { href: "/data-induk/akun", label: "Bagan Akun", hak: "data-induk.lihat" },
    { href: "/data-induk/proyek", label: "Proyek", hak: "data-induk.lihat" },
  ],
};

export const TAUTAN_PENGATURAN: TautanBerikon[] = [
  { href: "/pengaturan/perusahaan", label: "Perusahaan & Pajak", ikon: "domain", hak: "pengaturan.tulis" },
  { href: "/pengaturan/pemetaan-akun", label: "Pemetaan Akun", ikon: "tune", hak: "pemetaan.tulis" },
  { href: "/pengaturan/kategori-anggaran", label: "Kategori Anggaran Proyek", ikon: "category", hak: "kategori-anggaran.ubah" },
  { href: "/pengaturan/mata-uang", label: "Mata Uang & Kurs", ikon: "payments", hak: "pengaturan.tulis" },
  { href: "/pengaturan/bagan-akun", label: "Bagan Akun Standar", ikon: "account_tree", hak: "pengaturan.tulis" },
  { href: "/pengaturan/pengguna", label: "Pengguna", ikon: "group", hak: "pengguna.kelola" },
  { href: "/pengaturan/hak-akses", label: "Hak Akses", ikon: "shield", hak: "hak-akses.kelola" },
  { href: "/pengaturan/log-aktivitas", label: "Log Aktivitas", ikon: "history", hak: "log-aktivitas.lihat" },
  { href: "/crm/pengaturan", label: "Pengaturan CRM", ikon: "handshake", hak: "pengaturan-crm.ubah" },
  { href: "/pengaturan/berkas", label: "Akses Berkas", ikon: "lock", hak: "berkas.akses-penuh" },
];

/**
 * Gudang, Kru & Guest tidak melihat Beranda dan kotak masuk Persetujuan: perannya murni operasional (Gudang:
 * input/output stok; Kru/Guest: hanya ajukan peminjaman), dan persetujuan Kru/Guest sendiri sudah ada langsung
 * di halaman Peminjaman Barang. Yang dinilai hanya peran utama.
 */
export const PERAN_TANPA_BERANDA: ReadonlySet<PeranPengguna> = new Set<PeranPengguna>(["GUDANG", "KRU", "GUEST"]);

export function bolehBeranda(pengguna: PenggunaSesi): boolean {
  return !PERAN_TANPA_BERANDA.has(pengguna.peran);
}

/** Kotak masuk persetujuan tampil bagi siapa pun yang boleh membuat atau menyetujui dokumen yang ikut alur itu (kecuali PERAN_TANPA_BERANDA). */
export function bolehPersetujuan(pengguna: PenggunaSesi): boolean {
  return bolehBeranda(pengguna) && DOKUMEN_PERSETUJUAN.some((k) => punyaHak(pengguna, `${k}.buat` as Hak) || punyaHak(pengguna, `${k}.setujui` as Hak));
}

/** Blok tautan tunggal paling atas, urut tampil. */
export const TAUTAN_ATAS: TautanAtas[] = [
  { href: "/", label: "Beranda", ikon: "space_dashboard", boleh: bolehBeranda },
  { href: "/persetujuan", label: "Persetujuan", ikon: "verified", boleh: bolehPersetujuan },
  { href: "/berkas", label: "Berkas", ikon: "folder", boleh: (p) => punyaHak(p, "berkas.lihat") },
  { href: "/proyek", label: "Proyek & Event", ikon: "event_note", boleh: (p) => punyaHak(p, "proyek.lihat") },
];

/** Menyaring grup & tautan sesuai hak; grup tanpa tautan tersisa dibuang. */
export function saringGrup(daftar: readonly Grup[], pengguna: PenggunaSesi): Grup[] {
  return daftar
    .map((g) => ({ ...g, tautan: g.tautan.filter((l) => punyaHak(pengguna, l.hak)) }))
    .filter((g) => g.tautan.length > 0);
}

export type MenuTerlihat = {
  /** Beranda, Persetujuan, dan tautan tunggal atas lain yang boleh. */
  atas: TautanAtas[];
  /** Bagian "Operasional". */
  operasional: Grup[];
  /** Grup di bagian "Administrasi & Pengaturan" (Persediaan, Data Induk). */
  administrasi: Grup[];
  /** Tautan tunggal di bawah grup administrasi. */
  pengaturan: TautanBerikon[];
};

/** Menu yang dirender untuk pengguna ini: tautan tanpa hak dan grup kosong sudah dibuang. */
export function menuTerlihat(pengguna: PenggunaSesi): MenuTerlihat {
  return {
    atas: TAUTAN_ATAS.filter((t) => t.boleh(pengguna)),
    operasional: saringGrup(GRUP_OPERASIONAL, pengguna),
    administrasi: saringGrup([GRUP_PERSEDIAAN, GRUP_DATA_INDUK], pengguna),
    pengaturan: TAUTAN_PENGATURAN.filter((l) => punyaHak(pengguna, l.hak)),
  };
}

/** Semua href di data menu (tanpa penyaringan hak), untuk pemeriksaan rute. */
export function semuaHrefMenu(): string[] {
  return [
    ...TAUTAN_ATAS.map((t) => t.href),
    ...[...GRUP_OPERASIONAL, GRUP_PERSEDIAAN, GRUP_DATA_INDUK].flatMap((g) => g.tautan.map((l) => l.href)),
    ...TAUTAN_PENGATURAN.map((l) => l.href),
  ];
}

/**
 * Penanda tautan aktif: cocok bila path sama dengan href atau berada di bawahnya. Pengecualian untuk href yang
 * menjadi awalan rute milik tautan lain (/aset-tetap vs /aset-tetap/penyusutan, /rekonsiliasi vs /rekonsiliasi/kas-bank,
 * /proyek vs /proyek/keuangan dan /proyek/{id}/keuangan milik Keuangan Proyek, D5 §7.6).
 */
export function aktifDi(href: string, pathname: string): boolean {
  if (href === "/proyek") return pathname === "/proyek" || (/^\/proyek\/[^/]+$/.test(pathname) && pathname !== "/proyek/keuangan");
  if (href === "/aset-tetap") return pathname === "/aset-tetap" || pathname === "/aset-tetap/baru" || /^\/aset-tetap\/[^/]+\/lepas$/.test(pathname);
  if (href === "/rekonsiliasi") return pathname === "/rekonsiliasi" || pathname.startsWith("/rekonsiliasi/event");
  return pathname === href || pathname.startsWith(href + "/");
}
