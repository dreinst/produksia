import type { LaporanUmur } from "@/lib/laporanRekanan";
import { KERANJANG_UMUR } from "@/lib/laporanRekanan";
import { NomorDokumen } from "@/komponen/ui/Lencana";

const angka = (v: { toString(): string }) => Number(v).toLocaleString("id-ID");
const tgl = (d: Date | null) => (d ? d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "—");

/** Tabel umur piutang/hutang: subtotal per rekanan + rincian faktur. */
export default function TabelUmur({ laporan, labelRekanan, tautanFaktur }: { laporan: LaporanUmur; labelRekanan: string; tautanFaktur: string }) {
  return (
    <div className="kartu kartu-tabel">
      <div className="bungkus-tabel">
        <table className="tabel min-w-[72rem]">
          <thead>
            <tr>
              <th>{labelRekanan} / Faktur</th>
              <th>Tanggal</th>
              <th>Jatuh tempo</th>
              <th className="text-right">Total</th>
              <th className="text-right">Terbayar</th>
              <th className="text-right">Sisa</th>
              {KERANJANG_UMUR.map((k) => (
                <th key={k} className="text-right text-[11px]">{k}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {laporan.kelompok.map((k) => (
              <RekananBaris key={k.id} kelompok={k} tautanFaktur={tautanFaktur} />
            ))}
            {laporan.kelompok.length === 0 && (
              <tr><td colSpan={6 + KERANJANG_UMUR.length} className="kosong">Tidak ada saldo terbuka per tanggal ini.</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td colSpan={5}>Total ({laporan.jumlahFaktur} faktur)</td>
              <td className="text-right angka">{angka(laporan.total)}</td>
              {laporan.perKeranjang.map((v, i) => (
                <td key={i} className={`text-right angka ${i >= 3 && Number(v) > 0 ? "text-rose-700" : ""}`}>{angka(v)}</td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function RekananBaris({ kelompok, tautanFaktur }: { kelompok: LaporanUmur["kelompok"][number]; tautanFaktur: string }) {
  return (
    <>
      <tr className="bg-slate-50/70 font-semibold text-slate-900">
        <td colSpan={5}>{kelompok.nama} <span className="mono text-xs text-slate-400">{kelompok.kode}</span></td>
        <td className="text-right angka">{angka(kelompok.sisa)}</td>
        {kelompok.perKeranjang.map((v, i) => (
          <td key={i} className="text-right angka">{Number(v) ? angka(v) : "-"}</td>
        ))}
      </tr>
      {kelompok.faktur.map((f) => (
        <tr key={f.id}>
          <td className="pl-6"><a href={`${tautanFaktur}?q=${encodeURIComponent(f.nomor)}`} className="hover:underline"><NomorDokumen nomor={f.nomor} /></a></td>
          <td className="text-slate-500 whitespace-nowrap">{tgl(f.tanggal)}</td>
          <td className={`whitespace-nowrap ${f.umurHari > 0 ? "text-rose-700" : "text-slate-500"}`}>{tgl(f.jatuhTempo)}{f.umurHari > 0 ? ` (+${f.umurHari} hr)` : ""}</td>
          <td className="text-right angka">{angka(f.total)}</td>
          <td className="text-right angka">{angka(f.terbayar)}</td>
          <td className="text-right angka font-semibold">{angka(f.sisa)}</td>
          {KERANJANG_UMUR.map((_, i) => (
            <td key={i} className="text-right angka">{i === f.keranjang ? angka(f.sisa) : "-"}</td>
          ))}
        </tr>
      ))}
    </>
  );
}
