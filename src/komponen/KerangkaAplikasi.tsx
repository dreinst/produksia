"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import BilahSamping from "@/komponen/BilahSamping";
import BilahAtas from "@/komponen/BilahAtas";

/**
 * Kerangka aplikasi: sidebar tetap 16rem di desktop / drawer di mobile, topbar lengket,
 * kanvas konten maks 80rem. State drawer dipegang di sini agar BilahAtas bisa membukanya.
 */
export default function KerangkaAplikasi({ children }: { children: ReactNode }) {
  const [lacaTerbuka, setLacaTerbuka] = useState(false);

  return (
    <div className="min-h-screen bg-canvas">
      <BilahSamping open={lacaTerbuka} saatTutup={() => setLacaTerbuka(false)} />
      <div className="md:pl-64 min-h-screen flex flex-col">
        <BilahAtas saatMenu={() => setLacaTerbuka(true)} />
        <main className="w-full max-w-7xl mx-auto flex-1 px-4 md:px-8 py-5 md:py-7 space-y-6 min-w-0">{children}</main>
      </div>
    </div>
  );
}
