import { db } from "@/lib/db";
import ActionForm from "@/components/ActionForm";
import { createReceiptForm } from "@/lib/actions/sales";

export default async function NewReceiptPage({
  searchParams,
}: {
  searchParams: Promise<{ invoiceId?: string }>;
}) {
  const { invoiceId } = await searchParams;

  const [invoice, accounts] = await Promise.all([
    invoiceId
      ? db.salesInvoice.findUnique({
          where: { id: invoiceId },
          include: { customer: true, receipts: true },
        })
      : null,
    db.account.findMany({ where: { type: "ASET" }, orderBy: { code: "asc" } }),
  ]);

  if (!invoiceId || !invoice) {
    return (
      <div className="max-w-3xl space-y-4">
        <h1 className="page-title">Penerimaan Penjualan Baru</h1>
        <p className="muted">
          Pilih faktur dari halaman{" "}
          <a href="/sales/invoices" className="font-semibold text-blue-600 hover:underline">
            Faktur Penjualan
          </a>{" "}
          lalu klik &quot;Terima Bayar&quot;.
        </p>
      </div>
    );
  }

  const paid = invoice.receipts.reduce((s, r) => s + Number(r.amount), 0);
  const remaining = Number(invoice.total) - paid;

  return (
    <div className="space-y-6 max-w-md">
      <h1 className="page-title">Penerimaan untuk Faktur {invoice.no}</h1>
      <p className="muted">
        Pelanggan: {invoice.customer.name} &middot; Sisa tagihan: {remaining.toLocaleString("id-ID")}
      </p>

      <ActionForm action={createReceiptForm} className="card flex flex-col gap-4">
        <input type="hidden" name="invoiceId" value={invoice.id} />

        <div className="field">
          <label className="label">Akun Kas/Bank Penerima *</label>
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
          <select name="paymentMethod" defaultValue="CASH" className="input">
            <option value="CASH">Tunai</option>
            <option value="TRANSFER">Transfer</option>
            <option value="CARD">Kartu</option>
          </select>
        </div>

        <button type="submit" className="btn btn-primary">
          Catat Penerimaan
        </button>
      </ActionForm>
    </div>
  );
}
