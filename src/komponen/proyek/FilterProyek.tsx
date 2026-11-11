"use client";

import { useRef } from "react";
import { FILTER_TANPA_PROYEK, opsiFilterProyek, type FilterProyek as NilaiFilterProyek, type ProyekPilihan } from "@/lib/filterProyek";
import { labelStatus } from "@/komponen/ui/Lencana";

/**
 * Saringan proyek di atas daftar (D5 §7.3): formulir GET dengan satu pilihan "proyek". "Semua proyek" = tanpa
 * saringan, "Tanpa proyek" = dokumen tanpa proyek. Proyek yang diarsipkan atau batal tidak ditawarkan kecuali sedang
 * terpilih, dan status selain Berjalan ditulis sebagai akhiran. `tambahan` berisi parameter lain yang ikut
 * dipertahankan (mis. q dan saringan lain); halaman selalu kembali ke halaman 1.
 *
 * Pilihan dengan tetikus atau sentuhan langsung dikirim (D5 §7.3). Perubahan lewat panah papan ketik tidak dikirim,
 * karena di Windows panah pada pilihan yang tertutup langsung mengganti nilai; pengguna papan ketik menekan Enter
 * atau tombol "Terapkan" yang muncul saat mendapat fokus (tinjauan P15 butir 5).
 *
 * Id proyek yang ada tetapi tidak ada di `daftar` (mis. proyek perusahaan lain sesudah lingkup diganti) tetap tampil
 * sebagai "Proyek di luar lingkup" supaya saringan yang aktif terlihat (tinjauan P15 butir 4).
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
  const dariPapanKetik = useRef(false);
  const ekstra = Object.entries(tambahan ?? {}).filter((pasangan): pasangan is [string, string] => Boolean(pasangan[1]) && pasangan[0] !== "proyek" && pasangan[0] !== "hal");
  const luarDaftar = nilai !== "" && nilai !== FILTER_TANPA_PROYEK && !opsi.some((p) => p.id === nilai);

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
        defaultValue={nilai}
        onKeyDown={(e) => {
          dariPapanKetik.current = true;
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }
        }}
        onPointerDown={() => {
          dariPapanKetik.current = false;
        }}
        onChange={(e) => {
          if (!dariPapanKetik.current) e.currentTarget.form?.requestSubmit();
        }}
        className="isian isian-kecil w-auto max-w-xs"
      >
        <option value="">Semua proyek</option>
        <option value={FILTER_TANPA_PROYEK}>Tanpa proyek</option>
        {luarDaftar && <option value={nilai}>Proyek di luar lingkup</option>}
        {opsi.map((p) => (
          <option key={p.id} value={p.id}>
            {`${p.kode} - ${p.nama}${p.status !== "BERJALAN" ? ` · ${labelStatus(p.status)}` : ""}`}
          </option>
        ))}
      </select>
      {/* tersembunyi sampai mendapat fokus (Tab dari pilihan); tanpa JS pengguna juga memakainya */}
      <button type="submit" className="tombol tombol-garis tombol-kecil sr-only focus:not-sr-only">
        Terapkan
      </button>
    </form>
  );
}
