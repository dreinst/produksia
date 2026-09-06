import Link from "next/link";
import Icon from "@/components/ui/Icon";
import type { ReactNode } from "react";

type Crumb = { label: string; href?: string };

/**
 * Kepala halaman ala Stitch: breadcrumb kecil → judul + badge → tombol aksi di kanan.
 */
export default function PageHeader({
  crumbs,
  title,
  subtitle,
  badges,
  actions,
}: {
  crumbs?: Crumb[];
  title: string;
  subtitle?: string;
  badges?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
      <div className="min-w-0">
        {crumbs && crumbs.length > 0 && (
          <nav className="flex items-center gap-1 text-xs text-slate-500 mb-1" aria-label="Breadcrumb">
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <Icon name="chevron_right" className="!text-[14px] text-slate-400" />}
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
          <h1 className="page-title">{title}</h1>
          {badges}
        </div>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 self-start lg:self-center">{actions}</div>}
    </div>
  );
}
