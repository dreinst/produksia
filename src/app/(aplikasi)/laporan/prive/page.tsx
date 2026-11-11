import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { ambilPengaturanPerusahaan } from "@/lib/pengaturanPerusahaan";
import { bacaPeriode } from "@/lib/laporan";
import { hitungLaporanPrive } from "@/lib/laporanPrive";
import FilterPeriode from "@/komponen/ui/FilterPeriode";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import { NomorDokumen } from "@/komponen/ui/Lencana";
import LencanaPerusahaan from "@/komponen/ui/LencanaPerusahaan";
import { PERUSAHAAN_UTAMA, daftarPerusahaan, lingkupPerusahaan } from "@/lib/perusahaan";

const angka = (v: { toString(): string }) => Number(v).toLocaleString("id-ID");
const tanggal = (t: string) => new Date(`${t}T00:00:00`).toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });

export default async function HalamanLaporanPrive({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await wajibHak("buku-besar.lihat");
  const pengaturan = await ambilPengaturanPerusahaan(db);
  const periode = bacaPeriode(await searchParams, pengaturan.tahunBuku);
  // Lingkup perusahaan (D1 §7.4 butir 4). Subjudul diawali nama perusahaan atau "Gabungan {n} perusahaan", kecuali di
  // utama supaya tampilan peran lama tetap sama (penyimpangan P17).
  const lingkup = await lingkupPerusahaan();
  const lp = lingkup.perusahaanId;
  const awalan = lp === PERUSAHAAN_UTAMA ? "" : lp ? `${lingkup.perusahaan?.nama ?? lp}. ` : `Gabungan ${await db.perusahaan.count({ where: { OR: [{ aktif: true }, { jurnal: { some: {} } }] } })} perusahaan. `;
  const [{ rincian: daftar, perPemilik, total }, semuaPerusahaan] = await Promise.all([hitungLaporanPrive(db, periode.dari, periode.sampai, lp), daftarPerusahaan(true)]);
  const petaPerusahaan = new Map(semuaPerusahaan.map((x) => [x.id, x]));

  return (
    <div className="space-y-6">
      <KepalaHalaman
        jejak={[{ label: "Laporan" }]}
        judul="Laporan Prive"
        subjudul={`${awalan}Pengambilan pribadi pemilik, ${tanggal(periode.dariTeks)} s.d. ${tanggal(periode.sampaiTeks)}.`}
        lencana={<span className="lencana lencana-amber">Total Rp {angka(total)}</span>}
      />
      <FilterPeriode dari={periode.dariTeks} sampai={periode.sampaiTeks} tahunBuku={pengaturan.tahunBuku} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="kartu kartu-tabel">
          <div className="kepala-kartu"><h2 className="judul-kartu">Per pemilik</h2></div>
          <div className="bungkus-tabel">
            <table className="tabel">
              <thead><tr><th>Pemilik</th><th className="text-right">Jumlah</th></tr></thead>
              <tbody>
                {perPemilik.map((p) => (
                  <tr key={p.pemilikNama}><td>{p.pemilikNama}</td><td className="text-right angka">{angka(p.total)}</td></tr>
                ))}
                {perPemilik.length === 0 && <tr><td colSpan={2} className="kosong">Tidak ada prive pada periode ini.</td></tr>}
              </tbody>
              <tfoot><tr className="font-semibold"><td>Total</td><td className="text-right angka">{angka(total)}</td></tr></tfoot>
            </table>
          </div>
        </div>
        <div className="kartu kartu-tabel lg:col-span-2">
          <div className="kepala-kartu"><h2 className="judul-kartu">Rincian</h2></div>
          <div className="bungkus-tabel">
            <table className="tabel">
              <thead><tr><th>No</th>{!lp && <th>Perusahaan</th>}<th>Tanggal</th><th>Pemilik</th><th>Dari</th><th>Keterangan</th><th className="text-right">Jumlah</th></tr></thead>
              <tbody>
                {daftar.map((p) => (
                  <tr key={p.id}>
                    <td><NomorDokumen nomor={p.nomor} /></td>
                    {!lp && <td><LencanaPerusahaan kode={petaPerusahaan.get(p.perusahaanId)?.kode ?? p.perusahaanId} warna={petaPerusahaan.get(p.perusahaanId)?.warna} nama={petaPerusahaan.get(p.perusahaanId)?.nama} /></td>}
                    <td className="text-slate-500 whitespace-nowrap">{p.tanggal.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}</td>
                    <td>{p.pemilikNama}</td>
                    <td className="text-slate-500">{p.akunKas.kode}</td>
                    <td className="text-slate-600">{p.keterangan ?? "-"}</td>
                    <td className="text-right angka">{angka(p.jumlah)}</td>
                  </tr>
                ))}
                {daftar.length === 0 && <tr><td colSpan={lp ? 6 : 7} className="kosong">Tidak ada prive pada periode ini.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <p className="text-xs text-slate-500">Prive mengurangi modal pemilik. Angkanya juga tampil di Laporan Perubahan Modal.</p>
    </div>
  );
}
