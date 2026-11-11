"use client";

import { useEffect, useState } from "react";
import Ikon from "@/komponen/ui/Ikon";

/** Menyalin teks ke papan klip; label berubah "Tersalin" selama 2 detik (D7 §7.3). */
export default function TombolSalin({ teks, className = "tombol tombol-garis tombol-kecil" }: { teks: string; className?: string }) {
  const [tersalin, setTersalin] = useState(false);
  const [galat, setGalat] = useState(false);

  useEffect(() => {
    if (!tersalin) return;
    const t = setTimeout(() => setTersalin(false), 2000);
    return () => clearTimeout(t);
  }, [tersalin]);

  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(teks);
          setGalat(false);
          setTersalin(true);
        } catch {
          setGalat(true);
        }
      }}
      aria-live="polite"
    >
      <Ikon nama="content_copy" className="!text-[16px]" />
      {tersalin ? "Tersalin" : galat ? "Salin manual" : "Salin"}
    </button>
  );
}
