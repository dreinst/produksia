import type { LaporanIklan, TotalMetrik } from "@/lib/iklan";
import { formatTanggal } from "@/lib/waktu";
import { hapusMetrikIklanFormulir, ubahMetrikIklanFormulir } from "@/lib/aksi/iklan";
import FormulirAksi from "@/komponen/FormulirAksi";
import { Rp } from "@/komponen/ui/Lencana";
import FormulirLaporanIklan from "@/komponen/iklan/FormulirLaporanIklan";

/** Angka desimal dua digit gaya Indonesia (CTR, ROAS), mis. "2,11". */
export function duaDesimal(n: { toString(): string } | number): string {
  return Number(n.toString()).toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const hitung = (n: number) => n.toLocaleString("id-ID");

function TandaManual({ ada }: { ada: boolean }) {
  return ada ? <span className="ml-1 rounded bg-amber-50 px-1 text-[10px] font-semibold text-amber-700">manual</span> : null;
}

/**
 * Tabel laporan hasil harian kampanye (D6 §7.8 no. 5): satu baris per tanggal (terbaru dulu) dengan nilai turunan,
 * tanda "manual" untuk CTR, CPC, CPM, dan hasil yang diketik, baris kaki Total dari jumlah angka dasar, serta aksi Ubah
 * (formulir dalam <details>, id isian berawalan unik) dan Hapus menurut hak.
 */
export default function TabelLaporanIklan({
  laporan,
  total,
  aturan,
  bolehUbah,
  bolehHapus,
}: {
  laporan: LaporanIklan[];
  total: TotalMetrik;
  aturan: string | null;
  bolehUbah: boolean;
  bolehHapus: boolean;
}) {
  const adaAksi = bolehUbah || bolehHapus;
  return (
    <div className="bungkus-tabel">
      <table className="tabel min-w-[72rem]">
        <thead>
          <tr>
            <th>Tanggal</th>
            <th className="text-right">Belanja</th>
            <th className="text-right">Jangkauan</th>
            <th className="text-right">Tayangan</th>
            <th className="text-right">Klik</th>
            <th className="text-right">CTR</th>
            <th className="text-right">CPC</th>
            <th className="text-right">CPM</th>
            <th className="text-right">Leads</th>
            <th className="text-right">Konv.</th>
            <th className="text-right">Hasil</th>
            <th className="text-right">Biaya/hasil</th>
            <th className="text-right">Pendapatan</th>
            <th className="text-right">ROAS</th>
            {adaAksi && <th className="th-lekat" />}
          </tr>
        </thead>
        <tbody>
          {laporan.map((l) => (
            <tr key={l.id}>
              <td className="whitespace-nowrap">{formatTanggal(l.tanggal)}</td>
              <td className="text-right">
                <Rp nilai={l.belanja} />
              </td>
              <td className="text-right angka">{hitung(l.jangkauan)}</td>
              <td className="text-right angka">{hitung(l.tayangan)}</td>
              <td className="text-right angka">{hitung(l.klik)}</td>
              <td className="text-right angka whitespace-nowrap">
                {duaDesimal(l.turunan.ctr)}%<TandaManual ada={l.manual.ctr} />
              </td>
              <td className="text-right whitespace-nowrap">
                <Rp nilai={l.turunan.cpc} />
                <TandaManual ada={l.manual.cpc} />
              </td>
              <td className="text-right whitespace-nowrap">
                <Rp nilai={l.turunan.cpm} />
                <TandaManual ada={l.manual.cpm} />
              </td>
              <td className="text-right angka">{hitung(l.leads)}</td>
              <td className="text-right angka">{hitung(l.konversi)}</td>
              <td className="text-right angka whitespace-nowrap">
                {hitung(l.turunan.hasilEfektif)}
                <TandaManual ada={l.manual.hasil} />
              </td>
              <td className="text-right">
                <Rp nilai={l.turunan.cpr} />
              </td>
              <td className="text-right">
                <Rp nilai={l.pendapatan} />
              </td>
              <td className="text-right angka">{duaDesimal(l.turunan.roas)}x</td>
              {adaAksi && (
                <td className="td-lekat">
                  <div className="flex items-start gap-3">
                    {bolehUbah && (
                      <details>
                        <summary className="tombol-tautan cursor-pointer list-none">Ubah</summary>
                        <div className="mt-2 w-[min(40rem,80vw)]">
                          <FormulirLaporanIklan
                            aksi={ubahMetrikIklanFormulir.bind(null, l.id)}
                            awalan={`ubah-laporan-${l.id}-`}
                            nilai={{ ...l, belanja: l.belanja.toString(), pendapatan: l.pendapatan.toString(), ctrManual: l.ctrManual?.toString() ?? null, cpcManual: l.cpcManual?.toString() ?? null, cpmManual: l.cpmManual?.toString() ?? null }}
                            aturan={aturan}
                            tombol="Simpan laporan"
                            pesanSukses="Laporan tersimpan."
                          />
                        </div>
                      </details>
                    )}
                    {bolehHapus && (
                      <FormulirAksi aksi={hapusMetrikIklanFormulir.bind(null, l.id)} pesanKonfirmasi={`Hapus laporan ${formatTanggal(l.tanggal)}?`} pesanSuksesHalaman="Laporan dihapus.">
                        <button type="submit" className="tombol-tautan-bahaya">
                          Hapus
                        </button>
                      </FormulirAksi>
                    )}
                  </div>
                </td>
              )}
            </tr>
          ))}
          {laporan.length === 0 && (
            <tr>
              <td colSpan={adaAksi ? 15 : 14} className="kosong">
                Belum ada hasil yang dicatat
              </td>
            </tr>
          )}
        </tbody>
        {laporan.length > 0 && (
          <tfoot>
            <tr className="font-semibold">
              <td>Total</td>
              <td className="text-right">
                <Rp nilai={total.belanja} />
              </td>
              <td className="text-right angka">{hitung(total.jangkauan)}</td>
              <td className="text-right angka">{hitung(total.tayangan)}</td>
              <td className="text-right angka">{hitung(total.klik)}</td>
              <td className="text-right angka">{duaDesimal(total.ctr)}%</td>
              <td className="text-right">
                <Rp nilai={total.cpc} />
              </td>
              <td className="text-right">
                <Rp nilai={total.cpm} />
              </td>
              <td className="text-right angka">{hitung(total.leads)}</td>
              <td className="text-right angka">{hitung(total.konversi)}</td>
              <td className="text-right angka">{hitung(total.hasilEfektif)}</td>
              <td className="text-right">{total.cpr ? <Rp nilai={total.cpr} /> : "-"}</td>
              <td className="text-right">
                <Rp nilai={total.pendapatan} />
              </td>
              <td className="text-right angka">{duaDesimal(total.roas)}x</td>
              {adaAksi && <td className="td-lekat" />}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
