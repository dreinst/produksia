import Link from "next/link";
import Ikon from "@/komponen/ui/Ikon";
import type { ReactNode } from "react";

type Jejak = { label: string; href?: string };

/**
 * Kepala halaman ala Stitch: breadcrumb kecil → judul + lencana → tombol aksi di kanan.
 */
export default function KepalaHalaman({
  jejak,
  judul,
  subjudul,
  lencana,
  aksi,
}: {
  jejak?: Jejak[];
  judul: string;
  subjudul?: string;
  lencana?: ReactNode;
  aksi?: ReactNode;
}) {
  return (
    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
      <div className="min-w-0">
        {jejak && jejak.length > 0 && (
          <nav className="flex items-center gap-1 text-xs text-slate-500 mb-1" aria-label="Breadcrumb">
            {jejak.map((c, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <Ikon nama="chevron_right" className="!text-[14px] text-slate-400" />}
                {c.href ? (
                  <Link href={c.href} className="hover:text-slate-900 transition-colors">
                    {c.label}
                  </Link>
                ) : (
                  <span className="font-semibold text-slate-800">{c.label}</span>
                )}
              </span>
            ))}
          </nav>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="judul-halaman">{judul}</h1>
          {lencana}
        </div>
        {subjudul && <p className="page-subjudul">{subjudul}</p>}
      </div>
      {aksi && <div className="flex flex-wrap items-center gap-2 self-start lg:self-center">{aksi}</div>}
    </div>
  );
}
