import Ikon from "@/komponen/ui/Ikon";
import AngkaBergerak from "@/komponen/ui/AngkaBergerak";

/**
 * Kartu angka ringkas untuk panel beranda dan dasbor modul. Strukturnya salinan kartu Ringkasan beranda keuangan
 * (kartu-statistik, ubin-ikon, AngkaBergerak); Ringkasan lama tidak diubah.
 * nilai angka dianimasikan dengan awalan (bawaan "Rp ", pakai "" untuk hitungan); nilai teks ditampilkan apa adanya.
 */
export default function KartuKpi({
  judul,
  ikon,
  nilai,
  awalan = "Rp ",
  sub,
  lencana,
}: {
  judul: string;
  ikon: string;
  nilai: number | string;
  awalan?: string;
  sub?: string;
  lencana?: { teks: string; cls: string };
}) {
  return (
    <div className="kartu kartu-statistik p-5 flex flex-col justify-between">
      <div className="flex items-center justify-between mb-3 gap-2">
        <span className="flex items-center gap-2 text-xs font-semibold text-slate-500">
          <span className="ubin-ikon"><Ikon nama={ikon} className="!text-[16px]" /></span>
          {judul}
        </span>
        {lencana && <span className={`lencana ${lencana.cls}`}>{lencana.teks}</span>}
      </div>
      <div className="font-heading text-2xl font-bold tracking-tight text-slate-900 angka">
        {typeof nilai === "number" ? <AngkaBergerak nilai={nilai} awalan={awalan} /> : nilai}
      </div>
      {sub && <div className="text-[11px] text-slate-400 mt-1 truncate">{sub}</div>}
    </div>
  );
}
