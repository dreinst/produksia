"use client";

import { useSyncExternalStore } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/*
 * Pesan sukses di tingkat halaman untuk aksi yang ikut melenyapkan formulirnya sendiri (mis. Buang, Pulihkan, Hapus
 * permanen, dan Cabut tautan: barisnya hilang sesudah revalidasi, jadi pesanSukses di dalam FormulirAksi tidak sempat
 * tampil). FormulirAksi dengan prop pesanSuksesHalaman menulis pesannya ke sini, dan <PesanSuksesHalaman /> yang
 * dipasang di luar baris menampilkannya dengan gaya yang sama. Pesan hanya tampil di alamat tempat aksinya dijalankan,
 * dan dihapus saat formulir lain dikirim.
 */

type Pesan = { teks: string; alamat: string } | null;

let pesanSaatIni: Pesan = null;
const pendengar = new Set<() => void>();

function kabari() {
  for (const f of pendengar) f();
}

/** Jalur + query yang sudah dinormalkan URLSearchParams, supaya sebanding dengan useSearchParams(). */
const alamat = (jalur: string, cari: string) => `${jalur}?${cari}`;
const alamatSaatIni = () => alamat(window.location.pathname, new URLSearchParams(window.location.search).toString());

/** Dipanggil FormulirAksi: null saat pengiriman dimulai, teks saat aksi sukses. */
export function umumkanPesanSukses(teks: string | null) {
  const baru: Pesan = teks ? { teks, alamat: alamatSaatIni() } : null;
  if (baru?.teks === pesanSaatIni?.teks && baru?.alamat === pesanSaatIni?.alamat) return;
  pesanSaatIni = baru;
  kabari();
}

function langgan(f: () => void) {
  pendengar.add(f);
  return () => {
    pendengar.delete(f);
  };
}

export default function PesanSuksesHalaman({ className = "" }: { className?: string }) {
  const pesan = useSyncExternalStore(
    langgan,
    () => pesanSaatIni,
    () => null,
  );
  const jalur = usePathname();
  const cari = useSearchParams().toString();
  if (!pesan || pesan.alamat !== alamat(jalur, cari)) return null;
  return (
    <div role="status" className={`muncul rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 ${className}`}>
      {pesan.teks}
    </div>
  );
}
