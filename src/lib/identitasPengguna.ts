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

/** Nomor WhatsApp format Indonesia, mis. +6281234567890. Wajib untuk semua peran KECUALI GUEST. */
export const POLA_NOMOR_TELEPON = /^\+62[1-9][0-9]{7,13}$/;

export function bacaNomorTelepon(nilai: string, wajib: boolean): string | null {
  const bersih = nilai.trim().replace(/[\s-]/g, "");
  if (!bersih) {
    if (wajib) throw new Error("Nomor WhatsApp wajib diisi (format +62...)");
    return null;
  }
  if (!POLA_NOMOR_TELEPON.test(bersih)) throw new Error("Format nomor WhatsApp tidak valid, mis. +6281234567890");
  return bersih;
}
