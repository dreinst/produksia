import type { JenisCetakPenjualan } from "@/lib/cetak/tipe";

/**
 * Tautan cepat ke PDF satu dokumen penjualan (D3 §7.1), dibuka di tab baru. Sengaja <a>, bukan <Link>: tujuannya rute
 * PDF, bukan halaman aplikasi. Pemasang (panel termin, tombol cetak P45) memeriksa hak lihat dokumennya sendiri.
 */
export default function TautanCetak({ jenis, id, label, className = "tombol-tautan" }: { jenis: JenisCetakPenjualan; id: string; label?: string; className?: string }) {
  return (
    <a href={`/cetak/${jenis}/${encodeURIComponent(id)}`} target="_blank" rel="noopener" className={className}>
      {label ?? "Cetak"}
    </a>
  );
}
