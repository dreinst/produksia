import Link from "next/link";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { punyaHak } from "@/lib/hakAkses";
import { bacaParamDaftar } from "@/lib/daftar";
import { lingkupPerusahaan } from "@/lib/perusahaan";
import { daftarKeuanganProyek } from "@/lib/keuanganProyek";
import { LABEL_STATUS_PROYEK, STATUS_PROYEK, statusProyekSah } from "@/lib/proyek";
import Ikon from "@/komponen/ui/Ikon";
import KartuKpi from "@/komponen/ui/KartuKpi";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import KontrolDaftar from "@/komponen/ui/KontrolDaftar";
import { LencanaStatus, Rp } from "@/komponen/ui/Lencana";
import LencanaPerusahaan from "@/komponen/ui/LencanaPerusahaan";
import AngkaMargin from "@/komponen/proyek/AngkaMargin";
import TitikWarnaProyek from "@/komponen/proyek/TitikWarnaProyek";

/*
 * Keuangan Proyek (D5 §7.2): anggaran, biaya aktual, dan margin semua proyek dalam lingkup perusahaan. Saringan status
 * bawaan "Semua status" (P-60). Total dihitung dari semua proyek tersaring (paling banyak 500), tabel dipaginasi 25.
 * Angka dari daftarKeuanganProyek, fungsi yang sama dengan panel Keuangan Proyek di beranda.
 */

const rp = (v: { toString(): string }) => `Rp ${Number(v.toString()).toLocaleString("id-ID")}`;

export default async function HalamanKeuanganProyek({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const pengguna = await wajibHak("anggaran-proyek.lihat");
  const param = await bacaParamDaftar(searchParams);
  const sp = await searchParams;
  const statusMentah = typeof sp.status === "string" ? sp.status.trim() : "";
  const status = statusProyekSah(statusMentah) ? statusMentah : "";
  const lingkup = await lingkupPerusahaan();
  const gabungan = lingkup.perusahaanId === null;

  const { baris, total, jumlahTotal } = await daftarKeuanganProyek(db, { q: param.q, status: status || undefined }, lingkup.perusahaanId);
  const halaman = baris.slice(param.lewati, param.lewati + param.ambil);
  const adaSaringan = !!param.q || status !== "";
  const kolom = 7 + (gabungan ? 1 : 0);

  return (
    <div className="space-y-6">
      <KepalaHalaman
        jejak={[{ label: "Proyek & Event", href: "/proyek" }, { label: "Keuangan Proyek" }]}
        judul="Keuangan Proyek"
        subjudul="Anggaran, biaya aktual, dan margin per proyek. Pendapatan dihitung tanpa PPN; biaya diambil dari jurnal yang bertanda proyek."
        aksi={
          punyaHak(pengguna, "kategori-anggaran.ubah") ? (
            <Link href="/pengaturan/kategori-anggaran" className="tombol tombol-garis">
              <Ikon nama="category" className="!text-[18px]" />
              Kategori anggaran
            </Link>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KartuKpi judul="Kontrak / penawaran" ikon="savings" nilai={rp(total.pendapatanRencana)} sub={`Ditagih ${rp(total.ditagih)}`} />
        <KartuKpi judul="Diterima" ikon="payments" nilai={rp(total.diterima)} sub="Uang masuk tanpa PPN" />
        <KartuKpi judul="Biaya aktual" ikon="account_balance_wallet" nilai={rp(total.aktual)} sub={`Anggaran ${rp(total.anggaran)}`} />
        <KartuKpi judul="Margin kas" ikon="pie_chart" nilai={rp(total.marginKas)} sub={`Margin rencana ${rp(total.marginRencana)}`} />
      </div>
      {jumlahTotal > baris.length && (
        <p role="status" className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Ada {jumlahTotal.toLocaleString("id-ID")} proyek yang cocok. Total dan tabel hanya memuat {baris.length.toLocaleString("id-ID")} proyek pertama; persempit pencarian atau saringan status.
        </p>
      )}

      <form method="get" className="kartu flex flex-wrap items-end gap-3">
        {param.q && <input type="hidden" name="q" value={param.q} />}
        <div className="space-y-1">
          <label htmlFor="saring-status-keuangan" className="label">
            Status
          </label>
          <select id="saring-status-keuangan" name="status" defaultValue={status} className="isian w-60">
            <option value="">Semua status</option>
            {STATUS_PROYEK.map((s) => (
              <option key={s} value={s}>
                {LABEL_STATUS_PROYEK[s]}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="tombol tombol-garis">
          Terapkan
        </button>
      </form>

      <div className="kartu kartu-tabel">
        <KontrolDaftar param={param} total={baris.length} placeholder="Cari kode, nama proyek, atau klien…" tambahan={{ status: status || undefined }} adaSaringan={adaSaringan} />
        <div className="bungkus-tabel">
          <table className="tabel min-w-[60rem]">
            <thead>
              <tr>
                <th>Proyek</th>
                <th className="text-right">Pendapatan</th>
                <th className="text-right">Diterima</th>
                <th className="text-right">Anggaran</th>
                <th className="text-right">Biaya aktual</th>
                <th className="text-right">Margin rencana</th>
                <th className="text-right">Margin kas</th>
                {gabungan && <th>Perusahaan</th>}
              </tr>
            </thead>
            <tbody>
              {halaman.length === 0 ? (
                <tr>
                  <td colSpan={kolom} className="kosong">
                    {adaSaringan ? "Tidak ada proyek yang cocok dengan pencarian." : "Belum ada proyek."}
                  </td>
                </tr>
              ) : (
                halaman.map((p) => {
                  const r = p.ringkasan;
                  const lebih = r.anggaran.gt(0) && r.aktual.gt(r.anggaran);
                  return (
                    <tr key={p.id}>
                      <td>
                        <div className="flex items-center gap-2">
                          <TitikWarnaProyek warna={p.warna} />
                          <Link href={`/proyek/${p.id}/keuangan`} className="font-semibold text-slate-900 hover:underline">
                            <span className="mono text-xs text-slate-500 mr-1">{p.kode}</span>
                            {p.nama}
                          </Link>
                          <LencanaStatus status={p.status} />
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">{p.klien ?? "Tanpa klien"}</div>
                      </td>
                      <td className="text-right">
                        <Rp nilai={r.pendapatanRencana} />
                        {r.sumberPendapatan === "PENAWARAN" && <div className="text-xs text-slate-500">penawaran</div>}
                        {r.sumberPendapatan === "MANUAL" && <div className="text-xs text-slate-500">isian manual</div>}
                      </td>
                      <td className="text-right">
                        <Rp nilai={r.diterima} />
                      </td>
                      <td className="text-right">
                        <Rp nilai={r.anggaran} />
                      </td>
                      <td className="text-right">
                        <Rp nilai={r.aktual} />
                        {lebih && <div className="text-xs text-rose-700">lebih</div>}
                      </td>
                      <td className="text-right">
                        <AngkaMargin nilai={r.marginRencana} persen={r.persenMarginRencana} />
                      </td>
                      <td className="text-right">
                        <AngkaMargin nilai={r.marginKas} persen={r.persenMarginKas} />
                      </td>
                      {gabungan && (
                        <td>
                          <LencanaPerusahaan kode={p.perusahaan.kode} warna={p.perusahaan.warna} nama={p.perusahaan.nama} />
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
            {baris.length > 0 && (
              <tfoot>
                <tr>
                  <th className="text-left">Total {baris.length.toLocaleString("id-ID")} proyek</th>
                  <th className="text-right">
                    <Rp nilai={total.pendapatanRencana} />
                  </th>
                  <th className="text-right">
                    <Rp nilai={total.diterima} />
                  </th>
                  <th className="text-right">
                    <Rp nilai={total.anggaran} />
                  </th>
                  <th className="text-right">
                    <Rp nilai={total.aktual} />
                  </th>
                  <th className="text-right">
                    <AngkaMargin nilai={total.marginRencana} />
                  </th>
                  <th className="text-right">
                    <AngkaMargin nilai={total.marginKas} />
                  </th>
                  {gabungan && <th />}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
