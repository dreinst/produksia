import type { PeranPengguna } from "@/prisma-klien/enums";

/**
 * Hak akses per dokumen & per peran, file ini aman diimpor dari komponen klien (tidak menyentuh basis data).
 * Setiap jenis dokumen punya hak `lihat` / `buat` / `ubah` / `setujui` / `hapus` (tidak semua dokumen punya
 * kelimanya); hak lain (data induk, laporan, pengaturan) per modul. `setujui` adalah hak pemeriksa pada alur maker-checker: yang membuat dokumen
 * tidak pernah boleh menyetujuinya sendiri (dijaga di src/lib/persetujuan.ts), jadi Kasir & Gudang
 * bawaannya hanya punya `buat`, sedangkan Admin/Pemilik/Superadmin punya `setujui`.
 * Bawaan per peran ada di HAK_BAWAAN dan ditulis eksplisit: kunci baru hanya dimiliki peran yang
 * mencantumkannya (untuk Admin lewat HAK_ADMIN_BARU). Superadmin/Pemilik selalu penuh, peran lain bisa diubah di
 * Pengaturan › Hak Akses (tabel HakAksesPeran), hasil akhirnya dihitung `hitungHak` saat sesi dibaca.
 * Pemeriksaan sesungguhnya dilakukan di server: `wajibHak` (halaman) dan `wajibHakAksi` (aksi server).
 */
/** Nama cookie sesi, didefinisikan di sini agar proxy.ts bisa memakainya tanpa menyeret modul basis data. */
export const NAMA_COOKIE_SESI = "sesi_ac";

export type ModulDokumen = "penjualan" | "pembelian" | "kas-bank" | "buku-besar" | "persediaan" | "aset-tetap" | "sdm" | "crm" | "pemasaran" | "proyek" | "berkas";
export type AksiDokumen = "lihat" | "buat" | "ubah" | "setujui" | "hapus";

export const DOKUMEN_HAK = [
  { kode: "penawaran", label: "Penawaran Penjualan", modul: "penjualan", aksi: ["lihat", "buat", "ubah", "setujui", "hapus"] },
  { kode: "pesanan", label: "Pesanan Penjualan", modul: "penjualan", aksi: ["lihat", "buat", "ubah", "setujui", "hapus"] },
  { kode: "uang-muka", label: "Uang Muka Pelanggan", modul: "penjualan", aksi: ["lihat", "buat", "ubah", "setujui", "hapus"] },
  { kode: "pengiriman", label: "Surat Jalan (Pengiriman)", modul: "penjualan", aksi: ["lihat", "buat", "setujui", "hapus"] },
  { kode: "faktur", label: "Faktur Penjualan", modul: "penjualan", aksi: ["lihat", "buat", "ubah", "setujui", "hapus"] },
  { kode: "penerimaan", label: "Penerimaan Penjualan", modul: "penjualan", aksi: ["lihat", "buat", "ubah", "setujui", "hapus"] },
  { kode: "retur-penjualan", label: "Retur Penjualan", modul: "penjualan", aksi: ["lihat", "buat", "setujui", "hapus"] },
  { kode: "pesanan-pembelian", label: "Pesanan Pembelian", modul: "pembelian", aksi: ["lihat", "buat", "setujui", "hapus"] },
  { kode: "penerimaan-barang", label: "Terima Barang", modul: "pembelian", aksi: ["lihat", "buat", "setujui", "hapus"] },
  { kode: "faktur-pembelian", label: "Faktur Pembelian", modul: "pembelian", aksi: ["lihat", "buat", "setujui", "hapus"] },
  { kode: "pembayaran", label: "Pembayaran Pembelian", modul: "pembelian", aksi: ["lihat", "buat", "setujui", "hapus"] },
  { kode: "retur-pembelian", label: "Retur Pembelian", modul: "pembelian", aksi: ["lihat", "buat", "setujui", "hapus"] },
  { kode: "kas-masuk", label: "Kas Masuk", modul: "kas-bank", aksi: ["lihat", "buat", "setujui", "hapus"] },
  { kode: "kas-keluar", label: "Kas Keluar", modul: "kas-bank", aksi: ["lihat", "buat", "setujui", "hapus"] },
  { kode: "prive", label: "Prive (pengambilan pemilik)", modul: "kas-bank", aksi: ["lihat", "buat", "setujui", "hapus"] },
  { kode: "jurnal", label: "Jurnal Umum (manual)", modul: "buku-besar", aksi: ["lihat", "buat", "setujui", "hapus"] },
  { kode: "tutup-buku", label: "Tutup Buku Tahunan", modul: "buku-besar", aksi: ["buat", "setujui"] },
  { kode: "pph-final", label: "PPh Final Bulanan", modul: "buku-besar", aksi: ["buat", "setujui", "hapus"] },
  { kode: "penyesuaian", label: "Penyesuaian Stok", modul: "persediaan", aksi: ["lihat", "buat", "setujui", "hapus"] },
  { kode: "pindah-barang", label: "Pindah Barang", modul: "persediaan", aksi: ["lihat", "buat", "setujui", "hapus"] },
  { kode: "peminjaman", label: "Peminjaman Barang", modul: "persediaan", aksi: ["lihat", "buat", "setujui", "hapus"] },
  { kode: "kerusakan", label: "Laporan Kerusakan Barang", modul: "persediaan", aksi: ["lihat", "buat", "setujui", "hapus"] },
  { kode: "aset", label: "Aset Tetap", modul: "aset-tetap", aksi: ["lihat", "buat", "setujui", "hapus"] },
  { kode: "penyusutan", label: "Penyusutan Aset", modul: "aset-tetap", aksi: ["lihat", "buat", "setujui", "hapus"] },
  { kode: "pelepasan-aset", label: "Pelepasan Aset (jual/hapus buku)", modul: "aset-tetap", aksi: ["buat", "setujui", "hapus"] },
  { kode: "penggajian", label: "Penggajian (proses gaji karyawan)", modul: "sdm", aksi: ["lihat", "buat", "setujui", "hapus"] },
  // ---- sesudah peleburan HKA (urutan tetap, lihat desain HAK.md §1.2) ----
  { kode: "antar-perusahaan", label: "Transaksi Antar Perusahaan", modul: "buku-besar", aksi: ["lihat", "buat", "hapus"] },
  { kode: "lead", label: "Lead, pipeline & tindak lanjut (CRM)", modul: "crm", aksi: ["lihat", "buat", "ubah", "hapus"] },
  { kode: "konten", label: "Perencana Konten Media Sosial", modul: "pemasaran", aksi: ["lihat", "buat", "ubah", "setujui", "hapus"] },
  { kode: "tugas-desain", label: "Tugas Desain", modul: "pemasaran", aksi: ["lihat", "buat", "ubah", "setujui", "hapus"] },
  { kode: "kampanye", label: "Perencana Iklan Meta", modul: "pemasaran", aksi: ["lihat", "buat", "ubah", "hapus"] },
  { kode: "anggaran-proyek", label: "Anggaran & keuangan proyek", modul: "proyek", aksi: ["lihat", "buat", "ubah", "hapus"] },
  { kode: "bagi-hasil", label: "Mitra & bagi hasil proyek", modul: "proyek", aksi: ["lihat", "buat", "ubah", "hapus"] },
  { kode: "talangan-mitra", label: "Talangan Mitra (biaya dibayar mitra)", modul: "proyek", aksi: ["lihat", "buat", "setujui", "hapus"] },
  { kode: "pembayaran-mitra", label: "Pembayaran ke Mitra (modal & bagi laba)", modul: "proyek", aksi: ["lihat", "buat", "setujui", "hapus"] },
  { kode: "berkas", label: "Berkas & lampiran", modul: "berkas", aksi: ["lihat", "buat", "ubah", "hapus"] },
] as const satisfies readonly { kode: string; label: string; modul: ModulDokumen; aksi: readonly AksiDokumen[] }[];

type Dok = (typeof DOKUMEN_HAK)[number];
export type KodeDokumen = Dok["kode"];
type HakDokumen = { [K in KodeDokumen]: `${K}.${Extract<Dok, { kode: K }>["aksi"][number]}` }[KodeDokumen];

export const HAK_LAIN = [
  "data-induk.lihat",
  "data-induk.tulis",
  "sdm.lihat", // Data induk Karyawan & Departemen (termasuk gaji pokok/tunjangan) — terpisah dari data-induk, bukan untuk Kasir/Gudang
  "sdm.tulis",
  "stok-induk.lihat", // Data induk Barang & Jasa, Kategori Barang, Gudang (lokasi) — dipisah dari data-induk komersial supaya Gudang bisa kelola ini tanpa Pelanggan/Pemasok/Proyek/Bagan Akun
  "stok-induk.tulis",
  "persediaan.lihat", // Stok per gudang
  "buku-besar.lihat", // Buku besar mutasi, neraca saldo, laba rugi, neraca, arus kas, pajak, status tutup buku
  "buku-besar.tulis", // Mengubah bagan akun
  "pengaturan.tulis", // Perusahaan & pajak, pemetaan akun, bagan akun standar
  "pengguna.kelola",
  "log-aktivitas.lihat",
  "rekonsiliasi.lihat", // Rekonsiliasi event (LPJ) & kas/bank
  "rekonsiliasi.tulis", // Impor mutasi rekening & pencocokan
  "harga.nego", // Mengubah harga jual di penawaran/pesanan (nego dengan klien)
  "pemetaan.tulis", // Pemetaan akun (standar & tambahan)
  "hak-akses.kelola", // hanya Superadmin/Pemilik
  // ---- sesudah peleburan HKA (urutan tetap, lihat desain HAK.md §1.4) ----
  "perusahaan-gabungan.lihat", // Pilihan "Semua perusahaan" di pemilih lingkup: daftar dan laporan gabungan (D1)
  "tanda-tangan-cetak.buat", // Membubuhkan gambar tanda tangan & stempel di PDF dokumen yang bukan draf (D3)
  "pengaturan-crm.ubah", // Tahap pipeline & sumber lead per perusahaan (D4)
  "proyek.lihat", // Daftar proyek & hitungan pekerjaan per modul, tanpa angka keuangan (D5)
  "kategori-anggaran.ubah", // Kategori anggaran proyek & pemetaan akun beban (D5)
  "berkas.bagikan", // Tautan bagi publik bertoken (D7)
  "berkas.akses-penuh", // Semua folder & proyek terbatas, atur pembatasan, hapus permanen; HAK_TERTINGGI_SAJA (D7)
  "beranda-keuangan.lihat", // Tab Keuangan di beranda (D7)
] as const;

export const LABEL_HAK_LAIN: Record<(typeof HAK_LAIN)[number], string> = {
  "data-induk.lihat": "Data induk · lihat",
  "data-induk.tulis": "Data induk · ubah",
  "sdm.lihat": "SDM (Karyawan & Departemen) · lihat",
  "sdm.tulis": "SDM (Karyawan & Departemen) · ubah",
  "stok-induk.lihat": "Data induk stok (Barang, Kategori Barang, Gudang) · lihat",
  "stok-induk.tulis": "Data induk stok (Barang, Kategori Barang, Gudang) · ubah",
  "persediaan.lihat": "Stok per gudang · lihat",
  "buku-besar.lihat": "Laporan buku besar · lihat",
  "buku-besar.tulis": "Bagan akun · ubah",
  "pengaturan.tulis": "Pengaturan perusahaan · ubah",
  "pengguna.kelola": "Pengguna · kelola",
  "log-aktivitas.lihat": "Log aktivitas · lihat",
  "rekonsiliasi.lihat": "Rekonsiliasi (LPJ & kas/bank) · lihat",
  "rekonsiliasi.tulis": "Rekonsiliasi · impor mutasi & cocokkan",
  "harga.nego": "Harga jual · boleh nego (ubah harga di penawaran/pesanan)",
  "pemetaan.tulis": "Pemetaan akun · ubah",
  "hak-akses.kelola": "Hak akses · kelola",
  "perusahaan-gabungan.lihat": "Lingkup gabungan semua perusahaan · lihat",
  "tanda-tangan-cetak.buat": "Tanda tangan cetak · bubuhkan tanda tangan & stempel di PDF",
  "pengaturan-crm.ubah": "Pengaturan CRM (tahap pipeline & sumber lead) · ubah",
  "proyek.lihat": "Daftar proyek & hitungan pekerjaan per modul · lihat",
  "kategori-anggaran.ubah": "Kategori anggaran proyek & pemetaan akun beban · ubah",
  "berkas.bagikan": "Berkas · buat & cabut tautan bagi publik",
  "berkas.akses-penuh": "Berkas · semua folder & proyek terbatas, atur pembatasan, hapus permanen",
  "beranda-keuangan.lihat": "Beranda · ringkasan keuangan",
};

export type Hak = HakDokumen | (typeof HAK_LAIN)[number];

export const SEMUA_HAK: readonly Hak[] = [...DOKUMEN_HAK.flatMap((d) => d.aksi.map((a) => `${d.kode}.${a}` as Hak)), ...HAK_LAIN];

const ENTITAS_SDM = new Set(["karyawan", "departemen"]);
const ENTITAS_STOK_INDUK = new Set(["barang", "kelompok-barang", "gudang"]);

/**
 * Satu sumber kebenaran untuk hak lihat/ubah tiap slug entitas di /data-induk/[entitas]:
 * Bagan Akun ikut buku besar, Karyawan/Departemen ikut SDM (data gaji), Barang/Kelompok
 * Barang/Gudang ikut stok induk (supaya Gudang bisa kelola tanpa data induk komersial),
 * entitas lain (Pelanggan, Pemasok, Proyek) pakai data induk komersial biasa.
 */
export function hakDataInduk(slug: string): { lihat: Hak; tulis: Hak } {
  if (slug === "akun") return { lihat: "data-induk.lihat", tulis: "buku-besar.tulis" };
  if (ENTITAS_SDM.has(slug)) return { lihat: "sdm.lihat", tulis: "sdm.tulis" };
  if (ENTITAS_STOK_INDUK.has(slug)) return { lihat: "stok-induk.lihat", tulis: "stok-induk.tulis" };
  return { lihat: "data-induk.lihat", tulis: "data-induk.tulis" };
}

const hakDok = (kode: KodeDokumen, ...aksi: AksiDokumen[]): Hak[] => aksi.map((a) => `${kode}.${a}` as Hak);
const lihatModul = (...modul: ModulDokumen[]): Hak[] =>
  DOKUMEN_HAK.filter((d) => modul.includes(d.modul) && (d.aksi as readonly string[]).includes("lihat")).map((d) => `${d.kode}.lihat` as Hak);

/**
 * Hak yang cuma boleh dipegang Superadmin/Pemilik: tidak masuk bawaan Admin, dan TIDAK BISA
 * diberikan ke Admin/Kasir/Gudang lewat Pengaturan › Hak Akses sekalipun dicentang (lihat
 * simpanHakAkses di src/lib/aksi/hakAkses.ts dan kotak yang dinonaktifkan di halamannya).
 * SDM (Karyawan, Departemen, Penggajian) memuat data gaji, sengaja dikunci seketat hak-akses.kelola.
 */
export const HAK_TERTINGGI_SAJA: readonly Hak[] = ["hak-akses.kelola", "sdm.lihat", "sdm.tulis", ...hakDok("penggajian", "lihat", "buat", "setujui", "hapus"), "berkas.akses-penuh"];

/**
 * Potret kunci sebelum peleburan HKA (salinan persis DOKUMEN_HAK dan HAK_LAIN lama). Dibekukan: jangan diubah.
 * Hanya dipakai untuk menurunkan bagian lama bawaan ADMIN, supaya kunci yang lahir sesudahnya (termasuk aksi
 * baru pada dokumen lama, mis. penawaran.ubah) masuk ADMIN hanya bila dicantumkan di HAK_ADMIN_BARU.
 */
const EMPAT_AKSI = ["lihat", "buat", "setujui", "hapus"] as const;
const AKSI_DOKUMEN_SEBELUM_PELEBURAN: ReadonlyMap<string, readonly string[]> = new Map<string, readonly string[]>([
  ["penawaran", EMPAT_AKSI], ["pesanan", EMPAT_AKSI], ["uang-muka", EMPAT_AKSI], ["pengiriman", EMPAT_AKSI],
  ["faktur", EMPAT_AKSI], ["penerimaan", EMPAT_AKSI], ["retur-penjualan", EMPAT_AKSI],
  ["pesanan-pembelian", EMPAT_AKSI], ["penerimaan-barang", EMPAT_AKSI], ["faktur-pembelian", EMPAT_AKSI],
  ["pembayaran", EMPAT_AKSI], ["retur-pembelian", EMPAT_AKSI],
  ["kas-masuk", EMPAT_AKSI], ["kas-keluar", EMPAT_AKSI], ["prive", EMPAT_AKSI],
  ["jurnal", EMPAT_AKSI], ["tutup-buku", ["buat", "setujui"]], ["pph-final", ["buat", "setujui", "hapus"]],
  ["penyesuaian", EMPAT_AKSI], ["pindah-barang", EMPAT_AKSI], ["peminjaman", EMPAT_AKSI], ["kerusakan", EMPAT_AKSI],
  ["aset", EMPAT_AKSI], ["penyusutan", EMPAT_AKSI], ["pelepasan-aset", ["buat", "setujui", "hapus"]],
  ["penggajian", EMPAT_AKSI],
]);
const HAK_LAIN_SEBELUM_PELEBURAN: ReadonlySet<string> = new Set([
  "data-induk.lihat", "data-induk.tulis", "sdm.lihat", "sdm.tulis", "stok-induk.lihat", "stok-induk.tulis",
  "persediaan.lihat", "buku-besar.lihat", "buku-besar.tulis", "pengaturan.tulis", "pengguna.kelola",
  "log-aktivitas.lihat", "rekonsiliasi.lihat", "rekonsiliasi.tulis", "harga.nego", "pemetaan.tulis", "hak-akses.kelola",
]);

/** Benar bila kunci sudah ada sebelum peleburan HKA (117 kunci). */
export function kunciSebelumPeleburan(h: string): boolean {
  if (HAK_LAIN_SEBELUM_PELEBURAN.has(h)) return true;
  const i = h.lastIndexOf(".");
  return AKSI_DOKUMEN_SEBELUM_PELEBURAN.get(h.slice(0, i))?.includes(h.slice(i + 1)) ?? false;
}

/** Daftar hitam ADMIN lama ditambah seluruh HAK_TERTINGGI_SAJA, supaya ADMIN tidak pernah memegang kunci tertinggi. */
const PENGECUALIAN_ADMIN_LAMA: readonly Hak[] = ["pengaturan.tulis", "pengguna.kelola", "buku-besar.tulis", ...HAK_TERTINGGI_SAJA];

/** Kunci sesudah peleburan yang masuk bawaan ADMIN. Kunci baru yang tidak dicantumkan di sini tidak dimiliki ADMIN. */
export const HAK_ADMIN_BARU: readonly Hak[] = [
  // D1 multi perusahaan
  "perusahaan-gabungan.lihat",
  ...hakDok("antar-perusahaan", "lihat", "buat", "hapus"),
  // D2 dokumen penjualan
  ...hakDok("penawaran", "ubah"), ...hakDok("pesanan", "ubah"), ...hakDok("uang-muka", "ubah"), ...hakDok("faktur", "ubah"), ...hakDok("penerimaan", "ubah"),
  // D3 cetak
  "tanda-tangan-cetak.buat",
  // D4 CRM (tanpa pengaturan-crm.ubah)
  ...hakDok("lead", "lihat", "buat", "ubah", "hapus"),
  // D5 keuangan proyek (tanpa ketentuan mitra, tanpa setujui/hapus pembayaran mitra)
  "proyek.lihat", "kategori-anggaran.ubah",
  ...hakDok("anggaran-proyek", "lihat", "buat", "ubah", "hapus"),
  ...hakDok("bagi-hasil", "lihat"),
  ...hakDok("talangan-mitra", "lihat", "buat", "setujui", "hapus"),
  ...hakDok("pembayaran-mitra", "lihat", "buat"),
  // D6 pemasaran
  ...hakDok("konten", "lihat"), ...hakDok("tugas-desain", "lihat", "buat", "ubah"), ...hakDok("kampanye", "lihat"),
  // D7 platform (tanpa berkas.hapus dan berkas.akses-penuh)
  ...hakDok("berkas", "lihat", "buat", "ubah"), "berkas.bagikan", "beranda-keuangan.lihat",
];

/**
 * Bawaan hak per peran. Superadmin (admin IT) & Pemilik selalu penuh dan tidak bisa dikurangi.
 * Admin = pengelola dokumen & laporan; batasnya diatur Pemilik di Pengaturan › Hak Akses, tanpa
 * pengaturan perusahaan, pengguna, hak akses, dan SDM (lihat HAK_TERTINGGI_SAJA). Kasir/Gudang
 * hanya dokumen operasionalnya, tanpa laporan keuangan.
 */
export const HAK_BAWAAN: Record<PeranPengguna, readonly Hak[]> = {
  SUPERADMIN: SEMUA_HAK,
  PEMILIK: SEMUA_HAK,
  // Bagian lama = rumus daftar hitam lama atas kunci sebelum peleburan (107 kunci, tidak berubah);
  // kunci sesudahnya hanya yang dicantumkan di HAK_ADMIN_BARU.
  ADMIN: [...SEMUA_HAK.filter((h) => kunciSebelumPeleburan(h) && !PENGECUALIAN_ADMIN_LAMA.includes(h)), ...HAK_ADMIN_BARU],
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
    "harga.nego",
    // ---- sesudah peleburan HKA (HAK.md §2.1) ----
    "beranda-keuangan.lihat",
    "proyek.lihat",
    ...hakDok("penawaran", "ubah"), ...hakDok("pesanan", "ubah"), ...hakDok("uang-muka", "ubah"), ...hakDok("faktur", "ubah"), ...hakDok("penerimaan", "ubah"),
  ],
  // Gudang murni input/output stok: cuma 4 dokumen yang benar-benar menggerakkan stok fisik,
  // lihat maupun buat. TIDAK melihat dokumen penjualan/pembelian lain (Faktur, Penawaran,
  // Pesanan, Retur, Pembayaran, dst.) sama sekali, walau itu di modul yang sama.
  GUDANG: [
    ...hakDok("pengiriman", "lihat", "buat"),
    ...hakDok("penerimaan-barang", "lihat", "buat"),
    ...hakDok("penyesuaian", "lihat", "buat"),
    ...hakDok("pindah-barang", "lihat", "buat"),
    // Peminjaman barang: Gudang yang menyetujui pengajuan Kru (stok baru dikurangi/ditambah balik
    // saat itu) dan mengonfirmasi barang kembali, jadi juga punya "setujui" di sini.
    ...hakDok("peminjaman", "lihat", "buat", "setujui"),
    // Laporan Kerusakan Barang: pola sama seperti peminjaman (Kru/Gudang lapor, Gudang menyetujui).
    ...hakDok("kerusakan", "lihat", "buat", "setujui"),
    // Data induk yang boleh Gudang kelola sendiri (Barang & Jasa, Kategori Barang, Gudang/lokasi),
    // TERPISAH dari data induk komersial (Pelanggan, Pemasok, Bagan Akun, Proyek) yang tetap
    // urusan Admin. Lihat & ubah, bukan cuma lihat, karena Gudang perlu menambah barang baru sendiri.
    "stok-induk.lihat",
    "stok-induk.tulis",
    "persediaan.lihat", // Stok per Gudang
    // ---- sesudah peleburan HKA ----
    "perusahaan-gabungan.lihat", // gudang fisik dipakai bersama beberapa perusahaan (D1)
  ],
  // Kru lapangan: SATU-SATUNYA hak yang dimiliki adalah Peminjaman Barang (ajukan pinjam & ajukan
  // kembali), tanpa "setujui" (pemisahan tugas: yang ajukan bukan yang setujui) dan tanpa "hapus".
  // Laporan Kerusakan Barang BUKAN hak Kru - itu murni pemeriksaan fisik Gudang sendiri saat cek stok
  // (lihat src/app/(aplikasi)/data-induk/[entitas]/[id]/page.tsx). Tanpa persediaan.lihat/stok-induk.lihat
  // pun, jadi modul lain otomatis tidak tampil di menu (lihat modulTerlihat) - ini yang membuat Kru
  // cuma bisa mengakses halaman Peminjaman Barang.
  KRU: [...hakDok("peminjaman", "lihat", "buat")],
  // Tamu/pihak luar: persis sama seperti Kru. Dipisah jadi peran sendiri (bukan disamakan dengan Kru)
  // supaya kewajiban nomor WhatsApp saat pendaftaran bisa beda (Guest dikecualikan, lihat
  // src/lib/aksi/pengguna.ts) dan supaya kedua populasi ini bisa dibedakan di daftar pengguna & log.
  GUEST: [...hakDok("peminjaman", "lihat", "buat")],
  // Peran pemasaran (sesudah peleburan HKA). Tidak memegang satu pun kunci lama: tanpa dokumen keuangan,
  // laporan, data induk, dan pengaturan. Daftar literal, tidak diturunkan dari rumus.
  SOSMED: [
    "perusahaan-gabungan.lihat", "proyek.lihat",
    ...hakDok("konten", "lihat", "buat", "ubah", "hapus"),
    ...hakDok("tugas-desain", "lihat", "buat", "ubah", "setujui"),
    ...hakDok("berkas", "lihat", "buat", "ubah"), "berkas.bagikan",
  ],
  IKLAN: [
    "perusahaan-gabungan.lihat", "proyek.lihat",
    ...hakDok("konten", "lihat"),
    ...hakDok("tugas-desain", "lihat", "buat"),
    ...hakDok("kampanye", "lihat", "buat", "ubah", "hapus"),
    ...hakDok("berkas", "lihat", "buat"), "berkas.bagikan",
  ],
  DESAINER: [
    "perusahaan-gabungan.lihat", "proyek.lihat",
    ...hakDok("konten", "lihat"),
    ...hakDok("tugas-desain", "lihat", "ubah"),
    ...hakDok("berkas", "lihat", "buat"), "berkas.bagikan",
  ],
};

export const DAFTAR_PERAN: readonly PeranPengguna[] = ["SUPERADMIN", "PEMILIK", "ADMIN", "KASIR", "GUDANG", "KRU", "GUEST", "SOSMED", "IKLAN", "DESAINER"];

/** Tingkat tertinggi: Superadmin dan Pemilik setara, hanya mereka yang boleh menyentuh akun setingkat ini & hak akses. */
export const PERAN_TERTINGGI: readonly PeranPengguna[] = ["SUPERADMIN", "PEMILIK"];
export function peranTertinggi(peran: PeranPengguna): boolean {
  return PERAN_TERTINGGI.includes(peran);
}
/** Peran yang hak aksesnya bisa diubah dari Pengaturan › Hak Akses. */
export const PERAN_DAPAT_DIATUR: readonly PeranPengguna[] = ["ADMIN", "KASIR", "GUDANG", "KRU", "GUEST", "SOSMED", "IKLAN", "DESAINER"];

export const LABEL_PERAN: Record<PeranPengguna, string> = {
  SUPERADMIN: "Superadmin",
  PEMILIK: "Pemilik",
  ADMIN: "Admin",
  KASIR: "Kasir",
  GUDANG: "Gudang",
  KRU: "Kru",
  GUEST: "Guest",
  SOSMED: "Pengelola Media Sosial",
  IKLAN: "Pengelola Iklan",
  DESAINER: "Desainer",
};

export const KETERANGAN_PERAN: Record<PeranPengguna, string> = {
  SUPERADMIN: "Admin IT. Akses penuh, sama dengan Pemilik, termasuk membalap (bypass) aturan yang membatasi peran lain.",
  PEMILIK: "Akses penuh.",
  ADMIN: "Semua dokumen, laporan, dan rekonsiliasi untuk semua perusahaan, termasuk transaksi antar perusahaan. Di modul baru: lead CRM penuh, anggaran proyek, talangan mitra, pengajuan pembayaran ke mitra, tugas desain (buat dan kerjakan), dan berkas tanpa hapus; konten, iklan, dan bagi hasil hanya dilihat. Tanpa pengaturan, pengguna, hak akses, ketentuan bagi hasil, dan persetujuan pembayaran ke mitra.",
  KASIR: "Dokumen penjualan, pembelian, kas, dan data induk (tanpa SDM), termasuk membetulkan teks cetak dokumen penjualan dan melihat daftar proyek. Bekerja satu perusahaan sekali waktu: pilih perusahaan di bilah samping. Tanpa laporan dan tanpa hapus.",
  GUDANG: "Hanya input/edit stok gudang: surat jalan, terima barang, pindah & penyesuaian stok, peminjaman barang (loading out/in), plus lapor & setujui barang rusak dan kelola Barang/Kategori Barang/Gudang sendiri. Kalau Gudang sendiri yang mau pinjam barang keluar, yang menyetujui hanya Pemilik/Superadmin (lihat pastikanBolehSetujuiPeminjaman di src/lib/persetujuan.ts). Tanpa dokumen penjualan/pembelian lain, tanpa Pelanggan/Pemasok/Bagan Akun/Proyek, tanpa SDM. Bisa melihat stok semua perusahaan sekaligus.",
  KRU: "Hanya Peminjaman Barang (ajukan pinjam & ajukan kembali), menunggu persetujuan Gudang (atau Pemilik/Superadmin). Tidak bisa mengakses halaman lain sama sekali.",
  GUEST: "Tamu/pihak luar. Sama seperti Kru: hanya Peminjaman Barang, menunggu persetujuan Gudang. Tidak wajib nomor WhatsApp saat didaftarkan.",
  SOSMED: "Merencanakan konten media sosial (buat, ubah, ajukan, arsipkan), meminta dan menyetujui tugas desain, mengunggah lampiran. Persetujuan konten oleh Pemilik. Tanpa dokumen keuangan dan laporan.",
  IKLAN: "Merencanakan iklan Meta (kampanye, set iklan, iklan, laporan), melihat konten, meminta tugas desain, mengunggah materi iklan. Tanpa dokumen keuangan dan laporan.",
  DESAINER: "Mengerjakan tugas desain (ubah status, unggah hasil, ajukan tinjauan) dan melihat konten. Tidak membuat atau menyetujui tugas, tidak menghapus berkas.",
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

/** Peran yang boleh menjadi peran tambahan seorang pengguna (gabungan hak, lihat hitungHakPengguna). */
export const PERAN_TAMBAHAN_BOLEH: readonly PeranPengguna[] = ["SOSMED", "IKLAN", "DESAINER"];
export type PenyesuaianPeran = PenyesuaianHak & { peran: PeranPengguna };

/** Peran tambahan yang sah: hanya PERAN_TAMBAHAN_BOLEH, tanpa duplikat, tanpa peran utama. */
function peranTambahanSah(peran: PeranPengguna, peranTambahan: readonly PeranPengguna[] = []): PeranPengguna[] {
  return [...new Set(peranTambahan)].filter((p) => p !== peran && PERAN_TAMBAHAN_BOLEH.includes(p));
}

/** Hak yang hanya boleh berasal dari peran utama, supaya peran tambahan tidak mengubah lingkup perusahaan peran lama. */
const HAK_PERAN_UTAMA_SAJA: readonly Hak[] = ["perusahaan-gabungan.lihat"];

/**
 * Hak efektif pengguna = gabungan hak peran utama dan tiap peran tambahan yang sah, masing-masing dengan
 * penyesuaian perannya sendiri. Tanpa peran tambahan hasilnya persis hitungHak(peran, penyesuaian peran itu).
 * Kunci di HAK_PERAN_UTAMA_SAJA tidak diambil dari peran tambahan: KASIR + SOSMED tetap berlingkup satu
 * perusahaan seperti KASIR (HAK.md §5, perubahan setelah DF1).
 */
export function hitungHakPengguna(peran: PeranPengguna, peranTambahan: readonly PeranPengguna[], penyesuaian: readonly PenyesuaianPeran[] = []): Hak[] {
  if (peranTertinggi(peran)) return [...SEMUA_HAK];
  const hasil = new Set<Hak>(hitungHak(peran, penyesuaian.filter((x) => x.peran === peran)));
  for (const p of peranTambahanSah(peran, peranTambahan)) {
    for (const h of hitungHak(p, penyesuaian.filter((x) => x.peran === p))) if (!HAK_PERAN_UTAMA_SAJA.includes(h)) hasil.add(h);
  }
  return SEMUA_HAK.filter((h) => hasil.has(h));
}

/** Data pengguna yang aman dibawa ke komponen klien (tanpa hash kata sandi), termasuk hak efektifnya. */
export type PenggunaSesi = {
  id: string;
  nama: string;
  namaPengguna: string;
  email: string | null;
  nomorTelepon: string | null;
  peran: PeranPengguna;
  /** Peran tambahan (hanya SOSMED, IKLAN, DESAINER). Opsional supaya literal PenggunaSesi lama tetap sah. */
  peranTambahan?: readonly PeranPengguna[];
  hak: readonly Hak[];
};

/** Peran utama diikuti peran tambahan yang sah. */
export function peranEfektif(p: Pick<PenggunaSesi, "peran" | "peranTambahan">): PeranPengguna[] {
  return [p.peran, ...peranTambahanSah(p.peran, p.peranTambahan)];
}

/** Label gabungan peran, mis. "Admin + Desainer". */
export function labelPeranPengguna(p: Pick<PenggunaSesi, "peran" | "peranTambahan">): string {
  return peranEfektif(p).map((x) => LABEL_PERAN[x]).join(" + ");
}

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

export const LABEL_AKSI: Record<AksiDokumen, string> = { lihat: "lihat", buat: "buat", ubah: "ubah", setujui: "setujui", hapus: "hapus" };

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
