import { db } from "@/lib/db";
import { penggunaSaatIni } from "@/lib/otentikasi";
import { bacaUntukDikirim } from "@/lib/berkas";

/**
 * Pratinjau (gambar dan PDF inline) dan unduh (?unduh=1, selalu attachment) satu berkas (D7 §3.3.10). Wajib masuk;
 * berkas yang tidak boleh dilihat dijawab 404 supaya keberadaannya tidak bocor.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const unduh = new URL(request.url).searchParams.get("unduh") === "1";
    const hasil = await bacaUntukDikirim(db, await penggunaSaatIni(), id, { unduh, ifNoneMatch: request.headers.get("if-none-match") });
    if (hasil.status === 401 || hasil.status === 404) return Response.json({ ok: false, galat: hasil.galat }, { status: hasil.status, headers: { "Cache-Control": "private, no-store" } });
    return new Response(hasil.status === 304 ? null : hasil.isi, { status: hasil.status, headers: hasil.kepala });
  } catch (e) {
    console.error("[berkas]", e);
    return Response.json({ ok: false, galat: "Terjadi kesalahan. Coba lagi." }, { status: 500 });
  }
}
