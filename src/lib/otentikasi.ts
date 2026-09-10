import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { LABEL_PERAN, NAMA_COOKIE_SESI, SEMUA_HAK, hitungHak, labelHak, punyaHak, type Hak, type PenggunaSesi } from "@/lib/hakAkses";
import type { PeranPengguna } from "@/prisma-klien/client";

export { hashKataSandi, verifikasiKataSandi, periksaKekuatanKataSandi, PANJANG_KATA_SANDI_MINIMUM } from "@/lib/kataSandi";

/*
 * Sesi login berbasis basis data:
 * - cookie hanya berisi token acak 256-bit; tabel Sesi menyimpan SHA-256-nya
 *   (kalau isi basis data bocor, token di dalamnya tidak bisa dipakai untuk masuk)
 * - tidak ada kunci rahasia yang perlu diatur di .env
 * - mencabut sesi = menghapus barisnya (keluar dari semua perangkat, nonaktifkan akun, ganti kata sandi)
 */

const UMUR_SESI_MS = 30 * 24 * 60 * 60 * 1000; // 30 hari

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function buatSesi(penggunaId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const kedaluwarsa = new Date(Date.now() + UMUR_SESI_MS);
  await db.sesi.create({ data: { tokenHash: hashToken(token), penggunaId, kedaluwarsa } });
  (await cookies()).set(NAMA_COOKIE_SESI, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: kedaluwarsa,
    path: "/",
  });
}

export async function hapusSesi(): Promise<void> {
  const toko = await cookies();
  const token = toko.get(NAMA_COOKIE_SESI)?.value;
  if (token) await db.sesi.deleteMany({ where: { tokenHash: hashToken(token) } });
  toko.delete(NAMA_COOKIE_SESI);
}

/** Mengeluarkan pengguna dari semua perangkat (dipakai saat kata sandi diganti / akun dinonaktifkan). */
export async function hapusSemuaSesiPengguna(penggunaId: string): Promise<void> {
  await db.sesi.deleteMany({ where: { penggunaId } });
}

const DI_LUAR_PERMINTAAN = Symbol("di-luar-permintaan");

async function bacaTokenCookie(): Promise<string | null | typeof DI_LUAR_PERMINTAAN> {
  try {
    return (await cookies()).get(NAMA_COOKIE_SESI)?.value ?? null;
  } catch {
    // cookies() hanya tersedia di dalam siklus permintaan HTTP
    return DI_LUAR_PERMINTAAN;
  }
}

/**
 * Pengguna yang sedang masuk, atau null. Di-cache per render (React cache) supaya
 * layout, halaman, dan komponen yang sama-sama memanggilnya cukup satu kueri.
 */
export const penggunaSaatIni = cache(async (): Promise<PenggunaSesi | null> => {
  const token = await bacaTokenCookie();
  if (token === DI_LUAR_PERMINTAAN) {
    // Skrip regresi (skrip/uji-*.ts) memanggil aksi server langsung tanpa HTTP.
    // Pintu ini hanya terbuka di luar produksi DAN bila skrip menyetel UJI_TANPA_SESI=1.
    if (process.env.NODE_ENV !== "production" && process.env.UJI_TANPA_SESI === "1") {
      // UJI_PERAN=KASIR dsb. meniru peran lain (hak bawaan ± penyesuaian di tabel HakAksesPeran)
      const peran = (process.env.UJI_PERAN as PeranPengguna | undefined) ?? "PEMILIK";
      const penyesuaian = peran === "PEMILIK" ? [] : await db.hakAksesPeran.findMany({ where: { peran }, select: { hak: true, boleh: true } });
      return { id: "skrip-uji", nama: "Skrip Uji", namaPengguna: "skrip-uji", email: null, peran, hak: peran === "PEMILIK" ? SEMUA_HAK : hitungHak(peran, penyesuaian) };
    }
    return null;
  }
  if (!token) return null;

  const sesi = await db.sesi.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { pengguna: { select: { id: true, nama: true, namaPengguna: true, email: true, peran: true, aktif: true } } },
  });
  if (!sesi || sesi.kedaluwarsa < new Date() || !sesi.pengguna.aktif) return null;
  const { id, nama, namaPengguna, email, peran } = sesi.pengguna;
  // hak efektif = bawaan peran ± penyesuaian di Pengaturan › Hak Akses (dibaca tiap permintaan, jadi perubahan langsung berlaku)
  const penyesuaian = await db.hakAksesPeran.findMany({ where: { peran }, select: { hak: true, boleh: true } });
  return { id, nama, namaPengguna, email, peran, hak: hitungHak(peran, penyesuaian) };
});

/** Untuk halaman: belum masuk → dialihkan ke /masuk. */
export async function wajibMasuk(): Promise<PenggunaSesi> {
  const pengguna = await penggunaSaatIni();
  if (!pengguna) redirect("/masuk");
  return pengguna;
}

/** Untuk halaman: belum masuk → /masuk; masuk tapi tidak berhak → /tanpa-akses. */
export async function wajibHak(hak: Hak): Promise<PenggunaSesi> {
  const pengguna = await wajibMasuk();
  if (!punyaHak(pengguna, hak)) redirect(`/tanpa-akses?hak=${encodeURIComponent(hak)}`);
  return pengguna;
}

/** Untuk aksi server: melempar galat yang ditampilkan di formulir (bukan redirect, agar isian tidak hilang). */
export async function wajibHakAksi(hak: Hak): Promise<PenggunaSesi> {
  const pengguna = await penggunaSaatIni();
  if (!pengguna) throw new Error("Sesi sudah berakhir. Masuk kembali di tab lain, lalu kirim ulang formulir ini.");
  if (!punyaHak(pengguna, hak)) {
    throw new Error(`Peran ${LABEL_PERAN[pengguna.peran]} tidak punya hak "${labelHak(hak)}" untuk tindakan ini.`);
  }
  return pengguna;
}

/** Untuk aksi server yang memeriksa haknya sendiri setelah membaca data (mis. hapus jurnal menurut sumbernya). */
export async function wajibMasukAksi(): Promise<PenggunaSesi> {
  const pengguna = await penggunaSaatIni();
  if (!pengguna) throw new Error("Sesi sudah berakhir. Masuk kembali di tab lain, lalu kirim ulang formulir ini.");
  return pengguna;
}

/** Melempar galat bila pengguna (sudah masuk) tidak punya hak, dipakai setelah wajibMasukAksi. */
export function pastikanHak(pengguna: PenggunaSesi, hak: Hak) {
  if (!punyaHak(pengguna, hak)) throw new Error(`Peran ${LABEL_PERAN[pengguna.peran]} tidak punya hak "${labelHak(hak)}" untuk tindakan ini.`);
}
