import { db } from "@/lib/db";
import { NomorDokumen, LencanaStatus } from "@/komponen/ui/Lencana";

export default async function GoodsReceiptsPage() {
  const daftarPenerimaan = await db.penerimaanBarang.findMany({
    include: { pesanan: { include: { pemasok: true } }, gudang: true },
    orderBy: { tanggal: "desc" },
  });

  return (
    <div className="space-y-6">
      <h1 className="judul-halaman">Penerimaan Barang</h1>
      <p className="redup">
        Penerimaan dibuat dari halaman Pesanan Pembelian (tombol &quot;Terima Barang&quot;).
      </p>

      <div className="kartu kartu-tabel"><div className="bungkus-tabel">
        <table className="tabel min-w-[36rem]">
        <thead>
          <tr>
            <th>No</th>
            <th>Tanggal</th>
            <th>Pesanan</th>
            <th>Pemasok</th>
            <th>Gudang</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {daftarPenerimaan.map((r) => (
            <tr key={r.id}>
              <td><NomorDokumen nomor={r.nomor} /></td>
              <td className="text-slate-500 whitespace-nowrap">{r.tanggal.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}</td>
              <td>{r.pesanan.nomor}</td>
              <td>{r.pesanan.pemasok.nama}</td>
              <td>{r.gudang.nama}</td>
              <td><LencanaStatus status={r.status} /></td>
            </tr>
          ))}
          {daftarPenerimaan.length === 0 && (
            <tr>
              <td colSpan={6} className="kosong">
                Belum ada penerimaan barang.
              </td>
            </tr>
          )}
        </tbody>
        </table>
      </div></div>
    </div>
  );
}
