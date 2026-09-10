import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { ambilPengaturanPerusahaan } from "@/lib/pengaturanPerusahaan";
import { bacaPeriode, hitungLabaRugi, hitungLabaRugiBulanan } from "@/lib/laporan";
import { daftarProyekAktif } from "@/lib/proyek";
import FilterPeriode from "@/komponen/ui/FilterPeriode";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import TabelLaporan from "@/komponen/buku-besar/TabelLaporan";

const rp = (v: { toString(): string }) => `Rp ${Number(v).toLocaleString("id-ID")}`;
const angka = (v: { toString(): string }) => Number(v).toLocaleString("id-ID");
const tanggal = (t: string) => new Date(`${t}T00:00:00`).toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });
const NAMA_BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

export default async function HalamanLabaRugi({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await wajibHak("buku-besar.lihat");
  const param = await searchParams;
  const pengaturan = await ambilPengaturanPerusahaan(db);
  const periode = bacaPeriode(param, pengaturan.tahunBuku);
  const daftarProyek = await daftarProyekAktif();
  const proyekParam = Array.isArray(param.proyek) ? param.proyek[param.proyek.length - 1] : param.proyek;
  const proyekId = typeof proyekParam === "string" && daftarProyek.some((p) => p.id === proyekParam) ? proyekParam : null;
  const proyek = daftarProyek.find((p) => p.id === proyekId);
  const tampilan = param.tampilan === "bulanan" ? "bulanan" : "periode";
  const tahunBulanan = Number(periode.sampaiTeks.slice(0, 4));
  const [lr, bulanan] = await Promise.all([hitungLabaRugi(db, periode, { proyekId }), tampilan === "bulanan" ? hitungLabaRugiBulanan(db, tahunBulanan, { proyekId }) : null]);
  const untung = lr.labaBersih.gte(0);
  const tersembunyi = { proyek: proyekId ?? undefined, tampilan: tampilan === "bulanan" ? "bulanan" : undefined };
  const tautan = (t: "periode" | "bulanan") => `?dari=${periode.dariTeks}&sampai=${periode.sampaiTeks}${proyekId ? `&proyek=${proyekId}` : ""}${t === "bulanan" ? "&tampilan=bulanan" : ""}`;

  return (
    <div className="space-y-6">
      <KepalaHalaman
        jejak={[{ label: "Laporan" }]}
        judul={proyek ? `Laporan Laba Rugi · Event ${proyek.kode}` : "Laporan Laba Rugi"}
        subjudul={`${proyek ? `${proyek.nama}. ` : ""}Periode ${tanggal(periode.dariTeks)} s.d. ${tanggal(periode.sampaiTeks)}.`}
        lencana={
          <span className="flex items-center gap-1">
            <a href={tautan("periode")} className={`tombol tombol-kecil ${tampilan === "periode" ? "tombol-utama" : "tombol-garis"}`}>Per periode</a>
            <a href={tautan("bulanan")} className={`tombol tombol-kecil ${tampilan === "bulanan" ? "tombol-utama" : "tombol-garis"}`}>Per bulan {tahunBulanan}</a>
          </span>
        }
      />
      <FilterPeriode
        dari={periode.dariTeks}
        sampai={periode.sampaiTeks}
        tahunBuku={pengaturan.tahunBuku}
        tersembunyi={{ tampilan: tersembunyi.tampilan }}
        tambahan={
          <div className="bidang">
            <label className="label" htmlFor="proyek">Event / proyek</label>
            <select id="proyek" name="proyek" defaultValue={proyekId ?? ""} className="isian isian-kecil w-auto">
              <option value="">Semua (seluruh perusahaan)</option>
              {daftarProyek.map((p) => (
                <option key={p.id} value={p.id}>{p.kode} - {p.nama}</option>
              ))}
            </select>
          </div>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="kartu p-5"><div className="teks-label">Pendapatan</div><div className="font-heading text-xl font-bold angka mt-1">{rp(lr.totalPendapatan)}</div></div>
        <div className="kartu p-5"><div className="teks-label">Beban pokok pendapatan</div><div className="font-heading text-xl font-bold angka mt-1">{rp(lr.totalBebanPokok)}</div></div>
        <div className="kartu p-5"><div className="teks-label">Laba kotor</div><div className={`font-heading text-xl font-bold angka mt-1 ${lr.labaKotor.gte(0) ? "text-emerald-700" : "text-rose-700"}`}>{rp(lr.labaKotor)}</div></div>
        <div className={`kartu p-5 ${untung ? "border-emerald-200" : "border-rose-300"}`}><div className="teks-label">{untung ? "Laba bersih" : "Rugi bersih"}</div><div className={`font-heading text-xl font-bold angka mt-1 ${untung ? "text-emerald-700" : "text-rose-700"}`}>{rp(lr.labaBersih.abs())}</div></div>
      </div>

      {bulanan && (
        <div className="kartu kartu-tabel">
          <div className="kepala-kartu"><h2 className="judul-kartu">Laba Rugi per bulan {bulanan.tahun}{proyek ? ` · ${proyek.kode}` : ""}</h2></div>
          <div className="bungkus-tabel">
            <table className="tabel min-w-[64rem]">
              <thead>
                <tr>
                  <th>Bulan</th>
                  <th className="text-right">Pendapatan</th>
                  <th className="text-right">Beban pokok</th>
                  <th className="text-right">Laba kotor</th>
                  <th className="text-right">Beban lainnya</th>
                  <th className="text-right">Laba (rugi) bersih</th>
                </tr>
              </thead>
              <tbody>
                {bulanan.bulan.map((m) => (
                  <tr key={m.bulan} className={m.pendapatan.isZero() && m.bebanPokok.isZero() && m.bebanLain.isZero() ? "text-slate-400" : undefined}>
                    <td>{NAMA_BULAN[m.bulan - 1]} <a href={`?dari=${bulanan.tahun}-${String(m.bulan).padStart(2, "0")}-01&sampai=${bulanan.tahun}-${String(m.bulan).padStart(2, "0")}-${new Date(bulanan.tahun, m.bulan, 0).getDate()}${proyekId ? `&proyek=${proyekId}` : ""}`} className="text-xs text-blue-600 hover:underline">rinci</a></td>
                    <td className="text-right angka">{angka(m.pendapatan)}</td>
                    <td className="text-right angka">{angka(m.bebanPokok)}</td>
                    <td className="text-right angka">{angka(m.pendapatan.minus(m.bebanPokok))}</td>
                    <td className="text-right angka">{angka(m.bebanLain)}</td>
                    <td className={`text-right angka font-semibold ${m.labaBersih.lt(0) ? "text-rose-700" : "text-emerald-700"}`}>{angka(m.labaBersih)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td>Total {bulanan.tahun}</td>
                  <td className="text-right angka">{angka(bulanan.total.pendapatan)}</td>
                  <td className="text-right angka">{angka(bulanan.total.bebanPokok)}</td>
                  <td className="text-right angka">{angka(bulanan.total.pendapatan.minus(bulanan.total.bebanPokok))}</td>
                  <td className="text-right angka">{angka(bulanan.total.bebanLain)}</td>
                  <td className={`text-right angka ${bulanan.total.labaBersih.lt(0) ? "text-rose-700" : "text-emerald-700"}`}>{angka(bulanan.total.labaBersih)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

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
            <p className="text-xs text-slate-500 pt-2">Jurnal penutup tahun tidak dihitung. Laporan per event hanya memuat transaksi yang diberi tanda event itu.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
