import { unstable_rethrow } from "next/navigation";

export type StatusFormulir = { galat: string | null; ok?: boolean };

export const statusFormulirAwal: StatusFormulir = { galat: null };

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
