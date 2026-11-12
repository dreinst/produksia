import type { ReactNode } from "react";
import { buatTindakLanjutFormulir } from "@/lib/aksi/crm";
import FormulirAksi from "@/komponen/FormulirAksi";
import Ikon from "@/komponen/ui/Ikon";

/*
 * Formulir pengingat tindak lanjut baru (D4 §3.5, §7.3). Dari detail lead: leadId tersembunyi dan perusahaan
 * mengikuti lead. Tanpa lead: halaman mengirim `kolomPerusahaan` (KolomPerusahaan) supaya gabungan wajib memilih.
 * "Tugaskan ke" kosong = pembuat sendiri.
 */

export default function FormulirTindakLanjut({
  leadId,
  kolomPerusahaan,
  pengguna,
  penggunaId,
}: {
  leadId?: string;
  kolomPerusahaan?: ReactNode;
  /** pengguna aktif pemegang lead.lihat */
  pengguna: { id: string; nama: string }[];
  /** pengguna sesi, tidak diulang di daftar karena sudah menjadi opsi "Saya" */
  penggunaId: string;
}) {
  const awalan = leadId ? "tl-lead" : "tl-baru";
  return (
    <FormulirAksi aksi={buatTindakLanjutFormulir} pesanSukses="Pengingat dibuat" className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {leadId && <input type="hidden" name="leadId" value={leadId} />}
      {kolomPerusahaan && <div className="md:col-span-2">{kolomPerusahaan}</div>}
      <div className="bidang md:col-span-2">
        <label className="label" htmlFor={`${awalan}-judul`}>
          Judul pengingat *
        </label>
        <input id={`${awalan}-judul`} name="judul" required maxLength={160} className="isian" placeholder="mis. Telepon ulang soal proposal" />
      </div>
      <div className="bidang">
        <label className="label" htmlFor={`${awalan}-jatuhTempo`}>
          Tanggal &amp; jam *
        </label>
        <input id={`${awalan}-jatuhTempo`} name="jatuhTempo" type="datetime-local" required className="isian" />
      </div>
      <div className="bidang">
        <label className="label" htmlFor={`${awalan}-ditugaskanKeId`}>
          Tugaskan ke
        </label>
        <select id={`${awalan}-ditugaskanKeId`} name="ditugaskanKeId" defaultValue="" className="isian">
          <option value="">Saya</option>
          {pengguna
            .filter((p) => p.id !== penggunaId)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.nama}
              </option>
            ))}
        </select>
      </div>
      <div className="bidang md:col-span-2">
        <label className="label" htmlFor={`${awalan}-catatan`}>
          Catatan
        </label>
        <textarea id={`${awalan}-catatan`} name="catatan" maxLength={2000} className="isian h-auto min-h-20 py-2" />
      </div>
      <div className="md:col-span-2">
        <button type="submit" className="tombol tombol-utama w-full sm:w-auto min-h-11">
          <Ikon nama="alarm" className="!text-[18px]" />
          Buat pengingat
        </button>
      </div>
    </FormulirAksi>
  );
}
