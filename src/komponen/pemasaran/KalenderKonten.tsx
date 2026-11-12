"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PlatformKonten } from "@/prisma-klien/enums";
import { TITIK_PLATFORM } from "@/lib/labelPemasaran";
import Ikon from "@/komponen/ui/Ikon";

/*
 * Kisi kalender bulanan Perencana Konten (D6 §7.2 no. 3, §7.13). Selalu 42 sel mulai Senin (gridKalender). Tiap konten
 * menaut ke laci konten. Bila boleh membuat konten, klik dua kali sel membuka laci konten baru bertanggal itu, dan tiap
 * sel punya tombol kecil "add" untuk papan ketik dan layar sentuh (tampil saat fokus atau hover, selalu tampil di layar
 * sempit). Tanpa impor basis data; semua label tanggal disiapkan server.
 */

export type SelKalenderKonten = {
  tanggal: string;
  /** angka hari, mis. "18" */
  hari: string;
  /** tanggal untuk aria-label, mis. "18 Nov 2026" */
  label: string;
  diBulanIni: boolean;
  hariIni: boolean;
  konten: { id: string; href: string; judul: string; jam: string | null; platform: PlatformKonten }[];
};

export type NavigasiKalender = { sebelum: string; hariIni: string; sesudah: string };

const NAMA_HARI = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];

export default function KalenderKonten({
  judulBulan,
  sel,
  navigasi,
  bolehBuat,
  hrefBaru,
}: {
  judulBulan: string;
  sel: SelKalenderKonten[];
  navigasi: NavigasiKalender;
  bolehBuat: boolean;
  /** URL laci konten baru (sudah berisi "?...konten=baru"); komponen menambah "&tanggal=YYYY-MM-DD" */
  hrefBaru: string;
}) {
  const router = useRouter();
  const hrefTanggal = (t: string) => `${hrefBaru}&tanggal=${t}`;

  return (
    <section className="kartu !p-0 overflow-hidden" aria-label={`Kalender konten ${judulBulan}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-slate-100">
        <h2 className="judul-kartu capitalize">{judulBulan}</h2>
        <div className="flex items-center gap-1">
          <Link href={navigasi.sebelum} scroll={false} className="tombol tombol-garis tombol-kecil !px-2" aria-label="Bulan sebelumnya">
            <Ikon nama="chevron_left" className="!text-[18px]" />
          </Link>
          <Link href={navigasi.hariIni} scroll={false} className="tombol tombol-garis tombol-kecil">
            <Ikon nama="today" className="!text-[16px]" /> Hari ini
          </Link>
          <Link href={navigasi.sesudah} scroll={false} className="tombol tombol-garis tombol-kecil !px-2" aria-label="Bulan berikutnya">
            <Ikon nama="chevron_right" className="!text-[18px]" />
          </Link>
        </div>
      </div>
      <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50 text-center text-[11px] font-semibold text-slate-500">
        {NAMA_HARI.map((h) => (
          <div key={h} className="py-1.5">
            {h}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {sel.map((s) => (
          <div
            key={s.tanggal}
            className={`group relative min-h-24 border-b border-r border-slate-100 p-1 text-xs [&:nth-child(7n)]:border-r-0 ${s.diBulanIni ? "bg-white" : "bg-slate-50 text-slate-400"}`}
            onDoubleClick={
              bolehBuat
                ? (e) => {
                    // klik dua kali pada tautan konten atau tombol tambah di dalam sel bukan permintaan konten baru
                    if ((e.target as HTMLElement).closest("a, button")) return;
                    router.push(hrefTanggal(s.tanggal), { scroll: false });
                  }
                : undefined
            }
          >
            <div className="flex items-center justify-between gap-1">
              <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full angka ${s.hariIni ? "bg-navy text-white font-semibold" : ""}`}>{s.hari}</span>
              {bolehBuat && (
                <Link
                  href={hrefTanggal(s.tanggal)}
                  scroll={false}
                  aria-label={`Rencanakan konten ${s.label}`}
                  className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-500 hover:bg-slate-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100"
                >
                  <Ikon nama="add" className="!text-[16px]" />
                </Link>
              )}
            </div>
            <ul className="mt-1 max-h-28 space-y-0.5 overflow-y-auto">
              {s.konten.map((k) => (
                <li key={k.id}>
                  <Link href={k.href} scroll={false} title={k.judul} className="flex items-center gap-1 rounded px-1 py-0.5 text-slate-700 hover:bg-slate-100">
                    <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${TITIK_PLATFORM[k.platform]}`} aria-hidden="true" />
                    <span className="truncate">
                      {k.jam && <span className="angka text-slate-500">{k.jam} </span>}
                      {k.judul}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
