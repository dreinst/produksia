"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { masterEntities } from "@/lib/masterConfig";

type NavLink = { href: string; label: string };
type Section = { title: string; icon: string; links: NavLink[] };

const persediaanOrder = ["items", "categories", "warehouses"];
const daftarOrder = ["customers", "suppliers", "employees", "departments", "projects", "accounts"];

function masterLinks(order: string[]): NavLink[] {
  return order
    .map((slug) => masterEntities.find((e) => e.slug === slug))
    .filter((e): e is NonNullable<typeof e> => Boolean(e))
    .map((e) => ({ href: `/master/${e.slug}`, label: e.label }));
}

// 7 menu utama — urutannya mengikuti alur kerja: transaksi dulu, lalu pembukuan, lalu master data.
const sections: Section[] = [
  {
    title: "Penjualan",
    icon: "🧾",
    links: [
      { href: "/sales/quotations", label: "Penawaran Penjualan" },
      { href: "/sales/orders", label: "Pesanan Penjualan" },
      { href: "/sales/deliveries", label: "Pengiriman Pesanan" },
      { href: "/sales/invoices", label: "Faktur Penjualan" },
      { href: "/sales/receipts", label: "Penerimaan Penjualan" },
      { href: "/sales/returns", label: "Retur Penjualan" },
    ],
  },
  {
    title: "Pembelian",
    icon: "🛒",
    links: [
      { href: "/purchasing/orders", label: "Pesanan Pembelian" },
      { href: "/purchasing/receipts", label: "Penerimaan Barang" },
      { href: "/purchasing/invoices", label: "Faktur Pembelian" },
      { href: "/purchasing/payments", label: "Pembayaran Pembelian" },
      { href: "/purchasing/returns", label: "Retur Pembelian" },
    ],
  },
  {
    title: "Kas & Bank",
    icon: "💵",
    links: [
      { href: "/cashbank/in", label: "Kas Masuk" },
      { href: "/cashbank/out", label: "Kas Keluar" },
    ],
  },
  {
    title: "Buku Besar",
    icon: "📒",
    links: [
      { href: "/ledger/journal", label: "Jurnal Umum" },
      { href: "/ledger/general-ledger", label: "Buku Besar" },
      { href: "/ledger/trial-balance", label: "Neraca Saldo" },
      { href: "/settings/account-mapping", label: "Pemetaan Akun" },
    ],
  },
  {
    title: "Aset Tetap",
    icon: "🏭",
    links: [
      { href: "/assets", label: "Daftar Aset" },
      { href: "/assets/depreciation", label: "Penyusutan" },
    ],
  },
  { title: "Persediaan", icon: "📦", links: masterLinks(persediaanOrder) },
  { title: "Daftar", icon: "📇", links: masterLinks(daftarOrder) },
];

function isActive(pathname: string, href: string) {
  if (href === "/assets") return pathname === "/assets" || pathname === "/assets/new";
  return pathname === href || pathname.startsWith(href + "/");
}

/**
 * Accordion 7 menu utama. Hanya satu yang terbuka; default = menu yang memuat halaman aktif.
 * Di-render dengan key={pathname} dari Sidebar supaya state-nya reset tiap pindah halaman
 * (tanpa useEffect).
 */
function NavAccordion({ pathname, onNavigate }: { pathname: string; onNavigate: () => void }) {
  const activeTitle = sections.find((s) => s.links.some((l) => isActive(pathname, l.href)))?.title ?? null;
  const [openTitle, setOpenTitle] = useState<string | null>(activeTitle);

  return (
    <nav className="space-y-1 text-sm" aria-label="Menu utama">
      <Link
        href="/"
        onClick={onNavigate}
        aria-current={pathname === "/" ? "page" : undefined}
        className={`flex items-center gap-2 rounded px-2 py-2 ${
          pathname === "/" ? "bg-zinc-900 font-medium text-white" : "text-zinc-700 hover:bg-zinc-100"
        }`}
      >
        <span aria-hidden="true">🏠</span> Dashboard
      </Link>

      {sections.map((s) => {
        const open = openTitle === s.title;
        const containsActive = s.title === activeTitle;
        const panelId = `nav-${s.title.replace(/\W+/g, "-").toLowerCase()}`;
        return (
          <div key={s.title}>
            <button
              type="button"
              onClick={() => setOpenTitle(open ? null : s.title)}
              aria-expanded={open}
              aria-controls={panelId}
              className={`flex w-full items-center gap-2 rounded px-2 py-2 text-left ${
                containsActive && !open ? "font-medium text-zinc-900" : "text-zinc-700"
              } hover:bg-zinc-100`}
            >
              <span aria-hidden="true">{s.icon}</span>
              <span className="flex-1">{s.title}</span>
              <span
                aria-hidden="true"
                className={`text-xs text-zinc-400 transition-transform ${open ? "rotate-90" : ""}`}
              >
                ▶
              </span>
            </button>

            {open && (
              <ul id={panelId} className="mt-0.5 mb-1 ml-3 space-y-0.5 border-l pl-2">
                {s.links.map((l) => {
                  const active = isActive(pathname, l.href);
                  return (
                    <li key={l.href}>
                      <Link
                        href={l.href}
                        onClick={onNavigate}
                        aria-current={active ? "page" : undefined}
                        className={`block rounded px-2 py-1.5 ${
                          active ? "bg-zinc-900 font-medium text-white" : "text-zinc-600 hover:bg-zinc-100"
                        }`}
                      >
                        {l.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeDrawer = () => setDrawerOpen(false);

  return (
    <>
      {/* Top bar - hanya mobile */}
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b bg-white px-4 py-3 md:hidden">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Buka menu"
          aria-expanded={drawerOpen}
          className="rounded border px-3 py-1.5 text-sm"
        >
          ☰ Menu
        </button>
        <Link href="/" className="font-semibold">
          Accurate Copy
        </Link>
      </header>

      {/* Overlay - mobile */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={closeDrawer} aria-hidden="true" />
      )}

      {/* Drawer (mobile) / sidebar tetap (desktop) */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] overflow-y-auto border-r bg-white p-4 transition-transform duration-200
          md:sticky md:top-0 md:z-auto md:h-screen md:w-64 md:max-w-none md:translate-x-0 md:shrink-0
          ${drawerOpen ? "translate-x-0" : "-translate-x-full"}`}
        aria-label="Navigasi utama"
      >
        <div className="mb-4 flex items-center justify-between px-2">
          <Link href="/" className="font-semibold" onClick={closeDrawer}>
            Accurate Copy
          </Link>
          <button
            type="button"
            onClick={closeDrawer}
            aria-label="Tutup menu"
            className="rounded px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 md:hidden"
          >
            ✕
          </button>
        </div>
        <NavAccordion key={pathname} pathname={pathname} onNavigate={closeDrawer} />
      </aside>
    </>
  );
}
