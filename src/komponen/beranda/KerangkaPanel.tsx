/** Kerangka kerlip selama panel tab beranda dimuat (pola KerangkaTren). */
export default function KerangkaPanel() {
  return (
    <div className="space-y-5" aria-busy="true">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="kartu space-y-3">
            <div className="kerlip h-4 w-28" />
            <div className="kerlip h-7 w-36" />
          </div>
        ))}
      </div>
      <div className="kartu space-y-4">
        <div className="kerlip h-5 w-64" />
        <div className="kerlip h-40" />
      </div>
    </div>
  );
}
