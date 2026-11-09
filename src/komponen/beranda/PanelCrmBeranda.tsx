import { db } from "@/lib/db";
import { punyaHak, type PenggunaSesi } from "@/lib/hakAkses";
import { ringkasRupiah, statistikCrm, tindakLanjutSaya, tindakLanjutTerlambat } from "@/lib/crm";
import { formatWaktu } from "@/lib/waktu";
import KartuKpi from "@/komponen/ui/KartuKpi";
import { LencanaStatus } from "@/komponen/ui/Lencana";

const persen = (x: { toFixed(n: number): string }) => `${Number(x.toFixed(1)).toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`;

/**
 * Ringkasan CRM untuk tab "Penjualan & CRM" beranda (D4 §7.5). Angka dari statistikCrm menurut lingkup perusahaan.
 * Tautan ke dasbor CRM menyusul bersama halaman CRM.
 */
export default async function PanelCrmBeranda({ pengguna, perusahaanId }: { pengguna: PenggunaSesi; perusahaanId: string | null }) {
  if (!punyaHak(pengguna, "lead.lihat")) return null;
  const sekarang = new Date();
  const [stat, saya] = await Promise.all([statistikCrm(db, sekarang, perusahaanId), tindakLanjutSaya(db, pengguna.id, 10, perusahaanId)]);
  const sumberTeratas = stat.kinerjaSumber.slice(0, 5);

  return (
    <div className="space-y-7">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <KartuKpi judul="Deal menang" ikon="verified" nilai={stat.menang} awalan="" sub={`nilai ${ringkasRupiah(stat.nilaiMenang)}`} />
        <KartuKpi judul="Pipeline" ikon="trending_up" nilai={ringkasRupiah(stat.nilaiPipeline)} sub={`${stat.totalLead.toLocaleString("id-ID")} lead`} />
        <KartuKpi judul="Total lead" ikon="group" nilai={stat.totalLead} awalan="" sub={`${stat.leadBaru30Hari.toLocaleString("id-ID")} baru dalam 30 hari`} />
        <KartuKpi judul="Tingkat konversi" ikon="monitoring" nilai={persen(stat.tingkatKonversi)} sub={`Closing ${persen(stat.tingkatClosing)}`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-7">
        <div className="kartu">
          <div className="kepala-kartu">
            <div>
              <h2 className="judul-kartu">Tindak lanjut saya</h2>
              <p className="subjudul-kartu">Pengingat CRM yang ditugaskan ke Anda.</p>
            </div>
          </div>
          {saya.length === 0 ? (
            <p className="text-sm text-slate-500">Tidak ada tindak lanjut yang menunggu.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {saya.map((t) => (
                <li key={t.id} className="py-2.5 flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-800 truncate">{t.judul}</div>
                    <div className="text-xs text-slate-500 truncate">{t.namaLead ?? "Tanpa lead"} · {formatWaktu(t.jatuhTempo)}</div>
                  </div>
                  {tindakLanjutTerlambat(t, sekarang) && <LencanaStatus status="TERLAMBAT" />}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="kartu">
          <div className="kepala-kartu">
            <div>
              <h2 className="judul-kartu">Sumber lead</h2>
              <p className="subjudul-kartu">Lima sumber dengan lead terbanyak.</p>
            </div>
          </div>
          {sumberTeratas.length === 0 ? (
            <p className="text-sm text-slate-500">Belum ada lead.</p>
          ) : (
            <table className="tabel-polos w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500">
                  <th className="text-left font-medium pb-2">Sumber</th>
                  <th className="text-right font-medium pb-2">Lead</th>
                  <th className="text-right font-medium pb-2">Menang</th>
                  <th className="text-right font-medium pb-2">Nilai menang</th>
                </tr>
              </thead>
              <tbody>
                {sumberTeratas.map((s) => (
                  <tr key={s.sumber} className="border-t border-slate-100">
                    <td className="py-2 text-slate-700">{s.sumber}</td>
                    <td className="py-2 text-right angka">{s.lead.toLocaleString("id-ID")}</td>
                    <td className="py-2 text-right angka">{s.menang.toLocaleString("id-ID")}</td>
                    <td className="py-2 text-right angka">{ringkasRupiah(s.nilaiMenang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
