import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { ambilPengaturanPerusahaan } from "@/lib/pengaturanPerusahaan";
import { bacaPeriode, hitungLabaRugi, hitungNeraca } from "@/lib/laporan";
import { laporanPerubahanModal } from "@/lib/laporanRekanan";
import FilterPeriode from "@/komponen/ui/FilterPeriode";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";

const rp = (v: { toString(): string }) => `Rp ${Number(v).toLocaleString("id-ID")}`;
const angka = (v: { toString(): string }) => Number(v).toLocaleString("id-ID");
const tanggal = (t: string) => new Date(`${t}T00:00:00`).toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });

export default async function HalamanPerubahanModal({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await wajibHak("buku-besar.lihat");
  const pengaturan = await ambilPengaturanPerusahaan(db);
  const periode = bacaPeriode(await searchParams, pengaturan.tahunBuku);
  const sebelum = new Date(periode.dari.getTime() - 1);
  const [lr, neracaAwal, neracaAkhir] = await Promise.all([
    hitungLabaRugi(db, periode),
    hitungNeraca(db, sebelum, periode.dariTeks),
    hitungNeraca(db, periode.sampai, periode.sampaiTeks),
  ]);
  const pm = await laporanPerubahanModal(db, periode.dari, periode.sampai, lr.labaBersih, neracaAwal.totalEkuitas, neracaAkhir.totalEkuitas);
  const baris = [
    { label: `Ekuitas awal (per ${tanggal(periode.dariTeks)}, sebelum periode)`, nilai: pm.ekuitasAwal, tebal: false },
    { label: "+ Setoran (pengambilan) modal pemilik", nilai: pm.setoranModal, tebal: false },
    { label: `+ Laba (rugi) bersih periode`, nilai: pm.labaBersih, tebal: false },
    { label: "− Prive (pengambilan pribadi)", nilai: pm.prive.neg(), tebal: false },
    { label: "± Penyesuaian laba ditahan lainnya", nilai: pm.lainnya, tebal: false },
    { label: `Ekuitas akhir (per ${tanggal(periode.sampaiTeks)})`, nilai: pm.ekuitasAkhir, tebal: true },
  ];

  return (
    <div className="space-y-6">
      <KepalaHalaman
        jejak={[{ label: "Laporan" }]}
        judul="Laporan Perubahan Modal"
        subjudul={`Periode ${tanggal(periode.dariTeks)} s.d. ${tanggal(periode.sampaiTeks)} — Harta = Utang + Modal; modal berubah karena setoran, laba/rugi, dan prive.`}
        lencana={<span className={`lencana ${pm.cocok ? "lencana-emerald" : "lencana-rose"}`}>{pm.cocok ? "Cocok dengan ekuitas neraca" : "TIDAK COCOK dengan neraca"}</span>}
      />
      <FilterPeriode dari={periode.dariTeks} sampai={periode.sampaiTeks} tahunBuku={pengaturan.tahunBuku} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="kartu kartu-tabel">
          <div className="kepala-kartu"><h2 className="judul-kartu">Perubahan ekuitas</h2></div>
          <div className="bungkus-tabel">
            <table className="tabel">
              <tbody>
                {baris.map((b) => (
                  <tr key={b.label} className={b.tebal ? "bg-slate-50/70 font-bold" : undefined}>
                    <td>{b.label}</td>
                    <td className={`text-right angka ${Number(b.nilai) < 0 ? "text-rose-700" : ""}`}>{angka(b.nilai)}</td>
                  </tr>
                ))}
                <tr className="text-xs text-slate-500">
                  <td>Total ekuitas menurut Neraca per {tanggal(periode.sampaiTeks)}</td>
                  <td className={`text-right angka ${pm.cocok ? "text-emerald-700" : "text-rose-700"}`}>{angka(pm.ekuitasAkhirNeraca)} {pm.cocok ? "✓" : "✗"}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div className="space-y-6">
          <div className="kartu kartu-tabel">
            <div className="kepala-kartu"><h2 className="judul-kartu">Mutasi akun modal dalam periode</h2></div>
            <div className="bungkus-tabel">
              <table className="tabel">
                <thead><tr><th>Kode</th><th>Akun</th><th className="text-right">Mutasi (kredit − debit)</th></tr></thead>
                <tbody>
                  {pm.rincianModal.map((r) => (
                    <tr key={r.kode}><td className="mono">{r.kode}</td><td>{r.nama}</td><td className={`text-right angka ${Number(r.mutasi) < 0 ? "text-rose-700" : ""}`}>{angka(r.mutasi)}</td></tr>
                  ))}
                  {pm.rincianModal.length === 0 && <tr><td colSpan={3} className="kosong">Tidak ada mutasi akun modal pada periode ini.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          <div className="kartu text-sm space-y-2">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="ubin"><div className="teks-label">Harta</div><div className="font-heading font-bold angka">{rp(neracaAkhir.totalAset)}</div></div>
              <div className="ubin"><div className="teks-label">Utang</div><div className="font-heading font-bold angka">{rp(neracaAkhir.totalKewajiban)}</div></div>
              <div className="ubin"><div className="teks-label">Modal</div><div className="font-heading font-bold angka">{rp(neracaAkhir.totalEkuitas)}</div></div>
            </div>
            <p className="text-xs text-slate-500">Prive dikenali dari akun modal bernama “Prive” (3-4000). Setoran modal = mutasi akun modal lain (bukan Laba Ditahan). Jurnal penutup tahun tidak dihitung sebagai setoran.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
