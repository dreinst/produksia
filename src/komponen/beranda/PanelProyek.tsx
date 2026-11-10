import Link from "next/link";
import { db } from "@/lib/db";
import { punyaHak, type PenggunaSesi } from "@/lib/hakAkses";
import { BATAS_PROYEK_MUAT, daftarKeuanganProyek } from "@/lib/keuanganProyek";
import type { Desimal } from "@/lib/uang";
import KartuKpi from "@/komponen/ui/KartuKpi";
import LencanaPerusahaan from "@/komponen/ui/LencanaPerusahaan";
import { Rp } from "@/komponen/ui/Lencana";

/** Status proyek yang dianggap aktif di beranda (pilihan status data induk: BERJALAN, SELESAI, BATAL). */
export const STATUS_PROYEK_AKTIF = "BERJALAN";
/** Jumlah baris proyek yang ditampilkan; total tetap dari semua proyek aktif dalam lingkup. */
const BARIS_TAMPIL = 10;

const rupiah = (n: Desimal) => `Rp ${Number(n).toLocaleString("id-ID")}`;
/** Persen margin seragam satu desimal, mis. "35,0%". */
export const teksPersen = (p: Desimal | null) => (p === null ? "-" : `${Number(p).toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`);

/**
 * Tab "Keuangan Proyek" beranda: proyek berjalan dalam lingkup perusahaan dengan pendapatan (kontrak), tagihan,
 * penerimaan, anggaran, biaya aktual, dan margin kas (rumus D5 §3.7, biaya dari jurnal bertanda proyek seperti LPJ).
 * Dijaga anggaran-proyek.lihat (HAK.md); tautan ke LPJ hanya bagi pemegang rekonsiliasi.lihat.
 */
export default async function PanelProyek({ pengguna, perusahaanId }: { pengguna: PenggunaSesi; perusahaanId: string | null }) {
  if (!punyaHak(pengguna, "anggaran-proyek.lihat")) return null;
  const { baris, total, jumlahTotal } = await daftarKeuanganProyek(db, { status: STATUS_PROYEK_AKTIF }, perusahaanId);
  const terpotong = jumlahTotal > baris.length;
  const bolehLpj = punyaHak(pengguna, "rekonsiliasi.lihat");
  const gabungan = perusahaanId === null;
  const tampil = baris.slice(0, BARIS_TAMPIL);
  const kolom = 7 + (gabungan ? 1 : 0) + (bolehLpj ? 1 : 0);

  return (
    <div className="space-y-7">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <KartuKpi judul="Kontrak / penawaran" ikon="request_quote" nilai={Number(total.pendapatanRencana)} sub={`Ditagih ${rupiah(total.ditagih)}`} />
        <KartuKpi judul="Diterima" ikon="payments" nilai={Number(total.diterima)} sub="Uang masuk tanpa PPN" />
        <KartuKpi judul="Biaya aktual" ikon="receipt_long" nilai={Number(total.aktual)} sub={`Anggaran ${rupiah(total.anggaran)}`} />
        <KartuKpi judul="Margin kas" ikon="trending_up" nilai={Number(total.marginKas)} sub={`Margin rencana ${rupiah(total.marginRencana)}`} />
      </div>

      <div className="kartu kartu-tabel">
        <div className="kepala-kartu">
          <div>
            <h2 className="judul-kartu">Proyek berjalan</h2>
            <p className="subjudul-kartu">
              {jumlahTotal.toLocaleString("id-ID")} proyek. Pendapatan tanpa PPN; biaya dari jurnal yang bertanda proyek.
              {baris.length > BARIS_TAMPIL ? ` Menampilkan ${BARIS_TAMPIL} terbaru.` : ""}
              {terpotong ? ` Total dihitung dari ${BATAS_PROYEK_MUAT.toLocaleString("id-ID")} proyek pertama.` : ""}
            </p>
          </div>
          {bolehLpj && (
            <Link href="/rekonsiliasi" className="tombol tombol-lembut tombol-kecil">Buka LPJ</Link>
          )}
        </div>
        <div className="bungkus-tabel">
          <table className="tabel min-w-[56rem]">
            <thead>
              <tr>
                <th>Proyek</th>
                {gabungan && <th>Perusahaan</th>}
                <th className="text-right">Kontrak (Rp)</th>
                <th className="text-right">Ditagih (Rp)</th>
                <th className="text-right">Diterima (Rp)</th>
                <th className="text-right">Anggaran (Rp)</th>
                <th className="text-right">Biaya aktual (Rp)</th>
                <th className="text-right">Margin kas (Rp)</th>
                {bolehLpj && <th className="td-lekat" />}
              </tr>
            </thead>
            <tbody>
              {tampil.map((p) => {
                const r = p.ringkasan;
                const lebih = r.anggaran.gt(0) && r.aktual.gt(r.anggaran);
                return (
                  <tr key={p.id}>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.warna ?? "#71717a" }} aria-hidden="true" />
                        <span className="mono text-xs text-slate-500">{p.kode}</span>
                        <span className="font-medium text-slate-800">{p.nama}</span>
                      </div>
                      {p.klien && <div className="text-xs text-slate-500 mt-0.5">{p.klien}</div>}
                    </td>
                    {gabungan && <td><LencanaPerusahaan kode={p.perusahaan.kode} warna={p.perusahaan.warna} nama={p.perusahaan.nama} /></td>}
                    <td className="text-right">
                      <Rp nilai={r.pendapatanRencana} />
                      {r.sumberPendapatan === "PENAWARAN" && <div className="text-[11px] text-slate-400">penawaran</div>}
                      {r.sumberPendapatan === "MANUAL" && <div className="text-[11px] text-slate-400">isian manual</div>}
                    </td>
                    <td className="text-right"><Rp nilai={r.ditagih} /></td>
                    <td className="text-right"><Rp nilai={r.diterima} /></td>
                    <td className="text-right"><Rp nilai={r.anggaran} /></td>
                    <td className="text-right">
                      <Rp nilai={r.aktual} />
                      {lebih && <div className="text-[11px] text-rose-600 font-medium">lebih</div>}
                    </td>
                    <td className={`text-right ${r.marginKas.isNegative() ? "text-rose-700" : ""}`}>
                      <Rp nilai={r.marginKas} />
                      <div className="text-[11px] text-slate-400">{teksPersen(r.persenMarginKas)}</div>
                    </td>
                    {bolehLpj && (
                      <td className="text-right td-lekat">
                        <Link href={`/rekonsiliasi/event/${p.id}`} className="tombol-tautan">LPJ</Link>
                      </td>
                    )}
                  </tr>
                );
              })}
              {tampil.length === 0 && (
                <tr>
                  <td colSpan={kolom} className="kosong">Tidak ada proyek berjalan.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
