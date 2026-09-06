import Link from "next/link";
import { db } from "@/lib/db";
import Icon from "@/components/ui/Icon";
import { DocNo, StatusBadge } from "@/components/ui/Badges";

const rp = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;
const DEBIT_NORMAL = new Set(["ASET", "BEBAN"]);

type Recent = {
  no: string;
  date: Date;
  who: string;
  amount: number | null;
  status: string;
  action?: { label: string; href: string; icon: string };
};

export default async function Home() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const periodLabel = now.toLocaleDateString("id-ID", { month: "long", year: "numeric" });

  const [
    unpaidSales,
    unpaidPurchase,
    accounts,
    stocks,
    itemCount,
    assets,
    draftQuotations,
    openOrders,
    deliveriesMonth,
    receiptsMonth,
    recentInv,
    recentSo,
    recentRcp,
    recentDo,
    recentPinv,
    recentPp,
  ] = await Promise.all([
    db.salesInvoice.findMany({ where: { status: { not: "PAID" } }, include: { receipts: true } }),
    db.purchaseInvoice.findMany({ where: { status: { not: "PAID" } }, include: { payments: true } }),
    db.account.findMany({ include: { journalLines: true }, orderBy: { code: "asc" } }),
    db.itemStock.findMany({ include: { item: true, warehouse: true } }),
    db.item.count(),
    db.fixedAsset.findMany({ where: { status: "AKTIF" }, include: { depreciations: true } }),
    db.salesQuotation.findMany({ where: { status: "DRAFT" } }),
    db.salesOrder.findMany({ where: { status: { in: ["DRAFT", "PARTIAL"] } } }),
    db.delivery.count({ where: { date: { gte: monthStart } } }),
    db.salesReceipt.findMany({ where: { date: { gte: monthStart } } }),
    db.salesInvoice.findMany({ include: { customer: true }, orderBy: { date: "desc" }, take: 4 }),
    db.salesOrder.findMany({ include: { customer: true, lines: true }, orderBy: { date: "desc" }, take: 4 }),
    db.salesReceipt.findMany({ include: { customer: true }, orderBy: { date: "desc" }, take: 3 }),
    db.delivery.findMany({ include: { order: { include: { customer: true } } }, orderBy: { date: "desc" }, take: 3 }),
    db.purchaseInvoice.findMany({ include: { supplier: true }, orderBy: { date: "desc" }, take: 3 }),
    db.purchasePayment.findMany({ include: { supplier: true }, orderBy: { date: "desc" }, take: 2 }),
  ]);

  // ---- KPI 1: Piutang ----
  const arRows = unpaidSales.map((i) => ({
    remaining: Number(i.total) - i.receipts.reduce((s, r) => s + Number(r.amount), 0),
    overdue: !!i.dueDate && i.dueDate < now,
  }));
  const ar = arRows.reduce((s, r) => s + r.remaining, 0);
  const arOverdue = arRows.filter((r) => r.overdue).reduce((s, r) => s + r.remaining, 0);

  // ---- KPI 2: Utang ----
  const apRows = unpaidPurchase.map((i) => ({
    remaining: Number(i.total) - i.payments.reduce((s, p) => s + Number(p.amount), 0),
    overdue: !!i.dueDate && i.dueDate < now,
  }));
  const ap = apRows.reduce((s, r) => s + r.remaining, 0);
  const apOverdueCount = apRows.filter((r) => r.overdue).length;

  // ---- Saldo per akun & KPI 3: Kas & Bank (akun ASET bernama kas/bank) ----
  const balances = accounts.map((a) => {
    const debit = a.journalLines.reduce((s, l) => s + Number(l.debit), 0);
    const credit = a.journalLines.reduce((s, l) => s + Number(l.credit), 0);
    return { ...a, debit, credit, balance: DEBIT_NORMAL.has(a.type) ? debit - credit : credit - debit };
  });
  const cashAccounts = balances.filter((a) => a.type === "ASET" && /\b(kas|bank)\b/i.test(a.name));
  const cash = cashAccounts.reduce((s, a) => s + a.balance, 0);

  // ---- KPI 4: Persediaan ----
  const inventoryValue = stocks.reduce((s, st) => s + Number(st.qty) * Number(st.item.costPrice), 0);
  const belowMin = stocks.filter((st) => Number(st.item.minStock) > 0 && Number(st.qty) < Number(st.item.minStock));
  const byWarehouse = Object.values(
    stocks.reduce<Record<string, { name: string; value: number }>>((acc, st) => {
      const k = st.warehouseId;
      acc[k] ??= { name: st.warehouse.name, value: 0 };
      acc[k].value += Number(st.qty) * Number(st.item.costPrice);
      return acc;
    }, {}),
  )
    .sort((a, b) => b.value - a.value)
    .slice(0, 2);

  // ---- Neraca saldo cepat ----
  const totalDebit = balances.reduce((s, a) => s + a.debit, 0);
  const totalCredit = balances.reduce((s, a) => s + a.credit, 0);
  const sumType = (t: string) => balances.filter((a) => a.type === t).reduce((s, a) => s + a.balance, 0);
  const labaBerjalan = sumType("PENDAPATAN") - sumType("BEBAN");
  const balanced = Math.abs(totalDebit - totalCredit) < 0.005;

  // ---- Alur dokumen ----
  const sqTotal = draftQuotations.reduce((s, q) => s + Number(q.total), 0);
  const soTotal = openOrders.reduce((s, o) => s + Number(o.total), 0);
  const rcpTotal = receiptsMonth.reduce((s, r) => s + Number(r.amount), 0);

  // ---- Peringatan stok: rasio qty / min terendah ----
  const alerts = stocks
    .filter((st) => Number(st.item.minStock) > 0)
    .map((st) => ({ st, ratio: Number(st.qty) / Number(st.item.minStock) }))
    .sort((a, b) => a.ratio - b.ratio)
    .slice(0, 3);

  // ---- Penyusutan bulan ini ----
  const periodKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const period = new Date(`${periodKey}-01T00:00:00.000Z`);
  const monthlyDep = assets.reduce((s, a) => s + (Number(a.acquisitionCost) - Number(a.salvageValue)) / a.usefulLifeMonths, 0);
  const depPosted = assets.length > 0 && assets.every((a) => a.depreciations.some((d) => d.period.getTime() === period.getTime()));

  // ---- Transaksi terbaru (gabungan) ----
  const recent: Recent[] = [
    ...recentInv.map((d) => ({
      no: d.no, date: d.date, who: d.customer.name, amount: Number(d.total), status: d.status,
      action: d.status !== "PAID" ? { label: "Terima bayar", href: `/sales/receipts/new?invoiceId=${d.id}`, icon: "payments" } : undefined,
    })),
    ...recentSo.map((d) => {
      const fullyShipped = d.lines.every((l) => Number(l.qtyShipped) >= Number(l.qty));
      return {
        no: d.no, date: d.date, who: d.customer.name, amount: Number(d.total), status: d.status,
        action: !fullyShipped ? { label: "Buat SJ", href: `/sales/deliveries/new?orderId=${d.id}`, icon: "local_shipping" } : undefined,
      };
    }),
    ...recentRcp.map((d) => ({ no: d.no, date: d.date, who: d.customer.name, amount: Number(d.amount), status: "POSTED" })),
    ...recentDo.map((d) => ({ no: d.no, date: d.date, who: d.order.customer.name, amount: null, status: d.status })),
    ...recentPinv.map((d) => ({
      no: d.no, date: d.date, who: d.supplier.name, amount: Number(d.total), status: d.status,
      action: d.status !== "PAID" ? { label: "Bayar", href: `/purchasing/payments/new?invoiceId=${d.id}`, icon: "payments" } : undefined,
    })),
    ...recentPp.map((d) => ({ no: d.no, date: d.date, who: d.supplier.name, amount: Number(d.amount), status: "POSTED" })),
  ]
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, 8);

  const quick = [
    { href: "/sales/orders", label: "+ Faktur (FJ)", icon: "receipt_long", color: "text-blue-600" },
    { href: "/sales/orders", label: "+ Pengiriman (SJ)", icon: "local_shipping", color: "text-slate-600" },
    { href: "/sales/invoices", label: "+ Penerimaan (TRM)", icon: "payments", color: "text-emerald-600" },
    { href: "/cashbank/in", label: "Kas Masuk / Keluar", icon: "swap_horiz", color: "text-indigo-600" },
    { href: "/ledger/journal/new", label: "+ Jurnal Umum (JU)", icon: "edit_note", color: "text-slate-600" },
  ];

  const steps = [
    { code: "PNW", tag: "Tahap 1", title: "Penawaran", value: `${draftQuotations.length} Dokumen`, sub: `Perkiraan ${rp(sqTotal)}`, note: "Belum memengaruhi buku", dot: "bg-slate-300", tone: "" },
    { code: "PSJ", tag: "Tahap 2", title: "Pesanan Penjualan", value: `${openOrders.length} Pesanan Aktif`, sub: rp(soTotal), note: "Reservasi stok", dot: "bg-amber-400", tone: "text-amber-600" },
    { code: "SJ", tag: "Fisik Keluar", title: "Surat Jalan (SJ)", value: `${deliveriesMonth} Pengiriman`, sub: periodLabel, note: "Kuantitas stok berkurang", dot: "bg-blue-500", tone: "text-blue-700", highlight: true },
    { code: "FJ", tag: "Tahap 4", title: "Faktur Penjualan", value: `${unpaidSales.length} Faktur Aktif`, sub: `${rp(ar)} Piutang`, note: "Jurnal otomatis terbit", dot: "bg-emerald-500", tone: "text-emerald-600" },
    { code: "TRM", tag: "Lunas", title: "Penerimaan Kas", value: rp(rcpTotal), sub: `${receiptsMonth.length} Transaksi Masuk`, note: "Piutang lunas", dot: "bg-emerald-500", tone: "text-emerald-600" },
  ];

  return (
    <div className="space-y-7">
      {/* Hero */}
      <div className="card space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2.5 mb-1.5 text-xs text-slate-500">
              <span className="badge badge-emerald">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Transaksi atomik aktif
              </span>
              <span className="text-slate-400">•</span>
              <span>
                Periode: <strong className="text-slate-700 font-medium">{periodLabel}</strong>
              </span>
              <span className="text-slate-400">•</span>
              <span>
                Mata Uang: <strong className="text-slate-700 font-medium">Rupiah (Rp)</strong>
              </span>
            </div>
            <h1 className="page-title">Ringkasan Keuangan &amp; Operasional</h1>
            <p className="page-subtitle">Accurate Copy — dokumen, mutasi stok, dan jurnal tercatat dalam satu transaksi.</p>
          </div>
          <Link href="/ledger/trial-balance" className="btn btn-soft self-start md:self-center">
            <Icon name="balance" className="!text-[18px] text-slate-500" />
            Cek Neraca Saldo
          </Link>
        </div>
        <div className="pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 eyebrow">
            <Icon name="bolt" className="!text-[18px] text-slate-400" />
            Aksi Cepat
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {quick.map((q) => (
              <Link key={q.label} href={q.href} className="btn btn-soft btn-sm font-medium">
                <Icon name={q.icon} className={`!text-[18px] ${q.color}`} />
                {q.label}
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Ringkasan angka */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <Kpi
          title="Piutang Usaha"
          badge={{ text: `${unpaidSales.length} Faktur`, cls: unpaidSales.length ? "badge-amber" : "badge-emerald" }}
          value={rp(ar)}
          note="Faktur penjualan belum lunas"
          rows={[
            { k: "Lancar", v: rp(ar - arOverdue) },
            { k: "Lewat jatuh tempo", v: rp(arOverdue), cls: arOverdue > 0 ? "text-rose-600" : "" },
          ]}
        />
        <Kpi
          title="Utang Usaha"
          badge={{ text: apOverdueCount ? `${apOverdueCount} Faktur Tempo` : `${unpaidPurchase.length} Faktur`, cls: apOverdueCount ? "badge-amber" : "badge-slate" }}
          value={rp(ap)}
          note="Faktur pembelian belum lunas"
          rows={[
            { k: "Faktur aktif", v: `${unpaidPurchase.length}` },
            { k: "Lewat jatuh tempo", v: `${apOverdueCount}`, cls: apOverdueCount ? "text-rose-600" : "" },
          ]}
        />
        <Kpi
          title="Kas & Bank Tersedia"
          badge={{ text: `${cashAccounts.length} Akun`, cls: "badge-blue" }}
          value={rp(cash)}
          note={cashAccounts.map((a) => a.name).join(" + ") || "Belum ada akun kas/bank"}
          rows={cashAccounts.slice(0, 2).map((a) => ({ k: a.name, v: rp(a.balance) }))}
        />
        <Kpi
          title="Nilai Persediaan"
          badge={{ text: `${itemCount} Barang`, cls: "badge-slate" }}
          value={rp(inventoryValue)}
          note="Σ qty × harga pokok, semua gudang"
          rows={[
            ...byWarehouse.map((w) => ({ k: w.name, v: rp(w.value) })),
            ...(belowMin.length ? [{ k: "Di bawah stok minimum", v: `${belowMin.length} Barang`, cls: "text-amber-600" }] : []),
          ].slice(0, 2)}
        />
      </div>

      {/* Alur dokumen */}
      <div className="card">
        <div className="card-head">
          <div>
            <h2 className="card-title">Alur Transaksi &amp; Dokumen Terintegrasi</h2>
            <p className="card-subtitle">Siklus penjualan: Pesanan terbit → stok fisik berkurang di SJ → pengakuan piutang &amp; jurnal di Faktur/Penerimaan.</p>
          </div>
          <span className="text-xs text-slate-500 font-medium bg-slate-50 px-3 py-1 rounded-lg border border-slate-100 whitespace-nowrap">
            Stok terpotong di SJ • Jurnal di FJ &amp; TRM
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
          {steps.map((s) => (
            <div key={s.code} className={`p-3.5 rounded-xl border ${s.highlight ? "bg-blue-50/40 border-blue-100" : "bg-slate-50/70 border-slate-100"}`}>
              <div className="flex items-center justify-between mb-2">
                <span className={`text-xs font-bold font-mono ${s.highlight ? "text-blue-700" : "text-slate-700"}`}>{s.code}</span>
                <span className={`text-[11px] ${s.highlight ? "font-semibold text-blue-600" : "text-slate-400"}`}>{s.tag}</span>
              </div>
              <div className="text-xs font-semibold text-slate-900">{s.title}</div>
              <div className="text-sm font-bold text-slate-800 mt-1 num">{s.value}</div>
              <div className="text-[11px] text-slate-400 mt-0.5 num">{s.sub}</div>
              <div className={`text-[10px] mt-3 flex items-center gap-1 ${s.tone || "text-slate-400"}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} /> {s.note}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-7 items-start">
        {/* Kiri */}
        <div className="lg:col-span-8 space-y-7">
          <div className="card card-table">
            <div className="card-head">
              <div>
                <h2 className="card-title">Transaksi Terbaru &amp; Status</h2>
                <p className="card-subtitle">Gabungan faktur, pesanan, pengiriman, penerimaan, dan pembayaran terakhir</p>
              </div>
              <Link href="/search?q=2026" className="btn btn-soft btn-sm">
                <Icon name="search" className="!text-[16px]" /> Cari dokumen
              </Link>
            </div>
            <div className="table-wrap">
              <table className="tbl min-w-[40rem]">
                <thead>
                  <tr>
                    <th>No Dokumen</th>
                    <th>Tanggal</th>
                    <th>Rekanan</th>
                    <th className="text-right">Nilai</th>
                    <th className="text-center">Status</th>
                    <th className="text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((r) => (
                    <tr key={r.no}>
                      <td><DocNo no={r.no} /></td>
                      <td className="text-slate-500 whitespace-nowrap">{r.date.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}</td>
                      <td className="font-medium text-slate-900">{r.who}</td>
                      <td className="text-right num font-semibold text-slate-900">{r.amount === null ? "—" : r.amount.toLocaleString("id-ID")}</td>
                      <td className="text-center"><StatusBadge status={r.status} /></td>
                      <td className="text-center">
                        {r.action ? (
                          <Link href={r.action.href} title={r.action.label} className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700">
                            <Icon name={r.action.icon} className="!text-[18px]" />
                            <span className="text-[11px] font-semibold">{r.action.label}</span>
                          </Link>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {recent.length === 0 && (
                    <tr>
                      <td colSpan={6} className="empty">Belum ada transaksi.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="card-title">Buku Besar &amp; Neraca Saldo Cepat</h2>
                <p className="card-subtitle">Verifikasi integritas debit–kredit dari seluruh ayat jurnal</p>
              </div>
              <span className={`badge ${balanced ? "badge-emerald" : "badge-rose"}`}>
                <Icon name={balanced ? "check_circle" : "error"} className="!text-[14px]" />
                {balanced ? "Seimbang (Σ Debit = Σ Kredit)" : "Tidak seimbang — periksa jurnal"}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
              <div className="tile">
                <div className="text-xs font-medium text-slate-500">Total Aset (1-xxxx)</div>
                <div className="text-lg font-bold text-slate-900 mt-1 num">{rp(sumType("ASET"))}</div>
                <div className="text-[11px] text-emerald-600 mt-1 font-medium">Posisi normal: Debit</div>
              </div>
              <div className="tile">
                <div className="text-xs font-medium text-slate-500">Total Kewajiban (2-xxxx)</div>
                <div className="text-lg font-bold text-slate-900 mt-1 num">{rp(sumType("KEWAJIBAN"))}</div>
                <div className="text-[11px] text-slate-500 mt-1 font-medium">Posisi normal: Kredit</div>
              </div>
              <div className="tile">
                <div className="text-xs font-medium text-slate-500">Modal + Laba Berjalan</div>
                <div className="text-lg font-bold text-slate-900 mt-1 num">{rp(sumType("MODAL") + labaBerjalan)}</div>
                <div className={`text-[11px] mt-1 font-medium ${labaBerjalan >= 0 ? "text-blue-600" : "text-rose-600"}`}>
                  Laba berjalan {rp(labaBerjalan)}
                </div>
              </div>
            </div>
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/60 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div>
                <span className="text-xs font-semibold text-slate-800">Total Mutasi Buku Besar</span>
                <p className="text-[11px] text-slate-500 mt-0.5">Seluruh ayat jurnal (manual, kas, penjualan, pembelian, penyusutan).</p>
              </div>
              <div className="flex items-center gap-6 bg-white px-5 py-2.5 rounded-lg border border-slate-200/60">
                <div>
                  <span className="block eyebrow">Total Debit</span>
                  <span className="text-sm font-bold text-slate-900 num">{rp(totalDebit)}</span>
                </div>
                <div className="w-px h-7 bg-slate-200" />
                <div>
                  <span className="block eyebrow">Total Kredit</span>
                  <span className="text-sm font-bold text-slate-900 num">{rp(totalCredit)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Kanan */}
        <div className="lg:col-span-4 space-y-7">
          <div className="card space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Peringatan Stok Minimum</h3>
                <p className="text-xs text-slate-500 mt-0.5">Barang mendekati / di bawah ambang</p>
              </div>
              <span className={`badge ${belowMin.length ? "badge-rose" : "badge-emerald"}`}>
                {belowMin.length ? `${belowMin.length} Perlu Reorder` : "Aman"}
              </span>
            </div>
            <div className="space-y-3">
              {alerts.map(({ st, ratio }) => {
                const tone = ratio < 1 ? "rose" : ratio < 1.5 ? "amber" : "emerald";
                const wrap = tone === "rose" ? "bg-rose-50/40 border-rose-100/70" : tone === "amber" ? "bg-amber-50/40 border-amber-100/70" : "bg-slate-50/70 border-slate-100";
                const bar = tone === "rose" ? "bg-rose-500" : tone === "amber" ? "bg-amber-500" : "bg-emerald-500";
                const txt = tone === "rose" ? "text-rose-600" : tone === "amber" ? "text-amber-600" : "text-emerald-600";
                const diff = Number(st.qty) - Number(st.item.minStock);
                return (
                  <div key={`${st.itemId}-${st.warehouseId}`} className={`p-3 rounded-xl border space-y-2 ${wrap}`}>
                    <div className="flex justify-between items-start gap-2">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-900 truncate">{st.item.name}</div>
                        <div className="text-[11px] text-slate-400 font-medium">{st.warehouse.name}</div>
                      </div>
                      <span className={`text-[11px] font-semibold num whitespace-nowrap ${txt}`}>
                        {Number(st.qty).toLocaleString("id-ID")} {st.item.unit}
                      </span>
                    </div>
                    <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                      <div className={`${bar} h-full rounded-full`} style={{ width: `${Math.min(100, Math.round((ratio / 2) * 100))}%` }} />
                    </div>
                    <div className="flex justify-between text-[11px] text-slate-400">
                      <span>Min: {Number(st.item.minStock).toLocaleString("id-ID")} {st.item.unit}</span>
                      <span className={`font-medium ${txt}`}>{diff >= 0 ? `+${diff.toLocaleString("id-ID")} di atas min` : `Defisit ${diff.toLocaleString("id-ID")}`}</span>
                    </div>
                  </div>
                );
              })}
              {alerts.length === 0 && <p className="text-sm text-slate-400">Belum ada barang dengan stok minimum.</p>}
            </div>
            <Link href="/purchasing/orders/new" className="btn btn-primary w-full">
              <Icon name="shopping_cart" className="!text-[18px]" /> + Buat Pesanan Pembelian (PSB)
            </Link>
          </div>

          <div className="card space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Penyusutan Aset Tetap</h3>
                <p className="text-xs text-slate-500 mt-0.5">Garis lurus (straight-line) per bulan</p>
              </div>
              <span className="badge badge-slate">{now.toLocaleDateString("id-ID", { month: "short", year: "numeric" })}</span>
            </div>
            <div className="tile space-y-2 text-xs">
              <div className="flex justify-between items-center text-slate-500">
                <span>Status periode ini</span>
                <span className={`font-semibold ${depPosted ? "text-emerald-600" : "text-amber-600"}`}>{assets.length === 0 ? "Belum ada aset" : depPosted ? "Sudah dicatat" : "Belum dicatat"}</span>
              </div>
              <div className="flex justify-between items-center text-slate-500">
                <span>Estimasi beban bulan ini</span>
                <span className="font-bold text-slate-900 num">{rp(Math.round(monthlyDep))}</span>
              </div>
              <div className="flex justify-between items-center text-slate-500">
                <span>Aset aktif</span>
                <span className="font-medium text-slate-800">{assets.length} Unit</span>
              </div>
            </div>
            <Link href="/assets/depreciation" className={`btn w-full ${depPosted ? "btn-outline" : "btn-accent"}`}>
              <Icon name={depPosted ? "check_circle" : "play_arrow"} className="!text-[18px]" />
              {depPosted ? "Lihat Riwayat Penyusutan" : "Catat Jurnal Penyusutan (JU-PNY)"}
            </Link>
          </div>

          <div className="rounded-2xl bg-slate-900 text-slate-300 p-6 space-y-4">
            <div className="flex items-center gap-2.5 text-white">
              <Icon name="verified_user" className="!text-[22px] text-blue-400" />
              <h3 className="text-sm font-bold">Integritas Basis Data</h3>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">Pengaman yang berlaku di setiap transaksi Accurate Copy:</p>
            <div className="space-y-3 text-xs">
              {[
                ["Transaksi atomik dokumen–stok–jurnal", "Faktur, pengiriman, pembayaran, retur, dan penyusutan disimpan bersama efeknya dalam satu transaksi database."],
                ["DB constraint CHECK (qty ≥ 0)", "PostgreSQL menolak stok negatif walau dua pengiriman terjadi bersamaan."],
                ["Jurnal wajib balance", "Σ debit harus sama persis dengan Σ kredit; nominal dihitung dengan Decimal, bukan float."],
              ].map(([t, d]) => (
                <div key={t} className="flex items-start gap-2.5">
                  <Icon name="check_circle" className="!text-[18px] text-emerald-400 mt-0.5" />
                  <div>
                    <span className="font-semibold text-white">{t}</span>
                    <p className="text-slate-400 text-[11px] mt-0.5">{d}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="pt-3 border-t border-slate-800 flex justify-between items-center text-[11px] text-slate-400 font-mono">
              <span>PostgreSQL 18 • Prisma 7</span>
              <span className={balanced ? "text-emerald-400 font-semibold" : "text-rose-400 font-semibold"}>{balanced ? "Buku besar seimbang" : "Buku besar tidak seimbang"}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Kpi({
  title,
  badge,
  value,
  note,
  rows,
}: {
  title: string;
  badge: { text: string; cls: string };
  value: string;
  note: string;
  rows: { k: string; v: string; cls?: string }[];
}) {
  return (
    <div className="card p-5 flex flex-col justify-between hover:border-slate-300 transition-colors">
      <div>
        <div className="flex items-center justify-between mb-3 gap-2">
          <span className="text-xs font-semibold text-slate-500">{title}</span>
          <span className={`badge ${badge.cls}`}>{badge.text}</span>
        </div>
        <div className="font-heading text-2xl font-bold tracking-tight text-slate-900 num">{value}</div>
        <div className="text-[11px] text-slate-400 mt-1 font-mono truncate">{note}</div>
      </div>
      <div className="mt-4 pt-3 border-t border-slate-100 text-xs space-y-1.5">
        {rows.map((r) => (
          <div key={r.k} className="flex justify-between items-center gap-2 text-slate-600">
            <span className="text-[11px] truncate">{r.k}</span>
            <span className={`font-medium num whitespace-nowrap ${r.cls ?? "text-slate-800"}`}>{r.v}</span>
          </div>
        ))}
        {rows.length === 0 && <div className="text-[11px] text-slate-400">—</div>}
      </div>
    </div>
  );
}
