"use client";

import { useEffect } from "react";
import Ikon from "@/komponen/ui/Ikon";

export type RingkasanVerifikasi = { judul: string; baris: { label: string; nilai: string }[]; peringatan: string[] };

/**
 * Dialog verifikasi singkat sebelum simpan: ringkasan isian + peringatan (mis. tanpa event).
 * Escape / klik latar = kembali memeriksa; tombol utama = lanjut simpan.
 */
export default function DialogVerifikasi({ ringkasan, onBatal, onLanjut }: { ringkasan: RingkasanVerifikasi; onBatal: () => void; onLanjut: () => void }) {
  useEffect(() => {
    const tutup = (e: KeyboardEvent) => {
      if (e.key === "Escape") onBatal();
    };
    window.addEventListener("keydown", tutup);
    return () => window.removeEventListener("keydown", tutup);
  }, [onBatal]);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-slate-900/40" onClick={onBatal}>
      <div role="dialog" aria-modal="true" aria-labelledby="judul-verifikasi" className="muncul w-full max-w-lg rounded-xl bg-white shadow-xl border border-slate-200" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
          <Ikon nama="fact_check" className="!text-[22px] text-blue-600" />
          <h2 id="judul-verifikasi" className="font-heading text-base font-bold text-slate-900">{ringkasan.judul}</h2>
        </div>
        <div className="px-5 py-4 max-h-[60vh] overflow-y-auto space-y-4">
          <dl className="grid grid-cols-[minmax(0,10rem)_1fr] gap-x-4 gap-y-2 text-sm">
            {ringkasan.baris.map((b) => (
              <div key={b.label} className="contents">
                <dt className="text-slate-500">{b.label}</dt>
                <dd className="text-slate-900 font-medium whitespace-pre-line break-words">{b.nilai}</dd>
              </div>
            ))}
          </dl>
          {ringkasan.peringatan.length > 0 && (
            <ul className="space-y-2">
              {ringkasan.peringatan.map((p) => (
                <li key={p} className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  <Ikon nama="error" className="!text-[18px] shrink-0 mt-0.5" />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 px-5 py-4 border-t border-slate-100">
          <button type="button" onClick={onBatal} className="tombol tombol-garis">Kembali periksa</button>
          <button type="button" onClick={onLanjut} autoFocus className="tombol tombol-utama">{ringkasan.peringatan.length > 0 ? "Tetap simpan" : "Ya, simpan"}</button>
        </div>
      </div>
    </div>
  );
}
