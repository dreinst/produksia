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
        <h1 className="text-xl font-semibold">Penerimaan Penjualan Baru</h1>
        <p className="text-sm text-zinc-500">
          Pilih faktur dari halaman{" "}
          <a href="/sales/invoices" className="text-blue-600 hover:underline">
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
      <h1 className="text-xl font-semibold">Penerimaan untuk Faktur {invoice.no}</h1>
      <p className="text-sm text-zinc-500">
        Pelanggan: {invoice.customer.name} &middot; Sisa tagihan: {remaining.toLocaleString("id-ID")}
      </p>

      <ActionForm action={createReceiptForm} className="flex flex-col gap-4 border rounded-lg p-4">
        <input type="hidden" name="invoiceId" value={invoice.id} />

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">Akun Kas/Bank Penerima *</label>
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
          <select name="paymentMethod" defaultValue="CASH" className="border rounded px-2 py-1">
            <option value="CASH">Tunai</option>
            <option value="TRANSFER">Transfer</option>
            <option value="CARD">Kartu</option>
          </select>
        </div>

        <button type="submit" className="bg-black text-white px-4 py-2 rounded text-sm">
          Catat Penerimaan
        </button>
      </ActionForm>
    </div>
  );
}
