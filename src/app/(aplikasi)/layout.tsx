import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import KerangkaAplikasi from "@/komponen/KerangkaAplikasi";
import { penggunaSaatIni } from "@/lib/otentikasi";

/**
 * Semua halaman aplikasi berada di bawah grup rute ini: butuh sesi yang sah.
 * Layout tidak dirender ulang di setiap navigasi klien, jadi tiap halaman TETAP memanggil
 * wajibHak/wajibMasuk sendiri; di sini hanya untuk memasang kerangka dengan identitas pengguna.
 */
export default async function TataLetakAplikasi({ children }: { children: ReactNode }) {
  const pengguna = await penggunaSaatIni();
  if (!pengguna) redirect("/masuk");
  return <KerangkaAplikasi pengguna={pengguna}>{children}</KerangkaAplikasi>;
}
