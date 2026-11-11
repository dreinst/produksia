import TitikWarnaProyek from "@/komponen/proyek/TitikWarnaProyek";

/**
 * Lencana proyek: titik warna + nama proyek, kode sebagai judul (padanan ProjectBadge HKA, D5 §7.3). Tidak dirender
 * bila dokumen tanpa proyek. Dipakai domain lain di kolom daftar mereka.
 */
export default function LencanaProyek({ proyek }: { proyek: { kode: string; nama: string; warna?: string | null } | null | undefined }) {
  if (!proyek) return null;
  return (
    <span className="lencana lencana-slate max-w-full" title={`${proyek.kode} ${proyek.nama}`}>
      <TitikWarnaProyek warna={proyek.warna} />
      <span className="truncate">{proyek.nama}</span>
    </span>
  );
}
