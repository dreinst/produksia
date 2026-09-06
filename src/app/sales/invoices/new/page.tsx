import { db } from "@/lib/db";
import ActionForm from "@/components/ActionForm";
import { createInvoiceForm } from "@/lib/actions/sales";
import InvoiceLinesPicker from "@/components/sales/InvoiceLinesPicker";

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ orderId?: string; deliveryId?: string }>;
}) {
  const { orderId, deliveryId } = await searchParams;

  const order = orderId
    ? await db.salesOrder.findUnique({
        where: { id: orderId },
        include: { customer: true, lines: { include: { item: true } } },
      })
    : null;

  if (!orderId || !order) {
    return (
      <div className="max-w-3xl space-y-4">
        <h1 className="text-xl font-semibold">Faktur Penjualan Baru</h1>
        <p className="text-sm text-zinc-500">
          Pilih pesanan dari halaman{" "}
          <a href="/sales/orders" className="text-blue-600 hover:underline">
            Pesanan Penjualan
          </a>{" "}
          lalu klik &quot;Fakturkan&quot;.
        </p>
      </div>
    );
  }

  const linesForPicker = order.lines.map((l) => ({
    id: l.id,
    itemId: l.itemId,
    itemLabel: `${l.item.code} - ${l.item.name}`,
    qty: Number(l.qty),
    qtyInvoiced: Number(l.qtyInvoiced),
    price: Number(l.price),
  }));

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-xl font-semibold">Faktur untuk Pesanan {order.no}</h1>
      <p className="text-sm text-zinc-500">Pelanggan: {order.customer.name}</p>

      <ActionForm action={createInvoiceForm} className="grid grid-cols-1 md:grid-cols-2 gap-4 border rounded-lg p-4">
        <input type="hidden" name="orderId" value={order.id} />
        {deliveryId && <input type="hidden" name="deliveryId" value={deliveryId} />}

        <InvoiceLinesPicker lines={linesForPicker} />

        <div className="md:col-span-2">
          <button type="submit" className="bg-black text-white px-4 py-2 rounded text-sm">
            Terbitkan Faktur
          </button>
        </div>
      </ActionForm>
    </div>
  );
}
