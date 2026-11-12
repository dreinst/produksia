import Link from "next/link";

/**
 * Tab berupa tautan GET (D5 §7.3): tab aktif ditandai aria-current="page". Tanpa JavaScript, jadi isi tab dirender
 * server sesuai parameter URL.
 */
export default function TabTautan({ aktif, daftar, label = "Bagian halaman" }: { aktif: string; daftar: { kunci: string; label: string; href: string; ikon?: string }[]; label?: string }) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-1 border-b border-slate-200">
      {daftar.map((t) => {
        const ya = t.kunci === aktif;
        return (
          <Link
            key={t.kunci}
            href={t.href}
            aria-current={ya ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold min-h-11 inline-flex items-center ${ya ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300"}`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
