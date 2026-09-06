import { db } from "@/lib/db";
import { DocNo, StatusBadge } from "@/components/ui/Badges";

export default async function GoodsReceiptsPage() {
  const receipts = await db.goodsReceipt.findMany({
    include: { order: { include: { supplier: true } }, warehouse: true },
    orderBy: { date: "desc" },
  });

  return (
    <div className="space-y-6">
      <h1 className="page-title">Penerimaan Barang</h1>
      <p className="muted">
        Penerimaan dibuat dari halaman Pesanan Pembelian (tombol &quot;Terima Barang&quot;).
      </p>

      <div className="card card-table"><div className="table-wrap">
        <table className="tbl min-w-[36rem]">
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
          {receipts.map((r) => (
            <tr key={r.id}>
              <td><DocNo no={r.no} /></td>
              <td className="text-slate-500 whitespace-nowrap">{r.date.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}</td>
              <td>{r.order.no}</td>
              <td>{r.order.supplier.name}</td>
              <td>{r.warehouse.name}</td>
              <td><StatusBadge status={r.status} /></td>
            </tr>
          ))}
          {receipts.length === 0 && (
            <tr>
              <td colSpan={6} className="empty">
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
