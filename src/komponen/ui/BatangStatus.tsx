/**
 * Batang horizontal per status (corong, jumlah per status). Lebar = nilai ÷ max(1, Σ nilai) × 100%.
 * cls mengganti warna isi batang (bawaan bg-blue-600).
 */
export default function BatangStatus({ data, label }: { data: { label: string; nilai: number; cls?: string }[]; label?: string }) {
  const total = Math.max(1, data.reduce((s, d) => s + d.nilai, 0));
  return (
    <ul className="space-y-2.5" aria-label={label}>
      {data.map((d) => (
        <li key={d.label} className="text-xs">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-slate-600 truncate">{d.label}</span>
            <span className="angka font-semibold text-slate-800">{d.nilai.toLocaleString("id-ID")}</span>
          </div>
          <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
            <div className={`h-full rounded-full ${d.cls ?? "bg-blue-600"}`} style={{ width: `${(d.nilai / total) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
