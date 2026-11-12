import { LABEL_JENIS_AKTIVITAS, teksAktivitas } from "@/lib/crm";
import { formatWaktu } from "@/lib/waktu";
import type { JenisAktivitasLead } from "@/prisma-klien/enums";

/*
 * Linimasa aktivitas lead (D4 §3.6): lencana jenis, teks yang dirangkai teksAktivitas (meta rusak memberi "?"),
 * pelaku dan waktu. Catatan dicetak apa adanya dengan baris barunya.
 */

export type AktivitasTampil = { id: string; jenis: JenisAktivitasLead; meta: unknown; isi: string | null; penggunaNama: string; dibuatPada: Date };

export default function LinimasaLead({ daftar }: { daftar: AktivitasTampil[] }) {
  if (daftar.length === 0) return <p className="text-sm text-slate-500">Belum ada aktivitas.</p>;
  return (
    <ol className="divide-y divide-slate-100">
      {daftar.map((a) => {
        const lencana = LABEL_JENIS_AKTIVITAS[a.jenis] ?? { label: a.jenis, cls: "lencana lencana-slate" };
        return (
          <li key={a.id} className="py-3 flex items-start gap-3">
            <span className={`${lencana.cls} shrink-0`}>{lencana.label}</span>
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className={`text-sm text-slate-800 break-words ${a.jenis === "CATATAN" ? "whitespace-pre-line" : ""}`}>{teksAktivitas(a)}</p>
              <p className="text-xs text-slate-500">
                {a.penggunaNama} · {formatWaktu(a.dibuatPada)}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
