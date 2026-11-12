"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Ikon from "@/komponen/ui/Ikon";

/*
 * Laci samping kanan (D6 §7.10), pola DialogVerifikasi. Dibuka lewat parameter URL (mis. ?konten=id), jadi menutup
 * laci berarti pindah ke `tutupHref` (URL yang sama tanpa parameter laci). Escape dan klik lapisan menutup laci,
 * kecuali sedang ada dialog lain di dalamnya (pratinjau gambar, dialog konfirmasi) yang memakai Escape sendiri.
 * Fokus pindah ke judul saat dibuka, dan gulir halaman di belakangnya dikunci selama laci terbuka.
 * Server merender laci di tempatnya (tetap terbaca tanpa JavaScript). Sesudah terpasang di klien, laci dipindah ke
 * document.body lewat portal, karena anak langsung <main className="animasi-masuk"> menyisakan transform dari animasi
 * masuk, sehingga `fixed` di dalamnya hanya menutupi kolom konten, bukan seluruh layar.
 */
export default function Laci({ judul, tutupHref, children, lebar = "md" }: { judul: string; tutupHref: string; children: ReactNode; lebar?: "md" | "lg" }) {
  const router = useRouter();
  const idJudul = useId();
  const panel = useRef<HTMLDivElement>(null);
  const kepala = useRef<HTMLHeadingElement>(null);
  const [diPortal, setDiPortal] = useState(false);

  // pindah ke document.body sekali sesudah hidrasi (render pertama harus sama dengan HTML server)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setDiPortal(true), []);

  useEffect(() => {
    if (!diPortal) return;
    kepala.current?.focus();
    const lama = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = lama;
    };
  }, [diPortal]);

  useEffect(() => {
    const tekan = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // dialog lain (modal) yang terbuka di dalam laci menangani Escape-nya sendiri
      const modalLain = [...document.querySelectorAll('[aria-modal="true"]')].some((el) => el !== panel.current);
      if (modalLain) return;
      router.push(tutupHref, { scroll: false });
    };
    window.addEventListener("keydown", tekan);
    return () => window.removeEventListener("keydown", tekan);
  }, [router, tutupHref]);

  const laci = (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40" onClick={() => router.push(tutupHref, { scroll: false })}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idJudul}
        className={`muncul h-full w-full ${lebar === "lg" ? "sm:max-w-3xl" : "sm:max-w-2xl"} overflow-y-auto bg-white shadow-xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-100 bg-white px-5 py-4">
          <h2 id={idJudul} ref={kepala} tabIndex={-1} className="font-heading text-lg font-bold text-slate-900 outline-none">
            {judul}
          </h2>
          <Link href={tutupHref} scroll={false} className="tombol tombol-garis tombol-kecil !px-2" aria-label="Tutup">
            <Ikon nama="close" className="!text-[20px]" />
          </Link>
        </div>
        <div className="space-y-5 px-5 py-5">{children}</div>
      </div>
    </div>
  );
  return diPortal ? createPortal(laci, document.body) : laci;
}
