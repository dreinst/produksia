import Link from "next/link";
import { DocNo, StatusBadge } from "@/components/ui/Badges";
import { db } from "@/lib/db";
import ActionForm from "@/components/ActionForm";
import { convertQuotationToOrderForm } from "@/lib/actions/sales";

export default async function QuotationsPage() {
  const quotations = await db.salesQuotation.findMany({
    include: { customer: true },
    orderBy: { date: "desc" },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Penawaran Penjualan</h1>
        <Link href="/sales/quotations/new" className="btn btn-primary">
          + Penawaran Baru
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
          {quotations.map((q) => (
            <tr key={q.id}>
              <td><DocNo no={q.no} /></td>
              <td className="text-slate-500 whitespace-nowrap">{q.date.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}</td>
              <td>{q.customer.name}</td>
              <td className="text-right num">{Number(q.total).toLocaleString("id-ID")}</td>
              <td><StatusBadge status={q.status} /></td>
              <td>
                {q.status === "DRAFT" && (
                  <ActionForm
                    action={convertQuotationToOrderForm.bind(null, q.id)}
                    confirmMessage={`Konversi penawaran ${q.no} menjadi Pesanan Penjualan?`}
                  >
                    <button type="submit" className="btn-link">
                      Konversi ke Pesanan
                    </button>
                  </ActionForm>
                )}
              </td>
            </tr>
          ))}
          {quotations.length === 0 && (
            <tr>
              <td colSpan={6} className="empty">
                Belum ada penawaran.
              </td>
            </tr>
          )}
        </tbody>
        </table>
      </div></div>
    </div>
  );
}
