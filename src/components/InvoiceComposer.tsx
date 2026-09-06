"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import Icon from "@/components/ui/Icon";
import { DocNo, StatusBadge } from "@/components/ui/Badges";
import type { FormState } from "@/lib/formState";

export type ComposerLine = {
  id: string;
  itemId: string;
  code: string;
  name: string;
  unit: string;
  qtyOrdered: number;
  remaining: number;
  price: number;
  costPrice: number;
};

export type ComposerProps = {
  mode: "sales" | "purchase";
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  backHref: string;
  listHref: string;
  nextNo: string;
  date: string;
  dueDate: string;
  order: { id: string; no: string; date: string; status: string };
  partner: { code: string; name: string };
  lines: ComposerLine[];
  /** dokumen tahap sebelumnya: DO (penjualan) atau GR (pembelian) */
  priorDocs: { no: string; date: string }[];
  mapping: null | {
    counter: string; // Piutang (sales) / Utang (purchase)
    revenueOrInventory: string; // Pendapatan (sales) / Persediaan (purchase)
    hpp?: string;
    persediaan?: string;
  };
};

const fmt = (n: number) => n.toLocaleString("id-ID");

export default function InvoiceComposer(p: ComposerProps) {
  const isSales = p.mode === "sales";
  const [state, formAction, pending] = useActionState(p.action, { error: null });
  const [rows, setRows] = useState(p.lines.map((l) => ({ itemId: l.itemId, qty: l.remaining, price: l.price })));

  const calc = useMemo(() => {
    const subtotal = rows.reduce((s, r) => s + r.qty * r.price, 0);
    const cost = rows.reduce((s, r, i) => s + r.qty * p.lines[i].costPrice, 0);
    const qtyOk = rows.every((r, i) => r.qty >= 0 && r.qty <= p.lines[i].remaining) && rows.some((r) => r.qty > 0);
    return { subtotal, cost, qtyOk, count: rows.filter((r) => r.qty > 0).length };
  }, [rows, p.lines]);

  const update = (i: number, qty: number) => setRows((prev) => prev.map((r, k) => (k === i ? { ...r, qty } : r)));

  const labels = isSales
    ? { title: "Buat Faktur Penjualan (FJ)", module: "Penjualan", list: "Faktur Penjualan", partner: "Pelanggan", counter: "Akun Piutang", prior: "Surat Jalan (SJ)", submit: "Terbitkan Faktur & Jurnal", partnerHref: "/master/customers" }
    : { title: "Buat Faktur Pembelian (FB)", module: "Pembelian", list: "Faktur Pembelian", partner: "Pemasok", counter: "Akun Utang", prior: "Penerimaan Barang (TB)", submit: "Terbitkan Faktur & Jurnal", partnerHref: "/master/suppliers" };

  const journalRows = isSales
    ? [
        { acc: p.mapping?.counter ?? "Piutang Usaha", note: "Tagihan bruto pelanggan", debit: calc.subtotal, credit: 0 },
        { acc: p.mapping?.hpp ?? "HPP", note: "Harga pokok terjual (Σ qty × harga pokok)", debit: calc.cost, credit: 0 },
        { acc: p.mapping?.revenueOrInventory ?? "Pendapatan Penjualan", note: "Pendapatan diakui", debit: 0, credit: calc.subtotal },
        { acc: p.mapping?.persediaan ?? "Persediaan", note: "Pengurangan nilai persediaan", debit: 0, credit: calc.cost },
      ].filter((r) => r.debit > 0 || r.credit > 0 || calc.subtotal === 0)
    : [
        { acc: p.mapping?.revenueOrInventory ?? "Persediaan", note: "Penambahan nilai persediaan", debit: calc.subtotal, credit: 0 },
        { acc: p.mapping?.counter ?? "Utang Usaha", note: "Kewajiban ke pemasok", debit: 0, credit: calc.subtotal },
      ];
  const jDebit = journalRows.reduce((s, r) => s + r.debit, 0);
  const jCredit = journalRows.reduce((s, r) => s + r.credit, 0);

  const guards = [
    { ok: calc.qtyOk, text: "Semua qty valid (≤ sisa pesanan, minimal 1 baris > 0)" },
    { ok: !!p.mapping, text: p.mapping ? "Pemetaan akun terpasang (5 peran akun)" : "Pemetaan akun belum diatur — buka Buku Besar › Pemetaan Akun" },
    { ok: true, text: isSales ? "Stok dipotong saat Pengiriman (SJ), bukan saat faktur" : "Stok bertambah saat Penerimaan Barang (TB), bukan saat faktur" },
  ];
  const canSubmit = calc.qtyOk && !!p.mapping && !pending;

  return (
    <form
      action={formAction}
      id="invoice-form"
      className="space-y-4"
      aria-busy={pending}
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && canSubmit) (e.currentTarget as HTMLFormElement).requestSubmit();
      }}
    >
      <input type="hidden" name="orderId" value={p.order.id} />
      <input type="hidden" name="lines" value={JSON.stringify(rows)} />

      {/* Kepala halaman */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="min-w-0">
          <nav className="flex items-center gap-1 text-xs text-slate-500 mb-1" aria-label="Breadcrumb">
            <span>{labels.module}</span>
            <Icon name="chevron_right" className="!text-[14px] text-slate-400" />
            <Link href={p.listHref} className="hover:text-slate-900">{labels.list}</Link>
            <Icon name="chevron_right" className="!text-[14px] text-slate-400" />
            <span className="font-semibold text-slate-800">Buat Faktur Baru</span>
          </nav>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="page-title">{labels.title}</h1>
            <span className="badge badge-amber">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" /> Draf (belum dicatat)
            </span>
            <span className="badge badge-slate">
              <Icon name="link" className="!text-[14px] text-blue-600" /> Ref Pesanan: <span className="mono">{p.order.no}</span>
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 self-start lg:self-center">
          <Link href={p.backHref} className="btn btn-outline btn-sm">
            <Icon name="close" className="!text-[16px]" /> Batal
          </Link>
          <button type="submit" disabled={!canSubmit} className="btn btn-primary btn-sm group">
            <Icon name="check_circle" className="!text-[16px] text-emerald-400" />
            {pending ? "Memproses…" : labels.submit}
            <kbd className="hidden sm:inline-block bg-white/15 px-1 rounded font-mono text-[10px]">Ctrl+Enter</kbd>
          </button>
        </div>
      </div>

      {state.error && (
        <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {state.error}
        </div>
      )}

      <fieldset disabled={pending} className="contents">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Kiri */}
          <div className="lg:col-span-8 flex flex-col gap-4">
            <section className="card">
              <div className="card-head">
                <div className="flex items-center gap-2">
                  <Icon name="receipt_long" className="!text-[20px] text-blue-600" />
                  <h2 className="card-title !text-[15px]">Informasi Dokumen &amp; Rekanan</h2>
                </div>
                <span className="hint uppercase">Metode: Akrual • Rp</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                <div className="field">
                  <label className="label"><span>No. Faktur</span><span className="hint text-blue-600">Otomatis</span></label>
                  <div className="relative">
                    <input readOnly value={p.nextNo} className="input input-sm mono" />
                    <Icon name="lock" className="absolute right-2 top-1.5 !text-[16px] text-slate-400" />
                  </div>
                </div>
                <div className="field">
                  <label className="label">Tanggal Transaksi</label>
                  <input readOnly type="date" value={p.date} className="input input-sm" />
                </div>
                <div className="field">
                  <label className="label"><span>Jatuh Tempo</span><span className="hint">14 hari</span></label>
                  <input readOnly type="date" value={p.dueDate} className="input input-sm" />
                </div>
                <div className="field sm:col-span-2">
                  <label className="label">
                    <span>{labels.partner}</span>
                    <span className="hint text-emerald-600 flex items-center gap-0.5"><Icon name="verified" className="!text-[14px]" /> dari pesanan</span>
                  </label>
                  <input readOnly value={`${p.partner.code} • ${p.partner.name}`} className="input input-sm" />
                </div>
                <div className="field">
                  <label className="label"><span>{labels.counter}</span><span className="hint">Peta Akun</span></label>
                  <div className="relative">
                    <input readOnly value={p.mapping?.counter ?? "Belum dipetakan"} className={`input input-sm ${p.mapping ? "" : "!text-rose-600"}`} />
                    <Icon name="hub" className="absolute right-2 top-1.5 !text-[16px] text-slate-400" />
                  </div>
                </div>
              </div>
            </section>

            <section className="card card-table">
              <div className="card-head">
                <div className="flex flex-wrap items-center gap-2">
                  <Icon name="format_list_bulleted" className="!text-[20px] text-blue-600" />
                  <h2 className="card-title !text-[15px]">Daftar Barang &amp; Jasa Terfaktur</h2>
                  <span className="badge badge-slate">{calc.count} baris</span>
                </div>
                <button
                  type="button"
                  onClick={() => setRows(p.lines.map((l) => ({ itemId: l.itemId, qty: l.remaining, price: l.price })))}
                  className="btn btn-soft btn-sm text-blue-600"
                >
                  <Icon name="inventory_2" className="!text-[16px]" /> Isi semua sisa pesanan
                </button>
              </div>
              <div className="table-wrap">
                <table className="tbl min-w-[38rem]">
                  <thead>
                    <tr>
                      <th className="w-8 text-center">#</th>
                      <th>Kode &amp; Nama Barang / Jasa</th>
                      <th className="text-right">Sisa / Pesanan</th>
                      <th className="text-right w-24">Kuantitas Faktur</th>
                      <th className="text-center w-14">Satuan</th>
                      <th className="text-right w-24">Harga</th>
                      <th className="text-right w-28">Total (Rp)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.lines.map((l, i) => {
                      const r = rows[i];
                      const bad = r.qty < 0 || r.qty > l.remaining;
                      return (
                        <tr key={l.id}>
                          <td className="text-center mono text-slate-400">{i + 1}</td>
                          <td>
                            <div className="text-[13px] font-semibold text-slate-900">{l.name}</div>
                            <div className="mono text-slate-500">{l.code}</div>
                          </td>
                          <td className="text-right num whitespace-nowrap">
                            {fmt(l.remaining)} <span className="text-slate-400">/ {fmt(l.qtyOrdered)}</span>
                          </td>
                          <td className="text-right">
                            <input
                              type="number"
                              min={0}
                              max={l.remaining}
                              step="0.01"
                              value={r.qty}
                              onChange={(e) => update(i, Number(e.target.value))}
                              className={`input input-sm w-20 text-right num ${bad ? "!border-rose-500" : ""}`}
                              aria-invalid={bad}
                            />
                          </td>
                          <td className="text-center mono text-slate-500">{l.unit}</td>
                          <td className="text-right num">{fmt(l.price)}</td>
                          <td className="text-right num font-semibold text-slate-900">{fmt(r.qty * r.price)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={6} className="text-right text-xs uppercase tracking-wider text-slate-500">Subtotal</td>
                      <td className="text-right num">{fmt(calc.subtotal)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>

            <section className="card">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-[13px] font-semibold text-slate-900 flex items-center gap-2">
                  <Icon name="alt_route" className="!text-[18px] text-blue-600" />
                  Alur Terhubung ({isSales ? "PSJ → SJ → FJ" : "PSB → TB → FB"})
                </h3>
                <span className="hint text-emerald-600">Tautan dokumen tervalidasi</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="tile flex flex-col gap-1">
                  <span className="hint">1. Pesanan</span>
                  <DocNo no={p.order.no} />
                  <span className="text-[11px] text-slate-500">{new Date(p.order.date).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })} · <StatusBadge status={p.order.status} /></span>
                </div>
                <div className="tile flex flex-col gap-1">
                  <span className="hint">2. {labels.prior}</span>
                  {p.priorDocs.length ? (
                    p.priorDocs.map((d) => (
                      <span key={d.no} className="flex items-center gap-2 text-[12px]">
                        <DocNo no={d.no} /> <span className="text-slate-400">{new Date(d.date).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}</span>
                      </span>
                    ))
                  ) : (
                    <span className="text-[12px] text-amber-600 font-medium">Belum ada — faktur boleh mendahului</span>
                  )}
                </div>
                <div className="p-4 rounded-xl bg-blue-50/50 border border-blue-200 flex flex-col gap-1">
                  <span className="hint text-blue-700">3. Faktur (tahap ini)</span>
                  <span className="mono font-bold text-slate-900">{p.nextNo}</span>
                  <span className="text-[11px] text-blue-700">Sedang dibuat</span>
                </div>
              </div>
            </section>
          </div>

          {/* Kanan */}
          <div className="lg:col-span-4 flex flex-col gap-4">
            <section className="card">
              <div className="card-head">
                <div className="flex items-center gap-2">
                  <Icon name="calculate" className="!text-[20px] text-blue-600" />
                  <h2 className="card-title !text-[15px]">Ringkasan Finansial</h2>
                </div>
                <span className="badge badge-slate">Tanpa PPN</span>
              </div>
              <div className="flex flex-col gap-2 text-[13px]">
                <div className="flex justify-between text-slate-500"><span>Subtotal ({calc.count} baris)</span><span className="num text-slate-900">Rp {fmt(calc.subtotal)}</span></div>
                <div className="flex justify-between text-slate-500"><span>Diskon</span><span className="num text-slate-400">—</span></div>
                <div className="flex justify-between text-slate-500 pt-1 border-t border-dashed border-slate-200"><span className="font-semibold text-slate-900">Dasar Pengenaan Pajak</span><span className="num font-semibold text-slate-900">Rp {fmt(calc.subtotal)}</span></div>
                <div className="flex justify-between text-slate-500"><span>PPN</span><span className="num text-slate-400">tidak diterapkan</span></div>
                <div className="mt-3 p-3 rounded-lg bg-blue-50/60 border border-blue-100 flex flex-col gap-1">
                  <div className="flex justify-between items-baseline">
                    <span className="eyebrow">Total Nilai Tagihan</span>
                    <span className="hint font-bold text-blue-600">Rp</span>
                  </div>
                  <div className="font-mono text-xl font-bold tracking-tight text-slate-900">Rp {fmt(calc.subtotal)}</div>
                </div>
              </div>
            </section>

            <section className="card">
              <div className="flex items-start justify-between pb-2 mb-2 border-b border-slate-100">
                <div>
                  <div className="flex items-center gap-1.5">
                    <Icon name="balance" className="!text-[18px] text-blue-600" />
                    <h3 className="text-[13px] font-semibold text-slate-900">Pratinjau Jurnal Otomatis</h3>
                  </div>
                  <span className="hint">Dicatat bersama faktur dalam 1 transaksi</span>
                </div>
                <span className={`badge ${jDebit === jCredit ? "badge-emerald" : "badge-rose"}`}>
                  <Icon name="done_all" className="!text-[14px]" /> {jDebit === jCredit ? "Seimbang" : "Tidak seimbang"}
                </span>
              </div>
              <div className="rounded border border-slate-200 overflow-hidden">
                <table className="tbl-plain text-[11px]">
                  <thead>
                    <tr>
                      <th>Akun</th>
                      <th className="text-right">Debit</th>
                      <th className="text-right">Kredit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {journalRows.map((r) => (
                      <tr key={r.acc + r.note}>
                        <td>
                          <div className="font-semibold text-slate-900">{r.acc}</div>
                          <div className="text-[10px] text-slate-500">{r.note}</div>
                        </td>
                        <td className="text-right num text-emerald-600">{r.debit ? fmt(r.debit) : "-"}</td>
                        <td className="text-right num text-rose-600">{r.credit ? fmt(r.credit) : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-50 font-bold">
                      <td>Total (Σ)</td>
                      <td className="text-right num text-emerald-600">{fmt(jDebit)}</td>
                      <td className="text-right num text-rose-600">{fmt(jCredit)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>

            <section className="card">
              <h3 className="text-[13px] font-semibold text-slate-900 flex items-center gap-1.5 mb-3">
                <Icon name="shield" className="!text-[18px] text-blue-600" /> Pengaman &amp; Validasi
              </h3>
              <div className="space-y-2 text-[13px]">
                {guards.map((g) => (
                  <div key={g.text} className="flex items-start gap-2 text-slate-700">
                    <Icon name={g.ok ? "check_circle" : "cancel"} className={`!text-[18px] mt-px ${g.ok ? "text-emerald-500" : "text-rose-500"}`} />
                    <span>{g.text}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </fieldset>
    </form>
  );
}
