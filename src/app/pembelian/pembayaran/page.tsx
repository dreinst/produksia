import { db } from "@/lib/db";
import { NomorDokumen, labelMetodeBayar } from "@/komponen/ui/Lencana";

export default async function PurchasePaymentsPage() {
  const daftarPembayaran = await db.pembayaranPembelian.findMany({
    include: { pemasok: true, faktur: true },
    orderBy: { tanggal: "desc" },
  });

  return (
    <div className="space-y-6">
      <h1 className="judul-halaman">Pembayaran Pembelian</h1>
      <p className="redup">
        Pembayaran dibuat dari halaman Faktur Pembelian (tombol &quot;Bayar&quot;).
      </p>

      <div className="kartu kartu-tabel"><div className="bungkus-tabel">
        <table className="tabel min-w-[36rem]">
        <thead>
          <tr>
            <th>No</th>
            <th>Tanggal</th>
            <th>Faktur</th>
            <th>Pemasok</th>
            <th className="text-right">Jumlah</th>
            <th>Metode</th>
          </tr>
        </thead>
        <tbody>
          {daftarPembayaran.map((p) => (
            <tr key={p.id}>
              <td><NomorDokumen nomor={p.nomor} /></td>
              <td className="text-slate-500 whitespace-nowrap">{p.tanggal.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}</td>
              <td>{p.faktur.nomor}</td>
              <td>{p.pemasok.nama}</td>
              <td className="text-right angka">{Number(p.jumlah).toLocaleString("id-ID")}</td>
              <td>{labelMetodeBayar(p.metodeBayar)}</td>
            </tr>
          ))}
          {daftarPembayaran.length === 0 && (
            <tr>
              <td colSpan={6} className="kosong">
                Belum ada pembayaran.
              </td>
            </tr>
          )}
        </tbody>
        </table>
      </div></div>
    </div>
  );
}
