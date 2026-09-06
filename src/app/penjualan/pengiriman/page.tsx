import { db } from "@/lib/db";
import { NomorDokumen, LencanaStatus } from "@/komponen/ui/Lencana";

export default async function DeliveriesPage() {
  const daftarPengiriman = await db.pengirimanPesanan.findMany({
    include: { pesanan: { include: { pelanggan: true } }, gudang: true },
    orderBy: { tanggal: "desc" },
  });

  return (
    <div className="space-y-6">
      <h1 className="judul-halaman">Pengiriman Pesanan</h1>
      <p className="redup">
        Pengiriman dibuat dari halaman Pesanan Penjualan (tombol &quot;Kirim&quot;).
      </p>

      <div className="kartu kartu-tabel"><div className="bungkus-tabel">
        <table className="tabel min-w-[36rem]">
        <thead>
          <tr>
            <th>No</th>
            <th>Tanggal</th>
            <th>Pesanan</th>
            <th>Pelanggan</th>
            <th>Gudang</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {daftarPengiriman.map((d) => (
            <tr key={d.id}>
              <td><NomorDokumen nomor={d.nomor} /></td>
              <td className="text-slate-500 whitespace-nowrap">{d.tanggal.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}</td>
              <td>{d.pesanan.nomor}</td>
              <td>{d.pesanan.pelanggan.nama}</td>
              <td>{d.gudang.nama}</td>
              <td><LencanaStatus status={d.status} /></td>
            </tr>
          ))}
          {daftarPengiriman.length === 0 && (
            <tr>
              <td colSpan={6} className="kosong">
                Belum ada pengiriman.
              </td>
            </tr>
          )}
        </tbody>
        </table>
      </div></div>
    </div>
  );
}
