import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { bacaPeriode, hitungLabaRugi } from "@/lib/laporan";
import FilterPeriode from "@/komponen/ui/FilterPeriode";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import TabelLaporan from "@/komponen/buku-besar/TabelLaporan";

const rp = (v: { toString(): string }) => `Rp ${Number(v).toLocaleString("id-ID")}`;
const tanggal = (t: string) => new Date(`${t}T00:00:00`).toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });

export default async function HalamanLabaRugi({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await wajibHak("buku-besar.lihat");
  const periode = bacaPeriode(await searchParams);
  const lr = await hitungLabaRugi(db, periode);
  const untung = lr.labaBersih.gte(0);

  return (
    <div className="space-y-6">
      <KepalaHalaman
        jejak={[{ label: "Buku Besar" }]}
        judul="Laporan Laba Rugi"
        subjudul={`Periode ${tanggal(periode.dariTeks)} s.d. ${tanggal(periode.sampaiTeks)} — dihitung langsung dari jurnal.`}
      />
      <FilterPeriode dari={periode.dariTeks} sampai={periode.sampaiTeks} />

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="kartu p-5"><div className="teks-label">Pendapatan</div><div className="font-heading text-xl font-bold angka mt-1">{rp(lr.totalPendapatan)}</div></div>
        <div className="kartu p-5"><div className="teks-label">Beban pokok pendapatan</div><div className="font-heading text-xl font-bold angka mt-1">{rp(lr.totalBebanPokok)}</div></div>
        <div className="kartu p-5"><div className="teks-label">Laba kotor</div><div className={`font-heading text-xl font-bold angka mt-1 ${lr.labaKotor.gte(0) ? "text-emerald-700" : "text-rose-700"}`}>{rp(lr.labaKotor)}</div></div>
        <div className={`kartu p-5 ${untung ? "border-emerald-200" : "border-rose-300"}`}><div className="teks-label">{untung ? "Laba bersih" : "Rugi bersih"}</div><div className={`font-heading text-xl font-bold angka mt-1 ${untung ? "text-emerald-700" : "text-rose-700"}`}>{rp(lr.labaBersih.abs())}</div></div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-6">
          <TabelLaporan judul="Pendapatan" baris={lr.pendapatan} labelTotal="Total pendapatan" total={lr.totalPendapatan} />
          <TabelLaporan judul="Beban Pokok Pendapatan" baris={lr.bebanPokok} labelTotal="Total beban pokok" total={lr.totalBebanPokok} />
        </div>
        <div className="space-y-6">
          <TabelLaporan judul="Beban Operasional & Lainnya" baris={lr.bebanLain} labelTotal="Total beban lainnya" total={lr.totalBebanLain} />
          <div className="kartu space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">Pendapatan</span><span className="angka">{rp(lr.totalPendapatan)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">− Beban pokok pendapatan</span><span className="angka">{rp(lr.totalBebanPokok)}</span></div>
            <div className="flex justify-between border-t border-slate-200 pt-2 font-semibold"><span>Laba kotor</span><span className="angka">{rp(lr.labaKotor)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">− Beban operasional & lainnya</span><span className="angka">{rp(lr.totalBebanLain)}</span></div>
            <div className={`flex justify-between border-t-2 border-slate-300 pt-2 font-bold ${untung ? "text-emerald-700" : "text-rose-700"}`}><span>{untung ? "Laba bersih" : "Rugi bersih"}</span><span className="angka">{rp(lr.labaBersih)}</span></div>
            <p className="text-xs text-slate-500 pt-2">Akun kontra (mis. Potongan Penjualan) tampil negatif pada kelompoknya. Pajak penghasilan belum dihitung otomatis.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
