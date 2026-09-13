import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { ambilPengaturanPerusahaan } from "@/lib/pengaturanPerusahaan";
import { bacaPeriode, hitungLabaRugi, hitungLabaRugiBulanan } from "@/lib/laporan";
import { labaRugiKas, labaRugiKasBulanan, type BarisKas } from "@/lib/basisKas";
import { daftarProyekAktif } from "@/lib/proyek";
import FilterPeriode from "@/komponen/ui/FilterPeriode";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import TabelLaporan from "@/komponen/buku-besar/TabelLaporan";

const rp = (v: { toString(): string }) => `Rp ${Number(v).toLocaleString("id-ID")}`;
const angka = (v: { toString(): string }) => Number(v).toLocaleString("id-ID");
const tanggal = (t: string) => new Date(`${t}T00:00:00`).toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });
const NAMA_BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

function TabelKas({ judul, keterangan, baris, labelTotal, total }: { judul: string; keterangan: string; baris: BarisKas[]; labelTotal: string; total: { toString(): string } }) {
  return (
    <div className="kartu kartu-tabel">
      <div className="kepala-kartu"><div><h2 className="judul-kartu">{judul}</h2><p className="subjudul-kartu">{keterangan}</p></div></div>
      <div className="bungkus-tabel">
        <table className="tabel">
          <thead><tr><th>Kode</th><th>Akun lawan</th><th className="text-right">Jumlah</th></tr></thead>
          <tbody>
            {baris.map((b) => (
              <tr key={b.id}><td className="mono">{b.kode}</td><td>{b.nama}</td><td className="text-right angka">{angka(b.jumlah)}</td></tr>
            ))}
            {baris.length === 0 && <tr><td colSpan={3} className="kosong">Tidak ada.</td></tr>}
          </tbody>
          <tfoot><tr><td colSpan={2}>{labelTotal}</td><td className="text-right angka">{angka(total)}</td></tr></tfoot>
        </table>
      </div>
    </div>
  );
}

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
  const basis = param.basis === "akrual" ? "akrual" : "kas";
  const tahunBulanan = Number(periode.sampaiTeks.slice(0, 4));
  const tautan = (t: "periode" | "bulanan", b: "kas" | "akrual" = basis) =>
    `?dari=${periode.dariTeks}&sampai=${periode.sampaiTeks}${proyekId ? `&proyek=${proyekId}` : ""}${t === "bulanan" ? "&tampilan=bulanan" : ""}${b === "akrual" ? "&basis=akrual" : ""}`;
  const judul = `${basis === "kas" ? "Laba Rugi Basis Kas" : "Laporan Laba Rugi"}${proyek ? ` · Event ${proyek.kode}` : ""}`;
  const kepala = (
    <KepalaHalaman
      jejak={[{ label: "Laporan" }]}
      judul={judul}
      subjudul={`${proyek ? `${proyek.nama}. ` : ""}Periode ${tanggal(periode.dariTeks)} s.d. ${tanggal(periode.sampaiTeks)}. ${basis === "kas" ? "Uang yang benar-benar masuk dan keluar untuk operasi (sudut pandang pemilik)." : "Pendapatan saat faktur, beban saat terjadi (basis pembukuan & pajak)."}`}
      lencana={
        <span className="flex items-center gap-1">
          <a href={tautan(tampilan, "kas")} className={`tombol tombol-kecil ${basis === "kas" ? "tombol-utama" : "tombol-garis"}`}>Basis kas</a>
          <a href={tautan(tampilan, "akrual")} className={`tombol tombol-kecil ${basis === "akrual" ? "tombol-utama" : "tombol-garis"}`}>Akrual (fiskal)</a>
        </span>
      }
      aksi={
        <span className="flex items-center gap-1">
          <a href={tautan("periode")} className={`tombol tombol-kecil ${tampilan === "periode" ? "tombol-utama" : "tombol-garis"}`}>Per periode</a>
          <a href={tautan("bulanan")} className={`tombol tombol-kecil ${tampilan === "bulanan" ? "tombol-utama" : "tombol-garis"}`}>Per bulan {tahunBulanan}</a>
        </span>
      }
    />
  );
  const filter = (
    <FilterPeriode
      dari={periode.dariTeks}
      sampai={periode.sampaiTeks}
      tahunBuku={pengaturan.tahunBuku}
      tersembunyi={{ tampilan: tampilan === "bulanan" ? "bulanan" : undefined, basis: basis === "akrual" ? "akrual" : undefined }}
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
  );
  const tautanBulan = (bulan: number) => `?dari=${tahunBulanan}-${String(bulan).padStart(2, "0")}-01&sampai=${tahunBulanan}-${String(bulan).padStart(2, "0")}-${new Date(tahunBulanan, bulan, 0).getDate()}${proyekId ? `&proyek=${proyekId}` : ""}${basis === "akrual" ? "&basis=akrual" : ""}`;

  if (basis === "kas") {
    const [k, bulanan] = await Promise.all([labaRugiKas(db, periode, { proyekId }), tampilan === "bulanan" ? labaRugiKasBulanan(db, tahunBulanan, { proyekId }) : null]);
    const surplus = k.surplus.gte(0);
    return (
      <div className="space-y-6">
        {kepala}
        {filter}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="kartu p-5"><div className="teks-label">Uang masuk dari pelanggan</div><div className="font-heading text-xl font-bold angka mt-1">{rp(k.totalDariPelanggan)}</div><div className="text-xs text-slate-500">DP, pelunasan, kas masuk langsung</div></div>
          <div className="kartu p-5"><div className="teks-label">Penerimaan operasi lain</div><div className="font-heading text-xl font-bold angka mt-1">{rp(k.totalPenerimaanLain.minus(k.ppnTitipan))}</div></div>
          <div className="kartu p-5"><div className="teks-label">Uang keluar operasi</div><div className="font-heading text-xl font-bold angka mt-1">{rp(k.totalPengeluaran)}</div><div className="text-xs text-slate-500">pemasok, beban, pajak</div></div>
          <div className={`kartu p-5 ${surplus ? "border-emerald-200" : "border-rose-300"}`}><div className="teks-label">{surplus ? "Surplus kas operasi" : "Defisit kas operasi"}</div><div className={`font-heading text-xl font-bold angka mt-1 ${surplus ? "text-emerald-700" : "text-rose-700"}`}>{rp(k.surplus.abs())}</div></div>
        </div>

        {bulanan && (
          <div className="kartu kartu-tabel">
            <div className="kepala-kartu"><h2 className="judul-kartu">Kas masuk & keluar per bulan {bulanan.tahun}{proyek ? ` · ${proyek.kode}` : ""}</h2></div>
            <div className="bungkus-tabel">
              <table className="tabel min-w-[40rem]">
                <thead>
                  <tr><th>Bulan</th><th className="text-right">Kas masuk</th><th className="text-right">Kas keluar</th><th className="text-right">Surplus (defisit)</th></tr>
                </thead>
                <tbody>
                  {bulanan.bulan.map((m) => (
                    <tr key={m.bulan} className={m.diterima.isZero() && m.dikeluarkan.isZero() ? "text-slate-400" : undefined}>
                      <td>{NAMA_BULAN[m.bulan - 1]} <a href={tautanBulan(m.bulan)} className="text-xs text-blue-600 hover:underline">rinci</a></td>
                      <td className="text-right angka">{angka(m.diterima)}</td>
                      <td className="text-right angka">{angka(m.dikeluarkan)}</td>
                      <td className={`text-right angka font-semibold ${m.surplus.lt(0) ? "text-rose-700" : "text-emerald-700"}`}>{angka(m.surplus)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold">
                    <td>Total {bulanan.tahun}</td>
                    <td className="text-right angka">{angka(bulanan.total.diterima)}</td>
                    <td className="text-right angka">{angka(bulanan.total.dikeluarkan)}</td>
                    <td className={`text-right angka ${bulanan.total.surplus.lt(0) ? "text-rose-700" : "text-emerald-700"}`}>{angka(bulanan.total.surplus)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-6">
            <TabelLaporan judul="Pendapatan diterima (per jenis layanan)" baris={k.pendapatan} labelTotal="Total pendapatan diterima" total={k.totalPendapatan} />
            <TabelKas judul="Penerimaan operasi lain" keterangan="Kas masuk operasi yang bukan pendapatan: PPN titipan, pengembalian dari pemasok, dan sejenisnya." baris={k.penerimaanLain} labelTotal="Total penerimaan lain" total={k.totalPenerimaanLain} />
          </div>
          <div className="space-y-6">
            <TabelKas judul="Pengeluaran operasi" keterangan="Kas keluar menurut akun lawan: pembayaran pemasok, beban, setoran pajak. Pembelian aset, prive, dan pinjaman tidak ikut." baris={k.pengeluaran} labelTotal="Total pengeluaran" total={k.totalPengeluaran} />
            <div className="kartu space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Pendapatan diterima</span><span className="angka">{rp(k.totalPendapatan)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">+ Penerimaan lain (termasuk PPN titipan)</span><span className="angka">{rp(k.totalPenerimaanLain)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">− Pengeluaran operasi</span><span className="angka">{rp(k.totalPengeluaran)}</span></div>
              <div className={`flex justify-between border-t-2 border-slate-300 pt-2 font-bold ${surplus ? "text-emerald-700" : "text-rose-700"}`}><span>{surplus ? "Surplus kas operasi" : "Defisit kas operasi"}</span><span className="angka">{rp(k.surplus)}</span></div>
              <p className="text-xs text-slate-500 pt-2">Sama dengan arus kas operasi di Laporan Arus Kas. Buku besar tetap akrual untuk pajak; tampilan ini hanya membaca uang yang benar-benar masuk dan keluar. Laporan per event hanya memuat transaksi yang diberi tanda event itu.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const [lr, bulanan] = await Promise.all([hitungLabaRugi(db, periode, { proyekId }), tampilan === "bulanan" ? hitungLabaRugiBulanan(db, tahunBulanan, { proyekId }) : null]);
  const untung = lr.labaBersih.gte(0);

  return (
    <div className="space-y-6">
      {kepala}
      {filter}

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
                    <td>{NAMA_BULAN[m.bulan - 1]} <a href={tautanBulan(m.bulan)} className="text-xs text-blue-600 hover:underline">rinci</a></td>
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
            <p className="text-xs text-slate-500 pt-2">Basis akrual (pembukuan & pajak): pendapatan diakui saat faktur, diskon sebagai kontra-pendapatan. Jurnal penutup tahun tidak dihitung. Laporan per event hanya memuat transaksi yang diberi tanda event itu.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
