import type { BarisLaporan } from "@/lib/laporan";

const angka = (v: { toString(): string }) => Number(v).toLocaleString("id-ID");

/** Tabel satu bagian laporan (mis. Pendapatan) dengan baris berjenjang dan baris total. */
export default function TabelLaporan({ judul, baris, labelTotal, total, kelasTotal }: { judul: string; baris: BarisLaporan[]; labelTotal: string; total: { toString(): string }; kelasTotal?: string }) {
  return (
    <div className="kartu kartu-tabel">
      <div className="kepala-kartu">
        <h2 className="judul-kartu">{judul}</h2>
      </div>
      <div className="bungkus-tabel">
        <table className="tabel">
          <thead>
            <tr>
              <th>Kode</th>
              <th>Akun</th>
              <th className="text-right">Jumlah</th>
            </tr>
          </thead>
          <tbody>
            {baris.map((b) => (
              <tr key={b.id} className={b.kelompok ? "bg-slate-50/70" : undefined}>
                <td className="mono">{b.kode}</td>
                <td className={b.kelompok ? "font-semibold text-slate-900" : undefined} style={{ paddingLeft: `${0.75 + b.kedalaman * 1.25}rem` }}>
                  {b.nama}
                </td>
                <td className={`text-right angka ${b.kelompok ? "font-semibold text-slate-700" : ""}`}>{angka(b.jumlah)}</td>
              </tr>
            ))}
            {baris.length === 0 && (
              <tr>
                <td colSpan={3} className="kosong">Tidak ada mutasi.</td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>{labelTotal}</td>
              <td className={`text-right angka ${kelasTotal ?? ""}`}>{angka(total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
