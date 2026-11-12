"use client";

import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/*
 * Pesan sukses di tingkat halaman untuk aksi yang ikut melenyapkan formulirnya sendiri (mis. Buang, Pulihkan, Hapus
 * permanen, dan Cabut tautan: barisnya hilang sesudah revalidasi, jadi pesanSukses di dalam FormulirAksi tidak sempat
 * tampil). FormulirAksi dengan prop pesanSuksesHalaman menulis pesannya ke sini, dan <PesanSuksesHalaman /> yang
 * dipasang di luar baris menampilkannya dengan gaya yang sama. Pesan hanya tampil di alamat tempat aksinya dijalankan,
 * dan dihapus saat formulir lain dikirim, saat alamat berubah, atau saat <PesanSuksesHalaman /> dilepas (pindah
 * halaman). Pesan dari aksi yang selesai sesudah pengguna pindah alamat dibuang.
 * Saluran (bawaan kosong) memisahkan penampil di halaman yang sama: pesan hanya tampil di <PesanSuksesHalaman /> yang
 * berada di <SaluranPesanSukses> yang sama dengan formulir pengirimnya. Tiap kartu LampiranBerkas dan tabel laporan
 * iklan dibungkus saluran sendiri, jadi pesannya tidak muncul berlipat atau di kartu lain (perbaikan tinjauan P43 R3).
 */

type Pesan = { teks: string; alamat: string; saluran: string } | null;

let pesanSaatIni: Pesan = null;

const KonteksSaluran = createContext("");

/** Saluran pesan sukses untuk FormulirAksi dan <PesanSuksesHalaman /> di dalamnya. */
export function SaluranPesanSukses({ saluran, children }: { saluran: string; children: ReactNode }) {
  return <KonteksSaluran.Provider value={saluran}>{children}</KonteksSaluran.Provider>;
}

/** Saluran tempat komponen ini berada (kosong di luar SaluranPesanSukses). */
export function useSaluranPesanSukses(): string {
  return useContext(KonteksSaluran);
}
const pendengar = new Set<() => void>();

function kabari() {
  for (const f of pendengar) f();
}

/** Jalur + query yang sudah dinormalkan URLSearchParams, supaya sebanding dengan useSearchParams(). */
const alamat = (jalur: string, cari: string) => `${jalur}?${cari}`;
const alamatSaatIni = () => alamat(window.location.pathname, new URLSearchParams(window.location.search).toString());

function ganti(baru: Pesan) {
  if (baru?.teks === pesanSaatIni?.teks && baru?.alamat === pesanSaatIni?.alamat && baru?.saluran === pesanSaatIni?.saluran) return;
  pesanSaatIni = baru;
  kabari();
}

/**
 * Dipanggil FormulirAksi. Saat pengiriman dimulai: umumkanPesanSukses(null) menghapus pesan lama dan mengembalikan
 * alamat saat itu. Saat aksi sukses: umumkanPesanSukses(teks, alamatAwal) menampilkan pesan hanya bila pengguna masih
 * di alamat yang sama.
 */
export function umumkanPesanSukses(teks: string | null, alamatAwal?: string, saluran = ""): string {
  const kini = alamatSaatIni();
  if (!teks) ganti(null);
  else if (alamatAwal === undefined || alamatAwal === kini) ganti({ teks, alamat: kini, saluran });
  return kini;
}

function langgan(f: () => void) {
  pendengar.add(f);
  return () => {
    pendengar.delete(f);
  };
}

export default function PesanSuksesHalaman({ className = "" }: { className?: string }) {
  const saluran = useSaluranPesanSukses();
  const pesan = useSyncExternalStore(
    langgan,
    () => pesanSaatIni,
    () => null,
  );
  const jalur = usePathname();
  const cari = useSearchParams().toString();
  const alamatKini = alamat(jalur, cari);
  // pesan milik alamat lain dibuang supaya tidak muncul lagi saat pengguna kembali ke alamat itu
  useEffect(() => {
    if (pesan && pesan.alamat !== alamatKini) ganti(null);
  }, [pesan, alamatKini]);
  useEffect(() => () => ganti(null), []);
  if (!pesan || pesan.alamat !== alamatKini || pesan.saluran !== saluran) return null;
  return (
    <div role="status" className={`muncul rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 ${className}`}>
      {pesan.teks}
    </div>
  );
}
