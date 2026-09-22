/**
 * Tautan wa.me berisi pesan siap kirim, dipakai tombol "Konfirmasi via WhatsApp" di Peminjaman &
 * Laporan Kerusakan Barang. Tujuannya supaya Gudang (atau Pemilik/Superadmin kalau Gudang sendiri
 * yang mengajukan) benar-benar dapat notifikasi langsung, bukan cuma menunggu dicek di aplikasi.
 */

/** Nomor WA Gudang (dipakai sebagai tujuan konfirmasi normal). */
const NOMOR_WA_GUDANG = "+6285704874029";
/** Nomor WA Superadmin (tujuan konfirmasi kalau pengaju SENDIRI berperan Gudang - Gudang tidak boleh konfirmasi ke sesama Gudang). */
const NOMOR_WA_SUPERADMIN = "+6282228555254";

/** Tujuan konfirmasi: Gudang biasa, KECUALI pengajunya sendiri berperan Gudang -> ke Superadmin. */
export function nomorTujuanKonfirmasi(peranPengaju: string | null | undefined): string {
  return peranPengaju === "GUDANG" ? NOMOR_WA_SUPERADMIN : NOMOR_WA_GUDANG;
}

/** Tautan wa.me; nomor boleh format +62..., dibersihkan ke digit saja sesuai spesifikasi wa.me. */
export function tautanWhatsApp(nomor: string, pesan: string): string {
  const digit = nomor.replace(/[^0-9]/g, "");
  return `https://wa.me/${digit}?text=${encodeURIComponent(pesan)}`;
}

type BarisPesan = { kode: string; nama: string; jumlah: number; satuan: string };

function daftarBarisTeks(baris: BarisPesan[]): string {
  return baris.map((b) => `- ${b.kode} ${b.nama} x${b.jumlah.toLocaleString("id-ID")} ${b.satuan}`).join("\n");
}

export function pesanKonfirmasiPinjam(nomor: string, namaPengambil: string, baris: BarisPesan[]): string {
  return `Halo, saya ${namaPengambil} mau pinjam barang berikut (${nomor}):\n${daftarBarisTeks(baris)}\n\nMohon konfirmasi persetujuannya sebelum saya bawa keluar ya. Terima kasih.`;
}

export function pesanKonfirmasiKembali(nomor: string, namaPengambil: string, baris: BarisPesan[]): string {
  return `Halo, saya ${namaPengambil} mau mengembalikan barang pinjaman berikut (${nomor}):\n${daftarBarisTeks(baris)}\n\nMohon dicek dan dikonfirmasi kembalinya ya. Terima kasih.`;
}

export function pesanKonfirmasiKerusakan(nomor: string, namaPelapor: string, baris: BarisPesan[]): string {
  return `Halo, saya ${namaPelapor} mau lapor barang rusak berikut (${nomor}):\n${daftarBarisTeks(baris)}\n\nMohon dicek dan dikonfirmasi ya, supaya stoknya segera disesuaikan. Terima kasih.`;
}
