import Link from "next/link";
import { DocNo, StatusBadge } from "@/components/ui/Badges";
import { db } from "@/lib/db";

export default async function OrdersPage() {
  const orders = await db.salesOrder.findMany({
    include: { customer: true, lines: true },
    orderBy: { date: "desc" },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Pesanan Penjualan</h1>
        <Link href="/sales/orders/new" className="btn btn-primary">
          + Pesanan Baru
        </Link>
      </div>

      <div className="card card-table"><div className="table-wrap">
        <table className="tbl min-w-[36rem]">
        <thead>
          <tr>
            <th>No</th>
            <th>Tanggal</th>
            <th>Pelanggan</th>
            <th className="text-right">Total</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => {
            const fullyShipped = o.lines.every((l) => Number(l.qtyShipped) >= Number(l.qty));
            const fullyInvoiced = o.lines.every((l) => Number(l.qtyInvoiced) >= Number(l.qty));
            return (
              <tr key={o.id}>
                <td><DocNo no={o.no} /></td>
                <td className="text-slate-500 whitespace-nowrap">{o.date.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}</td>
                <td>{o.customer.name}</td>
                <td className="text-right num">{Number(o.total).toLocaleString("id-ID")}</td>
                <td><StatusBadge status={o.status} /></td>
                <td className="space-x-3 whitespace-nowrap">
                  {!fullyShipped && (
                    <Link
                      href={`/sales/deliveries/new?orderId=${o.id}`}
                      className="btn-link"
                    >
                      Kirim
                    </Link>
                  )}
                  {!fullyInvoiced && (
                    <Link
                      href={`/sales/invoices/new?orderId=${o.id}`}
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
                Belum ada pesanan.
              </td>
            </tr>
          )}
        </tbody>
        </table>
      </div></div>
    </div>
  );
}
