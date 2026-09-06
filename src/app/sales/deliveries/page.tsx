import { db } from "@/lib/db";

export default async function DeliveriesPage() {
  const deliveries = await db.delivery.findMany({
    include: { order: { include: { customer: true } }, warehouse: true },
    orderBy: { date: "desc" },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Pengiriman Pesanan</h1>
      <p className="text-sm text-zinc-500">
        Pengiriman dibuat dari halaman Pesanan Penjualan (tombol &quot;Kirim&quot;).
      </p>

      <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
        <table className="w-full text-sm border-collapse min-w-[36rem]">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2 pr-4">No</th>
            <th className="py-2 pr-4">Tanggal</th>
            <th className="py-2 pr-4">Pesanan</th>
            <th className="py-2 pr-4">Pelanggan</th>
            <th className="py-2 pr-4">Gudang</th>
            <th className="py-2 pr-4">Status</th>
          </tr>
        </thead>
        <tbody>
          {deliveries.map((d) => (
            <tr key={d.id} className="border-b">
              <td className="py-2 pr-4">{d.no}</td>
              <td className="py-2 pr-4">{d.date.toLocaleDateString("id-ID")}</td>
              <td className="py-2 pr-4">{d.order.no}</td>
              <td className="py-2 pr-4">{d.order.customer.name}</td>
              <td className="py-2 pr-4">{d.warehouse.name}</td>
              <td className="py-2 pr-4">{d.status}</td>
            </tr>
          ))}
          {deliveries.length === 0 && (
            <tr>
              <td colSpan={6} className="py-4 text-zinc-500">
                Belum ada pengiriman.
              </td>
            </tr>
          )}
        </tbody>
        </table>
      </div>
    </div>
  );
}
