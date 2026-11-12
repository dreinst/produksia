import type { StatusFormulir } from "@/lib/statusFormulir";
import { tanggalIso } from "@/lib/waktu";
import FormulirAksi from "@/komponen/FormulirAksi";

export type NilaiLaporan = {
  tanggal: Date | null;
  belanja: string;
  jangkauan: number;
  tayangan: number;
  klik: number;
  leads: number;
  konversi: number;
  /** null = otomatis */
  hasil: number | null;
  pendapatan: string;
  ctrManual: string | null;
  cpcManual: string | null;
  cpmManual: string | null;
  catatan: string | null;
};

export const LAPORAN_KOSONG: NilaiLaporan = {
  tanggal: null,
  belanja: "0",
  jangkauan: 0,
  tayangan: 0,
  klik: 0,
  leads: 0,
  konversi: 0,
  hasil: null,
  pendapatan: "0",
  ctrManual: null,
  cpcManual: null,
  cpmManual: null,
  catatan: null,
};

/**
 * Formulir laporan hasil harian (D6 §7.8 no. 5). Tanggal laporan baru bawaan hari ini menurut ZONA_WAKTU
 * (tanggalIso(new Date())). Kotak CTR, CPC, dan CPM hanya berisi angka manual (kosong = dihitung otomatis), jadi mengubah
 * belanja atau klik selalu memperbarui hitungannya. `aturan` = kolom dasar hasil otomatis tujuan kampanye (aturanHasil),
 * null untuk tujuan tanpa hitungan otomatis.
 */
export default function FormulirLaporanIklan({
  aksi,
  awalan,
  nilai = LAPORAN_KOSONG,
  aturan,
  tombol,
  pesanSukses,
}: {
  aksi: (sebelumnya: StatusFormulir, dataFormulir: FormData) => Promise<StatusFormulir>;
  awalan: string;
  nilai?: NilaiLaporan;
  aturan: string | null;
  tombol: string;
  pesanSukses: string;
}) {
  const id = (k: string) => `${awalan}${k}`;
  const angka = (nama: string, label: string, awal: string | number | null, desimal = false) => (
    <div className="bidang">
      <label className="label" htmlFor={id(nama)}>
        {label}
      </label>
      <input id={id(nama)} name={nama} inputMode={desimal ? "decimal" : "numeric"} defaultValue={awal ?? ""} className="isian min-h-11 angka" />
    </div>
  );
  return (
    <FormulirAksi aksi={aksi} pesanSukses={pesanSukses} className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div className="bidang col-span-2">
        <label className="label" htmlFor={id("tanggal")}>
          Tanggal *
        </label>
        <input id={id("tanggal")} name="tanggal" type="date" required defaultValue={nilai.tanggal ? tanggalIso(nilai.tanggal) : tanggalIso(new Date())} className="isian min-h-11" />
      </div>
      {angka("belanja", "Belanja (Rp)", nilai.belanja, true)}
      {angka("pendapatan", "Pendapatan (Rp)", nilai.pendapatan, true)}
      {angka("jangkauan", "Jangkauan", nilai.jangkauan)}
      {angka("tayangan", "Tayangan", nilai.tayangan)}
      {angka("klik", "Klik", nilai.klik)}
      {angka("leads", "Leads", nilai.leads)}
      {angka("konversi", "Konversi", nilai.konversi)}
      <div className="bidang col-span-2 md:col-span-3">
        <label className="label" htmlFor={id("hasil")}>
          {aturan ? `Hasil (kosong = otomatis: ${aturan})` : "Hasil (isi manual, tanpa hitungan otomatis)"}
        </label>
        <input id={id("hasil")} name="hasil" inputMode="numeric" defaultValue={nilai.hasil ?? ""} className="isian min-h-11 angka" />
      </div>
      {angka("ctrManual", "CTR % (otomatis bila kosong)", nilai.ctrManual, true)}
      {angka("cpcManual", "CPC (otomatis bila kosong)", nilai.cpcManual, true)}
      {angka("cpmManual", "CPM (otomatis bila kosong)", nilai.cpmManual, true)}
      <div className="bidang col-span-2 md:col-span-4">
        <label className="label" htmlFor={id("catatan")}>
          Catatan
        </label>
        <textarea id={id("catatan")} name="catatan" rows={2} maxLength={2000} defaultValue={nilai.catatan ?? ""} className="isian" />
      </div>
      <div className="col-span-2 md:col-span-4">
        <button type="submit" className="tombol tombol-utama min-h-11 w-full sm:w-auto">
          {tombol}
        </button>
      </div>
    </FormulirAksi>
  );
}
