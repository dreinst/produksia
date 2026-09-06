import Link from "next/link";
import { DocNo, StatusBadge } from "@/components/ui/Badges";
import { db } from "@/lib/db";

export default async function PurchaseOrdersPage() {
  const orders = await db.purchaseOrder.findMany({
    include: { supplier: true, lines: true },
    orderBy: { date: "desc" },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Pesanan Pembelian</h1>
        <Link href="/purchasing/orders/new" className="btn btn-primary">
          + Pesanan Baru
        </Link>
      </div>

      <div className="card card-table"><div className="table-wrap">
        <table className="tbl min-w-[36rem]">
        <thead>
          <tr>
            <th>No</th>
            <th>Tanggal</th>
            <th>Pemasok</th>
            <th className="text-right">Total</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => {
            const fullyReceived = o.lines.every((l) => Number(l.qtyReceived) >= Number(l.qty));
            const fullyInvoiced = o.lines.every((l) => Number(l.qtyInvoiced) >= Number(l.qty));
            return (
              <tr key={o.id}>
                <td><DocNo no={o.no} /></td>
                <td className="text-slate-500 whitespace-nowrap">{o.date.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}</td>
                <td>{o.supplier.name}</td>
                <td className="text-right num">{Number(o.total).toLocaleString("id-ID")}</td>
                <td><StatusBadge status={o.status} /></td>
                <td className="space-x-3 whitespace-nowrap">
                  {!fullyReceived && (
                    <Link
                      href={`/purchasing/receipts/new?orderId=${o.id}`}
                      className="btn-link"
                    >
                      Terima Barang
                    </Link>
                  )}
                  {!fullyInvoiced && (
                    <Link
                      href={`/purchasing/invoices/new?orderId=${o.id}`}
                      className="btn-link"
                    >
                      Fakturkan
                    </Link>
                  )}
                </td>
              </tr>
            );
          })}
          {orders.length === 0 && (
            <tr>
              <td colSpan={6} className="empty">
                Belum ada pesanan pembelian.
              </td>
            </tr>
          )}
        </tbody>
        </table>
      </div></div>
    </div>
  );
}
