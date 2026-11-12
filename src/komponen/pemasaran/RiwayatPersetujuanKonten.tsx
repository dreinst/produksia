import type { AksiRiwayatKonten } from "@/prisma-klien/enums";
import { formatWaktu } from "@/lib/waktu";
import { LencanaAksiRiwayat } from "@/komponen/pemasaran/LencanaPemasaran";

/** Riwayat persetujuan konten (D6 §7.3 no. 5), terbaru dulu: lencana aksi, nama, waktu, dan masukan. */
export default function RiwayatPersetujuanKonten({
  riwayat,
}: {
  riwayat: { id: string; aksi: AksiRiwayatKonten; masukan: string | null; penggunaNama: string; dibuatPada: Date }[];
}) {
  if (riwayat.length === 0) return <p className="text-sm text-slate-500">Belum ada riwayat persetujuan.</p>;
  return (
    <ol className="divide-y divide-slate-100">
      {riwayat.map((r) => (
        <li key={r.id} className="py-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <LencanaAksiRiwayat aksi={r.aksi} />
            <span className="font-medium text-slate-800">{r.penggunaNama}</span>
            <span className="text-xs text-slate-500">{formatWaktu(r.dibuatPada)}</span>
          </div>
          {r.masukan && <p className="mt-1 whitespace-pre-line break-words text-slate-600">{r.masukan}</p>}
        </li>
      ))}
    </ol>
  );
}
