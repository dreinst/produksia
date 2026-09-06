import { unstable_rethrow } from "next/navigation";

export type FormState = { error: string | null; ok?: boolean };

export const initialFormState: FormState = { error: null };

function friendlyMessage(err: unknown): string {
  const e = err as { code?: string; message?: string; meta?: { target?: string[] } };
  if (e?.code === "P2002") {
    const field = e.meta?.target?.join(", ");
    return field
      ? `Data dengan ${field} yang sama sudah ada (harus unik).`
      : "Data dengan nilai yang sama sudah ada (harus unik).";
  }
  if (e?.code === "P2003") {
    return "Data ini masih dipakai oleh data/transaksi lain, tidak bisa dihapus atau diubah.";
  }
  if (e?.code === "P2025") {
    return "Data tidak ditemukan (mungkin sudah dihapus).";
  }
  if (e?.message?.includes("ItemStock_qty_non_negative")) {
    return "Stok tidak cukup — baru saja berkurang oleh transaksi lain. Muat ulang halaman lalu coba lagi.";
  }
  return e?.message || "Terjadi kesalahan. Coba lagi.";
}

/**
 * Menjalankan server action di dalam try/catch supaya pesan validasi bisa dikembalikan ke form.
 * Di production Next.js menyamarkan error yang di-throw dari server action menjadi pesan generik,
 * jadi satu-satunya cara menampilkan pesan yang berguna ke user adalah MENGEMBALIKANNYA sebagai state.
 * redirect()/notFound() tetap diteruskan lewat unstable_rethrow.
 */
export async function runForm(fn: () => Promise<void>): Promise<FormState> {
  try {
    await fn();
    return { error: null, ok: true };
  } catch (err) {
    unstable_rethrow(err);
    console.error("[form action]", err);
    return { error: friendlyMessage(err) };
  }
}
