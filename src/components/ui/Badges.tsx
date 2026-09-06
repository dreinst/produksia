/**
 * Label tampilan (bahasa Indonesia) untuk nilai internal enum/status.
 * Nilai di database tetap kode internal (DRAFT, PAID, …); yang tampil ke pengguna selalu Indonesia.
 */
const STATUS_STYLE: Record<string, { cls: string; label: string }> = {
  DRAFT: { cls: "badge-amber", label: "Draf" },
  CONVERTED: { cls: "badge-slate", label: "Dikonversi" },
  PARTIAL: { cls: "badge-amber", label: "Sebagian" },
  PROCESSED: { cls: "badge-blue", label: "Diproses" },
  PAID: { cls: "badge-emerald", label: "Lunas" },
  CANCELLED: { cls: "badge-rose", label: "Dibatalkan" },
  POSTED: { cls: "badge-emerald", label: "Tercatat" },
  AKTIF: { cls: "badge-emerald", label: "Aktif" },
  DIJUAL: { cls: "badge-slate", label: "Dijual" },
  DIHAPUS: { cls: "badge-rose", label: "Dihapus" },
  OPEN: { cls: "badge-blue", label: "Berjalan" },
};

export function statusLabel(status: string) {
  return STATUS_STYLE[status]?.label ?? status;
}

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? { cls: "badge-slate", label: status };
  return <span className={`badge ${s.cls}`}>{s.label}</span>;
}

const PAYMENT_LABEL: Record<string, string> = { CASH: "Tunai", TRANSFER: "Transfer", CARD: "Kartu" };
export function labelPaymentMethod(v: string) {
  return PAYMENT_LABEL[v] ?? v;
}

const SOURCE_LABEL: Record<string, string> = {
  MANUAL: "Jurnal manual",
  KAS_MASUK: "Kas masuk",
  KAS_KELUAR: "Kas keluar",
  PENJUALAN: "Penjualan",
  PEMBELIAN: "Pembelian",
  PENYUSUTAN: "Penyusutan",
};
export function labelJournalSource(v: string) {
  return SOURCE_LABEL[v] ?? v;
}

/**
 * Kode dokumen (semua singkatan Indonesia):
 * PNW Penawaran · PSJ Pesanan Penjualan · SJ Surat Jalan · FJ Faktur Penjualan · TRM Penerimaan · RJ Retur Penjualan
 * PSB Pesanan Pembelian · TB Terima Barang · FB Faktur Pembelian · BYR Pembayaran · RB Retur Pembelian
 * JU Jurnal Umum · KM Kas Masuk · KK Kas Keluar · AT Aset Tetap
 */
const DOC_STYLE: Record<string, string> = {
  PNW: "bg-slate-100 text-slate-700",
  PSJ: "bg-indigo-50 text-indigo-700",
  SJ: "bg-cyan-50 text-cyan-700",
  FJ: "bg-blue-50 text-blue-700",
  TRM: "bg-emerald-50 text-emerald-700",
  RJ: "bg-rose-50 text-rose-700",
  PSB: "bg-indigo-50 text-indigo-700",
  TB: "bg-cyan-50 text-cyan-700",
  FB: "bg-slate-100 text-slate-700",
  BYR: "bg-emerald-50 text-emerald-700",
  RB: "bg-rose-50 text-rose-700",
  JU: "bg-slate-100 text-slate-700",
  KM: "bg-emerald-50 text-emerald-700",
  KK: "bg-rose-50 text-rose-700",
  AT: "bg-amber-50 text-amber-700",
};

/** Nomor dokumen: badge prefix berwarna + nomor monospace, mis. [FJ] FJ-2026-0001 */
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
