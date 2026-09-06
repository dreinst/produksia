import { db } from "@/lib/db";

export default async function ReceiptsPage() {
  const receipts = await db.salesReceipt.findMany({
    include: { customer: true, invoice: true },
    orderBy: { date: "desc" },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Penerimaan Penjualan</h1>
      <p className="text-sm text-zinc-500">
        Penerimaan dibuat dari halaman Faktur Penjualan (tombol &quot;Terima Bayar&quot;).
      </p>

      <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
        <table className="w-full text-sm border-collapse min-w-[36rem]">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2 pr-4">No</th>
            <th className="py-2 pr-4">Tanggal</th>
            <th className="py-2 pr-4">Faktur</th>
            <th className="py-2 pr-4">Pelanggan</th>
            <th className="py-2 pr-4">Jumlah</th>
            <th className="py-2 pr-4">Metode</th>
          </tr>
        </thead>
        <tbody>
          {receipts.map((r) => (
            <tr key={r.id} className="border-b">
              <td className="py-2 pr-4">{r.no}</td>
              <td className="py-2 pr-4">{r.date.toLocaleDateString("id-ID")}</td>
              <td className="py-2 pr-4">{r.invoice.no}</td>
              <td className="py-2 pr-4">{r.customer.name}</td>
              <td className="py-2 pr-4">{Number(r.amount).toLocaleString("id-ID")}</td>
              <td className="py-2 pr-4">{r.paymentMethod}</td>
            </tr>
          ))}
          {receipts.length === 0 && (
            <tr>
              <td colSpan={6} className="py-4 text-zinc-500">
                Belum ada penerimaan.
              </td>
            </tr>
          )}
        </tbody>
        </table>
      </div>
    </div>
  );
}
