import { db } from "@/lib/db";

export default async function Home() {
  const [customers, items, openOrders, unpaidInvoices] = await Promise.all([
    db.customer.count(),
    db.item.count(),
    db.salesOrder.count({ where: { status: { in: ["DRAFT", "PROCESSED"] } } }),
    db.salesInvoice.count({ where: { status: { in: ["DRAFT", "PARTIAL"] } } }),
  ]);

  const cards = [
    { label: "Pelanggan", value: customers },
    { label: "Barang & Jasa", value: items },
    { label: "Pesanan Aktif", value: openOrders },
    { label: "Faktur Belum Lunas", value: unpaidInvoices },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Dashboard</h1>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="border rounded-lg p-4">
            <div className="text-2xl font-semibold">{c.value}</div>
            <div className="text-sm text-zinc-500">{c.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
