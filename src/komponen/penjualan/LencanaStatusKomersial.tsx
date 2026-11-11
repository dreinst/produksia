import type { StatusKomersial } from "@/prisma-klien/enums";

/** Label dan warna status klien penawaran (D2 §7.2). */
export const GAYA_STATUS_KOMERSIAL: Record<StatusKomersial, { label: string; cls: string }> = {
  DRAF: { label: "Belum dikirim", cls: "lencana-slate" },
  TERKIRIM: { label: "Terkirim", cls: "lencana-blue" },
  DITERIMA: { label: "Diterima", cls: "lencana-emerald" },
  DITOLAK: { label: "Ditolak", cls: "lencana-rose" },
  KEDALUWARSA: { label: "Kedaluwarsa", cls: "lencana-amber" },
};

export const DAFTAR_STATUS_KOMERSIAL = Object.keys(GAYA_STATUS_KOMERSIAL) as StatusKomersial[];

export default function LencanaStatusKomersial({ status }: { status: StatusKomersial }) {
  const s = GAYA_STATUS_KOMERSIAL[status] ?? { label: status, cls: "lencana-slate" };
  return (
    <span className={`lencana ${s.cls}`} title="Status klien">
      {s.label}
    </span>
  );
}
