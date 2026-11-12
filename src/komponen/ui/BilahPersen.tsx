/**
 * Bilah persen terpakai (D5 §7.3): lebar min(100, persen)%, biru, atau rose bila lebih. persen null = bilah kosong.
 */
export default function BilahPersen({ persen, lebih }: { persen: number | null; lebih: boolean }) {
  const lebar = persen === null ? 0 : Math.max(0, Math.min(100, persen));
  return (
    <div className="flex items-center gap-2 min-w-[7rem]">
      <div className="h-1.5 flex-1 rounded-full bg-slate-100" role="presentation">
        <div className={`h-1.5 rounded-full ${lebih ? "bg-rose-600" : "bg-blue-600"}`} style={{ width: `${lebar}%` }} />
      </div>
      <span className={`text-xs angka w-12 text-right ${lebih ? "text-rose-700" : "text-slate-500"}`}>{persen === null ? "-" : `${persen.toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`}</span>
    </div>
  );
}
