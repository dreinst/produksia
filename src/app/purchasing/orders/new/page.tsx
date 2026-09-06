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
      <h1 className="page-title">Pesanan Pembelian Baru</h1>

      <ActionForm action={createPurchaseOrderForm} className="card grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="field">
          <label className="label">Pemasok *</label>
          <select name="supplierId" required className="input">
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
          <button type="submit" className="btn btn-primary">
            Simpan Pesanan
          </button>
        </div>
      </ActionForm>
    </div>
  );
}
