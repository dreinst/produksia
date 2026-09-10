import { NextResponse, type NextRequest } from "next/server";
import { NAMA_COOKIE_SESI } from "@/lib/hakAkses";

/*
 * Pemeriksaan optimistis di tepi: permintaan tanpa cookie sesi langsung dialihkan ke /masuk
 * (termasuk prefetch), tanpa menyentuh basis data. Pemeriksaan sesungguhnya — apakah token
 * masih berlaku dan peran berhak — tetap dilakukan di layout, halaman, dan aksi server
 * (lihat src/lib/otentikasi.ts).
 */
const JALUR_PUBLIK = ["/masuk", "/lupa-kata-sandi", "/atur-ulang"];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (JALUR_PUBLIK.some((j) => pathname === j || pathname.startsWith(`${j}/`))) return NextResponse.next();

  if (!request.cookies.has(NAMA_COOKIE_SESI)) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ ok: false, galat: "Belum masuk" }, { status: 401 });
    const tujuan = new URL("/masuk", request.url);
    if (pathname !== "/") tujuan.searchParams.set("kembali", pathname + search);
    return NextResponse.redirect(tujuan);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:png|jpg|jpeg|svg|webp|woff2?|ico)$).*)"],
};
