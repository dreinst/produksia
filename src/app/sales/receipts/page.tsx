import { db } from "@/lib/db";
import { DocNo, labelPaymentMethod } from "@/components/ui/Badges";

export default async function ReceiptsPage() {
  const receipts = await db.salesReceipt.findMany({
    include: { customer: true, invoice: true },
    orderBy: { date: "desc" },
  });

  return (
    <div className="space-y-6">
      <h1 className="page-title">Penerimaan Penjualan</h1>
      <p className="muted">
        Penerimaan dibuat dari halaman Faktur Penjualan (tombol &quot;Terima Bayar&quot;).
      </p>

      <div className="card card-table"><div className="table-wrap">
        <table className="tbl min-w-[36rem]">
        <thead>
          <tr>
            <th>No</th>
            <th>Tanggal</th>
            <th>Faktur</th>
            <th>Pelanggan</th>
            <th className="text-right">Jumlah</th>
            <th>Metode</th>
          </tr>
        </thead>
        <tbody>
          {receipts.map((r) => (
            <tr key={r.id}>
              <td><DocNo no={r.no} /></td>
              <td className="text-slate-500 whitespace-nowrap">{r.date.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}</td>
              <td>{r.invoice.no}</td>
              <td>{r.customer.name}</td>
              <td className="text-right num">{Number(r.amount).toLocaleString("id-ID")}</td>
              <td>{labelPaymentMethod(r.paymentMethod)}</td>
            </tr>
          ))}
          {receipts.length === 0 && (
            <tr>
              <td colSpan={6} className="empty">
                Belum ada penerimaan.
              </td>
            </tr>
          )}
        </tbody>
        </table>
      </div></div>
    </div>
  );
}
