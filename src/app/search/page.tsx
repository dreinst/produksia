import Link from "next/link";
import { db } from "@/lib/db";
import PageHeader from "@/components/ui/PageHeader";
import { DocNo, StatusBadge } from "@/components/ui/Badges";

type Hit = { no: string; date?: Date; status?: string; who?: string; href: string; kind: string };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const term = q.trim();
  const ci = { contains: term, mode: "insensitive" as const };

  const [sq, so, dov, inv, rcp, ret, po, gr, pinv, pp, pret, ju, customers, suppliers, items, accounts] = term
    ? await Promise.all([
        db.salesQuotation.findMany({ where: { no: ci }, include: { customer: true }, take: 10 }),
        db.salesOrder.findMany({ where: { no: ci }, include: { customer: true }, take: 10 }),
        db.delivery.findMany({ where: { no: ci }, include: { order: { include: { customer: true } } }, take: 10 }),
        db.salesInvoice.findMany({ where: { no: ci }, include: { customer: true }, take: 10 }),
        db.salesReceipt.findMany({ where: { no: ci }, include: { customer: true }, take: 10 }),
        db.salesReturn.findMany({ where: { no: ci }, include: { invoice: { include: { customer: true } } }, take: 10 }),
        db.purchaseOrder.findMany({ where: { no: ci }, include: { supplier: true }, take: 10 }),
        db.goodsReceipt.findMany({ where: { no: ci }, include: { order: { include: { supplier: true } } }, take: 10 }),
        db.purchaseInvoice.findMany({ where: { no: ci }, include: { supplier: true }, take: 10 }),
        db.purchasePayment.findMany({ where: { no: ci }, include: { supplier: true }, take: 10 }),
        db.purchaseReturn.findMany({ where: { no: ci }, include: { invoice: { include: { supplier: true } } }, take: 10 }),
        db.journalEntry.findMany({ where: { OR: [{ no: ci }, { memo: ci }] }, take: 10 }),
        db.customer.findMany({ where: { OR: [{ code: ci }, { name: ci }] }, take: 10 }),
        db.supplier.findMany({ where: { OR: [{ code: ci }, { name: ci }] }, take: 10 }),
        db.item.findMany({ where: { OR: [{ code: ci }, { name: ci }] }, take: 10 }),
        db.account.findMany({ where: { OR: [{ code: ci }, { name: ci }] }, take: 10 }),
      ])
    : [[], [], [], [], [], [], [], [], [], [], [], [], [], [], [], []];

  const docs: Hit[] = [
    ...sq.map((d) => ({ no: d.no, date: d.date, status: d.status, who: d.customer.name, href: "/sales/quotations", kind: "Penawaran" })),
    ...so.map((d) => ({ no: d.no, date: d.date, status: d.status, who: d.customer.name, href: "/sales/orders", kind: "Pesanan Penjualan" })),
    ...dov.map((d) => ({ no: d.no, date: d.date, status: d.status, who: d.order.customer.name, href: "/sales/deliveries", kind: "Pengiriman" })),
    ...inv.map((d) => ({ no: d.no, date: d.date, status: d.status, who: d.customer.name, href: "/sales/invoices", kind: "Faktur Penjualan" })),
    ...rcp.map((d) => ({ no: d.no, date: d.date, who: d.customer.name, href: "/sales/receipts", kind: "Penerimaan" })),
    ...ret.map((d) => ({ no: d.no, date: d.date, who: d.invoice.customer.name, href: "/sales/returns", kind: "Retur Penjualan" })),
    ...po.map((d) => ({ no: d.no, date: d.date, status: d.status, who: d.supplier.name, href: "/purchasing/orders", kind: "Pesanan Pembelian" })),
    ...gr.map((d) => ({ no: d.no, date: d.date, status: d.status, who: d.order.supplier.name, href: "/purchasing/receipts", kind: "Penerimaan Barang" })),
    ...pinv.map((d) => ({ no: d.no, date: d.date, status: d.status, who: d.supplier.name, href: "/purchasing/invoices", kind: "Faktur Pembelian" })),
    ...pp.map((d) => ({ no: d.no, date: d.date, who: d.supplier.name, href: "/purchasing/payments", kind: "Pembayaran" })),
    ...pret.map((d) => ({ no: d.no, date: d.date, who: d.invoice.supplier.name, href: "/purchasing/returns", kind: "Retur Pembelian" })),
    ...ju.map((d) => ({ no: d.no, date: d.date, who: d.memo ?? "", href: "/ledger/journal", kind: "Jurnal" })),
  ].sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));

  const masters = [
    ...customers.map((m) => ({ code: m.code, name: m.name, href: "/master/customers", kind: "Pelanggan" })),
    ...suppliers.map((m) => ({ code: m.code, name: m.name, href: "/master/suppliers", kind: "Pemasok" })),
    ...items.map((m) => ({ code: m.code, name: m.name, href: "/master/items", kind: "Barang" })),
    ...accounts.map((m) => ({ code: m.code, name: m.name, href: "/master/accounts", kind: "Akun" })),
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        crumbs={[{ label: "Dashboard", href: "/" }, { label: "Pencarian" }]}
        title={term ? `Hasil untuk “${term}”` : "Pencarian"}
        subtitle={term ? `${docs.length} dokumen · ${masters.length} master data` : "Ketik nomor dokumen, nama rekanan, barang, atau akun di kotak pencarian."}
      />

      {term && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-8 card card-table">
            <div className="card-head">
              <div>
                <h2 className="card-title">Dokumen</h2>
                <p className="card-subtitle">Klik untuk membuka daftar modul terkait.</p>
              </div>
            </div>
            <div className="table-wrap">
              <table className="tbl min-w-[36rem]">
                <thead>
                  <tr>
                    <th>No Dokumen</th>
                    <th>Jenis</th>
                    <th>Tanggal</th>
                    <th>Rekanan / Memo</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {docs.map((d) => (
                    <tr key={`${d.kind}-${d.no}`}>
                      <td>
                        <Link href={d.href} className="hover:underline">
                          <DocNo no={d.no} />
                        </Link>
                      </td>
                      <td>{d.kind}</td>
                      <td className="text-slate-500">{d.date?.toLocaleDateString("id-ID")}</td>
                      <td className="font-medium text-slate-900">{d.who}</td>
                      <td>{d.status ? <StatusBadge status={d.status} /> : "—"}</td>
                    </tr>
                  ))}
                  {docs.length === 0 && (
                    <tr>
                      <td colSpan={5} className="empty">
                        Tidak ada dokumen yang cocok.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="lg:col-span-4 card">
            <div className="card-head">
              <h2 className="card-title">Master Data</h2>
            </div>
            <ul className="divide-y divide-slate-100">
              {masters.map((m) => (
                <li key={`${m.kind}-${m.code}`} className="py-2 flex items-center justify-between gap-3">
                  <Link href={m.href} className="min-w-0">
                    <div className="text-sm font-medium text-slate-900 truncate">{m.name}</div>
                    <div className="mono text-slate-500">{m.code}</div>
                  </Link>
                  <span className="badge badge-slate">{m.kind}</span>
                </li>
              ))}
              {masters.length === 0 && <li className="py-6 text-center text-sm text-slate-400">Tidak ada master data yang cocok.</li>}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
