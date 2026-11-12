import { WARNA_PROYEK } from "@/lib/proyek";

/** Nama warna untuk pembaca layar, urut WARNA_PROYEK. */
const NAMA_WARNA: Record<(typeof WARNA_PROYEK)[number], string> = {
  "#18181b": "Hitam",
  "#2563eb": "Biru",
  "#0891b2": "Biru kehijauan",
  "#059669": "Hijau",
  "#d97706": "Jingga",
  "#dc2626": "Merah",
  "#db2777": "Merah muda",
  "#7c3aed": "Ungu",
};

/**
 * Pilihan warna proyek (D5 §7.3): radio `name="warna"` delapan contoh warna ditambah "Tanpa warna" (nilai kosong).
 * Komponen server tanpa hook; warna di luar daftar (data lama) tetap terpilih sebagai satu pilihan tambahan.
 */
export default function PilihWarnaProyek({ nilai, nonaktif = false }: { nilai: string | null; nonaktif?: boolean }) {
  const daftar: string[] = [...WARNA_PROYEK];
  if (nilai && !daftar.includes(nilai)) daftar.push(nilai);
  return (
    <fieldset className="space-y-2" disabled={nonaktif}>
      <legend className="label">Warna proyek</legend>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm cursor-pointer has-[:checked]:border-slate-900 has-[:checked]:ring-1 has-[:checked]:ring-slate-900 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-600">
          <input type="radio" name="warna" value="" defaultChecked={!nilai} className="sr-only" />
          <span className="inline-block w-5 h-5 rounded-full border border-dashed border-slate-400" aria-hidden="true" />
          Tanpa warna
        </label>
        {daftar.map((w) => (
          <label key={w} className="flex items-center rounded-lg border border-slate-200 p-1.5 cursor-pointer has-[:checked]:border-slate-900 has-[:checked]:ring-1 has-[:checked]:ring-slate-900 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-600" title={NAMA_WARNA[w as keyof typeof NAMA_WARNA] ?? w}>
            <input type="radio" name="warna" value={w} defaultChecked={nilai === w} className="sr-only" />
            <span className="inline-block w-5 h-5 rounded-full" style={{ backgroundColor: w }} aria-hidden="true" />
            <span className="sr-only">{NAMA_WARNA[w as keyof typeof NAMA_WARNA] ?? w}</span>
          </label>
        ))}
      </div>
      <p className="petunjuk">Tanpa warna, proyek ditandai abu-abu.</p>
    </fieldset>
  );
}
