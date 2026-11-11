import { db } from "@/lib/db";
import { PESAN_TAUTAN_TIDAK_BERLAKU, bacaTautanPublik } from "@/lib/berkas";

/**
 * Tautan bagi publik (D7 §3.3.13): tanpa sesi (jalur /b ada di JALUR_PUBLIK), selalu attachment, tidak diindeks.
 * Token tidak dicatat di mana pun.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const hasil = await bacaTautanPublik(db, token);
    if (hasil.status === 404) return new Response(PESAN_TAUTAN_TIDAK_BERLAKU, { status: 404, headers: hasil.kepala });
    return new Response(hasil.isi, { status: 200, headers: hasil.kepala });
  } catch (e) {
    console.error("[berkas]", e);
    return new Response("Terjadi kesalahan. Coba lagi.", { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store" } });
  }
}
