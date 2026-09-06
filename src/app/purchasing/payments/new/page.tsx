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
        <h1 className="page-title">Pembayaran Pembelian Baru</h1>
        <p className="muted">
          Pilih faktur dari halaman{" "}
          <a href="/purchasing/invoices" className="font-semibold text-blue-600 hover:underline">
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
      <h1 className="page-title">Pembayaran untuk Faktur {invoice.no}</h1>
      <p className="muted">
        Pemasok: {invoice.supplier.name} &middot; Sisa utang: {remaining.toLocaleString("id-ID")}
      </p>

      <ActionForm action={createPurchasePaymentForm} className="card flex flex-col gap-4">
        <input type="hidden" name="invoiceId" value={invoice.id} />

        <div className="field">
          <label className="label">Akun Kas/Bank Sumber *</label>
          <select name="accountId" required className="input">
            <option value="">-</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} - {a.name}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label className="label">Jumlah Bayar *</label>
          <input
            type="number"
            name="amount"
            step="0.01"
            min={0}
            max={remaining}
            defaultValue={remaining}
            required
            className="input"
          />
        </div>

        <div className="field">
          <label className="label">Metode Pembayaran</label>
          <select name="paymentMethod" defaultValue="TRANSFER" className="input">
            <option value="TRANSFER">Transfer</option>
            <option value="CASH">Tunai</option>
          </select>
        </div>

        <button type="submit" className="btn btn-primary">
          Catat Pembayaran
        </button>
      </ActionForm>
    </div>
  );
}
