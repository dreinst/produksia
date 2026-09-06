const STATUS_STYLE: Record<string, { cls: string; label: string }> = {
  DRAFT: { cls: "badge-amber", label: "DRAFT" },
  CONVERTED: { cls: "badge-slate", label: "CONVERTED" },
  PARTIAL: { cls: "badge-amber", label: "PARTIAL" },
  PROCESSED: { cls: "badge-blue", label: "PROCESSED" },
  PAID: { cls: "badge-emerald", label: "PAID" },
  CANCELLED: { cls: "badge-rose", label: "CANCELLED" },
  AKTIF: { cls: "badge-emerald", label: "AKTIF" },
  DIJUAL: { cls: "badge-slate", label: "DIJUAL" },
  DIHAPUS: { cls: "badge-rose", label: "DIHAPUS" },
  OPEN: { cls: "badge-blue", label: "OPEN" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? { cls: "badge-slate", label: status };
  return <span className={`badge ${s.cls}`}>{s.label}</span>;
}

const DOC_STYLE: Record<string, string> = {
  SQ: "bg-slate-100 text-slate-700",
  SO: "bg-indigo-50 text-indigo-700",
  DO: "bg-cyan-50 text-cyan-700",
  INV: "bg-blue-50 text-blue-700",
  RCP: "bg-emerald-50 text-emerald-700",
  RET: "bg-rose-50 text-rose-700",
  PO: "bg-indigo-50 text-indigo-700",
  GR: "bg-cyan-50 text-cyan-700",
  PINV: "bg-slate-100 text-slate-700",
  PP: "bg-emerald-50 text-emerald-700",
  PRET: "bg-rose-50 text-rose-700",
  JU: "bg-slate-100 text-slate-700",
  KM: "bg-emerald-50 text-emerald-700",
  KK: "bg-rose-50 text-rose-700",
  AT: "bg-amber-50 text-amber-700",
};

/** Nomor dokumen: badge prefix berwarna + nomor monospace, mis. [INV] INV-2026-0001 */
export function DocNo({ no }: { no: string }) {
  const m = /^([A-Z]+)(?:-[A-Z]+)*-/.exec(no);
  const prefix = no.startsWith("JU-") ? "JU" : (m?.[1] ?? "");
  const cls = DOC_STYLE[prefix] ?? "bg-slate-100 text-slate-700";
  return (
    <span className="inline-flex items-center gap-2">
      {prefix && <span className={`doc-badge ${cls}`}>{prefix}</span>}
      <span className="mono font-semibold text-slate-900">{no}</span>
    </span>
  );
}

/** Format rupiah ringkas untuk tabel: 1.234.567 */
export function Rp({ value, className = "" }: { value: number | string | { toString(): string }; className?: string }) {
  const n = typeof value === "number" ? value : Number(value.toString());
  return <span className={`num ${className}`}>{n.toLocaleString("id-ID")}</span>;
}
