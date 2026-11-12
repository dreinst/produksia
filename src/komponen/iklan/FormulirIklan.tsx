import type { StatusFormulir } from "@/lib/statusFormulir";
import FormulirAksi from "@/komponen/FormulirAksi";

export type NilaiIklan = {
  nama: string;
  setIklanId: string;
  berkasKreatifId: string | null;
  judulIklan: string | null;
  cta: string | null;
  urlTujuan: string | null;
  teksUtama: string | null;
  catatan: string | null;
};

/** Pilihan kreatif: berkas yang terlihat bagi pembaca, dikelompokkan menurut asalnya. */
export type KelompokKreatif = { label: string; berkas: { id: string; nama: string }[] };

/**
 * Formulir iklan (D6 §7.8 no. 4), di dalam <details> halaman detail kampanye. Pilihan kreatif berasal dari lampiran
 * kampanye dan berkas hasil tugas desain yang menaut kampanye ini, keduanya sudah disaring hak lihat pembaca; nilai
 * sekarang selalu ikut (kreatif yang tidak terlihat ditulis "Berkas tersembunyi" supaya tidak terlepas saat disimpan).
 * Server tetap memeriksa perusahaan dan hak lihat berkas.
 */
export default function FormulirIklan({
  aksi,
  awalan,
  nilai,
  setIklan,
  kreatif,
  kreatifSekarang,
  tombol,
  pesanSukses,
}: {
  aksi: (sebelumnya: StatusFormulir, dataFormulir: FormData) => Promise<StatusFormulir>;
  awalan: string;
  nilai: NilaiIklan;
  setIklan: { id: string; nama: string }[];
  kreatif: KelompokKreatif[];
  /** kreatif iklan ini bila tidak ada di `kreatif` (mis. tersembunyi bagi pembaca atau sudah dibuang) */
  kreatifSekarang?: { id: string; nama: string } | null;
  tombol: string;
  pesanSukses: string;
}) {
  const id = (k: string) => `${awalan}${k}`;
  const adaDiPilihan = kreatif.some((g) => g.berkas.some((b) => b.id === nilai.berkasKreatifId));
  return (
    <FormulirAksi aksi={aksi} pesanSukses={pesanSukses} className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="bidang md:col-span-2">
        <label className="label" htmlFor={id("nama")}>
          Nama iklan *
        </label>
        <input id={id("nama")} name="nama" required maxLength={200} defaultValue={nilai.nama} className="isian min-h-11" />
      </div>
      <div className="bidang">
        <label className="label" htmlFor={id("set")}>
          Set iklan
        </label>
        <select id={id("set")} name="setIklanId" required defaultValue={nilai.setIklanId} className="isian min-h-11">
          {setIklan.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nama}
            </option>
          ))}
        </select>
      </div>
      <div className="bidang">
        <label className="label" htmlFor={id("kreatif")}>
          Kreatif / berkas referensi
        </label>
        <select id={id("kreatif")} name="berkasKreatifId" defaultValue={nilai.berkasKreatifId ?? ""} className="isian min-h-11">
          <option value="">Tanpa kreatif</option>
          {nilai.berkasKreatifId && !adaDiPilihan && kreatifSekarang && <option value={kreatifSekarang.id}>{kreatifSekarang.nama}</option>}
          {kreatif
            .filter((g) => g.berkas.length > 0)
            .map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.berkas.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.nama}
                  </option>
                ))}
              </optgroup>
            ))}
        </select>
      </div>
      <div className="bidang">
        <label className="label" htmlFor={id("judul")}>
          Judul iklan
        </label>
        <input id={id("judul")} name="judulIklan" maxLength={200} defaultValue={nilai.judulIklan ?? ""} className="isian min-h-11" />
      </div>
      <div className="bidang">
        <label className="label" htmlFor={id("cta")}>
          CTA
        </label>
        <input id={id("cta")} name="cta" maxLength={60} defaultValue={nilai.cta ?? ""} className="isian min-h-11" />
      </div>
      <div className="bidang md:col-span-2">
        <label className="label" htmlFor={id("url")}>
          URL tujuan
        </label>
        <input id={id("url")} name="urlTujuan" type="url" maxLength={2000} placeholder="https://" defaultValue={nilai.urlTujuan ?? ""} className="isian min-h-11" />
      </div>
      <div className="bidang md:col-span-2">
        <label className="label" htmlFor={id("teks")}>
          Teks utama
        </label>
        <textarea id={id("teks")} name="teksUtama" rows={3} maxLength={5000} defaultValue={nilai.teksUtama ?? ""} className="isian" />
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
