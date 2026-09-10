"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Angka yang berjalan naik dari 0 ke nilai akhir saat pertama tampil (kira-kira 0,9 detik, easing keluar).
 * Format Rupiah id-ID. Bila pengguna memilih "kurangi gerakan", nilai akhir langsung tampil.
 */
export default function AngkaBergerak({ nilai, awalan = "Rp ", durasi = 900, className }: { nilai: number; awalan?: string; durasi?: number; className?: string }) {
  const [tampil, setTampil] = useState(nilai);
  const mulai = useRef<number | null>(null);

  useEffect(() => {
    // kurangi gerakan atau nilai 0: biarkan nilai akhir (state awal) tampil apa adanya
    if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches || nilai === 0) return;
    let bingkai = 0;
    const langkah = (t: number) => {
      if (mulai.current === null) mulai.current = t;
      const p = Math.min(1, (t - mulai.current) / durasi);
      const e = 1 - Math.pow(1 - p, 3);
      setTampil(Math.round(nilai * e));
      if (p < 1) bingkai = requestAnimationFrame(langkah);
    };
    bingkai = requestAnimationFrame(langkah);
    return () => cancelAnimationFrame(bingkai);
  }, [nilai, durasi]);

  return (
    <span className={className}>
      {awalan}
      {tampil.toLocaleString("id-ID")}
    </span>
  );
}
