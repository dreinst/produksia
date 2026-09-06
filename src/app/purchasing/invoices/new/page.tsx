import { db } from "@/lib/db";
import ActionForm from "@/components/ActionForm";
import { createPurchaseInvoiceForm } from "@/lib/actions/purchasing";
import InvoiceLinesPicker from "@/components/sales/InvoiceLinesPicker";

export default async function NewPurchaseInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ orderId?: string; receiptId?: string }>;
}) {
  const { orderId, receiptId } = await searchParams;

  const order = orderId
    ? await db.purchaseOrder.findUnique({
        where: { id: orderId },
        include: { supplier: true, lines: { include: { item: true } } },
      })
    : null;

  if (!orderId || !order) {
    return (
      <div className="max-w-3xl space-y-4">
        <h1 className="text-xl font-semibold">Faktur Pembelian Baru</h1>
        <p className="text-sm text-zinc-500">
          Pilih pesanan dari halaman{" "}
          <a href="/purchasing/orders" className="text-blue-600 hover:underline">
            Pesanan Pembelian
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
      <p className="text-sm text-zinc-500">Pemasok: {order.supplier.name}</p>

      <ActionForm action={createPurchaseInvoiceForm} className="grid grid-cols-1 md:grid-cols-2 gap-4 border rounded-lg p-4">
        <input type="hidden" name="orderId" value={order.id} />
        {receiptId && <input type="hidden" name="receiptId" value={receiptId} />}

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
