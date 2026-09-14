/**
 * Pembantu bersama skrip regresi (skrip/uji-*.ts).
 * Skrip memanggil aksi server langsung tanpa HTTP: redirect dan revalidatePath melempar galat khusus Next
 * yang di sini dianggap sukses; hasilnya diperiksa dari basis data.
 */
export async function jalankan(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (err) {
    const digest = (err as { digest?: string })?.digest ?? "";
    const pesan = (err as { message?: string })?.message ?? "";
    // redirect, revalidatePath, dan cookies() (buat sesi) hanya berjalan di dalam permintaan HTTP
    if (!digest.startsWith("NEXT_REDIRECT") && !pesan.includes("static generation store missing") && !pesan.includes("outside a request scope")) throw err;
  }
  console.log(`[ok] ${label}`);
}

/** FormData dari objek; nilai objek/array diserialisasi JSON (baris dokumen). */
export function formulir(isian: Record<string, string | number | boolean | object | null | undefined>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(isian)) {
    if (v === null || v === undefined) continue;
    fd.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  }
  return fd;
}

export function pastikan(kondisi: unknown, pesan: string): asserts kondisi {
  if (!kondisi) {
    console.error(`[FAIL] ${pesan}`);
    process.exit(1);
  }
  console.log(`[ok] ${pesan}`);
}

/**
 * Menjalankan `fn` sebagai pengguna sungguhan (dibaca dari tabel Pengguna lewat UJI_PENGGUNA).
 * Dibutuhkan uji alur persetujuan: pemisahan tugas membandingkan id pengguna, jadi pengaju dan
 * pemeriksa harus dua identitas berbeda yang benar-benar ada di basis data.
 */
export async function sebagai<T>(namaPengguna: string, fn: () => Promise<T>): Promise<T> {
  const sebelumnya = process.env.UJI_PENGGUNA;
  process.env.UJI_PENGGUNA = namaPengguna;
  try {
    return await fn();
  } finally {
    if (sebelumnya === undefined) delete process.env.UJI_PENGGUNA;
    else process.env.UJI_PENGGUNA = sebelumnya;
  }
}

/**
 * Menyalakan / mematikan alur persetujuan untuk skrip uji.
 *
 * Di dalam skrip uji alur persetujuan MATI secara bawaan (lihat persetujuanWajib di
 * src/lib/persetujuan.ts), supaya skrip lama yang memeriksa "buat dokumen → jurnalnya langsung ada"
 * tetap berlaku. Skrip yang memang menguji alur persetujuan memanggil `aturPersetujuan(true)`.
 */
export function aturPersetujuan(wajib: boolean) {
  if (wajib) process.env.UJI_PERSETUJUAN = "1";
  else delete process.env.UJI_PERSETUJUAN;
}

/** Aksi harus melempar galat yang memuat `potongan`; lolos (termasuk redirect/revalidate) = gagal uji. */
export async function harusDitolak(label: string, fn: () => Promise<unknown>, potongan: string) {
  try {
    await fn();
  } catch (err) {
    const digest = (err as { digest?: string })?.digest ?? "";
    const pesan = (err as { message?: string })?.message ?? String(err);
    if (digest.startsWith("NEXT_REDIRECT") || pesan.includes("static generation store missing")) {
      console.error(`[FAIL] ${label} TIDAK ditolak`);
      process.exit(1);
    }
    pastikan(pesan.includes(potongan), `${label} ditolak: "${pesan}"`);
    return;
  }
  console.error(`[FAIL] ${label} TIDAK ditolak`);
  process.exit(1);
}
