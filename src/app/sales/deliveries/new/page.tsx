import { db } from "@/lib/db";
import ActionForm from "@/components/ActionForm";
import { createDeliveryForm } from "@/lib/actions/sales";
import OrderLinesPicker from "@/components/sales/OrderLinesPicker";

export default async function NewDeliveryPage({
  searchParams,
}: {
  searchParams: Promise<{ orderId?: string }>;
}) {
  const { orderId } = await searchParams;

  const [order, warehouses] = await Promise.all([
    orderId
      ? db.salesOrder.findUnique({
          where: { id: orderId },
          include: { customer: true, lines: { include: { item: true } } },
        })
      : null,
    db.warehouse.findMany({ orderBy: { name: "asc" } }),
  ]);

  if (!orderId || !order) {
    return (
      <div className="max-w-3xl space-y-4">
        <h1 className="page-title">Pengiriman Pesanan Baru</h1>
        <p className="muted">
          Pilih pesanan dari halaman{" "}
          <a href="/sales/orders" className="font-semibold text-blue-600 hover:underline">
            Pesanan Penjualan
          </a>{" "}
          lalu klik &quot;Kirim&quot;.
        </p>
      </div>
    );
  }

  const linesForPicker = order.lines.map((l) => ({
    id: l.id,
    itemId: l.itemId,
    itemLabel: `${l.item.code} - ${l.item.name}`,
    qty: Number(l.qty),
    qtyShipped: Number(l.qtyShipped),
  }));

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="page-title">Pengiriman untuk Pesanan {order.no}</h1>
      <p className="muted">Pelanggan: {order.customer.name}</p>

      <ActionForm action={createDeliveryForm} className="card grid grid-cols-1 md:grid-cols-2 gap-4">
        <input type="hidden" name="orderId" value={order.id} />

        <div className="field">
          <label className="label">Gudang *</label>
          <select name="warehouseId" required className="input">
            <option value="">-</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} - {w.name}
              </option>
            ))}
          </select>
        </div>

        <div />

        <OrderLinesPicker lines={linesForPicker} />

        <div className="md:col-span-2">
          <button type="submit" className="btn btn-primary">
            Proses Pengiriman
          </button>
        </div>
      </ActionForm>
    </div>
  );
}
