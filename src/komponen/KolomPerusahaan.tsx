import type { Lingkup, RingkasPerusahaan } from "@/lib/perusahaan";
import LencanaPerusahaan from "@/komponen/ui/LencanaPerusahaan";

/**
 * Isian perusahaan di formulir dokumen akar (D1 §7.1). Tanpa hook, jadi boleh menjadi anak FormulirAksi.
 * - Lingkup satu perusahaan aktif: isian tersembunyi `perusahaanId` dan tampilan baca saja nama perusahaannya.
 * - Lingkup gabungan: pilihan wajib berisi perusahaan aktif.
 * - Lingkup perusahaan yang sudah diarsipkan: pilihan wajib seperti gabungan, karena dokumen baru tidak bisa dibuat
 *   untuk perusahaan arsip dan perusahaan lain tidak boleh terpilih diam-diam.
 * Server tetap memvalidasi isiannya (perusahaanDokumenBaru).
 */
export default function KolomPerusahaan({
  lingkup,
  daftar,
  nama = "perusahaanId",
  label = "Perusahaan",
}: {
  lingkup: Lingkup;
  /** perusahaan aktif (daftarPerusahaan()) */
  daftar: RingkasPerusahaan[];
  nama?: string;
  label?: string;
}) {
  const aktif = daftar.filter((p) => p.aktif);
  const satu = lingkup.perusahaan && aktif.some((p) => p.id === lingkup.perusahaan?.id) ? lingkup.perusahaan : null;

  if (satu) {
    return (
      <div className="bidang">
        <input type="hidden" name={nama} value={satu.id} />
        <span className="label">{label}</span>
        <div className="isian flex items-center gap-2 bg-slate-50 text-slate-700" aria-readonly="true">
          <LencanaPerusahaan kode={satu.kode} warna={satu.warna} />
          <span className="truncate">{satu.nama}</span>
        </div>
        <span className="petunjuk">Ganti lewat pemilih perusahaan di bilah samping</span>
      </div>
    );
  }

  return (
    <div className="bidang">
      <label className="label" htmlFor={nama}>
        {label} *
      </label>
      <select id={nama} name={nama} required defaultValue="" className="isian">
        <option value="">Pilih perusahaan…</option>
        {aktif.map((p) => (
          <option key={p.id} value={p.id}>
            {`${p.kode} - ${p.nama}`}
          </option>
        ))}
      </select>
      {lingkup.perusahaan && !lingkup.perusahaan.aktif && (
        <span className="petunjuk">{`${lingkup.perusahaan.nama} sudah diarsipkan; dokumen baru dibuat untuk perusahaan aktif yang dipilih`}</span>
      )}
    </div>
  );
}
