import { db } from "@/lib/db";

export default async function PurchasePaymentsPage() {
  const payments = await db.purchasePayment.findMany({
    include: { supplier: true, invoice: true },
    orderBy: { date: "desc" },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Pembayaran Pembelian</h1>
      <p className="text-sm text-zinc-500">
        Pembayaran dibuat dari halaman Faktur Pembelian (tombol &quot;Bayar&quot;).
      </p>

      <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
        <table className="w-full text-sm border-collapse min-w-[36rem]">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2 pr-4">No</th>
            <th className="py-2 pr-4">Tanggal</th>
            <th className="py-2 pr-4">Faktur</th>
            <th className="py-2 pr-4">Pemasok</th>
            <th className="py-2 pr-4">Jumlah</th>
            <th className="py-2 pr-4">Metode</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((p) => (
            <tr key={p.id} className="border-b">
              <td className="py-2 pr-4">{p.no}</td>
              <td className="py-2 pr-4">{p.date.toLocaleDateString("id-ID")}</td>
              <td className="py-2 pr-4">{p.invoice.no}</td>
              <td className="py-2 pr-4">{p.supplier.name}</td>
              <td className="py-2 pr-4">{Number(p.amount).toLocaleString("id-ID")}</td>
              <td className="py-2 pr-4">{p.paymentMethod}</td>
            </tr>
          ))}
          {payments.length === 0 && (
            <tr>
              <td colSpan={6} className="py-4 text-zinc-500">
                Belum ada pembayaran.
              </td>
            </tr>
          )}
        </tbody>
        </table>
      </div>
    </div>
  );
}
