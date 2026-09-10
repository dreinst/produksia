import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { ambilPengaturanPerusahaan } from "@/lib/pengaturanPerusahaan";
import { bacaPeriode } from "@/lib/laporan";
import { laporanHutang, KERANJANG_UMUR } from "@/lib/laporanRekanan";
import FilterPeriode from "@/komponen/ui/FilterPeriode";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import TabelUmur from "@/komponen/laporan/TabelUmur";

const rp = (v: { toString(): string }) => `Rp ${Number(v).toLocaleString("id-ID")}`;
const tanggal = (t: string) => new Date(`${t}T00:00:00`).toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });

export default async function HalamanPemasokUmur({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await wajibHak("buku-besar.lihat");
  const pengaturan = await ambilPengaturanPerusahaan(db);
  const periode = bacaPeriode(await searchParams, pengaturan.tahunBuku);
  const laporan = await laporanHutang(db, periode.sampai);
  const lewatTempo = laporan.perKeranjang.slice(1).reduce((s, v) => s + Number(v), 0);

  return (
    <div className="space-y-6">
      <KepalaHalaman
        jejak={[{ label: "Laporan" }]}
        judul="Laporan Hutang Usaha"
        subjudul={`Per ${tanggal(periode.sampaiTeks)} — Sisa kewajiban ke pemasok per tanggal, dikelompokkan menurut umur terhadap jatuh tempo. Faktur pembelian dikurangi pembayaran dan retur s.d. tanggal laporan.`}
        lencana={<span className={`lencana ${lewatTempo > 0 ? "lencana-rose" : "lencana-emerald"}`}>{lewatTempo > 0 ? `Lewat tempo Rp ${lewatTempo.toLocaleString("id-ID")}` : "Tidak ada yang lewat tempo"}</span>}
      />
      <FilterPeriode sampai={periode.sampaiTeks} hanyaSampai tahunBuku={pengaturan.tahunBuku} />
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        <div className="kartu p-4"><div className="teks-label">Total sisa</div><div className="font-heading text-lg font-bold angka mt-1">{rp(laporan.total)}</div><div className="text-xs text-slate-500">{laporan.jumlahFaktur} faktur · {laporan.kelompok.length} Pemasok</div></div>
        {KERANJANG_UMUR.map((k, i) => (
          <div key={k} className={`kartu p-4 ${i >= 3 && Number(laporan.perKeranjang[i]) > 0 ? "border-rose-300" : ""}`}><div className="teks-label">{k}</div><div className="font-heading text-lg font-bold angka mt-1">{rp(laporan.perKeranjang[i])}</div></div>
        ))}
      </div>
      <TabelUmur laporan={laporan} labelRekanan="Pemasok" tautanFaktur="/pembelian/faktur" />
    </div>
  );
}
