/**
 * Lencana kode perusahaan dengan titik warna merek. Tanpa hook, jadi bisa dipakai di komponen server maupun klien
 * (kolom "Perusahaan" daftar gabungan, pemilih lingkup, laporan).
 */
export default function LencanaPerusahaan({ kode, warna, nama }: { kode: string; warna?: string | null; nama?: string }) {
  return (
    <span className="lencana lencana-slate mono" title={nama}>
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: warna ?? "#94a3b8" }} aria-hidden="true" />
      {kode}
    </span>
  );
}
