import { db } from "@/lib/db";
import { NomorDokumen, labelMetodeBayar } from "@/komponen/ui/Lencana";

export default async function ReceiptsPage() {
  const daftarPenerimaan = await db.penerimaanPenjualan.findMany({
    include: { pelanggan: true, faktur: true },
    orderBy: { tanggal: "desc" },
  });

  return (
    <div className="space-y-6">
      <h1 className="judul-halaman">Penerimaan Penjualan</h1>
      <p className="redup">
        Penerimaan dibuat dari halaman Faktur Penjualan (tombol &quot;Terima Bayar&quot;).
      </p>

      <div className="kartu kartu-tabel"><div className="bungkus-tabel">
        <table className="tabel min-w-[36rem]">
        <thead>
          <tr>
            <th>No</th>
            <th>Tanggal</th>
            <th>Faktur</th>
            <th>Pelanggan</th>
            <th className="text-right">Jumlah</th>
            <th>Metode</th>
          </tr>
        </thead>
        <tbody>
          {daftarPenerimaan.map((r) => (
            <tr key={r.id}>
              <td><NomorDokumen nomor={r.nomor} /></td>
              <td className="text-slate-500 whitespace-nowrap">{r.tanggal.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}</td>
              <td>{r.faktur.nomor}</td>
              <td>{r.pelanggan.nama}</td>
              <td className="text-right angka">{Number(r.jumlah).toLocaleString("id-ID")}</td>
              <td>{labelMetodeBayar(r.metodeBayar)}</td>
            </tr>
          ))}
          {daftarPenerimaan.length === 0 && (
            <tr>
              <td colSpan={6} className="kosong">
                Belum ada penerimaan.
              </td>
            </tr>
          )}
        </tbody>
        </table>
      </div></div>
    </div>
  );
}
