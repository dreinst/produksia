import Link from "next/link";
import { db } from "@/lib/db";

export default async function InvoicesPage() {
  const invoices = await db.salesInvoice.findMany({
    include: { customer: true, receipts: true },
    orderBy: { date: "desc" },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Faktur Penjualan</h1>
      <p className="text-sm text-zinc-500">
        Faktur dibuat dari halaman Pesanan Penjualan (tombol &quot;Fakturkan&quot;).
      </p>

      <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
        <table className="w-full text-sm border-collapse min-w-[36rem]">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2 pr-4">No</th>
            <th className="py-2 pr-4">Tanggal</th>
            <th className="py-2 pr-4">Pelanggan</th>
            <th className="py-2 pr-4">Total</th>
            <th className="py-2 pr-4">Terbayar</th>
            <th className="py-2 pr-4">Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => {
            const paid = inv.receipts.reduce((s, r) => s + Number(r.amount), 0);
            return (
              <tr key={inv.id} className="border-b">
                <td className="py-2 pr-4">{inv.no}</td>
                <td className="py-2 pr-4">{inv.date.toLocaleDateString("id-ID")}</td>
                <td className="py-2 pr-4">{inv.customer.name}</td>
                <td className="py-2 pr-4">{Number(inv.total).toLocaleString("id-ID")}</td>
                <td className="py-2 pr-4">{paid.toLocaleString("id-ID")}</td>
                <td className="py-2 pr-4">{inv.status}</td>
                <td className="py-2 pr-4 space-x-3">
                  {inv.status !== "PAID" && (
                    <Link
                      href={`/sales/receipts/new?invoiceId=${inv.id}`}
                      className="text-blue-600 text-xs hover:underline"
                    >
                      Terima Bayar
                    </Link>
                  )}
                  <Link
                    href={`/sales/returns/new?invoiceId=${inv.id}`}
                    className="text-blue-600 text-xs hover:underline"
                  >
                    Retur
                  </Link>
                </td>
              </tr>
            );
          })}
          {invoices.length === 0 && (
            <tr>
              <td colSpan={7} className="py-4 text-zinc-500">
                Belum ada faktur.
              </td>
            </tr>
          )}
        </tbody>
        </table>
      </div>
    </div>
  );
}
