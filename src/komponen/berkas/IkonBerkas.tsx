import Ikon from "@/komponen/ui/Ikon";
import { keluargaDariMime, type KeluargaBerkas } from "@/lib/tipeBerkas";

/*
 * Ikon jenis berkas (D7 §7.3). Ditulis sebagai `ikon: "x"` supaya tertangkap skrip subset font. Tanpa hook dan tanpa
 * akses basis data, jadi bisa dirender di komponen server maupun klien.
 */

const IKON_KELUARGA: { keluarga: KeluargaBerkas; ikon: string }[] = [
  { keluarga: "gambar", ikon: "image" },
  { keluarga: "pdf", ikon: "picture_as_pdf" },
  { keluarga: "lembar", ikon: "table_view" },
  { keluarga: "video", ikon: "movie" },
  { keluarga: "arsip", ikon: "folder_zip" },
  { keluarga: "lain", ikon: "description" },
];

const WARNA_KELUARGA: Record<KeluargaBerkas, string> = {
  gambar: "text-emerald-600",
  pdf: "text-rose-600",
  lembar: "text-blue-600",
  video: "text-indigo-600",
  arsip: "text-amber-600",
  lain: "text-slate-500",
};

export default function IkonBerkas({ tipeMime, className = "" }: { tipeMime: string; className?: string }) {
  const keluarga = keluargaDariMime(tipeMime);
  const ikon = IKON_KELUARGA.find((k) => k.keluarga === keluarga)?.ikon ?? "description";
  return <Ikon nama={ikon} className={`!text-[20px] ${WARNA_KELUARGA[keluarga]} ${className}`} />;
}

/** Ukuran tampil: "x,x MB" mulai 1.000.000 byte, selain itu KB dibulatkan (paling kecil 1 KB). */
export function ukuranBerkas(byte: number): string {
  if (byte >= 1_000_000) return `${(byte / 1_048_576).toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
  return `${Math.max(1, Math.round(byte / 1024)).toLocaleString("id-ID")} KB`;
}
