"use client";

import { useEffect, useState } from "react";
import Ikon from "@/komponen/ui/Ikon";

/**
 * Tombol pratinjau dan dialog gambar (D7 §7.3), pola DialogVerifikasi: latar gelap, kotak role="dialog", tutup
 * lewat Escape, klik latar, atau tombol Tutup. Gambar dimuat dari /api/berkas/{id} (hak dinilai di route handler).
 * Nama berkas dirender di <bdi> supaya karakter arah teks di nama tidak membalik teks di sekitarnya.
 */
export default function DialogPratinjauGambar({
  id,
  nama,
  label = "Pratinjau",
  className = "tombol-tautan",
  tanpaIkon = false,
}: {
  id: string;
  nama: string;
  label?: string;
  className?: string;
  /** true: tombol hanya berisi label (mis. nama berkas sebagai pemicu) */
  tanpaIkon?: boolean;
}) {
  const [buka, setBuka] = useState(false);

  useEffect(() => {
    if (!buka) return;
    const tutup = (e: KeyboardEvent) => {
      if (e.key === "Escape") setBuka(false);
    };
    window.addEventListener("keydown", tutup);
    return () => window.removeEventListener("keydown", tutup);
  }, [buka]);

  return (
    <>
      <button type="button" className={className} onClick={() => setBuka(true)} title={`Pratinjau ${nama}`}>
        {!tanpaIkon && <Ikon nama="visibility" className="!text-[16px] align-[-3px] mr-0.5" />}
        {tanpaIkon ? <bdi>{label}</bdi> : label}
      </button>
      {buka && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-slate-900/40" onClick={() => setBuka(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Pratinjau ${nama}`}
            className="muncul w-full max-w-3xl rounded-xl bg-white shadow-xl border border-slate-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-100">
              <Ikon nama="image" className="!text-[20px] text-emerald-600" />
              <h2 className="min-w-0 flex-1 truncate font-heading text-sm font-bold text-slate-900">
                <bdi>{nama}</bdi>
              </h2>
            </div>
            <div className="p-4 flex justify-center bg-slate-50 max-h-[70vh] overflow-auto">
              {/* eslint-disable-next-line @next/next/no-img-element -- berkas privat lewat route handler, bukan aset statis */}
              <img src={`/api/berkas/${id}`} alt={nama} className="max-w-full h-auto object-contain" />
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-100">
              <a href={`/api/berkas/${id}?unduh=1`} className="tombol tombol-garis">
                <Ikon nama="download" className="!text-[18px]" />
                Unduh
              </a>
              <button type="button" className="tombol tombol-utama" onClick={() => setBuka(false)} autoFocus>
                <Ikon nama="close" className="!text-[18px]" />
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
