import { db } from "@/lib/db";
import { DocNo, StatusBadge } from "@/components/ui/Badges";

export default async function DeliveriesPage() {
  const deliveries = await db.delivery.findMany({
    include: { order: { include: { customer: true } }, warehouse: true },
    orderBy: { date: "desc" },
  });

  return (
    <div className="space-y-6">
      <h1 className="page-title">Pengiriman Pesanan</h1>
      <p className="muted">
        Pengiriman dibuat dari halaman Pesanan Penjualan (tombol &quot;Kirim&quot;).
      </p>

      <div className="card card-table"><div className="table-wrap">
        <table className="tbl min-w-[36rem]">
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
          {deliveries.map((d) => (
            <tr key={d.id}>
              <td><DocNo no={d.no} /></td>
              <td className="text-slate-500 whitespace-nowrap">{d.date.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}</td>
              <td>{d.order.no}</td>
              <td>{d.order.customer.name}</td>
              <td>{d.warehouse.name}</td>
              <td><StatusBadge status={d.status} /></td>
            </tr>
          ))}
          {deliveries.length === 0 && (
            <tr>
              <td colSpan={6} className="empty">
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
