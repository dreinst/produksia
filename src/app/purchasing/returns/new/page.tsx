import { db } from "@/lib/db";
import ActionForm from "@/components/ActionForm";
import { createPurchaseReturnForm } from "@/lib/actions/purchasing";
import ReturnLinesPicker from "@/components/sales/ReturnLinesPicker";

export default async function NewPurchaseReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ invoiceId?: string }>;
}) {
  const { invoiceId } = await searchParams;

  const [invoice, warehouses] = await Promise.all([
    invoiceId
      ? db.purchaseInvoice.findUnique({
          where: { id: invoiceId },
          include: { supplier: true, lines: { include: { item: true } } },
        })
      : null,
    db.warehouse.findMany({ orderBy: { name: "asc" } }),
  ]);

  if (!invoiceId || !invoice) {
    return (
      <div className="max-w-3xl space-y-4">
        <h1 className="text-xl font-semibold">Retur Pembelian Baru</h1>
        <p className="text-sm text-zinc-500">
          Pilih faktur dari halaman{" "}
          <a href="/purchasing/invoices" className="text-blue-600 hover:underline">
            Faktur Pembelian
          </a>{" "}
          lalu klik &quot;Retur&quot;.
        </p>
      </div>
    );
  }

  const linesForPicker = invoice.lines.map((l) => ({
    itemId: l.itemId,
    itemLabel: `${l.item.code} - ${l.item.name}`,
    qty: Number(l.qty),
  }));

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-xl font-semibold">Retur untuk Faktur {invoice.no}</h1>
      <p className="text-sm text-zinc-500">Pemasok: {invoice.supplier.name}</p>

      <ActionForm action={createPurchaseReturnForm} className="grid grid-cols-1 md:grid-cols-2 gap-4 border rounded-lg p-4">
        <input type="hidden" name="invoiceId" value={invoice.id} />

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">Gudang Asal Barang *</label>
          <select name="warehouseId" required className="border rounded px-2 py-1">
            <option value="">-</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} - {w.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">Alasan</label>
          <input type="text" name="reason" className="border rounded px-2 py-1" />
        </div>

        <ReturnLinesPicker lines={linesForPicker} />

        <div className="md:col-span-2">
          <button type="submit" className="bg-black text-white px-4 py-2 rounded text-sm">
            Proses Retur
          </button>
        </div>
      </ActionForm>
    </div>
  );
}
