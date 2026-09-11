import { headers } from "next/headers";
import { db } from "@/lib/db";

/*
 * Pembatas laju masuk (anti brute-force/credential-stuffing/password-spraying).
 * Berbasis basis data (tabel PercobaanMasuk) supaya tetap berlaku lintas instance
 * di lingkungan serverless (Vercel) — penghitung in-memory tidak cukup di sana.
 *
 * Dua kunci sekaligus:
 * - per AKUN (namaPengguna): mencegah brute-force satu akun tertentu.
 * - per IP: mencegah password-spraying/credential-stuffing dari satu sumber ke banyak akun.
 *
 * Setelah ambang tercapai, akses dikunci dengan backoff eksponensial (makin sering gagal,
 * makin lama menunggu) sampai kegagalan lama keluar dari jendela pengamatan.
 */

/** Jendela pengamatan kegagalan (mundur dari sekarang). */
const JENDELA_MS = 15 * 60 * 1000; // 15 menit
/** Kegagalan per akun sebelum dikunci. */
const BATAS_AKUN = 5;
/** Kegagalan per IP (lintas akun) sebelum dikunci; lebih longgar agar IP kantor/NAT bersama tidak mudah terkunci. */
const BATAS_IP = 20;
/** Lama kunci dasar begitu ambang tercapai. */
const BACKOFF_DASAR_MS = 60 * 1000; // 1 menit
/** Batas atas lama kunci (= panjang jendela). */
const BACKOFF_MAKS_MS = JENDELA_MS;
/** Delay progresif kecil pada tiap kegagalan (di bawah ambang) untuk memperlambat percobaan beruntun. */
const DELAY_PER_GAGAL_MS = 250;
const DELAY_MAKS_MS = 1000;
/** Permintaan "lupa kata sandi" per IP dalam satu jendela sebelum ditolak (cegah banjir/DoS dari satu sumber). */
const BATAS_ATUR_ULANG_IP = 5;
/** Awalan kunci IP khusus permintaan atur ulang, agar penghitungnya terpisah dari lockout masuk. */
const PRAKUNCI_ATUR_ULANG = "atur-ulang:";

/** Ambil IP klien dari header proxy (tersedia di Vercel), jatuh ke penanda generik bila tak ada. */
export async function bacaIpKlien(): Promise<string> {
  const kepala = await headers();
  const xff = kepala.get("x-forwarded-for");
  if (xff) {
    const pertama = xff.split(",")[0]?.trim();
    if (pertama) return pertama;
  }
  return kepala.get("x-real-ip")?.trim() || "tidak-diketahui";
}

function tunggu(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Terkunci bila jumlah kegagalan dalam jendela ≥ ambang DAN backoff sejak kegagalan terakhir belum lewat. */
async function terkunci(where: { namaPengguna: string } | { ip: string }, batas: number): Promise<boolean> {
  const sejak = new Date(Date.now() - JENDELA_MS);
  const baris = await db.percobaanMasuk.findMany({
    where: { ...where, waktu: { gte: sejak } },
    orderBy: { waktu: "desc" },
    select: { waktu: true },
  });
  if (baris.length < batas) return false;
  const backoff = Math.min(BACKOFF_DASAR_MS * 2 ** (baris.length - batas), BACKOFF_MAKS_MS);
  return Date.now() < baris[0]!.waktu.getTime() + backoff;
}

/** Lempar galat generik bila akun ATAU IP sedang terkunci. Dipanggil sebelum verifikasi kata sandi. */
export async function pastikanBolehCoba(namaPengguna: string, ip: string): Promise<void> {
  const [akunTerkunci, ipTerkunci] = await Promise.all([
    terkunci({ namaPengguna }, BATAS_AKUN),
    terkunci({ ip }, BATAS_IP),
  ]);
  if (akunTerkunci || ipTerkunci) {
    throw new Error("Terlalu banyak percobaan masuk. Coba lagi dalam beberapa menit.");
  }
}

/** Catat satu kegagalan, bersihkan catatan lama, lalu tahan sejenak (delay progresif). */
export async function catatKegagalanMasuk(namaPengguna: string, ip: string): Promise<void> {
  await db.percobaanMasuk.deleteMany({ where: { waktu: { lt: new Date(Date.now() - JENDELA_MS) } } });
  await db.percobaanMasuk.create({ data: { namaPengguna, ip } });
  const sejak = new Date(Date.now() - JENDELA_MS);
  const jumlah = await db.percobaanMasuk.count({ where: { namaPengguna, waktu: { gte: sejak } } });
  await tunggu(Math.min(jumlah * DELAY_PER_GAGAL_MS, DELAY_MAKS_MS));
}

/** Bersihkan kegagalan akun setelah berhasil masuk (kunci per akun langsung pulih). */
export async function resetPercobaanMasuk(namaPengguna: string): Promise<void> {
  await db.percobaanMasuk.deleteMany({ where: { namaPengguna } });
}

/**
 * Batasi laju permintaan "lupa kata sandi" per IP. Memakai tabel PercobaanMasuk yang sama,
 * tetapi IP diberi awalan agar penghitungnya TERPISAH dari lockout masuk (permintaan atur ulang
 * tidak ikut mengunci login, dan sebaliknya). Mengembalikan true bila permintaan harus ditolak
 * karena sudah melebihi ambang dalam jendela berjalan.
 */
export async function lajuAturUlangTerlampaui(ip: string): Promise<boolean> {
  const kunci = PRAKUNCI_ATUR_ULANG + ip;
  const sejak = new Date(Date.now() - JENDELA_MS);
  await db.percobaanMasuk.deleteMany({ where: { ip: kunci, waktu: { lt: sejak } } });
  const jumlah = await db.percobaanMasuk.count({ where: { ip: kunci, waktu: { gte: sejak } } });
  if (jumlah >= BATAS_ATUR_ULANG_IP) return true;
  await db.percobaanMasuk.create({ data: { namaPengguna: PRAKUNCI_ATUR_ULANG, ip: kunci } });
  return false;
}
