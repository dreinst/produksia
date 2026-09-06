import { db } from "@/lib/db";
import { DocNo } from "@/components/ui/Badges";

export default async function ReturnsPage() {
  const returns = await db.salesReturn.findMany({
    include: { invoice: { include: { customer: true } }, warehouse: true },
    orderBy: { date: "desc" },
  });

  return (
    <div className="space-y-6">
      <h1 className="page-title">Retur Penjualan</h1>
      <p className="muted">
        Retur dibuat dari halaman Faktur Penjualan (tombol &quot;Retur&quot;).
      </p>

      <div className="card card-table"><div className="table-wrap">
        <table className="tbl min-w-[36rem]">
        <thead>
          <tr>
            <th>No</th>
            <th>Tanggal</th>
            <th>Faktur</th>
            <th>Pelanggan</th>
            <th>Gudang</th>
            <th>Alasan</th>
          </tr>
        </thead>
        <tbody>
          {returns.map((r) => (
            <tr key={r.id}>
              <td><DocNo no={r.no} /></td>
              <td className="text-slate-500 whitespace-nowrap">{r.date.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}</td>
              <td>{r.invoice.no}</td>
              <td>{r.invoice.customer.name}</td>
              <td>{r.warehouse.name}</td>
              <td>{r.reason ?? "-"}</td>
            </tr>
          ))}
          {returns.length === 0 && (
            <tr>
              <td colSpan={6} className="empty">
                Belum ada retur.
              </td>
            </tr>
          )}
        </tbody>
        </table>
      </div></div>
    </div>
  );
}
