import type { StatusKampanye, TujuanKampanye } from "@/prisma-klien/enums";
import type { StatusFormulir } from "@/lib/statusFormulir";
import type { Lingkup, RingkasPerusahaan } from "@/lib/perusahaan";
import { tanggalIso } from "@/lib/waktu";
import { LABEL_TUJUAN, STATUS_KAMPANYE, URUTAN_STATUS_KAMPANYE, URUTAN_TUJUAN } from "@/lib/labelPemasaran";
import FormulirAksi from "@/komponen/FormulirAksi";
import KolomPerusahaan from "@/komponen/KolomPerusahaan";

export type NilaiKampanye = {
  nama: string;
  tujuan: TujuanKampanye;
  anggaran: string;
  status: StatusKampanye;
  tanggalMulai: Date | null;
  tanggalSelesai: Date | null;
  proyekId: string | null;
  catatan: string | null;
};

/**
 * Formulir kampanye iklan (D6 §7.7) untuk halaman baru dan ubah. Perusahaan hanya diisi saat membuat (KolomPerusahaan:
 * baca saja di lingkup satu perusahaan, pilihan wajib di gabungan); saat ubah perusahaan tidak bisa diganti.
 */
export default function FormulirKampanye({
  aksi,
  nilai,
  buat,
  proyek,
}: {
  aksi: (sebelumnya: StatusFormulir, dataFormulir: FormData) => Promise<StatusFormulir>;
  nilai: NilaiKampanye;
  /** isian perusahaan untuk kampanye baru; tanpa ini formulir ubah */
  buat?: { lingkup: Lingkup; daftar: RingkasPerusahaan[] };
  /** pilihan proyek, `label` sudah berawalan kode perusahaan bila perlu */
  proyek: { id: string; label: string }[];
}) {
  return (
    <FormulirAksi aksi={aksi} className="kartu grid grid-cols-1 md:grid-cols-2 gap-4">
      {buat && <KolomPerusahaan lingkup={buat.lingkup} daftar={buat.daftar} />}
      <div className="bidang md:col-span-2">
        <label className="label" htmlFor="kampanye-nama">
          Nama kampanye *
        </label>
        <input id="kampanye-nama" name="nama" required maxLength={200} defaultValue={nilai.nama} className="isian min-h-11" />
      </div>
      <div className="bidang">
        <label className="label" htmlFor="kampanye-proyek">
          Proyek
        </label>
        <select id="kampanye-proyek" name="proyekId" defaultValue={nilai.proyekId ?? ""} className="isian min-h-11">
          <option value="">Tanpa proyek</option>
          {proyek.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      <div className="bidang">
        <label className="label" htmlFor="kampanye-tujuan">
          Tujuan
        </label>
        <select id="kampanye-tujuan" name="tujuan" defaultValue={nilai.tujuan} className="isian min-h-11">
          {URUTAN_TUJUAN.map((t) => (
            <option key={t} value={t}>
              {LABEL_TUJUAN[t]}
            </option>
          ))}
        </select>
      </div>
      <div className="bidang">
        <label className="label" htmlFor="kampanye-anggaran">
          Anggaran (Rp)
        </label>
        <input id="kampanye-anggaran" name="anggaran" inputMode="decimal" defaultValue={nilai.anggaran} className="isian min-h-11 angka" />
      </div>
      <div className="bidang">
        <label className="label" htmlFor="kampanye-status">
          Status
        </label>
        <select id="kampanye-status" name="status" defaultValue={nilai.status} className="isian min-h-11">
          {URUTAN_STATUS_KAMPANYE.map((s) => (
            <option key={s} value={s}>
              {STATUS_KAMPANYE[s].label}
            </option>
          ))}
        </select>
      </div>
      <div className="bidang">
        <label className="label" htmlFor="kampanye-mulai">
          Tanggal mulai
        </label>
        <input id="kampanye-mulai" name="tanggalMulai" type="date" defaultValue={nilai.tanggalMulai ? tanggalIso(nilai.tanggalMulai) : ""} className="isian min-h-11" />
      </div>
      <div className="bidang">
        <label className="label" htmlFor="kampanye-selesai">
          Tanggal selesai
        </label>
        <input id="kampanye-selesai" name="tanggalSelesai" type="date" defaultValue={nilai.tanggalSelesai ? tanggalIso(nilai.tanggalSelesai) : ""} className="isian min-h-11" />
      </div>
      <div className="bidang md:col-span-2">
        <label className="label" htmlFor="kampanye-catatan">
          Catatan
        </label>
        <textarea id="kampanye-catatan" name="catatan" rows={3} maxLength={5000} defaultValue={nilai.catatan ?? ""} className="isian" />
      </div>
      <div className="md:col-span-2">
        <button type="submit" className="tombol tombol-utama min-h-11 w-full sm:w-auto">
          Simpan kampanye
        </button>
      </div>
    </FormulirAksi>
  );
}
