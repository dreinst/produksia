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
  const [perusahaan, rentang] = await Promise.all([
    ambilPengaturanPerusahaan(),
    // MIN/MAX memakai indeks Jurnal(tanggal): konstan, tidak memindai seluruh jurnal tiap permintaan
    db.jurnal.aggregate({ _min: { tanggal: true }, _max: { tanggal: true } }),
  ]);
  const tahunIni = new Date().getFullYear();
  const tahunAwal = rentang._min.tanggal?.getFullYear() ?? tahunIni;
  const tahunAkhir = rentang._max.tanggal?.getFullYear() ?? tahunIni;
  const tahunJurnal = Array.from({ length: Math.max(0, tahunAkhir - tahunAwal + 1) }, (_, i) => tahunAwal + i);
  const daftarTahun = [...new Set([...tahunJurnal, perusahaan.tahunBuku, tahunIni - 1, tahunIni, tahunIni + 1])].sort((a, b) => b - a);
  return (
    <KerangkaAplikasi pengguna={pengguna} namaPerusahaan={perusahaan.nama} tahunBuku={perusahaan.tahunBuku} daftarTahun={daftarTahun}>
      {children}
    </KerangkaAplikasi>
  );
}
