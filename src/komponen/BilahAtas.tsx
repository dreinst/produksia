"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import Ikon from "@/komponen/ui/Ikon";
import { keluar } from "@/lib/aksi/otentikasi";
import { inisialNama, LABEL_PERAN, punyaHak, type Hak, type PenggunaSesi } from "@/lib/hakAkses";

const tautanTransaksiBaru: { href: string; label: string; kode: string; ikon: string; hak: Hak }[] = [
  { href: "/penjualan/penawaran/baru", label: "Penawaran Penjualan", kode: "PNW", ikon: "request_quote", hak: "penawaran.buat" },
  { href: "/penjualan/pesanan/baru", label: "Pesanan Penjualan", kode: "PSJ", ikon: "receipt_long", hak: "pesanan.buat" },
  { href: "/penjualan/pengiriman", label: "Surat Jalan", kode: "SJ", ikon: "local_shipping", hak: "pengiriman.buat" },
  { href: "/pembelian/pesanan/baru", label: "Pesanan Pembelian", kode: "PSB", ikon: "shopping_bag", hak: "pesanan-pembelian.buat" },
  { href: "/pembelian/penerimaan-barang", label: "Terima Barang", kode: "TB", ikon: "inventory", hak: "penerimaan-barang.buat" },
  { href: "/kas-bank/masuk", label: "Kas Masuk", kode: "KM", ikon: "south_west", hak: "kas-masuk.buat" },
  { href: "/kas-bank/keluar", label: "Kas Keluar", kode: "KK", ikon: "north_east", hak: "kas-keluar.buat" },
  { href: "/buku-besar/jurnal/baru", label: "Jurnal Umum", kode: "JU", ikon: "edit_note", hak: "jurnal.buat" },
  { href: "/aset-tetap/baru", label: "Aset Tetap", kode: "AT", ikon: "domain", hak: "aset.buat" },
  { href: "/persediaan/penyesuaian/baru", label: "Penyesuaian Stok", kode: "PS", ikon: "inventory_2", hak: "penyesuaian.buat" },
];

export default function BilahAtas({ pengguna, saatMenu }: { pengguna: PenggunaSesi; saatMenu: () => void }) {
  const router = useRouter();
  const refCari = useRef<HTMLInputElement>(null);
  const tautanBoleh = tautanTransaksiBaru.filter((l) => punyaHak(pengguna, l.hak));

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
        {tautanBoleh.length > 0 && (
          <details className="relative group">
            <summary className="tombol tombol-utama list-none cursor-pointer select-none [&::-webkit-details-marker]:hidden">
              <Ikon nama="add" className="!text-[18px]" />
              <span className="hidden sm:inline">Transaksi Baru</span>
            </summary>
            <div className="absolute right-0 mt-2 w-64 rounded-xl border border-slate-200 bg-white p-1.5 z-40" style={{ boxShadow: "var(--shadow-pop)" }}>
              {tautanBoleh.map((l) => (
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
        )}

        <div className="hidden md:block h-6 w-px bg-slate-200" />

        <details className="relative">
          <summary
            className="flex items-center gap-3 list-none cursor-pointer select-none rounded-lg px-1 py-0.5 hover:bg-slate-50 [&::-webkit-details-marker]:hidden"
            aria-label="Menu akun"
          >
            <span className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center text-xs font-bold ring-2 ring-slate-100">
              {inisialNama(pengguna.nama)}
            </span>
            <span className="hidden md:flex flex-col text-left">
              <span className="text-xs font-semibold text-slate-900 leading-tight max-w-[10rem] truncate">{pengguna.nama}</span>
              <span className="text-[11px] text-slate-500 leading-normal">{LABEL_PERAN[pengguna.peran]}</span>
            </span>
            <Ikon nama="expand_more" className="hidden md:block !text-[18px] text-slate-400" />
          </summary>
          <div className="absolute right-0 mt-2 w-60 rounded-xl border border-slate-200 bg-white p-1.5 z-40" style={{ boxShadow: "var(--shadow-pop)" }}>
            <div className="px-3 py-2 border-b border-slate-100 mb-1">
              <div className="text-sm font-semibold text-slate-900 truncate">{pengguna.nama}</div>
              <div className="text-xs text-slate-500 truncate font-mono">@{pengguna.namaPengguna}</div>
            </div>
            <Link href="/profil" className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-700 hover:bg-slate-50 hover:text-slate-900">
              <Ikon nama="person" className="!text-[18px] text-slate-400" />
              Profil &amp; kata sandi
            </Link>
            <form action={keluar}>
              <button type="submit" className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-rose-600 hover:bg-rose-50">
                <Ikon nama="logout" className="!text-[18px]" />
                Keluar
              </button>
            </form>
          </div>
        </details>
      </div>
    </header>
  );
}
