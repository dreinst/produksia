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
  // CRM (D4 §7.6): tindak lanjut MENUNGGU yang jatuh temponya sudah lewat
  TERLAMBAT: { cls: "lencana-rose", label: "Terlambat" },
  // Status bersama (D4 §7.6, D5 §3.1, DESAIN F17): tiap kunci ditulis sekali. BERJALAN dan SELESAI dipakai tahap
  // lead dan status proyek; MENUNGGU dipakai tindak lanjut CRM (persetujuan dokumen tetap lewat LencanaPersetujuan).
  BERJALAN: { cls: "lencana-blue", label: "Berjalan" },
  SELESAI: { cls: "lencana-emerald", label: "Selesai" },
  MENUNGGU: { cls: "lencana-amber", label: "Menunggu" },
  MENANG: { cls: "lencana-emerald", label: "Menang" },
  KALAH: { cls: "lencana-rose", label: "Kalah" },
  // Status proyek (D5 §3.1; DIARSIP berlabel "Diarsipkan" seperti LABEL_STATUS_PROYEK)
  DITUNDA: { cls: "lencana-amber", label: "Ditunda" },
  DIARSIP: { cls: "lencana-slate", label: "Diarsipkan" },
  BATAL: { cls: "lencana-rose", label: "Batal" },
  // Status pembayaran mitra proyek (D5 §3.13; LUNAS sudah ada di atas)
  LEBIH_BAYAR: { cls: "lencana-rose", label: "Lebih bayar" },
  DIBAYAR_SEBAGIAN: { cls: "lencana-blue", label: "Sebagian dibayar" },
  PERLU_DIBAYAR: { cls: "lencana-amber", label: "Perlu dibayar" },
  BELUM_ADA_HAK: { cls: "lencana-slate", label: "Belum ada hak" },
};

export function LencanaStatus({ status }: { status: string }) {
  const s = GAYA_STATUS[status] ?? { cls: "lencana-slate", label: status };
  return <span className={`lencana ${s.cls}`}>{s.label}</span>;
}

/** Label Indonesia status yang sama dengan LencanaStatus (kode mentah bila tidak dikenal), untuk teks opsi dan ringkasan. */
export function labelStatus(status: string): string {
  return GAYA_STATUS[status]?.label ?? status;
}

/** Status alur persetujuan (maker-checker); DISETUJUI = jurnalnya sudah masuk buku besar. */
const GAYA_PERSETUJUAN: Record<string, { cls: string; label: string; judul: string }> = {
  DRAFT: { cls: "lencana-slate", label: "Draf", judul: "Belum diajukan; belum ada jurnal di buku besar" },
  MENUNGGU: { cls: "lencana-amber", label: "Menunggu", judul: "Sudah diajukan, menunggu persetujuan; belum ada jurnal" },
  DISETUJUI: { cls: "lencana-emerald", label: "Disetujui", judul: "Sudah disetujui; jurnalnya sudah masuk buku besar" },
  DITOLAK: { cls: "lencana-rose", label: "Ditolak", judul: "Ditolak pemeriksa; tidak ada jurnal yang dicatat" },
};

export function LencanaPersetujuan({ status }: { status: string }) {
  const s = GAYA_PERSETUJUAN[status] ?? { cls: "lencana-slate", label: status, judul: status };
  return (
    <span className={`lencana ${s.cls}`} title={s.judul}>
      {s.label}
    </span>
  );
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
  PERSEDIAAN: "Persediaan",
  ASET_TETAP: "Aset tetap",
  PENUTUP: "Penutup tahun",
  PAJAK: "Pajak",
  PRIVE: "Prive",
  PENGGAJIAN: "Penggajian",
  SELISIH_KURS: "Selisih kurs",
  ANTAR_PERUSAHAAN: "Antar perusahaan",
  MITRA_PROYEK: "Mitra proyek",
};
export function labelSumberJurnal(v: string) {
  return LABEL_SUMBER[v] ?? v;
}

/**
 * Kode dokumen (semua singkatan Indonesia):
 * PNW Penawaran · PSJ Pesanan Penjualan · SJ Surat Jalan · FJ Faktur Penjualan · TRM Penerimaan · RJ Retur Penjualan
 * PSB Pesanan Pembelian · TB Terima Barang · FB Faktur Pembelian · BYR Pembayaran · RB Retur Pembelian
 * JU Jurnal Umum · KM Kas Masuk · KK Kas Keluar · AT Aset Tetap
 * AP Transaksi Antar Perusahaan · TLM Talangan Mitra · BYM Pembayaran ke Mitra
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
  PB: "bg-blue-50 text-blue-700",
  PRV: "bg-amber-50 text-amber-700",
  AP: "bg-indigo-50 text-indigo-700",
  TLM: "bg-amber-50 text-amber-700",
  BYM: "bg-rose-50 text-rose-700",
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
