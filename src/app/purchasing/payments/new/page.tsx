import { db } from "@/lib/db";
import ActionForm from "@/components/ActionForm";
import { createPurchasePaymentForm } from "@/lib/actions/purchasing";

export default async function NewPurchasePaymentPage({
  searchParams,
}: {
  searchParams: Promise<{ invoiceId?: string }>;
}) {
  const { invoiceId } = await searchParams;

  const [invoice, accounts] = await Promise.all([
    invoiceId
      ? db.purchaseInvoice.findUnique({
          where: { id: invoiceId },
          include: { supplier: true, payments: true },
        })
      : null,
    db.account.findMany({ where: { type: "ASET" }, orderBy: { code: "asc" } }),
  ]);

  if (!invoiceId || !invoice) {
    return (
      <div className="max-w-3xl space-y-4">
        <h1 className="text-xl font-semibold">Pembayaran Pembelian Baru</h1>
        <p className="text-sm text-zinc-500">
          Pilih faktur dari halaman{" "}
          <a href="/purchasing/invoices" className="text-blue-600 hover:underline">
            Faktur Pembelian
          </a>{" "}
          lalu klik &quot;Bayar&quot;.
        </p>
      </div>
    );
  }

  const paid = invoice.payments.reduce((s, p) => s + Number(p.amount), 0);
  const remaining = Number(invoice.total) - paid;

  return (
    <div className="space-y-6 max-w-md">
      <h1 className="text-xl font-semibold">Pembayaran untuk Faktur {invoice.no}</h1>
      <p className="text-sm text-zinc-500">
        Pemasok: {invoice.supplier.name} &middot; Sisa utang: {remaining.toLocaleString("id-ID")}
      </p>

      <ActionForm action={createPurchasePaymentForm} className="flex flex-col gap-4 border rounded-lg p-4">
        <input type="hidden" name="invoiceId" value={invoice.id} />

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">Akun Kas/Bank Sumber *</label>
          <select name="accountId" required className="border rounded px-2 py-1">
            <option value="">-</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} - {a.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">Jumlah Bayar *</label>
          <input
            type="number"
            name="amount"
            step="0.01"
            min={0}
            max={remaining}
            defaultValue={remaining}
            required
            className="border rounded px-2 py-1"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">Metode Pembayaran</label>
          <select name="paymentMethod" defaultValue="TRANSFER" className="border rounded px-2 py-1">
            <option value="TRANSFER">Transfer</option>
            <option value="CASH">Tunai</option>
          </select>
        </div>

        <button type="submit" className="bg-black text-white px-4 py-2 rounded text-sm">
          Catat Pembayaran
        </button>
      </ActionForm>
    </div>
  );
}
