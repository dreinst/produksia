import Link from "next/link";
import { db } from "@/lib/db";
import { nextDocNumber } from "@/lib/numbering";
import { createPurchaseInvoiceForm } from "@/lib/actions/purchasing";
import InvoiceComposer from "@/components/InvoiceComposer";
import PageHeader from "@/components/ui/PageHeader";

export default async function NewPurchaseInvoicePage({ searchParams }: { searchParams: Promise<{ orderId?: string }> }) {
  const { orderId } = await searchParams;

  const order = orderId
    ? await db.purchaseOrder.findUnique({
        where: { id: orderId },
        include: { supplier: true, lines: { include: { item: true } }, receipts: { orderBy: { date: "asc" } } },
      })
    : null;

  if (!orderId || !order) {
    return (
      <div className="space-y-6">
        <PageHeader crumbs={[{ label: "Pembelian" }, { label: "Faktur Pembelian", href: "/purchasing/invoices" }, { label: "Buat Faktur" }]} title="Faktur Pembelian Baru" />
        <div className="card max-w-xl">
          <p className="muted">
            Faktur dibuat dari pesanan yang sudah ada. Buka{" "}
            <Link href="/purchasing/orders" className="font-semibold text-blue-600 hover:underline">Pesanan Pembelian</Link>{" "}
            lalu klik <strong>Fakturkan</strong> pada pesanan yang dimaksud.
          </p>
        </div>
      </div>
    );
  }

  const [mapping, nextNo] = await Promise.all([
    db.accountMapping.findUnique({ where: { id: "default" }, include: { utangUsaha: true, persediaan: true } }),
    nextDocNumber(db.purchaseInvoice, "PINV"),
  ]);

  const today = new Date();
  const due = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const label = (a: { code: string; name: string }) => `${a.code} • ${a.name}`;

  return (
    <InvoiceComposer
      mode="purchase"
      action={createPurchaseInvoiceForm}
      backHref="/purchasing/orders"
      listHref="/purchasing/invoices"
      nextNo={nextNo}
      date={iso(today)}
      dueDate={iso(due)}
      order={{ id: order.id, no: order.no, date: order.date.toISOString(), status: order.status }}
      partner={{ code: order.supplier.code, name: order.supplier.name }}
      lines={order.lines.map((l) => ({
        id: l.id,
        itemId: l.itemId,
        code: l.item.code,
        name: l.item.name,
        unit: l.item.unit,
        qtyOrdered: Number(l.qty),
        remaining: Math.max(Number(l.qty) - Number(l.qtyInvoiced), 0),
        price: Number(l.price),
        costPrice: Number(l.item.costPrice),
      }))}
      priorDocs={order.receipts.map((r) => ({ no: r.no, date: r.date.toISOString() }))}
      mapping={mapping ? { counter: label(mapping.utangUsaha), revenueOrInventory: label(mapping.persediaan) } : null}
    />
  );
}
