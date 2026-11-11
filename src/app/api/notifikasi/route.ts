import { db } from "@/lib/db";
import { penggunaSaatIni } from "@/lib/otentikasi";
import { ringkasNotifikasi } from "@/lib/notifikasi";
import { periksaPengingat } from "@/lib/pengingat";

/** Data lonceng notifikasi (D7 §6.2): jalankan pengingat malas, lalu jumlah belum dibaca dan 8 notifikasi terbaru. */
export async function GET() {
  const pengguna = await penggunaSaatIni();
  if (!pengguna) return Response.json({ ok: false, galat: "Belum masuk" }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
  try {
    await periksaPengingat(pengguna);
    const { belumDibaca, terbaru } = await ringkasNotifikasi(db, pengguna.id, 8);
    return Response.json({ ok: true, belumDibaca, terbaru }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (galat) {
    console.error("[notifikasi]", galat);
    return Response.json({ ok: false, galat: "Terjadi kesalahan. Coba lagi." }, { status: 500, headers: { "Cache-Control": "private, no-store" } });
  }
}
