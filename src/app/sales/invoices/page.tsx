import Link from "next/link";
import { DocNo, StatusBadge } from "@/components/ui/Badges";
import { db } from "@/lib/db";

export default async function InvoicesPage() {
  const invoices = await db.salesInvoice.findMany({
    include: { customer: true, receipts: true },
    orderBy: { date: "desc" },
  });

  return (
    <div className="space-y-6">
      <h1 className="page-title">Faktur Penjualan</h1>
      <p className="muted">
        Faktur dibuat dari halaman Pesanan Penjualan (tombol &quot;Fakturkan&quot;).
      </p>

      <div className="card card-table"><div className="table-wrap">
        <table className="tbl min-w-[36rem]">
        <thead>
          <tr>
            <th>No</th>
            <th>Tanggal</th>
            <th>Pelanggan</th>
            <th className="text-right">Total</th>
            <th className="text-right">Terbayar</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => {
            const paid = inv.receipts.reduce((s, r) => s + Number(r.amount), 0);
            return (
              <tr key={inv.id}>
                <td><DocNo no={inv.no} /></td>
                <td className="text-slate-500 whitespace-nowrap">{inv.date.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}</td>
                <td>{inv.customer.name}</td>
                <td className="text-right num">{Number(inv.total).toLocaleString("id-ID")}</td>
                <td className="text-right num">{paid.toLocaleString("id-ID")}</td>
                <td><StatusBadge status={inv.status} /></td>
                <td className="space-x-3 whitespace-nowrap">
                  {inv.status !== "PAID" && (
                    <Link
                      href={`/sales/receipts/new?invoiceId=${inv.id}`}
                      className="btn-link"
                    >
                      Terima Bayar
                    </Link>
                  )}
                  <Link
                    href={`/sales/returns/new?invoiceId=${inv.id}`}
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
                Belum ada faktur.
              </td>
            </tr>
          )}
        </tbody>
        </table>
      </div></div>
    </div>
  );
}
