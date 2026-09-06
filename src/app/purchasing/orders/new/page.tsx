import { db } from "@/lib/db";
import ActionForm from "@/components/ActionForm";
import { createPurchaseOrderForm } from "@/lib/actions/purchasing";
import LineItemsEditor from "@/components/sales/LineItemsEditor";

export default async function NewPurchaseOrderPage() {
  const [suppliers, items] = await Promise.all([
    db.supplier.findMany({ orderBy: { name: "asc" } }),
    db.item.findMany({ orderBy: { name: "asc" } }),
  ]);

  const itemOptions = items.map((i) => ({
    id: i.id,
    code: i.code,
    name: i.name,
    defaultPrice: Number(i.costPrice),
  }));

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-xl font-semibold">Pesanan Pembelian Baru</h1>

      <ActionForm action={createPurchaseOrderForm} className="grid grid-cols-1 md:grid-cols-2 gap-4 border rounded-lg p-4">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">Pemasok *</label>
          <select name="supplierId" required className="border rounded px-2 py-1">
            <option value="">-</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} - {s.name}
              </option>
            ))}
          </select>
        </div>

        <div />

        <LineItemsEditor items={itemOptions} />

        <div className="md:col-span-2">
          <button type="submit" className="bg-black text-white px-4 py-2 rounded text-sm">
            Simpan Pesanan
          </button>
        </div>
      </ActionForm>
    </div>
  );
}
