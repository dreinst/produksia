import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { ambilPengaturanPerusahaan } from "@/lib/pengaturanPerusahaan";
import { bacaPeriode } from "@/lib/laporan";
import { hitungArusKas, type BarisArus } from "@/lib/arusKas";
import FilterPeriode from "@/komponen/ui/FilterPeriode";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";

const rp = (v: { toString(): string }) => `Rp ${Number(v).toLocaleString("id-ID")}`;
const angka = (v: { toString(): string }) => Number(v).toLocaleString("id-ID");
const tanggal = (t: string) => new Date(`${t}T00:00:00`).toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });

function TabelArus({ judul, keterangan, baris, total }: { judul: string; keterangan: string; baris: BarisArus[]; total: { toString(): string } }) {
  return (
    <div className="kartu kartu-tabel">
      <div className="kepala-kartu">
        <div>
          <h2 className="judul-kartu">{judul}</h2>
          <p className="subjudul-kartu">{keterangan}</p>
        </div>
      </div>
      <div className="bungkus-tabel">
        <table className="tabel">
          <thead><tr><th>Kode</th><th>Akun lawan</th><th className="text-right">Masuk (keluar)</th></tr></thead>
          <tbody>
            {baris.map((b) => (
              <tr key={b.id}>
                <td className="mono">{b.kode}</td>
                <td>{b.nama}</td>
                <td className={`text-right angka ${b.jumlah.lt(0) ? "text-rose-700" : "text-emerald-700"}`}>{b.jumlah.lt(0) ? `(${angka(b.jumlah.neg())})` : angka(b.jumlah)}</td>
              </tr>
            ))}
            {baris.length === 0 && <tr><td colSpan={3} className="kosong">Tidak ada arus kas pada bagian ini.</td></tr>}
          </tbody>
          <tfoot>
            <tr><td colSpan={2}>Arus kas bersih</td><td className={`text-right angka ${Number(total) < 0 ? "text-rose-700" : "text-emerald-700"}`}>{Number(total) < 0 ? `(${angka(-Number(total))})` : angka(total)}</td></tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

export default async function HalamanArusKas({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await wajibHak("buku-besar.lihat");
  const pengaturan = await ambilPengaturanPerusahaan(db);
  const periode = bacaPeriode(await searchParams, pengaturan.tahunBuku);
  const a = await hitungArusKas(db, periode);

  return (
    <div className="space-y-6">
      <KepalaHalaman
        jejak={[{ label: "Buku Besar" }]}
        judul="Laporan Arus Kas"
        subjudul={`Metode langsung, periode ${tanggal(periode.dariTeks)} s.d. ${tanggal(periode.sampaiTeks)} — dari ${a.jumlahJurnal} jurnal yang menyentuh akun kas/bank.`}
        lencana={<span className={`lencana ${a.cocok ? "lencana-emerald" : "lencana-rose"}`}>{a.cocok ? "Kas akhir = buku besar" : "TIDAK COCOK dengan buku besar"}</span>}
      />
      <FilterPeriode dari={periode.dariTeks} sampai={periode.sampaiTeks} tahunBuku={pengaturan.tahunBuku} />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="kartu p-5"><div className="teks-label">Kas & bank awal</div><div className="font-heading text-lg font-bold angka mt-1">{rp(a.kasAwal)}</div></div>
        <div className="kartu p-5"><div className="teks-label">Arus operasi</div><div className={`font-heading text-lg font-bold angka mt-1 ${a.totalOperasi.lt(0) ? "text-rose-700" : "text-emerald-700"}`}>{rp(a.totalOperasi)}</div></div>
        <div className="kartu p-5"><div className="teks-label">Arus investasi</div><div className={`font-heading text-lg font-bold angka mt-1 ${a.totalInvestasi.lt(0) ? "text-rose-700" : "text-emerald-700"}`}>{rp(a.totalInvestasi)}</div></div>
        <div className="kartu p-5"><div className="teks-label">Arus pendanaan</div><div className={`font-heading text-lg font-bold angka mt-1 ${a.totalPendanaan.lt(0) ? "text-rose-700" : "text-emerald-700"}`}>{rp(a.totalPendanaan)}</div></div>
        <div className={`kartu p-5 ${a.cocok ? "border-emerald-200" : "border-rose-300"}`}><div className="teks-label">Kas & bank akhir</div><div className="font-heading text-lg font-bold angka mt-1">{rp(a.kasAkhir)}</div></div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-6">
          <TabelArus judul="Aktivitas Operasi" keterangan="Penerimaan dari pelanggan, pembayaran ke vendor, beban, pajak, uang muka" baris={a.operasi} total={a.totalOperasi} />
          <TabelArus judul="Aktivitas Investasi" keterangan="Perolehan/penjualan aset tetap dan investasi jangka panjang (1-2xxx, 1-3xxx)" baris={a.investasi} total={a.totalInvestasi} />
        </div>
        <div className="space-y-6">
          <TabelArus judul="Aktivitas Pendanaan" keterangan="Setoran/pengambilan modal, prive, hutang jangka panjang (3-xxxx, 2-2xxx)" baris={a.pendanaan} total={a.totalPendanaan} />
          <div className="kartu space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">Kas & bank awal periode</span><span className="angka">{rp(a.kasAwal)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">+ Arus operasi</span><span className="angka">{rp(a.totalOperasi)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">+ Arus investasi</span><span className="angka">{rp(a.totalInvestasi)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">+ Arus pendanaan</span><span className="angka">{rp(a.totalPendanaan)}</span></div>
            <div className="flex justify-between border-t border-slate-200 pt-2 font-semibold"><span>Kenaikan (penurunan) kas bersih</span><span className={`angka ${a.kenaikan.lt(0) ? "text-rose-700" : "text-emerald-700"}`}>{rp(a.kenaikan)}</span></div>
            <div className="flex justify-between border-t-2 border-slate-300 pt-2 font-bold"><span>Kas & bank akhir periode</span><span className="angka">{rp(a.kasAkhir)}</span></div>
            <div className={`flex justify-between text-xs ${a.cocok ? "text-emerald-700" : "text-rose-700"}`}><span>Saldo kas/bank menurut buku besar</span><span className="angka">{rp(a.kasAkhirBukuBesar)} {a.cocok ? "✓" : "✗"}</span></div>
            <div className="pt-2 border-t border-dashed border-slate-200 space-y-1">
              {a.daftarKas.map((k) => (
                <div key={k.id} className="flex justify-between text-xs text-slate-500"><span><span className="mono">{k.kode}</span> {k.nama}</span><span className="angka">{angka(k.saldoAwal)} → {angka(k.saldoAkhir)}</span></div>
              ))}
            </div>
            <p className="text-xs text-slate-500 pt-2">Perpindahan antar akun kas/bank saling meniadakan dan tidak ditampilkan. Setiap jurnal seimbang, jadi total arus selalu sama dengan perubahan saldo kas/bank.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
