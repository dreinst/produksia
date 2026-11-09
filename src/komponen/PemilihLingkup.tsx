"use client";

import FormulirAksi from "@/komponen/FormulirAksi";
import Ikon from "@/komponen/ui/Ikon";
import LencanaPerusahaan from "@/komponen/ui/LencanaPerusahaan";
import { gantiPerusahaanAktifFormulir } from "@/lib/aksi/perusahaan";
import type { RingkasPerusahaan } from "@/lib/perusahaan";

const kelasTombol =
  "w-full flex items-center gap-2 px-2 py-1.5 min-h-11 md:min-h-0 rounded-lg text-left text-xs text-slate-700 hover:bg-slate-50 aria-[current=true]:bg-slate-100 aria-[current=true]:font-semibold";

/**
 * Pemilih lingkup pembukuan di kartu perusahaan bilah samping (D1 §7.1). Satu formulir, satu tombol submit
 * per pilihan (name="perusahaanId"). "Semua perusahaan" hanya untuk pemegang perusahaan-gabungan.lihat;
 * perusahaan arsip tidak bisa dipilih, tapi tetap tampil bila sedang menjadi lingkup aktif.
 */
export default function PemilihLingkup({ daftar, aktifId, bolehGabungan }: { daftar: RingkasPerusahaan[]; aktifId: string | null; bolehGabungan: boolean }) {
  const pilihan = daftar.filter((p) => p.aktif || p.id === aktifId);
  return (
    <FormulirAksi aksi={gantiPerusahaanAktifFormulir} pesanSukses="Lingkup perusahaan diganti." className="px-1 py-1 space-y-0.5">
      <div className="teks-label px-1 pb-1">Lingkup pembukuan</div>
      {bolehGabungan && (
        <button type="submit" name="perusahaanId" value="semua" aria-current={aktifId === null ? "true" : undefined} className={kelasTombol}>
          <Ikon nama="hub" className="!text-[16px] text-slate-400" />
          <span className="flex-1 truncate">Semua perusahaan (gabungan)</span>
          {aktifId === null && <Ikon nama="check_circle" className="!text-[16px] text-emerald-600" />}
        </button>
      )}
      {pilihan.map((p) => {
        const aktif = p.id === aktifId;
        return (
          <button key={p.id} type="submit" name="perusahaanId" value={p.id} disabled={!p.aktif} aria-current={aktif ? "true" : undefined} className={kelasTombol}>
            <LencanaPerusahaan kode={p.kode} warna={p.warna} nama={p.nama} />
            <span className="flex-1 truncate">
              {p.nama}
              {!p.aktif && " (diarsipkan)"}
            </span>
            {aktif && <Ikon nama="check_circle" className="!text-[16px] text-emerald-600" />}
          </button>
        );
      })}
    </FormulirAksi>
  );
}
