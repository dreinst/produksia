import Link from "next/link";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { punyaHak } from "@/lib/hakAkses";
import { lingkupPerusahaan, saringPerusahaan } from "@/lib/perusahaan";
import { bacaParamDaftar } from "@/lib/daftar";
import { bacaFilterProyek, filterProyekSah } from "@/lib/filterProyek";
import { bacaSaringanIklan, daftarKampanye, ringkasanIklan } from "@/lib/iklan";
import { LABEL_TUJUAN, STATUS_KAMPANYE, URUTAN_STATUS_KAMPANYE } from "@/lib/labelPemasaran";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import KontrolDaftar from "@/komponen/ui/KontrolDaftar";
import KartuKpi from "@/komponen/ui/KartuKpi";
import Ikon from "@/komponen/ui/Ikon";
import { Rp } from "@/komponen/ui/Lencana";
import LencanaPerusahaan from "@/komponen/ui/LencanaPerusahaan";
import FilterProyek from "@/komponen/proyek/FilterProyek";
import LencanaProyek from "@/komponen/proyek/LencanaProyek";
import { LencanaStatusKampanye } from "@/komponen/pemasaran/LencanaPemasaran";
import { duaDesimal } from "@/komponen/iklan/TabelLaporanIklan";

/*
 * Perencana Iklan Meta (D6 §7.6): enam KPI ringkasanIklan dan tabel kampanye per lingkup perusahaan aktif, dengan
 * saringan proyek dan status. Data iklan dicatat manual tanpa integrasi API Meta.
 */
export default async function HalamanIklanMeta({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const pengguna = await wajibHak("kampanye.lihat");
  const sp = await searchParams;
  const lingkup = await lingkupPerusahaan();
  const gabungan = lingkup.perusahaanId === null;
  const saringan = bacaSaringanIklan(sp);
  saringan.proyek = await filterProyekSah(db, bacaFilterProyek(sp));
  const param = await bacaParamDaftar(Promise.resolve(sp));
  const [ringkasan, { total, baris }, proyekLingkup] = await Promise.all([
    ringkasanIklan(db, { proyek: saringan.proyek, status: saringan.status }, lingkup.perusahaanId),
    daftarKampanye(db, saringan, param, lingkup.perusahaanId),
    db.proyek.findMany({ where: saringPerusahaan(lingkup.perusahaanId), orderBy: { kode: "asc" }, select: { id: true, kode: true, nama: true, status: true } }),
  ]);
  const t = ringkasan.total;
  const rupiah = (n: { toString(): string }) => Number(n.toString()).toLocaleString("id-ID");
  const adaSaringan = !!(saringan.proyek || saringan.status);

  return (
    <div className="space-y-6">
      <KepalaHalaman
        jejak={[{ label: "Pemasaran" }, { label: "Perencana Iklan Meta" }]}
        judul="Perencana Iklan Meta"
        subjudul="Rencanakan kampanye, set iklan, dan iklan, lalu catat hasilnya secara manual."
        aksi={
          punyaHak(pengguna, "kampanye.buat") ? (
            <Link href={saringan.proyek && saringan.proyek !== "tanpa" ? `/pemasaran/iklan/baru?proyek=${encodeURIComponent(saringan.proyek)}` : "/pemasaran/iklan/baru"} className="tombol tombol-utama min-h-11 w-full sm:w-auto">
              <Ikon nama="add" className="!text-[18px]" /> Kampanye baru
            </Link>
          ) : undefined
        }
      />

      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end sm:justify-end gap-3">
        <FilterProyek nilai={saringan.proyek ?? ""} daftar={proyekLingkup} tambahan={{ status: saringan.status || undefined, q: param.q || undefined }} label="Proyek" />
        <form method="get" className="flex items-center gap-2" aria-label="Saringan status kampanye">
          {saringan.proyek && <input type="hidden" name="proyek" value={saringan.proyek} />}
          {param.q && <input type="hidden" name="q" value={param.q} />}
          <select name="status" defaultValue={saringan.status ?? ""} aria-label="Status" className="isian isian-kecil w-auto">
            <option value="">Semua status</option>
            {URUTAN_STATUS_KAMPANYE.map((s) => (
              <option key={s} value={s}>
                {STATUS_KAMPANYE[s].label}
              </option>
            ))}
          </select>
          <button type="submit" className="tombol tombol-garis tombol-kecil">
            Terapkan
          </button>
        </form>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <KartuKpi judul="Kampanye" ikon="ads_click" nilai={ringkasan.jumlahKampanye} awalan="" sub={`${ringkasan.aktif.toLocaleString("id-ID")} aktif`} />
        <KartuKpi judul="Anggaran rencana" ikon="payments" nilai={Number(ringkasan.anggaranRencana.toString())} />
        <KartuKpi judul="Belanja" ikon="payments" nilai={Number(t.belanja.toString())} />
        <KartuKpi judul="Leads" ikon="group" nilai={t.leads} awalan="" sub={t.cpr ? `Biaya per hasil Rp ${rupiah(t.cpr)}` : "Biaya per hasil: tujuan berbeda"} />
        <KartuKpi judul="CTR / CPC" ikon="ads_click" nilai={`${duaDesimal(t.ctr)}%`} sub={`CPC Rp ${rupiah(t.cpc)}`} />
        <KartuKpi judul="ROAS" ikon="monitoring" nilai={`${duaDesimal(t.roas)}x`} sub={`Rp ${rupiah(t.pendapatan)} pendapatan`} />
      </div>

      <div className="kartu kartu-tabel">
        <KontrolDaftar param={param} total={total} placeholder="Cari nama kampanye…" tambahan={{ proyek: saringan.proyek || undefined, status: saringan.status || undefined }} adaSaringan={adaSaringan} />
        <div className="bungkus-tabel">
          <table className="tabel min-w-[64rem]">
            <thead>
              <tr>
                <th>Kampanye</th>
                {gabungan && <th>Perusahaan</th>}
                <th>Proyek</th>
                <th>Status</th>
                <th>Tujuan</th>
                <th className="text-right">Anggaran</th>
                <th className="text-right">Belanja</th>
                <th className="text-right">Tayangan</th>
                <th className="text-right">Leads</th>
                <th className="text-right">Biaya/hasil</th>
                <th className="text-right">ROAS</th>
              </tr>
            </thead>
            <tbody>
              {baris.map((k) => (
                <tr key={k.id}>
                  <td className="max-w-xs">
                    <Link href={`/pemasaran/iklan/${k.id}`} className="tombol-tautan font-medium">
                      {k.nama}
                    </Link>
                  </td>
                  {gabungan && (
                    <td>
                      <LencanaPerusahaan kode={k.perusahaan.kode} warna={k.perusahaan.warna} nama={k.perusahaan.nama} />
                    </td>
                  )}
                  <td>{k.proyek ? <LencanaProyek proyek={k.proyek} /> : <span className="text-slate-400">-</span>}</td>
                  <td>
                    <LencanaStatusKampanye status={k.status} />
                  </td>
                  <td>{LABEL_TUJUAN[k.tujuan]}</td>
                  <td className="text-right">
                    <Rp nilai={k.anggaran} />
                  </td>
                  <td className="text-right">
                    <Rp nilai={k.total.belanja} />
                  </td>
                  <td className="text-right angka">{k.total.tayangan.toLocaleString("id-ID")}</td>
                  <td className="text-right angka">{k.total.leads.toLocaleString("id-ID")}</td>
                  <td className="text-right">{k.total.cpr ? <Rp nilai={k.total.cpr} /> : "-"}</td>
                  <td className="text-right angka">{duaDesimal(k.total.roas)}x</td>
                </tr>
              ))}
              {baris.length === 0 && (
                <tr>
                  <td colSpan={gabungan ? 11 : 10} className="kosong">
                    {param.q || adaSaringan ? "Tidak ada yang cocok dengan pencarian." : "Belum ada kampanye"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
