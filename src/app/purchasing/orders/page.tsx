import Link from "next/link";
import { db } from "@/lib/db";

export default async function PurchaseOrdersPage() {
  const orders = await db.purchaseOrder.findMany({
    include: { supplier: true, lines: true },
    orderBy: { date: "desc" },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Pesanan Pembelian</h1>
        <Link href="/purchasing/orders/new" className="bg-black text-white px-4 py-2 rounded text-sm">
          + Pesanan Baru
        </Link>
      </div>

      <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
        <table className="w-full text-sm border-collapse min-w-[36rem]">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2 pr-4">No</th>
            <th className="py-2 pr-4">Tanggal</th>
            <th className="py-2 pr-4">Pemasok</th>
            <th className="py-2 pr-4">Total</th>
            <th className="py-2 pr-4">Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => {
            const fullyReceived = o.lines.every((l) => Number(l.qtyReceived) >= Number(l.qty));
            const fullyInvoiced = o.lines.every((l) => Number(l.qtyInvoiced) >= Number(l.qty));
            return (
              <tr key={o.id} className="border-b">
                <td className="py-2 pr-4">{o.no}</td>
                <td className="py-2 pr-4">{o.date.toLocaleDateString("id-ID")}</td>
                <td className="py-2 pr-4">{o.supplier.name}</td>
                <td className="py-2 pr-4">{Number(o.total).toLocaleString("id-ID")}</td>
                <td className="py-2 pr-4">{o.status}</td>
                <td className="py-2 pr-4 space-x-3">
                  {!fullyReceived && (
                    <Link
                      href={`/purchasing/receipts/new?orderId=${o.id}`}
                      className="text-blue-600 text-xs hover:underline"
                    >
                      Terima Barang
                    </Link>
                  )}
                  {!fullyInvoiced && (
                    <Link
                      href={`/purchasing/invoices/new?orderId=${o.id}`}
                      className="text-blue-600 text-xs hover:underline"
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
              <td colSpan={6} className="py-4 text-zinc-500">
                Belum ada pesanan pembelian.
              </td>
            </tr>
          )}
        </tbody>
        </table>
      </div>
    </div>
  );
}
