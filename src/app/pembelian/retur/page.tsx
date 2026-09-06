import { db } from "@/lib/db";
import { NomorDokumen } from "@/komponen/ui/Lencana";

export default async function PurchaseReturnsPage() {
  const daftarRetur = await db.returPembelian.findMany({
    include: { faktur: { include: { pemasok: true } }, gudang: true },
    orderBy: { tanggal: "desc" },
  });

  return (
    <div className="space-y-6">
      <h1 className="judul-halaman">Retur Pembelian</h1>
      <p className="redup">
        Retur dibuat dari halaman Faktur Pembelian (tombol &quot;Retur&quot;).
      </p>

      <div className="kartu kartu-tabel"><div className="bungkus-tabel">
        <table className="tabel min-w-[36rem]">
        <thead>
          <tr>
            <th>No</th>
            <th>Tanggal</th>
            <th>Faktur</th>
            <th>Pemasok</th>
            <th>Gudang</th>
            <th>Alasan</th>
          </tr>
        </thead>
        <tbody>
          {daftarRetur.map((r) => (
            <tr key={r.id}>
              <td><NomorDokumen nomor={r.nomor} /></td>
              <td className="text-slate-500 whitespace-nowrap">{r.tanggal.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}</td>
              <td>{r.faktur.nomor}</td>
              <td>{r.faktur.pemasok.nama}</td>
              <td>{r.gudang.nama}</td>
              <td>{r.alasan ?? "-"}</td>
            </tr>
          ))}
          {daftarRetur.length === 0 && (
            <tr>
              <td colSpan={6} className="kosong">
                Belum ada retur pembelian.
              </td>
            </tr>
          )}
        </tbody>
        </table>
      </div></div>
    </div>
  );
}
