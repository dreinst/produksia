/** Kerangka halaman saat data dimuat: bentuk kepala halaman, tiga kartu ringkasan, dan satu tabel. */
export default function Memuat() {
  return (
    <div className="space-y-6" aria-label="Memuat" aria-busy="true">
      <div className="space-y-2">
        <div className="kerlip h-3 w-24" />
        <div className="kerlip h-7 w-64" />
        <div className="kerlip h-3 w-96 max-w-full" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="kartu space-y-3">
            <div className="kerlip h-3 w-32" />
            <div className="kerlip h-7 w-40" />
          </div>
        ))}
      </div>
      <div className="kartu kartu-tabel">
        <div className="p-5 space-y-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="kerlip h-4" style={{ width: `${88 - i * 6}%` }} />
          ))}
        </div>
      </div>
    </div>
  );
}
