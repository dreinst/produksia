import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import KerangkaAplikasi from "@/komponen/KerangkaAplikasi";
import { db } from "@/lib/db";
import { penggunaSaatIni } from "@/lib/otentikasi";
import { ambilPengaturanPerusahaan } from "@/lib/pengaturanPerusahaan";

/**
 * Semua halaman aplikasi berada di bawah grup rute ini: butuh sesi yang sah.
 * Layout tidak dirender ulang di setiap navigasi klien, jadi tiap halaman TETAP memanggil
 * wajibHak/wajibMasuk sendiri; di sini hanya untuk memasang kerangka dengan identitas pengguna.
 */
export default async function TataLetakAplikasi({ children }: { children: ReactNode }) {
  const pengguna = await penggunaSaatIni();
  if (!pengguna) redirect("/masuk");
  const [perusahaan, tahunJurnal] = await Promise.all([
    ambilPengaturanPerusahaan(),
    db.$queryRaw<{ tahun: number }[]>`SELECT DISTINCT EXTRACT(YEAR FROM "tanggal")::int AS tahun FROM "Jurnal" ORDER BY 1`,
  ]);
  const tahunIni = new Date().getFullYear();
  const daftarTahun = [...new Set([...tahunJurnal.map((t) => t.tahun), perusahaan.tahunBuku, tahunIni - 1, tahunIni, tahunIni + 1])].sort((a, b) => b - a);
  return (
    <KerangkaAplikasi pengguna={pengguna} namaPerusahaan={perusahaan.nama} tahunBuku={perusahaan.tahunBuku} daftarTahun={daftarTahun}>
      {children}
    </KerangkaAplikasi>
  );
}
