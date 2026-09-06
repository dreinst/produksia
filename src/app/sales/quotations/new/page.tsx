import { db } from "@/lib/db";
import ActionForm from "@/components/ActionForm";
import { createQuotationForm } from "@/lib/actions/sales";
import LineItemsEditor from "@/components/sales/LineItemsEditor";

export default async function NewQuotationPage() {
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
      <h1 className="text-xl font-semibold">Penawaran Penjualan Baru</h1>

      <ActionForm action={createQuotationForm} className="grid grid-cols-1 md:grid-cols-2 gap-4 border rounded-lg p-4">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">Pelanggan *</label>
          <select name="customerId" required className="border rounded px-2 py-1">
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
          <button type="submit" className="bg-black text-white px-4 py-2 rounded text-sm">
            Simpan Penawaran
          </button>
        </div>
      </ActionForm>
    </div>
  );
}
