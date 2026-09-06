"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import Icon from "@/components/ui/Icon";

type NavLink = { href: string; label: string; code?: string };
type Group = { title: string; icon: string; links: NavLink[] };

const operasional: Group[] = [
  {
    title: "Penjualan",
    icon: "point_of_sale",
    links: [
      { href: "/sales/quotations", label: "Penawaran", code: "SQ" },
      { href: "/sales/orders", label: "Pesanan", code: "SO" },
      { href: "/sales/deliveries", label: "Pengiriman", code: "DO" },
      { href: "/sales/invoices", label: "Faktur Penjualan", code: "INV" },
      { href: "/sales/receipts", label: "Penerimaan", code: "RCP" },
      { href: "/sales/returns", label: "Retur Penjualan", code: "RET" },
    ],
  },
  {
    title: "Pembelian",
    icon: "shopping_bag",
    links: [
      { href: "/purchasing/orders", label: "Pesanan", code: "PO" },
      { href: "/purchasing/receipts", label: "Penerimaan Barang", code: "GR" },
      { href: "/purchasing/invoices", label: "Faktur Pembelian", code: "PINV" },
      { href: "/purchasing/payments", label: "Pembayaran", code: "PP" },
      { href: "/purchasing/returns", label: "Retur Pembelian", code: "PRET" },
    ],
  },
  {
    title: "Kas & Bank",
    icon: "account_balance",
    links: [
      { href: "/cashbank/in", label: "Kas Masuk", code: "KM" },
      { href: "/cashbank/out", label: "Kas Keluar", code: "KK" },
    ],
  },
  {
    title: "Buku Besar",
    icon: "menu_book",
    links: [
      { href: "/ledger/journal", label: "Jurnal Umum", code: "JU" },
      { href: "/ledger/general-ledger", label: "Buku Besar Mutasi" },
      { href: "/ledger/trial-balance", label: "Neraca Saldo" },
    ],
  },
  {
    title: "Aset Tetap",
    icon: "domain",
    links: [
      { href: "/assets", label: "Daftar Aset" },
      { href: "/assets/depreciation", label: "Hitung Penyusutan", code: "PNY" },
    ],
  },
];

const masterData: Group = {
  title: "Master Data",
  icon: "dataset",
  links: [
    { href: "/master/customers", label: "Pelanggan" },
    { href: "/master/suppliers", label: "Pemasok" },
    { href: "/master/items", label: "Barang & Jasa" },
    { href: "/master/categories", label: "Group Barang" },
    { href: "/master/warehouses", label: "Gudang" },
    { href: "/master/accounts", label: "Bagan Akun", code: "COA" },
    { href: "/master/departments", label: "Departemen" },
    { href: "/master/employees", label: "Karyawan" },
    { href: "/master/projects", label: "Proyek" },
  ],
};

const allGroups = [...operasional, masterData];

function isActive(pathname: string, href: string) {
  if (href === "/assets") return pathname === "/assets" || pathname === "/assets/new";
  return pathname === href || pathname.startsWith(href + "/");
}

function NavGroup({
  group,
  pathname,
  open,
  onToggle,
  onNavigate,
}: {
  group: Group;
  pathname: string;
  open: boolean;
  onToggle: () => void;
  onNavigate: () => void;
}) {
  const containsActive = group.links.some((l) => isActive(pathname, l.href));
  const panelId = `nav-${group.title.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className={`flex w-full items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors select-none ${
          containsActive ? "text-slate-900" : "text-slate-600 hover:text-slate-900"
        } hover:bg-slate-50`}
      >
        <span className="flex items-center gap-3">
          <Icon name={group.icon} className={`!text-[20px] ${containsActive ? "text-slate-700" : "text-slate-400"}`} />
          <span>{group.title}</span>
        </span>
        <Icon
          name="expand_more"
          className={`!text-[18px] text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div id={panelId} className="pl-9 pr-2 py-1 space-y-0.5 text-[13px]">
          {group.links.map((l) => {
            const active = isActive(pathname, l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={`flex items-center justify-between gap-2 py-1.5 px-2 rounded-md transition-colors ${
                  active ? "bg-slate-100 text-slate-900 font-semibold" : "text-slate-500 hover:text-blue-600 hover:bg-slate-50"
                }`}
              >
                <span className="truncate">{l.label}</span>
                {l.code && <span className="mono text-[10px] text-slate-400">{l.code}</span>}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Accordion: satu grup terbuka; grup yang memuat halaman aktif terbuka otomatis (reset via key={pathname}). */
function NavAccordion({ pathname, onNavigate }: { pathname: string; onNavigate: () => void }) {
  const activeTitle = allGroups.find((g) => g.links.some((l) => isActive(pathname, l.href)))?.title ?? null;
  const [openTitle, setOpenTitle] = useState<string | null>(activeTitle);
  const toggle = (title: string) => setOpenTitle((cur) => (cur === title ? null : title));
  const dashboardActive = pathname === "/";

  return (
    <nav className="space-y-5" aria-label="Menu utama">
      <div className="space-y-0.5">
        <Link
          href="/"
          onClick={onNavigate}
          aria-current={dashboardActive ? "page" : undefined}
          className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
            dashboardActive ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
          }`}
        >
          <Icon name="space_dashboard" className="!text-[20px]" />
          <span>Dashboard</span>
        </Link>
      </div>

      <div className="space-y-1">
        <span className="px-3 eyebrow">Operasional Finansial</span>
        {operasional.map((g) => (
          <NavGroup
            key={g.title}
            group={g}
            pathname={pathname}
            open={openTitle === g.title}
            onToggle={() => toggle(g.title)}
            onNavigate={onNavigate}
          />
        ))}
      </div>

      <div className="space-y-1">
        <span className="px-3 eyebrow">Administrasi &amp; Setup</span>
        <NavGroup
          group={masterData}
          pathname={pathname}
          open={openTitle === masterData.title}
          onToggle={() => toggle(masterData.title)}
          onNavigate={onNavigate}
        />
        <Link
          href="/settings/account-mapping"
          onClick={onNavigate}
          aria-current={isActive(pathname, "/settings/account-mapping") ? "page" : undefined}
          className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
            isActive(pathname, "/settings/account-mapping")
              ? "bg-slate-900 text-white shadow-sm"
              : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
          }`}
        >
          <Icon name="tune" className="!text-[20px] text-current opacity-80" />
          <span>Pemetaan Akun</span>
        </Link>
      </div>
    </nav>
  );
}

function DbStatus() {
  const [state, setState] = useState<"checking" | "ok" | "error">("checking");
  useEffect(() => {
    let cancelled = false;
    fetch("/api/health")
      .then((r) => r.json())
      .then((j) => !cancelled && setState(j?.ok ? "ok" : "error"))
      .catch(() => !cancelled && setState("error"));
    return () => {
      cancelled = true;
    };
  }, []);
  const dot = state === "ok" ? "bg-emerald-500" : state === "error" ? "bg-rose-500" : "bg-slate-300 animate-pulse";
  const label = state === "ok" ? "OK" : state === "error" ? "GAGAL" : "...";
  return (
    <div className="flex items-center justify-between px-3 py-2 bg-slate-50 rounded-lg text-xs font-medium text-slate-600">
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${dot}`} />
        <span>PostgreSQL 18</span>
      </div>
      <span className="text-[10px] text-slate-400 font-mono">{label}</span>
    </div>
  );
}

export default function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const year = new Date().getFullYear();

  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-slate-900/40 md:hidden" onClick={onClose} aria-hidden="true" />}

      <aside
        aria-label="Navigasi utama"
        className={`fixed left-0 top-0 z-50 h-full w-72 max-w-[85vw] md:w-64 md:max-w-none bg-white border-r border-slate-100 flex flex-col
          transition-transform duration-200 md:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        {/* Brand */}
        <div className="h-16 px-5 flex items-center justify-between border-b border-slate-100/80 shrink-0">
          <Link href="/" onClick={onClose} className="flex items-center gap-2.5 min-w-0">
            <span className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center font-heading font-bold text-sm shrink-0">
              A
            </span>
            <span className="flex flex-col leading-none min-w-0">
              <span className="font-heading font-bold text-[15px] text-slate-900 tracking-tight">
                Accurate <span className="text-blue-600">Copy</span>
              </span>
              <span className="text-[9px] font-semibold tracking-[0.12em] text-slate-400 uppercase mt-0.5">
                Enterprise ERP &amp; Ledger
              </span>
            </span>
          </Link>
          <div className="flex items-center gap-1">
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-slate-100 text-slate-500 font-mono">v0.1</span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Tutup menu"
              className="md:hidden rounded p-1 text-slate-500 hover:bg-slate-100"
            >
              <Icon name="close" className="!text-[18px]" />
            </button>
          </div>
        </div>

        {/* Company / periode */}
        <div className="p-3 shrink-0">
          <div className="bg-slate-50 border border-slate-200/60 rounded-xl px-3.5 py-2.5 flex items-center justify-between">
            <div className="flex flex-col min-w-0">
              <span className="text-xs font-semibold text-slate-900 truncate">Accurate Copy</span>
              <span className="text-[11px] text-slate-500 font-medium">FY {year} • IDR Ledger</span>
            </div>
            <Icon name="unfold_more" className="!text-[18px] text-slate-400" />
          </div>
        </div>

        {/* Menu */}
        <div className="px-3 py-1 flex-1 overflow-y-auto">
          <NavAccordion key={pathname} pathname={pathname} onNavigate={onClose} />
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-slate-100 shrink-0">
          <DbStatus />
        </div>
      </aside>
    </>
  );
}
