import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { ambilPengaturanPerusahaan } from "@/lib/pengaturanPerusahaan";
import { bacaPeriode, hitungNeraca } from "@/lib/laporan";
import FilterPeriode from "@/komponen/ui/FilterPeriode";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import TabelLaporan from "@/komponen/buku-besar/TabelLaporan";

const rp = (v: { toString(): string }) => `Rp ${Number(v).toLocaleString("id-ID")}`;
const tanggal = (t: string) => new Date(`${t}T00:00:00`).toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });

export default async function HalamanNeraca({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await wajibHak("buku-besar.lihat");
  const pengaturan = await ambilPengaturanPerusahaan(db);
  const periode = bacaPeriode(await searchParams, pengaturan.tahunBuku);
  const n = await hitungNeraca(db, periode.sampai, periode.sampaiTeks);

  return (
    <div className="space-y-6">
      <KepalaHalaman
        jejak={[{ label: "Buku Besar" }]}
        judul="Neraca (Posisi Keuangan)"
        subjudul={`Per ${tanggal(periode.sampaiTeks)} — tahun yang sudah ditutup ada di akun Laba Ditahan; laba tahun-tahun lalu yang belum ditutup dan tahun berjalan dihitung dari jurnal.`}
        lencana={<span className={`lencana ${n.seimbang ? "lencana-emerald" : "lencana-rose"}`}>{n.seimbang ? "Aset = Kewajiban + Ekuitas" : "TIDAK SEIMBANG"}</span>}
      />
      <FilterPeriode sampai={periode.sampaiTeks} hanyaSampai tahunBuku={pengaturan.tahunBuku} />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="kartu p-5"><div className="teks-label">Total aset</div><div className="font-heading text-xl font-bold angka mt-1">{rp(n.totalAset)}</div></div>
        <div className="kartu p-5"><div className="teks-label">Total kewajiban</div><div className="font-heading text-xl font-bold angka mt-1">{rp(n.totalKewajiban)}</div></div>
        <div className="kartu p-5"><div className="teks-label">Total ekuitas (termasuk laba)</div><div className="font-heading text-xl font-bold angka mt-1">{rp(n.totalEkuitas)}</div></div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TabelLaporan judul="Aset" baris={n.aset} labelTotal="Total aset" total={n.totalAset} kelasTotal="text-slate-900" />
        <div className="space-y-6">
          <TabelLaporan judul="Kewajiban" baris={n.kewajiban} labelTotal="Total kewajiban" total={n.totalKewajiban} />
          <div className="kartu kartu-tabel">
            <div className="kepala-kartu"><h2 className="judul-kartu">Ekuitas</h2></div>
            <div className="bungkus-tabel">
              <table className="tabel">
                <thead><tr><th>Kode</th><th>Akun</th><th className="text-right">Jumlah</th></tr></thead>
                <tbody>
                  {n.ekuitas.map((b) => (
                    <tr key={b.id} className={b.kelompok ? "bg-slate-50/70" : undefined}>
                      <td className="mono">{b.kode}</td>
                      <td style={{ paddingLeft: `${0.75 + b.kedalaman * 1.25}rem` }}>{b.nama}</td>
                      <td className="text-right angka">{Number(b.jumlah).toLocaleString("id-ID")}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="mono text-slate-400">—</td>
                    <td>Laba (rugi) tahun-tahun sebelumnya yang belum ditutup <span className="text-xs text-slate-400">(dihitung)</span></td>
                    <td className="text-right angka">{Number(n.labaDitahan).toLocaleString("id-ID")}</td>
                  </tr>
                  <tr>
                    <td className="mono text-slate-400">—</td>
                    <td>Laba (rugi) tahun berjalan <span className="text-xs text-slate-400">(dihitung)</span></td>
                    <td className="text-right angka">{Number(n.labaBerjalan).toLocaleString("id-ID")}</td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr><td colSpan={2}>Total ekuitas</td><td className="text-right angka">{Number(n.totalEkuitas).toLocaleString("id-ID")}</td></tr>
                  <tr><td colSpan={2}>Total kewajiban + ekuitas</td><td className={`text-right angka ${n.seimbang ? "text-emerald-700" : "text-rose-700"}`}>{Number(n.totalPasiva).toLocaleString("id-ID")}</td></tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
