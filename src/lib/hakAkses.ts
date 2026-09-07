import type { PeranPengguna } from "@/prisma-klien/enums";

/**
 * Matriks hak akses — file ini aman diimpor dari komponen klien (tidak menyentuh basis data).
 * Pemeriksaan sesungguhnya dilakukan di server: `wajibHak` (halaman) dan `wajibHakAksi` (aksi server)
 * di src/lib/otentikasi.ts. Sidebar & menu hanya memakai matriks ini untuk menyembunyikan tautan.
 */
/** Nama cookie sesi — didefinisikan di sini agar proxy.ts bisa memakainya tanpa menyeret modul basis data. */
export const NAMA_COOKIE_SESI = "sesi_ac";

export type Hak =
  | "penjualan.lihat"
  | "penjualan.tulis" // Penawaran, Pesanan, Faktur, Penerimaan, Retur
  | "penjualan.kirim" // Surat Jalan (pengiriman)
  | "pembelian.lihat"
  | "pembelian.tulis" // Pesanan, Faktur, Pembayaran, Retur
  | "pembelian.terima" // Terima Barang
  | "kas-bank.lihat"
  | "kas-bank.tulis"
  | "buku-besar.lihat"
  | "buku-besar.tulis" // Jurnal umum manual & bagan akun
  | "aset-tetap.lihat"
  | "aset-tetap.tulis"
  | "data-induk.lihat"
  | "data-induk.tulis"
  | "pengaturan.tulis" // Pemetaan akun
  | "pengguna.kelola"; // Kelola akun pengguna

export const SEMUA_HAK: readonly Hak[] = [
  "penjualan.lihat",
  "penjualan.tulis",
  "penjualan.kirim",
  "pembelian.lihat",
  "pembelian.tulis",
  "pembelian.terima",
  "kas-bank.lihat",
  "kas-bank.tulis",
  "buku-besar.lihat",
  "buku-besar.tulis",
  "aset-tetap.lihat",
  "aset-tetap.tulis",
  "data-induk.lihat",
  "data-induk.tulis",
  "pengaturan.tulis",
  "pengguna.kelola",
];

export const HAK_PERAN: Record<PeranPengguna, readonly Hak[]> = {
  PEMILIK: SEMUA_HAK,
  ADMIN: SEMUA_HAK,
  KASIR: [
    "penjualan.lihat",
    "penjualan.tulis",
    "pembelian.lihat",
    "pembelian.tulis",
    "kas-bank.lihat",
    "kas-bank.tulis",
    "buku-besar.lihat",
    "aset-tetap.lihat",
    "data-induk.lihat",
    "data-induk.tulis",
  ],
  GUDANG: ["penjualan.lihat", "penjualan.kirim", "pembelian.lihat", "pembelian.terima", "data-induk.lihat", "data-induk.tulis"],
};

export const DAFTAR_PERAN: readonly PeranPengguna[] = ["PEMILIK", "ADMIN", "KASIR", "GUDANG"];

export const LABEL_PERAN: Record<PeranPengguna, string> = {
  PEMILIK: "Pemilik",
  ADMIN: "Admin",
  KASIR: "Kasir",
  GUDANG: "Gudang",
};

export const KETERANGAN_PERAN: Record<PeranPengguna, string> = {
  PEMILIK: "Akses penuh, termasuk mengelola akun pemilik lain.",
  ADMIN: "Akses penuh ke semua modul; tidak bisa mengubah akun berperan Pemilik.",
  KASIR: "Penjualan, pembelian, kas & bank, data induk; buku besar & aset hanya lihat.",
  GUDANG: "Surat jalan, terima barang, dan data induk barang/gudang; tanpa modul keuangan.",
};

export function punyaHak(peran: PeranPengguna, hak: Hak): boolean {
  return HAK_PERAN[peran].includes(hak);
}

/** Data pengguna yang aman dibawa ke komponen klien (tanpa hash kata sandi). */
export type PenggunaSesi = {
  id: string;
  nama: string;
  email: string;
  peran: PeranPengguna;
};

export function inisialNama(nama: string): string {
  const kata = nama.trim().split(/\s+/).filter(Boolean);
  if (kata.length === 0) return "?";
  return (kata[0][0] + (kata.length > 1 ? kata[kata.length - 1][0] : "")).toUpperCase();
}
