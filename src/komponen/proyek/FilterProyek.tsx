"use client";

import { FILTER_TANPA_PROYEK, opsiFilterProyek, type FilterProyek as NilaiFilterProyek, type ProyekPilihan } from "@/lib/filterProyek";
import { labelStatus } from "@/komponen/ui/Lencana";

/**
 * Saringan proyek di atas daftar (D5 §7.3): formulir GET dengan satu pilihan "proyek" yang langsung dikirim saat
 * berubah. "Semua proyek" = tanpa saringan, "Tanpa proyek" = dokumen tanpa proyek. Proyek yang diarsipkan atau batal
 * tidak ditawarkan kecuali sedang terpilih, dan status selain Berjalan ditulis sebagai akhiran. `tambahan` berisi
 * parameter lain yang ikut dipertahankan (mis. q dan saringan lain); halaman selalu kembali ke halaman 1.
 */
export default function FilterProyek({
  nilai,
  daftar,
  tambahan,
  label = "Proyek / Event",
}: {
  nilai: NilaiFilterProyek;
  daftar: ProyekPilihan[];
  tambahan?: Record<string, string | undefined>;
  label?: string;
}) {
  const opsi = opsiFilterProyek(daftar, nilai);
  const ekstra = Object.entries(tambahan ?? {}).filter((pasangan): pasangan is [string, string] => Boolean(pasangan[1]) && pasangan[0] !== "proyek" && pasangan[0] !== "hal");
  // id yang tidak ada di daftar (proyek sudah dihapus) ditampilkan sebagai "Semua proyek"
  const terpilih = nilai === "" || nilai === FILTER_TANPA_PROYEK || opsi.some((p) => p.id === nilai) ? nilai : "";

  return (
    <form method="get" className="flex items-center gap-2">
      {ekstra.map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <label htmlFor="saring-proyek" className="text-xs font-semibold text-slate-600 whitespace-nowrap">
        {label}
      </label>
      <select
        id="saring-proyek"
        name="proyek"
        defaultValue={terpilih}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="isian isian-kecil w-auto max-w-xs"
      >
        <option value="">Semua proyek</option>
        <option value={FILTER_TANPA_PROYEK}>Tanpa proyek</option>
        {opsi.map((p) => (
          <option key={p.id} value={p.id}>
            {`${p.kode} - ${p.nama}${p.status !== "BERJALAN" ? ` · ${labelStatus(p.status)}` : ""}`}
          </option>
        ))}
      </select>
      <noscript>
        <button type="submit" className="tombol tombol-garis tombol-kecil">
          Terapkan
        </button>
      </noscript>
    </form>
  );
}
