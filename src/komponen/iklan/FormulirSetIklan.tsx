import type { GenderAudiens } from "@/prisma-klien/enums";
import type { StatusFormulir } from "@/lib/statusFormulir";
import { LABEL_GENDER } from "@/lib/labelPemasaran";
import FormulirAksi from "@/komponen/FormulirAksi";

const URUTAN_GENDER: readonly GenderAudiens[] = ["SEMUA", "PEREMPUAN", "LAKI_LAKI"];

export type NilaiSetIklan = {
  nama: string;
  audiens: string | null;
  lokasi: string | null;
  usia: string | null;
  gender: GenderAudiens;
  penempatan: string | null;
  anggaran: string;
  catatan: string | null;
};

export const SET_IKLAN_KOSONG: NilaiSetIklan = { nama: "", audiens: null, lokasi: null, usia: null, gender: "SEMUA", penempatan: null, anggaran: "0", catatan: null };

/**
 * Formulir set iklan (D6 §7.8 no. 3), dipakai di dalam <details> halaman detail kampanye. `awalan` membuat id isian unik
 * per formulir (mis. "ubah-set-{id}-", spec/06 §7.2).
 */
export default function FormulirSetIklan({
  aksi,
  awalan,
  nilai = SET_IKLAN_KOSONG,
  tombol,
  pesanSukses,
}: {
  aksi: (sebelumnya: StatusFormulir, dataFormulir: FormData) => Promise<StatusFormulir>;
  awalan: string;
  nilai?: NilaiSetIklan;
  tombol: string;
  pesanSukses: string;
}) {
  const id = (k: string) => `${awalan}${k}`;
  return (
    <FormulirAksi aksi={aksi} pesanSukses={pesanSukses} className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="bidang md:col-span-2">
        <label className="label" htmlFor={id("nama")}>
          Nama set iklan *
        </label>
        <input id={id("nama")} name="nama" required maxLength={200} defaultValue={nilai.nama} className="isian min-h-11" />
      </div>
      <div className="bidang md:col-span-2">
        <label className="label" htmlFor={id("audiens")}>
          Audiens
        </label>
        <input id={id("audiens")} name="audiens" maxLength={500} defaultValue={nilai.audiens ?? ""} className="isian min-h-11" />
      </div>
      <div className="bidang">
        <label className="label" htmlFor={id("lokasi")}>
          Lokasi
        </label>
        <input id={id("lokasi")} name="lokasi" maxLength={200} defaultValue={nilai.lokasi ?? ""} className="isian min-h-11" />
      </div>
      <div className="bidang">
        <label className="label" htmlFor={id("usia")}>
          Usia (mis. 22-40)
        </label>
        <input id={id("usia")} name="usia" maxLength={20} defaultValue={nilai.usia ?? ""} className="isian min-h-11" />
      </div>
      <div className="bidang">
        <label className="label" htmlFor={id("gender")}>
          Gender
        </label>
        <select id={id("gender")} name="gender" defaultValue={nilai.gender} className="isian min-h-11">
          {URUTAN_GENDER.map((g) => (
            <option key={g} value={g}>
              {LABEL_GENDER[g]}
            </option>
          ))}
        </select>
      </div>
      <div className="bidang">
        <label className="label" htmlFor={id("penempatan")}>
          Penempatan
        </label>
        <input id={id("penempatan")} name="penempatan" maxLength={200} defaultValue={nilai.penempatan ?? ""} className="isian min-h-11" />
      </div>
      <div className="bidang">
        <label className="label" htmlFor={id("anggaran")}>
          Anggaran (Rp)
        </label>
        <input id={id("anggaran")} name="anggaran" inputMode="decimal" defaultValue={nilai.anggaran} className="isian min-h-11 angka" />
      </div>
      <div className="bidang md:col-span-2">
        <label className="label" htmlFor={id("catatan")}>
          Catatan
        </label>
        <textarea id={id("catatan")} name="catatan" rows={2} maxLength={5000} defaultValue={nilai.catatan ?? ""} className="isian" />
      </div>
      <div className="md:col-span-2">
        <button type="submit" className="tombol tombol-utama min-h-11 w-full sm:w-auto">
          {tombol}
        </button>
      </div>
    </FormulirAksi>
  );
}
