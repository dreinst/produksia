"use client";

import { useState } from "react";
import FormulirAksi from "@/komponen/FormulirAksi";
import Ikon from "@/komponen/ui/Ikon";
import type { StatusFormulir } from "@/lib/statusFormulir";

/** Ukuran kertas yang dikirim ke rute cetak (bacaOpsiCetak). */
export type UkuranOpsi = "A4" | "A5" | "A5L";

/** Pilihan cetak satu kop, dihitung PanelCetak di server (D3 §3.1): ukuran sah, nilai awal, dan alasan tanpa tanda tangan. */
export type OpsiKopCetak = {
  /** null = kop polos (perusahaan belum punya kop) */
  id: string | null;
  nama: string;
  bawaan: boolean;
  ukuran: UkuranOpsi[];
  ukuranAwal: UkuranOpsi;
  ttdAwal: boolean;
  /** null = tanda tangan bisa dibubuhkan */
  alasanTanpaTtd: string | null;
  /** tampilan event bisa dipilih (dokumen mode event bertata letak HKA) */
  tampilanEvent: boolean;
};

const LABEL_UKURAN: Record<UkuranOpsi, string> = { A4: "A4", A5: "A5", A5L: "A5 landscape" };

/**
 * Formulir cetak klien (D3 §7.1). Pratinjau dan unduh lewat formulir GET ke /cetak/{jenis}/{id} di tab baru (lolos
 * CSP form-action 'self' tanpa window.open). Bila `aksiSimpan` diisi (P45), tombol "Simpan PDF ke Lampiran" mengirim
 * pilihan yang sama ke aksi server, kecuali tanda tangan: PDF lampiran selalu disimpan tanpa tanda tangan dan stempel
 * (perbaikan tinjauan P45 T1), karena lampiran terbuka bagi semua pemegang hak lihat dokumen. Server tetap menentukan
 * ulang tanda tangan unduhan menurut hak dan status dokumen.
 */
export default function FormulirCetak({
  aksi,
  opsiKop,
  kopAwal,
  tampilanAwal,
  aksiSimpan,
}: {
  aksi: string;
  opsiKop: OpsiKopCetak[];
  kopAwal: string | null;
  tampilanAwal: "RINCI" | "RINGKAS";
  aksiSimpan?: (s: StatusFormulir, fd: FormData) => Promise<StatusFormulir>;
}) {
  const [kop, setKop] = useState<string | null>(kopAwal);
  const pilihan = opsiKop.find((k) => k.id === kop) ?? opsiKop[0];
  const [ukuranDipilih, setUkuran] = useState<UkuranOpsi>(pilihan.ukuranAwal);
  const [ttdDipilih, setTtd] = useState<boolean>(pilihan.ttdAwal);
  const [tampilan, setTampilan] = useState<"RINCI" | "RINGKAS">(tampilanAwal);
  const ukuran = pilihan.ukuran.includes(ukuranDipilih) ? ukuranDipilih : pilihan.ukuranAwal;
  const ttd = !pilihan.alasanTanpaTtd && ttdDipilih;

  const gantiKop = (id: string) => {
    setKop(id);
    const k = opsiKop.find((x) => x.id === id);
    if (k) {
      setUkuran(k.ukuranAwal);
      setTtd(k.ttdAwal);
    }
  };

  return (
    <div className="space-y-3">
      <form method="get" action={aksi} target="_blank" className="kartu grid grid-cols-1 md:grid-cols-2 gap-4">
        {opsiKop.length > 1 || pilihan.id ? (
          <div className="bidang">
            <label className="label" htmlFor="cetak-kop">
              Kop surat
            </label>
            <select id="cetak-kop" name="kop" className="isian" value={kop ?? ""} onChange={(e) => gantiKop(e.target.value)}>
              {opsiKop.map((k) => (
                <option key={k.id ?? ""} value={k.id ?? ""}>
                  {k.nama}
                  {k.bawaan ? " (bawaan)" : ""}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {pilihan.ukuran.length > 1 ? (
          <fieldset className="bidang">
            <legend className="label">Ukuran kertas</legend>
            <div className="flex flex-wrap gap-4 text-sm">
              {pilihan.ukuran.map((u) => (
                <label key={u} className="inline-flex items-center gap-2">
                  <input type="radio" name="ukuran" value={u} checked={ukuran === u} onChange={() => setUkuran(u)} />
                  {LABEL_UKURAN[u]}
                </label>
              ))}
            </div>
          </fieldset>
        ) : (
          <input type="hidden" name="ukuran" value={ukuran} />
        )}
        <div className="bidang">
          <input type="hidden" name="ttd" value="0" />
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" name="ttd" value="1" checked={ttd} disabled={!!pilihan.alasanTanpaTtd} onChange={(e) => setTtd(e.target.checked)} />
            Bubuhkan tanda tangan &amp; stempel
          </label>
          {pilihan.alasanTanpaTtd && <span className="petunjuk">{pilihan.alasanTanpaTtd}</span>}
        </div>
        {pilihan.tampilanEvent && (
          <div className="bidang">
            <label className="label" htmlFor="cetak-tampilan">
              Tampilan event
            </label>
            <select id="cetak-tampilan" name="tampilan" className="isian" value={tampilan} onChange={(e) => setTampilan(e.target.value === "RINGKAS" ? "RINGKAS" : "RINCI")}>
              <option value="RINCI">Rinci</option>
              <option value="RINGKAS">Ringkas (faktur dan RAB)</option>
            </select>
          </div>
        )}
        <div className="md:col-span-2 flex flex-wrap gap-2">
          <button type="submit" className="tombol tombol-utama">
            <Ikon nama="picture_as_pdf" className="!text-[18px]" />
            Pratinjau PDF
          </button>
          <button type="submit" name="unduh" value="1" className="tombol tombol-garis">
            <Ikon nama="download" className="!text-[18px]" />
            Unduh PDF
          </button>
        </div>
      </form>
      {aksiSimpan && (
        <FormulirAksi aksi={aksiSimpan} pesanSukses="PDF tersimpan sebagai lampiran.">
          {pilihan.id && <input type="hidden" name="kop" value={pilihan.id} />}
          <input type="hidden" name="ukuran" value={ukuran} />
          {pilihan.tampilanEvent && <input type="hidden" name="tampilan" value={tampilan} />}
          <button type="submit" className="tombol tombol-lembut">
            <Ikon nama="attach_file" className="!text-[18px]" />
            Simpan PDF ke Lampiran
          </button>
          <p className="petunjuk mt-1">PDF lampiran selalu disimpan tanpa tanda tangan dan stempel. PDF bertanda tangan hanya bisa diunduh.</p>
        </FormulirAksi>
      )}
    </div>
  );
}
