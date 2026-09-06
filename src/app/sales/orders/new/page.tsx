import { db } from "@/lib/db";
import ActionForm from "@/components/ActionForm";
import { createOrderForm } from "@/lib/actions/sales";
import LineItemsEditor from "@/components/sales/LineItemsEditor";

export default async function NewOrderPage() {
  const [customers, items] = await Promise.all([
    db.customer.findMany({ orderBy: { name: "asc" } }),
    db.item.findMany({ orderBy: { name: "asc" } }),
  ]);

  const itemOptions = items.map((i) => ({
    id: i.id,
    code: i.code,
    name: i.name,
    defaultPrice: Number(i.sellPrice),
  }));

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="page-title">Pesanan Penjualan Baru</h1>

      <ActionForm action={createOrderForm} className="card grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="field">
          <label className="label">Pelanggan *</label>
          <select name="customerId" required className="input">
            <option value="">-</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} - {c.name}
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
