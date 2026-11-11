import type { ReactNode } from "react";
import Link from "next/link";
import { formatTanggal } from "@/lib/waktu";
import TeksBerbutir from "@/komponen/penjualan/TeksBerbutir";

/*
 * Potongan tata letak bersama lima halaman detail dokumen penjualan (P27). Folder berawalan garis bawah tidak menjadi
 * rute Next.js.
 */

/** Daftar label dan nilai dua kolom; isian kosong (null, undefined, "") tidak dirender. */
export function DaftarInfo({ isi }: { isi: readonly (readonly [string, ReactNode])[] }) {
  const ada = isi.filter(([, v]) => v !== null && v !== undefined && v !== "" && v !== false);
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
      {ada.map(([label, nilai]) => (
        <div key={label} className="min-w-0">
          <dt className="teks-label">{label}</dt>
          <dd className="text-slate-800 break-words whitespace-pre-line">{nilai}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Kartu ber-judul dengan isi bebas. */
export function Kartu({ judul, aksi, children, className = "" }: { judul: string; aksi?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`kartu space-y-4 ${className}`} aria-label={judul}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="judul-kartu">{judul}</h2>
        {aksi}
      </div>
      {children}
    </section>
  );
}

type TeksSurat = {
  teksPembuka?: string | null;
  teksPenutup?: string | null;
  catatan?: string | null;
  catatanKanan?: string | null;
  syaratPembayaran?: string | null;
  infoBank?: string | null;
};

const LABEL_TEKS: [keyof TeksSurat, string][] = [
  ["teksPembuka", "Paragraf pembuka"],
  ["teksPenutup", "Paragraf penutup"],
  ["catatan", "Catatan"],
  ["catatanKanan", "Catatan kanan"],
  ["syaratPembayaran", "Syarat pembayaran"],
  ["infoBank", "Info rekening"],
];

/** Kartu "Teks surat" (D2 §7.3); tidak dirender bila semua teks kosong. */
export function KartuTeksSurat({ teks }: { teks: TeksSurat }) {
  const ada = LABEL_TEKS.filter(([k]) => teks[k]?.trim());
  if (ada.length === 0) return null;
  return (
    <Kartu judul="Teks surat">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
        {ada.map(([k, label]) => (
          <div key={k} className="min-w-0">
            <p className="teks-label mb-1">{label}</p>
            <TeksBerbutir teks={teks[k]} />
          </div>
        ))}
      </div>
    </Kartu>
  );
}

/** Nomor tampil dokumen: nomor cetak bila ada, kalau tidak nomor internal. */
export const nomorTampil = (d: { nomor: string; nomorCetak?: string | null }) => d.nomorCetak || d.nomor;

export const LABEL_TAMPILAN_EVENT: Record<string, string> = { RINCI: "Rinci: satu halaman", RINGKAS: "Ringkas: ringkasan + lampiran RAB" };

/** Satu baris daftar "Dokumen turunan": tautan hanya bila halaman tujuan ada dan pengguna berhak melihatnya. */
export function BarisTurunan({ jenis, nomor, nomorCetak, tanggal, href, children }: { jenis: string; nomor: string; nomorCetak?: string | null; tanggal?: Date; href?: string; children?: ReactNode }) {
  const label = `${jenis} ${nomorCetak || nomor}`;
  return (
    <li className="py-2 flex flex-wrap items-center gap-3">
      {href ? (
        <Link href={href} className="tombol-tautan">
          {label}
        </Link>
      ) : (
        <span className="text-slate-800">{label}</span>
      )}
      {nomorCetak && <span className="mono text-[11px] text-slate-500">{nomor}</span>}
      {tanggal && <span className="text-slate-500">{formatTanggal(tanggal)}</span>}
      {children}
    </li>
  );
}
