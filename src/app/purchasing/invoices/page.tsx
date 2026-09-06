import Link from "next/link";
import { DocNo, StatusBadge } from "@/components/ui/Badges";
import { db } from "@/lib/db";

export default async function PurchaseInvoicesPage() {
  const invoices = await db.purchaseInvoice.findMany({
    include: { supplier: true, payments: true },
    orderBy: { date: "desc" },
  });

  return (
    <div className="space-y-6">
      <h1 className="page-title">Faktur Pembelian</h1>
      <p className="muted">
        Faktur dibuat dari halaman Pesanan Pembelian (tombol &quot;Fakturkan&quot;).
      </p>

      <div className="card card-table"><div className="table-wrap">
        <table className="tbl min-w-[36rem]">
        <thead>
          <tr>
            <th>No</th>
            <th>Tanggal</th>
            <th>Pemasok</th>
            <th className="text-right">Total</th>
            <th className="text-right">Terbayar</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => {
            const paid = inv.payments.reduce((s, p) => s + Number(p.amount), 0);
            return (
              <tr key={inv.id}>
                <td><DocNo no={inv.no} /></td>
                <td className="text-slate-500 whitespace-nowrap">{inv.date.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}</td>
                <td>{inv.supplier.name}</td>
                <td className="text-right num">{Number(inv.total).toLocaleString("id-ID")}</td>
                <td className="text-right num">{paid.toLocaleString("id-ID")}</td>
                <td><StatusBadge status={inv.status} /></td>
                <td className="space-x-3 whitespace-nowrap">
                  {inv.status !== "PAID" && (
                    <Link
                      href={`/purchasing/payments/new?invoiceId=${inv.id}`}
                      className="btn-link"
                    >
                      Bayar
                    </Link>
                  )}
                  <Link
                    href={`/purchasing/returns/new?invoiceId=${inv.id}`}
                    className="btn-link"
                  >
                    Retur
                  </Link>
                </td>
              </tr>
            );
          })}
          {invoices.length === 0 && (
            <tr>
              <td colSpan={7} className="empty">
                Belum ada faktur pembelian.
              </td>
            </tr>
          )}
        </tbody>
        </table>
      </div></div>
    </div>
  );
}
