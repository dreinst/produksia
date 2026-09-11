import { unstable_rethrow } from "next/navigation";

export type StatusFormulir = { galat: string | null; ok?: boolean };


/**
 * Galat yang DILEMPAR dengan sengaja oleh aplikasi selalu berupa Error biasa (new Error("pesan"))
 * tanpa kode/metadata driver, jadi pesannya aman ditampilkan ke pengguna. Galat internal tak terduga
 * (PrismaClient*Error, galat driver pg, galat koneksi, TypeError, dsb.) TIDAK BOLEH dibocorkan mentah
 * ke klien karena pesannya bisa memuat host/port DB, nama tabel/kolom/model, atau struktur kueri (CWE-209).
 */
function galatInternalTakTerduga(galat: unknown): boolean {
  if (!(galat instanceof Error)) return true;
  // Subkelas bawaan (TypeError, RangeError, ...) atau galat ORM/driver (PrismaClient*Error,
  // DatabaseError, AggregateError) punya nama konstruktor selain "Error".
  if (galat.constructor?.name !== "Error") return true;
  // Galat sistem/driver membawa properti khas (kode koneksi, metadata Prisma/pg).
  const x = galat as { code?: unknown; errno?: unknown; syscall?: unknown; severity?: unknown; clientVersion?: unknown };
  return x.code != null || x.errno != null || x.syscall != null || x.severity != null || x.clientVersion != null;
}

function pesanRamah(galat: unknown): string {
  const e = galat as { code?: string; message?: string; meta?: { target?: string[] } };
  if (e?.code === "P2002") {
    const bidang = e.meta?.target?.join(", ");
    return bidang
      ? `Data dengan ${bidang} yang sama sudah ada (harus unik).`
      : "Data dengan nilai yang sama sudah ada (harus unik).";
  }
  if (e?.code === "P2003") {
    return "Data ini masih dipakai oleh data/transaksi lain, tidak bisa dihapus atau diubah.";
  }
  if (e?.code === "P2025") {
    return "Data tidak ditemukan (mungkin sudah dihapus).";
  }
  if (e?.message?.includes("StokBarang_jumlah_tidak_negatif")) {
    return "Stok tidak cukup. Muat ulang halaman lalu coba lagi.";
  }
  // Galat internal tak terduga hanya dicatat di server (console.error di jalankanFormulir),
  // klien cukup dapat pesan generik supaya detail internal tidak bocor.
  if (galatInternalTakTerduga(galat)) return "Terjadi kesalahan. Coba lagi.";
  return e?.message || "Terjadi kesalahan. Coba lagi.";
}

/**
 * Menjalankan aksi server di dalam try/catch supaya pesan validasi bisa dikembalikan ke formulir.
 * Di produksi Next.js menyamarkan galat yang di-throw dari aksi server menjadi pesan generik,
 * jadi satu-satunya cara menampilkan pesan yang berguna ke pengguna adalah MENGEMBALIKANNYA sebagai status.
 * redirect()/notFound() tetap diteruskan lewat unstable_rethrow.
 */
export async function jalankanFormulir(fungsi: () => Promise<void>): Promise<StatusFormulir> {
  try {
    await fungsi();
    return { galat: null, ok: true };
  } catch (galat) {
    unstable_rethrow(galat);
    console.error("[aksi formulir]", galat);
    return { galat: pesanRamah(galat) };
  }
}

/** Seperti jalankanFormulir, tetapi meneruskan nilai balik aksi (mis. tautan sekali pakai) ke formulir. */
export async function jalankanFormulirHasil<T>(fungsi: () => Promise<T>): Promise<StatusFormulir & { hasil?: T }> {
  try {
    const hasil = await fungsi();
    return { galat: null, ok: true, hasil };
  } catch (galat) {
    unstable_rethrow(galat);
    console.error("[aksi formulir]", galat);
    return { galat: pesanRamah(galat) };
  }
}
