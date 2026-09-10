import Link from "next/link";
import { wajibHak } from "@/lib/otentikasi";
import { daftarRingkasanProyek } from "@/lib/proyek";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import { LencanaStatus } from "@/komponen/ui/Lencana";

const angka = (v: { toString(): string } | null) => (v === null ? "—" : Number(v).toLocaleString("id-ID"));

export default async function HalamanRekonsiliasi() {
  await wajibHak("rekonsiliasi.lihat");
  const daftar = await daftarRingkasanProyek();
  const totalLaba = daftar.reduce((s, p) => s + Number(p.laba), 0);

  return (
    <div className="space-y-6">
      <KepalaHalaman
        jejak={[{ label: "Rekonsiliasi" }]}
        judul="Rekonsiliasi Event (LPJ)"
        subjudul="Per event: proposal disetujui / pesanan → LPJ (faktur & termin) → kas masuk; pengadaan / pembelian / beban → nota → kas keluar → laba/rugi & posisi neraca event."
        lencana={<span className={`lencana ${totalLaba >= 0 ? "lencana-emerald" : "lencana-rose"}`}>Laba semua event Rp {totalLaba.toLocaleString("id-ID")}</span>}
        aksi={<Link href="/data-induk/proyek" className="tombol tombol-garis">Kelola daftar event</Link>}
      />

      <div className="kartu text-sm space-y-2">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="ubin">
            <div className="font-semibold text-slate-900 mb-1">Skema pemasukan</div>
            <div className="text-slate-600">Proposal ter-acc / Pesanan (PSJ) → <strong>LPJ</strong>: Faktur (FJ) + Uang muka (UM) → Kas/Bank masuk (TRM) · <strong>TOP</strong> (jatuh tempo, sisa piutang) → Laba/Rugi event</div>
          </div>
          <div className="ubin">
            <div className="font-semibold text-slate-900 mb-1">Skema pengeluaran</div>
            <div className="text-slate-600">Pengadaan (PSB) / Pembelian (FB) / Beban-biaya (KK, JU) → <strong>Nota</strong> (dokumen & jurnal) → Cash flow tunai/transfer (BYR, KK) → Neraca (sisa hutang) & L/R event</div>
          </div>
        </div>
      </div>

      <div className="kartu kartu-tabel">
        <div className="bungkus-tabel">
          <table className="tabel min-w-[64rem]">
            <thead>
              <tr>
                <th>Event</th>
                <th>Klien</th>
                <th>Status</th>
                <th className="text-right">Nilai kontrak</th>
                <th className="text-right">Pesanan (PSJ)</th>
                <th className="text-right">Pendapatan</th>
                <th className="text-right">Anggaran biaya</th>
                <th className="text-right">Realisasi biaya</th>
                <th className="text-right">Laba (rugi)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {daftar.map((p) => (
                <tr key={p.id}>
                  <td><span className="mono font-semibold text-slate-900">{p.kode}</span> <span className="text-slate-700">{p.nama}</span></td>
                  <td className="text-slate-600">{p.pelanggan ?? "—"}</td>
                  <td><LencanaStatus status={p.status} /></td>
                  <td className="text-right angka">{angka(p.nilaiKontrak)}</td>
                  <td className="text-right angka">{angka(p.totalPesanan)}</td>
                  <td className="text-right angka">{angka(p.pendapatan)}</td>
                  <td className="text-right angka">{angka(p.anggaranBiaya)}</td>
                  <td className={`text-right angka ${p.anggaranBiaya && Number(p.beban) > Number(p.anggaranBiaya) ? "text-rose-700" : ""}`}>{angka(p.beban)}</td>
                  <td className={`text-right angka font-semibold ${Number(p.laba) < 0 ? "text-rose-700" : "text-emerald-700"}`}>{angka(p.laba)}</td>
                  <td className="text-right"><Link href={`/rekonsiliasi/event/${p.id}`} className="tombol-tautan">Buka LPJ</Link></td>
                </tr>
              ))}
              {daftar.length === 0 && <tr><td colSpan={10} className="kosong">Belum ada event/proyek. Tambahkan di Data Induk → Proyek, lalu pilih event saat membuat penawaran/pesanan.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
