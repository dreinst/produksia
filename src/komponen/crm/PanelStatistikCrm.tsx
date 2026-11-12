import Link from "next/link";
import { db } from "@/lib/db";
import { punyaHak, type PenggunaSesi } from "@/lib/hakAkses";
import { ringkasRupiah, statistikCrm, tindakLanjutTerlambat } from "@/lib/crm";
import { formatWaktu } from "@/lib/waktu";
import KartuKpi from "@/komponen/ui/KartuKpi";
import { LencanaStatus } from "@/komponen/ui/Lencana";

/*
 * Isi dasbor CRM (D4 §7.5): empat KPI, corong pipeline per perusahaan, kinerja sales dan sumber, tren 6 bulan, dan
 * tindak lanjut jatuh tempo. Semua angka dari statistikCrm (agregat di basis data). Kartu "Pendapatan lunas" hanya
 * untuk pemegang faktur.lihat; tanpa hak itu diganti "Tingkat konversi".
 */

const persen = (x: { toFixed(n: number): string }) => `${Number(x.toFixed(1)).toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`;
const angka = (n: number) => n.toLocaleString("id-ID");
const WARNA_CORONG = { BERJALAN: "bg-blue-600", MENANG: "bg-emerald-600", KALAH: "bg-rose-600" } as const;

export default async function PanelStatistikCrm({ perusahaanId, sekarang, pengguna }: { perusahaanId: string | null; sekarang: Date; pengguna: PenggunaSesi }) {
  const s = await statistikCrm(db, sekarang, perusahaanId);
  const bolehFaktur = punyaHak(pengguna, "faktur.lihat");

  const corong = new Map<string, { nama: string; tahap: typeof s.corong; total: number }>();
  for (const c of s.corong) {
    const isi = corong.get(c.perusahaanId) ?? { nama: c.namaPerusahaan, tahap: [], total: 0 };
    isi.tahap.push(c);
    isi.total += c.jumlah;
    corong.set(c.perusahaanId, isi);
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <KartuKpi judul="Total lead" ikon="group" nilai={s.totalLead} awalan="" sub={`${angka(s.leadBaru30Hari)} baru (30 hari)`} />
        <KartuKpi judul="Nilai pipeline" ikon="trending_up" nilai={ringkasRupiah(s.nilaiPipeline)} />
        <KartuKpi judul="Menang / Kalah" ikon="trophy" nilai={`${angka(s.menang)} / ${angka(s.kalah)}`} sub={`Closing rate ${persen(s.tingkatClosing)}`} />
        {bolehFaktur ? (
          <KartuKpi judul="Pendapatan lunas" ikon="payments" nilai={ringkasRupiah(s.pendapatanLunas)} sub={`Konversi ${persen(s.tingkatKonversi)}`} />
        ) : (
          <KartuKpi judul="Tingkat konversi" ikon="payments" nilai={persen(s.tingkatKonversi)} sub={`Closing ${persen(s.tingkatClosing)}`} />
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="kartu space-y-4">
          <h2 className="judul-kartu">Corong pipeline</h2>
          {corong.size === 0 && <p className="text-sm text-slate-500">Belum ada tahap pipeline.</p>}
          {[...corong.entries()].map(([id, p]) => (
            <div key={id} className="space-y-2">
              {corong.size > 1 && <h3 className="teks-label">{p.nama}</h3>}
              <ul className="space-y-2">
                {p.tahap.map((t) => (
                  <li key={t.tahapId} className="grid grid-cols-[8rem_1fr_3rem] items-center gap-3 text-sm">
                    <span className="truncate text-slate-700" title={t.nama}>
                      {t.nama}
                    </span>
                    <span className="h-1.5 rounded-full bg-slate-100 overflow-hidden" aria-hidden="true">
                      <span className={`block h-full rounded-full ${WARNA_CORONG[t.jenis]}`} style={{ width: `${(t.jumlah / Math.max(1, p.total)) * 100}%` }} />
                    </span>
                    <span className="text-right angka text-slate-700">{angka(t.jumlah)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="kartu space-y-3">
          <h2 className="judul-kartu">Tindak lanjut jatuh tempo</h2>
          {s.tindakLanjutJatuhTempo.length === 0 ? (
            <p className="text-sm text-slate-500">Tidak ada tindak lanjut jatuh tempo.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {s.tindakLanjutJatuhTempo.map((t) => (
                <li key={t.id} className="py-2.5 flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <Link href={t.leadId ? `/crm/lead/${t.leadId}` : "/crm/tindak-lanjut"} className="font-medium text-slate-800 hover:underline break-words">
                      {t.judul}
                    </Link>
                    <div className="text-xs text-slate-500 truncate">
                      {t.namaLead ?? "Tanpa lead"} · {t.namaPenerima ?? "Tanpa penerima"} · {formatWaktu(t.jatuhTempo)}
                    </div>
                  </div>
                  {tindakLanjutTerlambat(t, sekarang) && <LencanaStatus status="TERLAMBAT" />}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TabelKinerja judul="Kinerja sales" kepala="PIC" baris={s.kinerjaSales.map((k) => ({ kunci: k.picId ?? "-", nama: k.nama, lead: k.lead, menang: k.menang, nilai: k.nilaiMenang }))} />
        <TabelKinerja judul="Kinerja sumber lead" kepala="Sumber" baris={s.kinerjaSumber.map((k) => ({ kunci: k.sumber, nama: k.sumber, lead: k.lead, menang: k.menang, nilai: k.nilaiMenang }))} />
      </div>

      <div className="kartu space-y-3">
        <h2 className="judul-kartu">Tren 6 bulan</h2>
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
          {s.bulanan.map((b) => (
            <div key={b.bulan} className="rounded-lg border border-slate-200 p-3 text-center">
              <div className="text-xs text-slate-500">{b.label}</div>
              <div className="font-heading text-xl font-bold text-slate-900 angka">{angka(b.dibuat)}</div>
              <div className="text-xs text-emerald-700">{angka(b.menang)} menang</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TabelKinerja({ judul, kepala, baris }: { judul: string; kepala: string; baris: { kunci: string; nama: string; lead: number; menang: number; nilai: { toString(): string } }[] }) {
  return (
    <div className="kartu kartu-tabel">
      <div className="px-5 md:px-6 pt-5">
        <h2 className="judul-kartu">{judul}</h2>
      </div>
      <div className="bungkus-tabel">
        <table className="tabel min-w-[28rem]">
          <thead>
            <tr>
              <th>{kepala}</th>
              <th className="text-right">Lead</th>
              <th className="text-right">Menang</th>
              <th className="text-right">Nilai menang</th>
            </tr>
          </thead>
          <tbody>
            {baris.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-center text-slate-500">
                  Belum ada lead.
                </td>
              </tr>
            ) : (
              baris.map((b) => (
                <tr key={b.kunci}>
                  <td>{b.nama}</td>
                  <td className="text-right angka">{angka(b.lead)}</td>
                  <td className="text-right angka">{angka(b.menang)}</td>
                  <td className="text-right angka">{ringkasRupiah(b.nilai.toString())}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
