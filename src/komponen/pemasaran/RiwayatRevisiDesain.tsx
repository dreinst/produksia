import type { Prisma } from "@/prisma-klien/client";
import type { KeputusanRevisiDesain } from "@/prisma-klien/enums";
import { db } from "@/lib/db";
import { bacaBerkasRevisi } from "@/lib/desain";
import { formatWaktu } from "@/lib/waktu";
import { LencanaKeputusanRevisi } from "@/komponen/pemasaran/LencanaPemasaran";

type BarisRevisi = {
  id: string;
  nomorRevisi: number;
  keputusan: KeputusanRevisiDesain;
  catatan: string | null;
  berkasSebelumnya: Prisma.JsonValue;
  berkasBaru: Prisma.JsonValue;
  peninjauNama: string;
  dibuatPada: Date;
};

/**
 * Riwayat revisi desain (D6 §7.5 no. 7), terbaru dulu. Nama berkas dibaca dari salinan JSON, jadi tetap terbaca walau
 * berkasnya sudah dibuang; yang masih ada menaut ke /api/berkas/{id} (hak lihat diperiksa rute itu).
 */
export default async function RiwayatRevisiDesain({ revisi }: { revisi: BarisRevisi[] }) {
  if (revisi.length === 0) return <p className="text-sm text-slate-500">Belum ada tinjauan.</p>;
  const baris = revisi.map((r) => ({ ...r, sebelumnya: bacaBerkasRevisi(r.berkasSebelumnya), baru: bacaBerkasRevisi(r.berkasBaru) }));
  const semuaId = [...new Set(baris.flatMap((r) => [...r.sebelumnya, ...r.baru].map((b) => b.id)))];
  const ada = new Set(
    semuaId.length ? (await db.berkas.findMany({ where: { id: { in: semuaId }, dihapusPada: null, isiDihapusPada: null }, select: { id: true } })).map((b) => b.id) : [],
  );
  const daftarNama = (berkas: { id: string; nama: string }[]) => (
    <>
      {berkas.map((b, i) => (
        <span key={`${b.id}-${i}`}>
          {i > 0 && ", "}
          {ada.has(b.id) ? (
            <a href={`/api/berkas/${b.id}`} target="_blank" rel="noopener noreferrer" className="tombol-tautan">
              {b.nama}
            </a>
          ) : (
            <span className="text-slate-500">{b.nama}</span>
          )}
        </span>
      ))}
    </>
  );

  return (
    <ol className="divide-y divide-slate-100">
      {baris.map((r) => (
        <li key={r.id} className="py-2 text-sm space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mono font-semibold text-slate-700">#{r.nomorRevisi}</span>
            <LencanaKeputusanRevisi keputusan={r.keputusan} />
            <span className="font-medium text-slate-800">{r.peninjauNama}</span>
            <span className="text-xs text-slate-500">{formatWaktu(r.dibuatPada)}</span>
          </div>
          {r.catatan && <p className="whitespace-pre-line break-words text-slate-600">{r.catatan}</p>}
          <p className="text-xs text-slate-500">
            {r.sebelumnya.length} berkas sebelumnya · {r.baru.length} berkas baru
          </p>
          {r.baru.length > 0 && (
            <p className="text-xs text-slate-600">
              Baru: {daftarNama(r.baru)}
            </p>
          )}
          {r.sebelumnya.length > 0 && (
            <p className="text-xs text-slate-600">
              Sebelumnya: {daftarNama(r.sebelumnya)}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}
