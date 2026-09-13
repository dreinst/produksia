/*
 * Aturan verifikasi singkat sebelum formulir dikirim (dialog di <FormulirAksi verifikasi=...>).
 * Data biasa (bukan fungsi) supaya bisa dikirim dari halaman server ke komponen klien.
 */
export type AturanPeringatan =
  | { bidang: string; bilaKosong: string }
  | { bidang: string; bilaAtribut: { nama: string; nilai: string }; pesan: string };

export type Verifikasi = { judul?: string; peringatan?: AturanPeringatan[] };

/** Dokumen tanpa tanda event tidak ikut Laba Rugi per event maupun LPJ. */
export const PERINGATAN_TANPA_EVENT: AturanPeringatan = {
  bidang: "proyekId",
  bilaKosong: "Tanpa event. Transaksi ini tidak akan muncul di Laba Rugi per event maupun LPJ. Pilih event bila memang milik sebuah event.",
};

/** Kas masuk langsung ke akun pendapatan: sah, tetapi lewat jalur di luar faktur. */
export const PERINGATAN_PENDAPATAN_TANPA_FAKTUR: AturanPeringatan = {
  bidang: "akunLawanId",
  bilaAtribut: { nama: "jenis", nilai: "PENDAPATAN" },
  pesan: "Pendapatan tanpa faktur. Tetap ikut omzet pajak dan Laba Rugi, tetapi tidak tercatat atas nama pelanggan dan tidak menerbitkan faktur. Untuk penjualan ke pelanggan gunakan Pesanan → Faktur → Penerimaan (atau Uang Muka untuk DP).",
};
