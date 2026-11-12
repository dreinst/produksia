import { NextResponse, type NextRequest } from "next/server";
import { NAMA_COOKIE_SESI, jalurPublik } from "@/lib/hakAkses";

/*
 * Pemeriksaan optimistis di tepi: permintaan tanpa cookie sesi langsung dialihkan ke /masuk
 * (termasuk prefetch), tanpa menyentuh basis data. Pemeriksaan sesungguhnya, apakah token
 * masih berlaku dan peran berhak, tetap dilakukan di layout, halaman, dan aksi server
 * (lihat src/lib/otentikasi.ts). Daftar jalur tanpa sesi ada di JALUR_PUBLIK (src/lib/hakAkses.ts).
 */

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (jalurPublik(pathname)) return NextResponse.next();

  if (!request.cookies.has(NAMA_COOKIE_SESI)) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ ok: false, galat: "Belum masuk" }, { status: 401 });
    const tujuan = new URL("/masuk", request.url);
    if (pathname !== "/") tujuan.searchParams.set("kembali", pathname + search);
    return NextResponse.redirect(tujuan);
  }
  return NextResponse.next();
}

/*
 * /api/berkas (unggah dan unduh) dan /api/cetak (unggah gambar kop) sengaja tidak melewati proxy: Next menyangga
 * seluruh badan POST yang melewati proxy (sampai 10 MB) sebelum rute berjalan, termasuk dari pengirim tanpa sesi.
 * Rutenya memeriksa sesi (401 JSON yang sama), asal, hak, dan ukuran sendiri. Batas badan di reverse proxy tetap
 * dianjurkan (lihat catatan deploy).
 */
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|manifest\\.webmanifest|api/berkas(?:/|$)|api/cetak(?:/|$)|.*\\.(?:png|jpg|jpeg|svg|webp|woff2?|ico)$).*)"],
};
