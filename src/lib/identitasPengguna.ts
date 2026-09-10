/** Aturan nama pengguna (identitas masuk) dan email kontak, dipakai aksi otentikasi & kelola pengguna. */
export const POLA_NAMA_PENGGUNA = /^[a-z0-9][a-z0-9._-]{2,31}$/;

export function bacaNamaPengguna(nilai: string): string {
  const bersih = nilai.trim().toLowerCase();
  if (!bersih) throw new Error("Nama pengguna wajib diisi");
  if (!POLA_NAMA_PENGGUNA.test(bersih)) {
    throw new Error("Nama pengguna 3–32 karakter: huruf kecil, angka, titik, garis bawah, atau strip; diawali huruf/angka");
  }
  return bersih;
}

export function bacaEmailOpsional(nilai: string): string | null {
  const bersih = nilai.trim().toLowerCase();
  if (!bersih) return null;
  if (!bersih.includes("@")) throw new Error("Format email tidak valid");
  return bersih;
}
