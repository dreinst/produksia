import { NomorDokumen } from "@/komponen/ui/Lencana";

/** Nomor internal dokumen (lencana + mono) dengan nomor cetak di bawahnya bila ada (D2 §7.2). */
export default function NomorDokumenCetak({ nomor, nomorCetak }: { nomor: string; nomorCetak?: string | null }) {
  return (
    <span className="inline-flex flex-col gap-0.5">
      <NomorDokumen nomor={nomor} />
      {nomorCetak && <span className="mono text-[11px] text-slate-500">{nomorCetak}</span>}
    </span>
  );
}
