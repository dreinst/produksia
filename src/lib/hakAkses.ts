import type { PeranPengguna } from "@/prisma-klien/enums";

/**
 * Hak akses per dokumen & per peran — file ini aman diimpor dari komponen klien (tidak menyentuh basis data).
 * Setiap jenis dokumen punya hak `lihat` / `buat` / `hapus`; hak lain (data induk, laporan, pengaturan) per modul.
 * Bawaan per peran ada di HAK_BAWAAN; Superadmin/Pemilik selalu penuh, peran lain bisa diubah di
 * Pengaturan › Hak Akses (tabel HakAksesPeran) — hasil akhirnya dihitung `hitungHak` saat sesi dibaca.
 * Pemeriksaan sesungguhnya dilakukan di server: `wajibHak` (halaman) dan `wajibHakAksi` (aksi server).
 */
/** Nama cookie sesi — didefinisikan di sini agar proxy.ts bisa memakainya tanpa menyeret modul basis data. */
export const NAMA_COOKIE_SESI = "sesi_ac";

export type ModulDokumen = "penjualan" | "pembelian" | "kas-bank" | "buku-besar" | "persediaan" | "aset-tetap";
export type AksiDokumen = "lihat" | "buat" | "hapus";

export const DOKUMEN_HAK = [
  { kode: "penawaran", label: "Penawaran Penjualan", modul: "penjualan", aksi: ["lihat", "buat", "hapus"] },
  { kode: "pesanan", label: "Pesanan Penjualan", modul: "penjualan", aksi: ["lihat", "buat", "hapus"] },
  { kode: "uang-muka", label: "Uang Muka Pelanggan", modul: "penjualan", aksi: ["lihat", "buat", "hapus"] },
  { kode: "pengiriman", label: "Surat Jalan (Pengiriman)", modul: "penjualan", aksi: ["lihat", "buat", "hapus"] },
  { kode: "faktur", label: "Faktur Penjualan", modul: "penjualan", aksi: ["lihat", "buat", "hapus"] },
  { kode: "penerimaan", label: "Penerimaan Penjualan", modul: "penjualan", aksi: ["lihat", "buat", "hapus"] },
  { kode: "retur-penjualan", label: "Retur Penjualan", modul: "penjualan", aksi: ["lihat", "buat", "hapus"] },
  { kode: "pesanan-pembelian", label: "Pesanan Pembelian", modul: "pembelian", aksi: ["lihat", "buat", "hapus"] },
  { kode: "penerimaan-barang", label: "Terima Barang", modul: "pembelian", aksi: ["lihat", "buat", "hapus"] },
  { kode: "faktur-pembelian", label: "Faktur Pembelian", modul: "pembelian", aksi: ["lihat", "buat", "hapus"] },
  { kode: "pembayaran", label: "Pembayaran Pembelian", modul: "pembelian", aksi: ["lihat", "buat", "hapus"] },
  { kode: "retur-pembelian", label: "Retur Pembelian", modul: "pembelian", aksi: ["lihat", "buat", "hapus"] },
  { kode: "kas-masuk", label: "Kas Masuk", modul: "kas-bank", aksi: ["lihat", "buat", "hapus"] },
  { kode: "kas-keluar", label: "Kas Keluar", modul: "kas-bank", aksi: ["lihat", "buat", "hapus"] },
  { kode: "jurnal", label: "Jurnal Umum (manual)", modul: "buku-besar", aksi: ["lihat", "buat", "hapus"] },
  { kode: "tutup-buku", label: "Tutup Buku Tahunan", modul: "buku-besar", aksi: ["buat"] },
  { kode: "pph-final", label: "PPh Final Bulanan", modul: "buku-besar", aksi: ["buat", "hapus"] },
  { kode: "penyesuaian", label: "Penyesuaian Stok", modul: "persediaan", aksi: ["lihat", "buat", "hapus"] },
  { kode: "pindah-barang", label: "Pindah Barang", modul: "persediaan", aksi: ["lihat", "buat", "hapus"] },
  { kode: "aset", label: "Aset Tetap", modul: "aset-tetap", aksi: ["lihat", "buat", "hapus"] },
  { kode: "penyusutan", label: "Penyusutan Aset", modul: "aset-tetap", aksi: ["lihat", "buat", "hapus"] },
  { kode: "pelepasan-aset", label: "Pelepasan Aset (jual/hapus buku)", modul: "aset-tetap", aksi: ["buat", "hapus"] },
] as const satisfies readonly { kode: string; label: string; modul: ModulDokumen; aksi: readonly AksiDokumen[] }[];

type Dok = (typeof DOKUMEN_HAK)[number];
export type KodeDokumen = Dok["kode"];
type HakDokumen = { [K in KodeDokumen]: `${K}.${Extract<Dok, { kode: K }>["aksi"][number]}` }[KodeDokumen];

export const HAK_LAIN = [
  "data-induk.lihat",
  "data-induk.tulis",
  "persediaan.lihat", // Stok per gudang
  "buku-besar.lihat", // Buku besar mutasi, neraca saldo, laba rugi, neraca, arus kas, pajak, status tutup buku
  "buku-besar.tulis", // Mengubah bagan akun
  "pengaturan.tulis", // Perusahaan & pajak, pemetaan akun, bagan akun standar
  "pengguna.kelola",
  "log-aktivitas.lihat",
  "rekonsiliasi.lihat", // Rekonsiliasi event (LPJ) & kas/bank
  "rekonsiliasi.tulis", // Impor mutasi rekening & pencocokan
  "hak-akses.kelola", // hanya Superadmin/Pemilik
] as const;

export const LABEL_HAK_LAIN: Record<(typeof HAK_LAIN)[number], string> = {
  "data-induk.lihat": "Data induk · lihat",
  "data-induk.tulis": "Data induk · ubah",
  "persediaan.lihat": "Stok per gudang · lihat",
  "buku-besar.lihat": "Laporan buku besar · lihat",
  "buku-besar.tulis": "Bagan akun · ubah",
  "pengaturan.tulis": "Pengaturan perusahaan · ubah",
  "pengguna.kelola": "Pengguna · kelola",
  "log-aktivitas.lihat": "Log aktivitas · lihat",
  "rekonsiliasi.lihat": "Rekonsiliasi (LPJ & kas/bank) · lihat",
  "rekonsiliasi.tulis": "Rekonsiliasi · impor mutasi & cocokkan",
  "hak-akses.kelola": "Hak akses · kelola",
};

export type Hak = HakDokumen | (typeof HAK_LAIN)[number];

export const SEMUA_HAK: readonly Hak[] = [...DOKUMEN_HAK.flatMap((d) => d.aksi.map((a) => `${d.kode}.${a}` as Hak)), ...HAK_LAIN];

const hakDok = (kode: KodeDokumen, ...aksi: AksiDokumen[]): Hak[] => aksi.map((a) => `${kode}.${a}` as Hak);
const lihatModul = (...modul: ModulDokumen[]): Hak[] =>
  DOKUMEN_HAK.filter((d) => modul.includes(d.modul) && (d.aksi as readonly string[]).includes("lihat")).map((d) => `${d.kode}.lihat` as Hak);

/**
 * Bawaan hak per peran. Superadmin (admin IT) & Pemilik selalu penuh dan tidak bisa dikurangi.
 * Admin = pengelola dokumen & laporan; batasnya diatur Pemilik di Pengaturan › Hak Akses — tanpa
 * pengaturan perusahaan, pengguna, dan hak akses. Kasir/Gudang hanya dokumen operasionalnya, tanpa laporan keuangan.
 */
export const HAK_BAWAAN: Record<PeranPengguna, readonly Hak[]> = {
  SUPERADMIN: SEMUA_HAK,
  PEMILIK: SEMUA_HAK,
  ADMIN: SEMUA_HAK.filter((h) => !["hak-akses.kelola", "pengaturan.tulis", "pengguna.kelola", "buku-besar.tulis"].includes(h)),
  KASIR: [
    ...lihatModul("penjualan", "pembelian", "kas-bank"),
    ...hakDok("penawaran", "buat"),
    ...hakDok("pesanan", "buat"),
    ...hakDok("uang-muka", "buat"),
    ...hakDok("faktur", "buat"),
    ...hakDok("penerimaan", "buat"),
    ...hakDok("retur-penjualan", "buat"),
    ...hakDok("pesanan-pembelian", "buat"),
    ...hakDok("faktur-pembelian", "buat"),
    ...hakDok("pembayaran", "buat"),
    ...hakDok("retur-pembelian", "buat"),
    ...hakDok("kas-masuk", "buat"),
    ...hakDok("kas-keluar", "buat"),
    "data-induk.lihat",
    "data-induk.tulis",
    "persediaan.lihat",
  ],
  GUDANG: [
    ...lihatModul("penjualan", "pembelian", "persediaan"),
    ...hakDok("pengiriman", "buat"),
    ...hakDok("penerimaan-barang", "buat"),
    ...hakDok("penyesuaian", "buat"),
    ...hakDok("pindah-barang", "buat"),
    "data-induk.lihat",
    "data-induk.tulis",
    "persediaan.lihat",
  ],
};

export const DAFTAR_PERAN: readonly PeranPengguna[] = ["SUPERADMIN", "PEMILIK", "ADMIN", "KASIR", "GUDANG"];

/** Tingkat tertinggi: Superadmin dan Pemilik setara — hanya mereka yang boleh menyentuh akun setingkat ini & hak akses. */
export const PERAN_TERTINGGI: readonly PeranPengguna[] = ["SUPERADMIN", "PEMILIK"];
export function peranTertinggi(peran: PeranPengguna): boolean {
  return PERAN_TERTINGGI.includes(peran);
}
/** Peran yang hak aksesnya bisa diubah dari Pengaturan › Hak Akses. */
export const PERAN_DAPAT_DIATUR: readonly PeranPengguna[] = ["ADMIN", "KASIR", "GUDANG"];

export const LABEL_PERAN: Record<PeranPengguna, string> = {
  SUPERADMIN: "Superadmin",
  PEMILIK: "Pemilik",
  ADMIN: "Admin",
  KASIR: "Kasir",
  GUDANG: "Gudang",
};

export const KETERANGAN_PERAN: Record<PeranPengguna, string> = {
  SUPERADMIN: "Admin IT: akses penuh setara Pemilik — semua dokumen, laporan keuangan, rekonsiliasi, pengaturan, hak akses, dan semua akun termasuk Pemilik.",
  PEMILIK: "Akses penuh setara Superadmin — semua dokumen, laporan keuangan, rekonsiliasi, pengaturan, hak akses, dan semua akun.",
  ADMIN: "Pengelola dokumen: semua dokumen (lihat, buat, hapus), laporan keuangan, rekonsiliasi, data induk, log aktivitas; TANPA pengaturan perusahaan, pengguna, bagan akun, dan hak akses. Batasnya diatur Pemilik di Pengaturan › Hak Akses.",
  KASIR: "Bawaan: membuat & melihat dokumen penjualan, pembelian, dan kas; data induk; melihat stok; tanpa laporan keuangan dan tanpa hapus.",
  GUDANG: "Bawaan: surat jalan, terima barang, penyesuaian & pindah stok, data induk; melihat dokumen penjualan/pembelian; tanpa modul keuangan.",
};

export type PenyesuaianHak = { hak: string; boleh: boolean };

/** Hak efektif sebuah peran = bawaan ± penyesuaian dari Pengaturan › Hak Akses (tingkat tertinggi selalu penuh). */
export function hitungHak(peran: PeranPengguna, penyesuaian: readonly PenyesuaianHak[] = []): Hak[] {
  if (peranTertinggi(peran)) return [...SEMUA_HAK];
  const hasil = new Set<Hak>(HAK_BAWAAN[peran]);
  for (const p of penyesuaian) {
    if (!(SEMUA_HAK as readonly string[]).includes(p.hak) || p.hak === "hak-akses.kelola") continue;
    if (p.boleh) hasil.add(p.hak as Hak);
    else hasil.delete(p.hak as Hak);
  }
  return SEMUA_HAK.filter((h) => hasil.has(h));
}

/** Data pengguna yang aman dibawa ke komponen klien (tanpa hash kata sandi), termasuk hak efektifnya. */
export type PenggunaSesi = {
  id: string;
  nama: string;
  namaPengguna: string;
  email: string | null;
  peran: PeranPengguna;
  hak: readonly Hak[];
};

/** Memeriksa hak: dari sesi (hak efektif) atau dari nama peran (bawaan saja). */
export function punyaHak(subjek: PenggunaSesi | PeranPengguna, hak: Hak): boolean {
  if (typeof subjek === "string") return HAK_BAWAAN[subjek].includes(hak);
  return subjek.hak.includes(hak);
}

/** Modul tampil di menu bila ada satu pun dokumen/laporan di dalamnya yang boleh dilihat. */
export function modulTerlihat(pengguna: PenggunaSesi, modul: ModulDokumen): boolean {
  if (modul === "buku-besar" && punyaHak(pengguna, "buku-besar.lihat")) return true;
  if (modul === "persediaan" && punyaHak(pengguna, "persediaan.lihat")) return true;
  return lihatModul(modul).some((h) => punyaHak(pengguna, h));
}

export const LABEL_AKSI: Record<AksiDokumen, string> = { lihat: "lihat", buat: "buat", hapus: "hapus" };

export function labelHak(hak: string): string {
  if ((HAK_LAIN as readonly string[]).includes(hak)) return LABEL_HAK_LAIN[hak as (typeof HAK_LAIN)[number]];
  const titik = hak.lastIndexOf(".");
  const dok = DOKUMEN_HAK.find((d) => d.kode === hak.slice(0, titik));
  const aksi = hak.slice(titik + 1) as AksiDokumen;
  return dok ? `${dok.label} · ${LABEL_AKSI[aksi] ?? aksi}` : hak;
}

export function inisialNama(nama: string): string {
  const kata = nama.trim().split(/\s+/).filter(Boolean);
  if (kata.length === 0) return "?";
  return (kata[0][0] + (kata.length > 1 ? kata[kata.length - 1][0] : "")).toUpperCase();
}
