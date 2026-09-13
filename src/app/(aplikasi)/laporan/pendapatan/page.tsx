import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { ambilPengaturanPerusahaan } from "@/lib/pengaturanPerusahaan";
import { bacaPeriode, type BarisLaporan } from "@/lib/laporan";
import { ringkasanPendapatan } from "@/lib/laporanPendapatan";
import { labaRugiKas } from "@/lib/basisKas";
import { jumlahkan } from "@/lib/uang";
import FilterPeriode from "@/komponen/ui/FilterPeriode";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";

const rp = (v: { toString(): string }) => `Rp ${Number(v).toLocaleString("id-ID")}`;
const angka = (v: { toString(): string }) => Number(v).toLocaleString("id-ID");
const tanggal = (t: string) => new Date(`${t}T00:00:00`).toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });

function TabelLayanan({ baris, total, keterangan }: { baris: BarisLaporan[]; total: { toString(): string }; keterangan: string }) {
  const t = Number(total);
  const persen = (v: { toString(): string }) => (t ? `${((Number(v) / t) * 100).toFixed(1)}%` : "");
  return (
    <div className="kartu kartu-tabel">
      <div className="kepala-kartu"><h2 className="judul-kartu">Per jenis layanan</h2><span className="text-xs text-slate-500">{keterangan}</span></div>
      <div className="bungkus-tabel">
        <table className="tabel">
          <thead>
            <tr><th>Kode</th><th>Jenis layanan</th><th className="text-right">Pendapatan</th><th className="text-right">%</th></tr>
          </thead>
          <tbody>
            {baris.map((b) => (
              <tr key={b.id} className={b.kelompok ? "bg-slate-50/70" : undefined}>
                <td className="mono">{b.kode}</td>
                <td className={b.kelompok ? "font-semibold text-slate-900" : undefined} style={{ paddingLeft: `${0.75 + b.kedalaman * 1.25}rem` }}>{b.nama}</td>
                <td className={`text-right angka ${b.kelompok ? "font-semibold text-slate-700" : ""}`}>{angka(b.jumlah)}</td>
                <td className="text-right angka">{persen(b.jumlah)}</td>
              </tr>
            ))}
            {baris.length === 0 && <tr><td colSpan={4} className="kosong">Tidak ada pendapatan dalam periode ini.</td></tr>}
          </tbody>
          <tfoot>
            <tr><td colSpan={2}>Total pendapatan</td><td className="text-right angka">{angka(total)}</td><td className="text-right angka">{t ? "100%" : ""}</td></tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

export default async function HalamanRingkasanPendapatan({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await wajibHak("buku-besar.lihat");
  const param = await searchParams;
  const pengaturan = await ambilPengaturanPerusahaan(db);
  const periode = bacaPeriode(param, pengaturan.tahunBuku);
  const basis = param.basis === "akrual" ? "akrual" : "kas";
  const tautan = (b: "kas" | "akrual") => `?dari=${periode.dariTeks}&sampai=${periode.sampaiTeks}${b === "akrual" ? "&basis=akrual" : ""}`;
  const kepala = (subjudul: string) => (
    <KepalaHalaman
      jejak={[{ label: "Laporan" }]}
      judul="Ringkasan Pendapatan"
      subjudul={`Periode ${tanggal(periode.dariTeks)} s.d. ${tanggal(periode.sampaiTeks)}. ${subjudul}`}
      lencana={
        <span className="flex items-center gap-1">
          <a href={tautan("kas")} className={`tombol tombol-kecil ${basis === "kas" ? "tombol-utama" : "tombol-garis"}`}>Basis kas (uang diterima)</a>
          <a href={tautan("akrual")} className={`tombol tombol-kecil ${basis === "akrual" ? "tombol-utama" : "tombol-garis"}`}>Basis faktur (akrual)</a>
        </span>
      }
      aksi={<a href={`/buku-besar/laba-rugi${tautan(basis)}`} className="tombol tombol-kecil tombol-garis">Laba Rugi periode ini</a>}
    />
  );
  const filter = <FilterPeriode dari={periode.dariTeks} sampai={periode.sampaiTeks} tahunBuku={pengaturan.tahunBuku} tersembunyi={{ basis: basis === "akrual" ? "akrual" : undefined }} />;

  if (basis === "kas") {
    const k = await labaRugiKas(db, periode);
    const total = Number(k.totalDariPelanggan);
    const persen = (v: { toString(): string }) => (total ? `${((Number(v) / total) * 100).toFixed(1)}%` : "");
    const pelanggan = k.perPelanggan.filter((p) => p.id);
    const terbesar = pelanggan[0];
    return (
      <div className="space-y-6">
        {kepala("Uang yang benar-benar diterima dari pelanggan: uang muka (DP), pelunasan faktur, dan kas masuk langsung; dipecah per pelanggan dan per jenis layanan.")}
        {filter}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="kartu p-5"><div className="teks-label">Uang diterima dari pelanggan</div><div className="font-heading text-xl font-bold angka mt-1">{rp(k.totalDariPelanggan)}</div></div>
          <div className="kartu p-5"><div className="teks-label">Dokumen penerimaan</div><div className="font-heading text-xl font-bold angka mt-1">{k.jumlahDokumen}</div><div className="text-xs text-slate-500">uang muka + pelunasan</div></div>
          <div className="kartu p-5"><div className="teks-label">Pelanggan</div><div className="font-heading text-xl font-bold angka mt-1">{pelanggan.length}</div></div>
          <div className="kartu p-5"><div className="teks-label">Pelanggan terbesar</div><div className="font-heading text-lg font-bold mt-1 truncate">{terbesar ? terbesar.nama : "–"}</div>{terbesar && <div className="text-xs text-slate-500">{rp(terbesar.total)} · {persen(terbesar.total)}</div>}</div>
        </div>

        <div className="kartu kartu-tabel">
          <div className="kepala-kartu"><h2 className="judul-kartu">Per pelanggan</h2><span className="text-xs text-slate-500">Uang muka dihitung saat diterima, pelunasan saat dibayar; bukan saat faktur terbit.</span></div>
          <div className="bungkus-tabel">
            <table className="tabel">
              <thead>
                <tr>
                  <th>Pelanggan</th>
                  <th className="text-right">Dokumen</th>
                  <th className="text-right">Uang muka (DP)</th>
                  <th className="text-right">Pelunasan faktur</th>
                  <th className="text-right">Total diterima</th>
                  <th className="text-right">%</th>
                </tr>
              </thead>
              <tbody>
                {k.perPelanggan.map((p) => (
                  <tr key={p.id ?? ""} className={p.id ? undefined : "text-slate-500"}>
                    <td>
                      {p.id ? (
                        <>
                          <a href={`/penjualan/penerimaan?q=${encodeURIComponent(p.nama)}`} className="font-medium text-slate-900 hover:underline">{p.nama}</a>
                          <span className="mono text-xs text-slate-500 ml-2">{p.kode}</span>
                        </>
                      ) : p.nama}
                    </td>
                    <td className="text-right angka">{p.id ? p.jumlahDokumen : ""}</td>
                    <td className="text-right angka">{p.id ? angka(p.uangMuka) : ""}</td>
                    <td className="text-right angka">{p.id ? angka(p.pelunasan) : ""}</td>
                    <td className="text-right angka font-semibold">{angka(p.total)}</td>
                    <td className="text-right angka">{persen(p.total)}</td>
                  </tr>
                ))}
                {k.perPelanggan.length === 0 && <tr><td colSpan={6} className="kosong">Tidak ada uang masuk dari pelanggan dalam periode ini.</td></tr>}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td className="text-right angka">{k.jumlahDokumen}</td>
                  <td className="text-right angka">{angka(jumlahkan(k.perPelanggan.map((p) => p.uangMuka)))}</td>
                  <td className="text-right angka">{angka(jumlahkan(k.perPelanggan.map((p) => p.pelunasan)))}</td>
                  <td className="text-right angka">{angka(k.totalDariPelanggan)}</td>
                  <td className="text-right angka">{total ? "100%" : ""}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <TabelLayanan baris={k.pendapatan} total={k.totalPendapatan} keterangan="Uang yang diterima dialokasikan ke akun pendapatan menurut baris faktur atau pesanan (Event, Produksi, Sewa; Reguler atau Flagship)." />
        {k.ppnTitipan.gt(0) && <p className="text-xs text-slate-500">Selisih dengan total per pelanggan: PPN dalam penerimaan {rp(k.ppnTitipan)} (titipan, bukan pendapatan).</p>}
      </div>
    );
  }

  const r = await ringkasanPendapatan(db, periode);
  const total = Number(r.total);
  const persen = (v: { toString(): string }) => (total ? `${((Number(v) / total) * 100).toFixed(1)}%` : "");
  const pelanggan = r.perPelanggan.filter((k) => k.id);
  const terbesar = pelanggan[0];

  return (
    <div className="space-y-6">
      {kepala("Pendapatan menurut faktur (akrual), sama dengan baris Pendapatan di Laba Rugi fiskal; per pelanggan dan per jenis layanan.")}
      {filter}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="kartu p-5"><div className="teks-label">Total pendapatan</div><div className="font-heading text-xl font-bold angka mt-1">{rp(r.total)}</div></div>
        <div className="kartu p-5"><div className="teks-label">Faktur penjualan</div><div className="font-heading text-xl font-bold angka mt-1">{r.jumlahFaktur}</div></div>
        <div className="kartu p-5"><div className="teks-label">Pelanggan</div><div className="font-heading text-xl font-bold angka mt-1">{pelanggan.length}</div></div>
        <div className="kartu p-5"><div className="teks-label">Pelanggan terbesar</div><div className="font-heading text-lg font-bold mt-1 truncate">{terbesar ? terbesar.nama : "–"}</div>{terbesar && <div className="text-xs text-slate-500">{rp(terbesar.bersih)} · {persen(terbesar.bersih)}</div>}</div>
      </div>

      <div className="kartu kartu-tabel">
        <div className="kepala-kartu"><h2 className="judul-kartu">Per pelanggan</h2></div>
        <div className="bungkus-tabel">
          <table className="tabel">
            <thead>
              <tr>
                <th>Pelanggan</th>
                <th className="text-right">Faktur</th>
                <th className="text-right">Nilai faktur</th>
                <th className="text-right">Retur</th>
                <th className="text-right">Pendapatan bersih</th>
                <th className="text-right">%</th>
              </tr>
            </thead>
            <tbody>
              {r.perPelanggan.map((k) => (
                <tr key={k.id ?? ""} className={k.id ? undefined : "text-slate-500"}>
                  <td>
                    {k.id ? (
                      <>
                        <a href={`/penjualan/faktur?q=${encodeURIComponent(k.nama)}`} className="font-medium text-slate-900 hover:underline">{k.nama}</a>
                        <span className="mono text-xs text-slate-500 ml-2">{k.kode}</span>
                      </>
                    ) : k.nama}
                  </td>
                  <td className="text-right angka">{k.id ? k.jumlahFaktur : ""}</td>
                  <td className="text-right angka">{k.id ? angka(k.faktur) : ""}</td>
                  <td className="text-right angka">{k.id ? angka(k.retur) : ""}</td>
                  <td className="text-right angka font-semibold">{angka(k.bersih)}</td>
                  <td className="text-right angka">{persen(k.bersih)}</td>
                </tr>
              ))}
              {r.perPelanggan.length === 0 && (
                <tr><td colSpan={6} className="kosong">Tidak ada pendapatan dalam periode ini.</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td className="text-right angka">{r.jumlahFaktur}</td>
                <td colSpan={2}></td>
                <td className="text-right angka">{angka(r.total)}</td>
                <td className="text-right angka">{total ? "100%" : ""}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <TabelLayanan baris={r.perLayanan} total={r.total} keterangan="Mengikuti akun pendapatan tiap barang/jasa (Event, Produksi, Sewa; Reguler atau Flagship). Pendapatan bruto; diskon ada di kelompok Potongan Penjualan." />
    </div>
  );
}
