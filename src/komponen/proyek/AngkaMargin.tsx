/**
 * Angka margin (D5 §7.3, padanan Margin HKA): rose bila negatif, persen kecil di sampingnya bila ada.
 */
export default function AngkaMargin({ nilai, persen }: { nilai: { toString(): string }; persen?: { toString(): string } | null }) {
  const n = Number(nilai.toString());
  return (
    <span className={`angka whitespace-nowrap ${n < 0 ? "text-rose-700" : ""}`}>
      {n.toLocaleString("id-ID")}
      {persen !== undefined && persen !== null && (
        <span className={`ml-1 text-xs ${n < 0 ? "text-rose-600" : "text-slate-500"}`}>({Number(persen.toString()).toLocaleString("id-ID", { maximumFractionDigits: 1 })}%)</span>
      )}
    </span>
  );
}
