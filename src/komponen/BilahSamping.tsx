"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import Ikon from "@/komponen/ui/Ikon";

type TautanNavigasi = { href: string; label: string; kode?: string };
type Grup = { judul: string; ikon: string; tautan: TautanNavigasi[] };

const operasional: Grup[] = [
  {
    judul: "Penjualan",
    ikon: "point_of_sale",
    tautan: [
      { href: "/penjualan/penawaran", label: "Penawaran", kode: "PNW" },
      { href: "/penjualan/pesanan", label: "Pesanan", kode: "PSJ" },
      { href: "/penjualan/pengiriman", label: "Pengiriman", kode: "SJ" },
      { href: "/penjualan/faktur", label: "Faktur Penjualan", kode: "FJ" },
      { href: "/penjualan/penerimaan", label: "Penerimaan", kode: "TRM" },
      { href: "/penjualan/retur", label: "Retur Penjualan", kode: "RJ" },
    ],
  },
  {
    judul: "Pembelian",
    ikon: "shopping_bag",
    tautan: [
      { href: "/pembelian/pesanan", label: "Pesanan", kode: "PSB" },
      { href: "/pembelian/penerimaan-barang", label: "Penerimaan Barang", kode: "TB" },
      { href: "/pembelian/faktur", label: "Faktur Pembelian", kode: "FB" },
      { href: "/pembelian/pembayaran", label: "Pembayaran", kode: "BYR" },
      { href: "/pembelian/retur", label: "Retur Pembelian", kode: "RB" },
    ],
  },
  {
    judul: "Kas & Bank",
    ikon: "account_balance",
    tautan: [
      { href: "/kas-bank/masuk", label: "Kas Masuk", kode: "KM" },
      { href: "/kas-bank/keluar", label: "Kas Keluar", kode: "KK" },
    ],
  },
  {
    judul: "Buku Besar",
    ikon: "menu_book",
    tautan: [
      { href: "/buku-besar/jurnal", label: "Jurnal Umum", kode: "JU" },
      { href: "/buku-besar/mutasi", label: "Buku Besar Mutasi" },
      { href: "/buku-besar/neraca-saldo", label: "Neraca Saldo" },
    ],
  },
  {
    judul: "Aset Tetap",
    ikon: "domain",
    tautan: [
      { href: "/aset-tetap", label: "Daftar Aset" },
      { href: "/aset-tetap/penyusutan", label: "Hitung Penyusutan", kode: "PNY" },
    ],
  },
];

const masterData: Grup = {
  judul: "Data Induk",
  ikon: "dataset",
  tautan: [
    { href: "/data-induk/pelanggan", label: "Pelanggan" },
    { href: "/data-induk/pemasok", label: "Pemasok" },
    { href: "/data-induk/barang", label: "Barang & Jasa" },
    { href: "/data-induk/kelompok-barang", label: "Kelompok Barang" },
    { href: "/data-induk/gudang", label: "Gudang" },
    { href: "/data-induk/akun", label: "Bagan Akun" },
    { href: "/data-induk/departemen", label: "Departemen" },
    { href: "/data-induk/karyawan", label: "Karyawan" },
    { href: "/data-induk/proyek", label: "Proyek" },
  ],
};

const allGroups = [...operasional, masterData];

function aktifDi(pathname: string, href: string) {
  if (href === "/aset-tetap") return pathname === "/aset-tetap" || pathname === "/aset-tetap/baru";
  return pathname === href || pathname.startsWith(href + "/");
}

function GrupNavigasi({
  group,
  pathname,
  open,
  saatBuka,
  saatNavigasi,
}: {
  group: Grup;
  pathname: string;
  open: boolean;
  saatBuka: () => void;
  saatNavigasi: () => void;
}) {
  const memuatAktif = group.tautan.some((l) => aktifDi(pathname, l.href));
  const panelId = `nav-${group.judul.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div>
      <button
        type="button"
        onClick={saatBuka}
        aria-expanded={open}
        aria-controls={panelId}
        className={`flex w-full items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors select-none ${
          memuatAktif ? "text-slate-900" : "text-slate-600 hover:text-slate-900"
        } hover:bg-slate-50`}
      >
        <span className="flex items-center gap-3">
          <Ikon nama={group.ikon} className={`!text-[20px] ${memuatAktif ? "text-slate-700" : "text-slate-400"}`} />
          <span>{group.judul}</span>
        </span>
        <Ikon
          nama="expand_more"
          className={`!text-[18px] text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div id={panelId} className="pl-9 pr-2 py-1 space-y-0.5 text-[13px]">
          {group.tautan.map((l) => {
            const aktif = aktifDi(pathname, l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                onClick={saatNavigasi}
                aria-current={aktif ? "page" : undefined}
                className={`flex items-center justify-between gap-2 py-1.5 px-2 rounded-md transition-colors ${
                  aktif ? "bg-slate-100 text-slate-900 font-semibold" : "text-slate-500 hover:text-blue-600 hover:bg-slate-50"
                }`}
              >
                <span className="truncate">{l.label}</span>
                {l.kode && <span className="mono text-[10px] text-slate-400">{l.kode}</span>}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Accordion: satu grup terbuka; grup yang memuat halaman aktif terbuka otomatis (reset via key={pathname}). */
function AkordeonNavigasi({ pathname, saatNavigasi }: { pathname: string; saatNavigasi: () => void }) {
  const judulAktif = allGroups.find((g) => g.tautan.some((l) => aktifDi(pathname, l.href)))?.judul ?? null;
  const [judulTerbuka, setJudulTerbuka] = useState<string | null>(judulAktif);
  const alihkan = (judul: string) => setJudulTerbuka((cur) => (cur === judul ? null : judul));
  const berandaAktif = pathname === "/";

  return (
    <nav className="space-y-5" aria-label="Menu utama">
      <div className="space-y-0.5">
        <Link
          href="/"
          onClick={saatNavigasi}
          aria-current={berandaAktif ? "page" : undefined}
          className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
            berandaAktif ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
          }`}
        >
          <Ikon nama="space_dashboard" className="!text-[20px]" />
          <span>Beranda</span>
        </Link>
      </div>

      <div className="space-y-1">
        <span className="px-3 teks-label">Operasional Finansial</span>
        {operasional.map((g) => (
          <GrupNavigasi
            key={g.judul}
            group={g}
            pathname={pathname}
            open={judulTerbuka === g.judul}
            saatBuka={() => alihkan(g.judul)}
            saatNavigasi={saatNavigasi}
          />
        ))}
      </div>

      <div className="space-y-1">
        <span className="px-3 teks-label">Administrasi &amp; Pengaturan</span>
        <GrupNavigasi
          group={masterData}
          pathname={pathname}
          open={judulTerbuka === masterData.judul}
          saatBuka={() => alihkan(masterData.judul)}
          saatNavigasi={saatNavigasi}
        />
        <Link
          href="/pengaturan/pemetaan-akun"
          onClick={saatNavigasi}
          aria-current={aktifDi(pathname, "/pengaturan/pemetaan-akun") ? "page" : undefined}
          className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
            aktifDi(pathname, "/pengaturan/pemetaan-akun")
              ? "bg-slate-900 text-white shadow-sm"
              : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
          }`}
        >
          <Ikon nama="tune" className="!text-[20px] text-current opacity-80" />
          <span>Pemetaan Akun</span>
        </Link>
      </div>
    </nav>
  );
}

function StatusBasisData() {
  const [keadaan, setKeadaan] = useState<"checking" | "ok" | "error">("checking");
  useEffect(() => {
    let dibatalkan = false;
    fetch("/api/status")
      .then((r) => r.json())
      .then((j) => !dibatalkan && setKeadaan(j?.ok ? "ok" : "error"))
      .catch(() => !dibatalkan && setKeadaan("error"));
    return () => {
      dibatalkan = true;
    };
  }, []);
  const titik = keadaan === "ok" ? "bg-emerald-500" : keadaan === "error" ? "bg-rose-500" : "bg-slate-300 animate-pulse";
  const label = keadaan === "ok" ? "Terhubung" : keadaan === "error" ? "Gagal" : "…";
  return (
    <div className="flex items-center justify-between px-3 py-2 bg-slate-50 rounded-lg text-xs font-medium text-slate-600">
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${titik}`} />
        <span>PostgreSQL 18</span>
      </div>
      <span className="text-[10px] text-slate-400 font-mono">{label}</span>
    </div>
  );
}

export default function BilahSamping({ open, saatTutup }: { open: boolean; saatTutup: () => void }) {
  const pathname = usePathname();
  const year = new Date().getFullYear();

  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-slate-900/40 md:hidden" onClick={saatTutup} aria-hidden="true" />}

      <aside
        aria-label="Navigasi utama"
        className={`fixed left-0 top-0 z-50 h-full w-72 max-w-[85vw] md:w-64 md:max-w-none bg-white border-r border-slate-100 flex flex-col
          transition-transform duration-200 md:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        {/* Brand */}
        <div className="h-16 px-5 flex items-center justify-between border-b border-slate-100/80 shrink-0">
          <Link href="/" onClick={saatTutup} className="flex items-center gap-2.5 min-w-0">
            <span className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center font-heading font-bold text-sm shrink-0">
              A
            </span>
            <span className="flex flex-col leading-none min-w-0">
              <span className="font-heading font-bold text-[15px] text-slate-900 tracking-tight">
                Accurate <span className="text-blue-600">Copy</span>
              </span>
              <span className="text-[9px] font-semibold tracking-[0.12em] text-slate-400 uppercase mt-0.5">
                Sistem Akuntansi Terpadu
              </span>
            </span>
          </Link>
          <div className="flex items-center gap-1">
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-slate-100 text-slate-500 font-mono">v0.1</span>
            <button
              type="button"
              onClick={saatTutup}
              aria-label="Tutup menu"
              className="md:hidden rounded p-1 text-slate-500 hover:bg-slate-100"
            >
              <Ikon nama="close" className="!text-[18px]" />
            </button>
          </div>
        </div>

        {/* Company / periode */}
        <div className="p-3 shrink-0">
          <div className="bg-slate-50 border border-slate-200/60 rounded-xl px-3.5 py-2.5 flex items-center justify-between">
            <div className="flex flex-col min-w-0">
              <span className="text-xs font-semibold text-slate-900 truncate">Accurate Copy</span>
              <span className="text-[11px] text-slate-500 font-medium">Tahun Buku {year} • Rupiah</span>
            </div>
            <Ikon nama="unfold_more" className="!text-[18px] text-slate-400" />
          </div>
        </div>

        {/* Menu */}
        <div className="px-3 py-1 flex-1 overflow-y-auto">
          <AkordeonNavigasi key={pathname} pathname={pathname} saatNavigasi={saatTutup} />
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-slate-100 shrink-0">
          <StatusBasisData />
        </div>
      </aside>
    </>
  );
}
