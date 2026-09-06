import { db } from "@/lib/db";

export default async function PurchaseReturnsPage() {
  const returns = await db.purchaseReturn.findMany({
    include: { invoice: { include: { supplier: true } }, warehouse: true },
    orderBy: { date: "desc" },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Retur Pembelian</h1>
      <p className="text-sm text-zinc-500">
        Retur dibuat dari halaman Faktur Pembelian (tombol &quot;Retur&quot;).
      </p>

      <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
        <table className="w-full text-sm border-collapse min-w-[36rem]">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2 pr-4">No</th>
            <th className="py-2 pr-4">Tanggal</th>
            <th className="py-2 pr-4">Faktur</th>
            <th className="py-2 pr-4">Pemasok</th>
            <th className="py-2 pr-4">Gudang</th>
            <th className="py-2 pr-4">Alasan</th>
          </tr>
        </thead>
        <tbody>
          {returns.map((r) => (
            <tr key={r.id} className="border-b">
              <td className="py-2 pr-4">{r.no}</td>
              <td className="py-2 pr-4">{r.date.toLocaleDateString("id-ID")}</td>
              <td className="py-2 pr-4">{r.invoice.no}</td>
              <td className="py-2 pr-4">{r.invoice.supplier.name}</td>
              <td className="py-2 pr-4">{r.warehouse.name}</td>
              <td className="py-2 pr-4">{r.reason ?? "-"}</td>
            </tr>
          ))}
          {returns.length === 0 && (
            <tr>
              <td colSpan={6} className="py-4 text-zinc-500">
                Belum ada retur pembelian.
              </td>
            </tr>
          )}
        </tbody>
        </table>
      </div>
    </div>
  );
}
