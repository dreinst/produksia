"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import Ikon from "@/komponen/ui/Ikon";

const tautanTransaksiBaru = [
  { href: "/penjualan/penawaran/baru", label: "Penawaran Penjualan", kode: "PNW", ikon: "request_quote" },
  { href: "/penjualan/pesanan/baru", label: "Pesanan Penjualan", kode: "PSJ", ikon: "receipt_long" },
  { href: "/pembelian/pesanan/baru", label: "Pesanan Pembelian", kode: "PSB", ikon: "shopping_bag" },
  { href: "/kas-bank/masuk", label: "Kas Masuk", kode: "KM", ikon: "south_west" },
  { href: "/kas-bank/keluar", label: "Kas Keluar", kode: "KK", ikon: "north_east" },
  { href: "/buku-besar/jurnal/baru", label: "Jurnal Umum", kode: "JU", ikon: "edit_note" },
  { href: "/aset-tetap/baru", label: "Aset Tetap", kode: "AT", ikon: "domain" },
];

export default function BilahAtas({ saatMenu }: { saatMenu: () => void }) {
  const router = useRouter();
  const refCari = useRef<HTMLInputElement>(null);

  // ⌘K / Ctrl+K memfokuskan kotak pencarian
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        refCari.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="sticky top-0 z-30 h-16 bg-white/80 backdrop-blur-md border-b border-slate-100 px-4 md:px-8 flex items-center justify-between gap-3 md:gap-6">
      <div className="flex items-center gap-3 flex-1 min-w-0 max-w-lg">
        <button
          type="button"
          onClick={saatMenu}
          aria-label="Buka menu"
          className="md:hidden rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50"
        >
          <Ikon nama="menu" className="!text-[20px]" />
        </button>

        <form
          role="search"
          className="relative w-full"
          onSubmit={(e) => {
            e.preventDefault();
            const q = refCari.current?.value.trim();
            if (q) router.push(`/cari?q=${encodeURIComponent(q)}`);
          }}
        >
          <Ikon nama="search" className="absolute left-3 top-1/2 -translate-y-1/2 !text-[18px] text-slate-400" />
          <input
            ref={refCari}
            name="q"
            type="search"
            placeholder="Cari nomor transaksi, akun, atau rekanan..."
            className="w-full h-9 pl-9 pr-14 bg-slate-50 text-slate-900 placeholder:text-slate-400 text-sm rounded-lg border border-transparent focus:border-slate-300 focus:bg-white focus:outline-none transition-all"
          />
          <kbd className="hidden sm:block absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] font-mono text-slate-400 bg-white border border-slate-200 px-1.5 py-0.5 rounded">
            ⌘K
          </kbd>
        </form>
      </div>

      <div className="flex items-center gap-2 md:gap-4 shrink-0">
        <details className="relative group">
          <summary className="tombol tombol-utama list-none cursor-pointer select-none [&::-webkit-details-marker]:hidden">
            <Ikon nama="add" className="!text-[18px]" />
            <span className="hidden sm:inline">Transaksi Baru</span>
          </summary>
          <div className="absolute right-0 mt-2 w-64 rounded-xl border border-slate-200 bg-white p-1.5 z-40" style={{ boxShadow: "var(--shadow-pop)" }}>
            {tautanTransaksiBaru.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-700 hover:bg-slate-50 hover:text-slate-900"
              >
                <Ikon nama={l.ikon} className="!text-[18px] text-slate-400" />
                <span className="flex-1">{l.label}</span>
                <span className="mono text-[10px] text-slate-400">{l.kode}</span>
              </Link>
            ))}
          </div>
        </details>

        <div className="hidden md:block h-6 w-px bg-slate-200" />

        <div className="hidden md:flex items-center gap-3">
          <span className="w-8 h-8 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center text-xs font-bold ring-2 ring-slate-100">
            AL
          </span>
          <div className="flex flex-col text-left">
            <span className="text-xs font-semibold text-slate-900 leading-tight">Admin Lokal</span>
            <span className="text-[11px] text-slate-500 leading-normal">Belum masuk</span>
          </div>
        </div>
      </div>
    </header>
  );
}
