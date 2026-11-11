"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import Ikon from "@/komponen/ui/Ikon";
import { bukaNotifikasi, tandaiSemuaNotifikasiDibaca } from "@/lib/aksi/notifikasi";
import { formatWaktu } from "@/lib/waktu";

type Butir = {
  id: string;
  judul: string;
  isi: string | null;
  tautan: string | null;
  dibaca: boolean;
  dibuatPada: string;
  perusahaan: { id: string; nama: string } | null;
};

const JEDA_MUAT_MS = 120_000;

/**
 * Lonceng notifikasi di bilah atas (D7 §7.5). Data dari GET /api/notifikasi: saat dipasang, saat panel dibuka,
 * tiap 2 menit selama tab terlihat, dan saat tab kembali terlihat. Galat muat diabaikan diam-diam.
 */
export default function LoncengNotifikasi() {
  const router = useRouter();
  const refPanel = useRef<HTMLDetailsElement>(null);
  const [belumDibaca, setBelumDibaca] = useState(0);
  const [daftar, setDaftar] = useState<Butir[]>([]);

  const muat = useCallback(async () => {
    try {
      const jawab = await fetch("/api/notifikasi", { cache: "no-store" });
      if (!jawab.ok) return;
      const data = (await jawab.json()) as { ok: boolean; belumDibaca: number; terbaru: Butir[] };
      if (!data.ok) return;
      setBelumDibaca(data.belumDibaca);
      setDaftar(data.terbaru);
    } catch {
      // jaringan putus atau server sibuk: coba lagi pada putaran berikutnya
    }
  }, []);

  useEffect(() => {
    // muat pertama ditunda ke putaran berikutnya supaya setState tidak terjadi langsung di dalam efek
    const awal = window.setTimeout(() => void muat(), 0);
    const selang = window.setInterval(() => {
      if (document.visibilityState === "visible") void muat();
    }, JEDA_MUAT_MS);
    const saatTerlihat = () => {
      if (document.visibilityState === "visible") void muat();
    };
    document.addEventListener("visibilitychange", saatTerlihat);
    return () => {
      window.clearTimeout(awal);
      window.clearInterval(selang);
      document.removeEventListener("visibilitychange", saatTerlihat);
    };
  }, [muat]);

  const tutup = () => {
    if (refPanel.current) refPanel.current.open = false;
  };

  const buka = async (id: string) => {
    let tautan: string | null = null;
    try {
      tautan = (await bukaNotifikasi(id)).tautan;
    } catch {
      tautan = null;
    }
    tutup();
    router.push(tautan ?? "/notifikasi");
    router.refresh();
    void muat();
  };

  const tandaiSemua = async () => {
    try {
      await tandaiSemuaNotifikasiDibaca();
    } catch {
      // diabaikan; daftar dimuat ulang di bawah
    }
    await muat();
    router.refresh();
  };

  const labelAngka = belumDibaca > 9 ? "9+" : String(belumDibaca);

  return (
    <details ref={refPanel} className="relative" onToggle={(e) => (e.currentTarget.open ? void muat() : undefined)}>
      <summary
        className="relative flex items-center list-none cursor-pointer select-none rounded-lg p-1.5 hover:bg-slate-50 [&::-webkit-details-marker]:hidden"
        aria-label={`Notifikasi, ${belumDibaca} belum dibaca`}
      >
        <Ikon nama="notifications" className="!text-[22px] text-slate-600" />
        {belumDibaca > 0 && (
          <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-rose-600 text-white text-[10px] font-bold leading-4 text-center">{labelAngka}</span>
        )}
      </summary>
      <div className="absolute right-0 mt-2 w-[340px] max-w-[90vw] rounded-xl border border-slate-200 bg-white p-1.5 z-40" style={{ boxShadow: "var(--shadow-pop)" }}>
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-100 mb-1">
          <span className="text-sm font-semibold text-slate-900">Notifikasi</span>
          {belumDibaca > 0 && (
            <button type="button" onClick={() => void tandaiSemua()} className="flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-900">
              <Ikon nama="done_all" className="!text-[16px]" />
              Tandai semua dibaca
            </button>
          )}
        </div>
        {daftar.length === 0 ? (
          <p className="px-3 py-4 text-sm text-slate-500">Tidak ada notifikasi.</p>
        ) : (
          <ul className="max-h-[60vh] overflow-y-auto">
            {daftar.map((n) => (
              <li key={n.id}>
                <button type="button" onClick={() => void buka(n.id)} className="w-full flex items-start gap-2 px-3 py-2 rounded-lg text-left hover:bg-slate-50">
                  <span className={`mt-1.5 w-2 h-2 shrink-0 rounded-full ${n.dibaca ? "bg-transparent" : "bg-blue-600"}`} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-sm text-slate-900 ${n.dibaca ? "" : "font-semibold"}`}>{n.judul}</span>
                    {n.isi && <span className="block text-xs text-slate-500 truncate">{n.isi}</span>}
                    <span className="block text-[11px] text-slate-400">
                      {formatWaktu(new Date(n.dibuatPada))}
                      {n.perusahaan ? ` · ${n.perusahaan.nama}` : ""}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-slate-100 mt-1 pt-1">
          <Link href="/notifikasi" onClick={tutup} className="block px-3 py-2 rounded-lg text-sm text-center font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900">
            Lihat semua
          </Link>
        </div>
      </div>
    </details>
  );
}
