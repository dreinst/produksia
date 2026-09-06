import { db } from "@/lib/db";
import { DocNo, labelPaymentMethod } from "@/components/ui/Badges";

export default async function PurchasePaymentsPage() {
  const payments = await db.purchasePayment.findMany({
    include: { supplier: true, invoice: true },
    orderBy: { date: "desc" },
  });

  return (
    <div className="space-y-6">
      <h1 className="page-title">Pembayaran Pembelian</h1>
      <p className="muted">
        Pembayaran dibuat dari halaman Faktur Pembelian (tombol &quot;Bayar&quot;).
      </p>

      <div className="card card-table"><div className="table-wrap">
        <table className="tbl min-w-[36rem]">
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
          {payments.map((p) => (
            <tr key={p.id}>
              <td><DocNo no={p.no} /></td>
              <td className="text-slate-500 whitespace-nowrap">{p.date.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}</td>
              <td>{p.invoice.no}</td>
              <td>{p.supplier.name}</td>
              <td className="text-right num">{Number(p.amount).toLocaleString("id-ID")}</td>
              <td>{labelPaymentMethod(p.paymentMethod)}</td>
            </tr>
          ))}
          {payments.length === 0 && (
            <tr>
              <td colSpan={6} className="empty">
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
