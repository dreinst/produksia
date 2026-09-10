/**
 * Label tampilan (bahasa Indonesia) untuk nilai internal enum/status.
 * Nilai di database tetap kode internal (DRAF, LUNAS, …); yang tampil ke pengguna selalu Indonesia.
 */
const GAYA_STATUS: Record<string, { cls: string; label: string }> = {
  DRAF: { cls: "lencana-amber", label: "Draf" },
  DIKONVERSI: { cls: "lencana-slate", label: "Dikonversi" },
  SEBAGIAN: { cls: "lencana-amber", label: "Sebagian" },
  DIPROSES: { cls: "lencana-blue", label: "Diproses" },
  LUNAS: { cls: "lencana-emerald", label: "Lunas" },
  DIBATALKAN: { cls: "lencana-rose", label: "Dibatalkan" },
  TERCATAT: { cls: "lencana-emerald", label: "Tercatat" },
  AKTIF: { cls: "lencana-emerald", label: "Aktif" },
  DIJUAL: { cls: "lencana-slate", label: "Dijual" },
  DIHAPUS: { cls: "lencana-rose", label: "Dihapus" },
  OPEN: { cls: "lencana-blue", label: "Berjalan" },
};

export function labelStatus(status: string) {
  return GAYA_STATUS[status]?.label ?? status;
}

export function LencanaStatus({ status }: { status: string }) {
  const s = GAYA_STATUS[status] ?? { cls: "lencana-slate", label: status };
  return <span className={`lencana ${s.cls}`}>{s.label}</span>;
}

const LABEL_BAYAR: Record<string, string> = { TUNAI: "Tunai", TRANSFER: "Transfer", KARTU: "Kartu" };
export function labelMetodeBayar(v: string) {
  return LABEL_BAYAR[v] ?? v;
}

const LABEL_SUMBER: Record<string, string> = {
  MANUAL: "Jurnal manual",
  KAS_MASUK: "Kas masuk",
  KAS_KELUAR: "Kas keluar",
  PENJUALAN: "Penjualan",
  PEMBELIAN: "Pembelian",
  PENYUSUTAN: "Penyusutan",
};
export function labelSumberJurnal(v: string) {
  return LABEL_SUMBER[v] ?? v;
}

/**
 * Kode dokumen (semua singkatan Indonesia):
 * PNW Penawaran · PSJ Pesanan Penjualan · SJ Surat Jalan · FJ Faktur Penjualan · TRM Penerimaan · RJ Retur Penjualan
 * PSB Pesanan Pembelian · TB Terima Barang · FB Faktur Pembelian · BYR Pembayaran · RB Retur Pembelian
 * JU Jurnal Umum · KM Kas Masuk · KK Kas Keluar · AT Aset Tetap
 */
const GAYA_DOKUMEN: Record<string, string> = {
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
  UM: "bg-emerald-50 text-emerald-700",
};

/** Nomor dokumen: lencana prefix berwarna + nomor monospace, mis. [FJ] FJ-2026-0001 */
export function NomorDokumen({ nomor }: { nomor: string }) {
  const m = /^([A-Z]+)(?:-[A-Z]+)*-/.exec(nomor);
  const prefix = nomor.startsWith("JU-") ? "JU" : (m?.[1] ?? "");
  const cls = GAYA_DOKUMEN[prefix] ?? "bg-slate-100 text-slate-700";
  return (
    <span className="inline-flex items-center gap-2">
      {prefix && <span className={`doc-lencana ${cls}`}>{prefix}</span>}
      <span className="mono font-semibold text-slate-900">{nomor}</span>
    </span>
  );
}

/** Format rupiah ringkas untuk tabel: 1.234.567 */
export function Rp({ nilai, className = "" }: { nilai: number | string | { toString(): string }; className?: string }) {
  const n = typeof nilai === "number" ? nilai : Number(nilai.toString());
  return <span className={`angka ${className}`}>{n.toLocaleString("id-ID")}</span>;
}
