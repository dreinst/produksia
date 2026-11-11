import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import KerangkaAplikasi from "@/komponen/KerangkaAplikasi";
import { db } from "@/lib/db";
import { penggunaSaatIni } from "@/lib/otentikasi";
import { ambilPengaturanPerusahaan } from "@/lib/pengaturanPerusahaan";
import { PERUSAHAAN_UTAMA, daftarPerusahaan, lingkupPerusahaan } from "@/lib/perusahaan";

/**
 * Semua halaman aplikasi berada di bawah grup rute ini: butuh sesi yang sah.
 * Layout tidak dirender ulang di setiap navigasi klien, jadi tiap halaman TETAP memanggil
 * wajibHak/wajibMasuk sendiri; di sini hanya untuk memasang kerangka dengan identitas pengguna.
 */
export default async function TataLetakAplikasi({ children }: { children: ReactNode }) {
  const pengguna = await penggunaSaatIni();
  if (!pengguna) redirect("/masuk");
  const [perusahaan, rentang, lingkup, semuaPerusahaan] = await Promise.all([
    ambilPengaturanPerusahaan(),
    // MIN/MAX memakai indeks Jurnal(tanggal): konstan, tidak memindai seluruh jurnal tiap permintaan
    db.jurnal.aggregate({ _min: { tanggal: true }, _max: { tanggal: true } }),
    lingkupPerusahaan(),
    daftarPerusahaan(true),
  ]);
  const tahunIni = new Date().getFullYear();
  const tahunAwal = rentang._min.tanggal?.getFullYear() ?? tahunIni;
  const tahunAkhir = rentang._max.tanggal?.getFullYear() ?? tahunIni;
  const tahunJurnal = Array.from({ length: Math.max(0, tahunAkhir - tahunAwal + 1) }, (_, i) => tahunAwal + i);
  const daftarTahun = [...new Set([...tahunJurnal, perusahaan.tahunBuku, tahunIni - 1, tahunIni, tahunIni + 1])].sort((a, b) => b - a);
  // Perusahaan utama memakai nama dari baris pengaturan "default", sama dengan tampilan lama. Sejak P19 ubahPerusahaan
  // menyalin nama utama ke baris itu dan ke tabel Perusahaan sekaligus, jadi keduanya sama sesudah simpan pertama.
  // Perusahaan lain memakai namanya sendiri, gabungan "Semua perusahaan".
  const namaPerusahaan = lingkup.perusahaanId === null ? "Semua perusahaan" : lingkup.perusahaanId === PERUSAHAAN_UTAMA ? perusahaan.nama : (lingkup.perusahaan?.nama ?? perusahaan.nama);
  return (
    <KerangkaAplikasi
      pengguna={pengguna}
      namaPerusahaan={namaPerusahaan}
      tahunBuku={perusahaan.tahunBuku}
      daftarTahun={daftarTahun}
      perusahaanAktif={lingkup.perusahaan}
      daftarPerusahaan={semuaPerusahaan}
      bolehGabungan={lingkup.bolehGabungan}
    >
      {children}
    </KerangkaAplikasi>
  );
}
