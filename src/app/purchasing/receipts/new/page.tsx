import { db } from "@/lib/db";
import ActionForm from "@/components/ActionForm";
import { createGoodsReceiptForm } from "@/lib/actions/purchasing";
import ReceiptLinesPicker from "@/components/purchasing/ReceiptLinesPicker";

export default async function NewGoodsReceiptPage({
  searchParams,
}: {
  searchParams: Promise<{ orderId?: string }>;
}) {
  const { orderId } = await searchParams;

  const [order, warehouses] = await Promise.all([
    orderId
      ? db.purchaseOrder.findUnique({
          where: { id: orderId },
          include: { supplier: true, lines: { include: { item: true } } },
        })
      : null,
    db.warehouse.findMany({ orderBy: { name: "asc" } }),
  ]);

  if (!orderId || !order) {
    return (
      <div className="max-w-3xl space-y-4">
        <h1 className="page-title">Penerimaan Barang Baru</h1>
        <p className="muted">
          Pilih pesanan dari halaman{" "}
          <a href="/purchasing/orders" className="font-semibold text-blue-600 hover:underline">
            Pesanan Pembelian
          </a>{" "}
          lalu klik &quot;Terima Barang&quot;.
        </p>
      </div>
    );
  }

  const linesForPicker = order.lines.map((l) => ({
    id: l.id,
    itemId: l.itemId,
    itemLabel: `${l.item.code} - ${l.item.name}`,
    qty: Number(l.qty),
    qtyReceived: Number(l.qtyReceived),
  }));

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="page-title">Penerimaan untuk Pesanan {order.no}</h1>
      <p className="muted">Pemasok: {order.supplier.name}</p>

      <ActionForm action={createGoodsReceiptForm} className="card grid grid-cols-1 md:grid-cols-2 gap-4">
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

        <ReceiptLinesPicker lines={linesForPicker} />

        <div className="md:col-span-2">
          <button type="submit" className="btn btn-primary">
            Proses Penerimaan
          </button>
        </div>
      </ActionForm>
    </div>
  );
}
