import Link from "next/link";
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
        <h1 className="text-xl font-semibold">Penawaran Penjualan</h1>
        <Link href="/sales/quotations/new" className="bg-black text-white px-4 py-2 rounded text-sm">
          + Penawaran Baru
        </Link>
      </div>

      <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
        <table className="w-full text-sm border-collapse min-w-[36rem]">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2 pr-4">No</th>
            <th className="py-2 pr-4">Tanggal</th>
            <th className="py-2 pr-4">Pelanggan</th>
            <th className="py-2 pr-4">Total</th>
            <th className="py-2 pr-4">Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {quotations.map((q) => (
            <tr key={q.id} className="border-b">
              <td className="py-2 pr-4">{q.no}</td>
              <td className="py-2 pr-4">{q.date.toLocaleDateString("id-ID")}</td>
              <td className="py-2 pr-4">{q.customer.name}</td>
              <td className="py-2 pr-4">{Number(q.total).toLocaleString("id-ID")}</td>
              <td className="py-2 pr-4">{q.status}</td>
              <td className="py-2">
                {q.status === "DRAFT" && (
                  <ActionForm
                    action={convertQuotationToOrderForm.bind(null, q.id)}
                    confirmMessage={`Konversi penawaran ${q.no} menjadi Pesanan Penjualan?`}
                  >
                    <button type="submit" className="text-blue-600 text-xs hover:underline">
                      Konversi ke Pesanan
                    </button>
                  </ActionForm>
                )}
              </td>
            </tr>
          ))}
          {quotations.length === 0 && (
            <tr>
              <td colSpan={6} className="py-4 text-zinc-500">
                Belum ada penawaran.
              </td>
            </tr>
          )}
        </tbody>
        </table>
      </div>
    </div>
  );
}
