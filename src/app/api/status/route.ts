import { db } from "@/lib/db";
import { penggunaSaatIni } from "@/lib/otentikasi";

/** Dipakai indikator "PostgreSQL • Terhubung" di sidebar. Hanya untuk pengguna yang sudah masuk. */
export async function GET() {
  if (!(await penggunaSaatIni())) return Response.json({ ok: false, galat: "Belum masuk" }, { status: 401 });
  const jumlahPelanggan = await db.pelanggan.count();
  return Response.json({ ok: true, jumlahPelanggan });
}
