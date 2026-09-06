import Link from "next/link";
import { db } from "@/lib/db";
import { nextDocNumber } from "@/lib/numbering";
import { createInvoiceForm } from "@/lib/actions/sales";
import InvoiceComposer from "@/components/InvoiceComposer";
import PageHeader from "@/components/ui/PageHeader";

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ orderId?: string }> }) {
  const { orderId } = await searchParams;

  const order = orderId
    ? await db.salesOrder.findUnique({
        where: { id: orderId },
        include: { customer: true, lines: { include: { item: true } }, deliveries: { orderBy: { date: "asc" } } },
      })
    : null;

  if (!orderId || !order) {
    return (
      <div className="space-y-6">
        <PageHeader crumbs={[{ label: "Penjualan" }, { label: "Faktur Penjualan", href: "/sales/invoices" }, { label: "Buat Faktur" }]} title="Faktur Penjualan Baru" />
        <div className="card max-w-xl">
          <p className="muted">
            Faktur dibuat dari pesanan yang sudah ada. Buka{" "}
            <Link href="/sales/orders" className="font-semibold text-blue-600 hover:underline">Pesanan Penjualan</Link>{" "}
            lalu klik <strong>Fakturkan</strong> pada pesanan yang dimaksud.
          </p>
        </div>
      </div>
    );
  }

  const [mapping, nextNo] = await Promise.all([
    db.accountMapping.findUnique({
      where: { id: "default" },
      include: { piutangUsaha: true, pendapatanPenjualan: true, hpp: true, persediaan: true },
    }),
    nextDocNumber(db.salesInvoice, "INV"),
  ]);

  const today = new Date();
  const due = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const label = (a: { code: string; name: string }) => `${a.code} • ${a.name}`;

  return (
    <InvoiceComposer
      mode="sales"
      action={createInvoiceForm}
      backHref="/sales/orders"
      listHref="/sales/invoices"
      nextNo={nextNo}
      date={iso(today)}
      dueDate={iso(due)}
      order={{ id: order.id, no: order.no, date: order.date.toISOString(), status: order.status }}
      partner={{ code: order.customer.code, name: order.customer.name }}
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
      priorDocs={order.deliveries.map((d) => ({ no: d.no, date: d.date.toISOString() }))}
      mapping={
        mapping
          ? {
              counter: label(mapping.piutangUsaha),
              revenueOrInventory: label(mapping.pendapatanPenjualan),
              hpp: label(mapping.hpp),
              persediaan: label(mapping.persediaan),
            }
          : null
      }
    />
  );
}
