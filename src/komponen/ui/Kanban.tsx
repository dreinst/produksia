"use client";

import Link from "next/link";
import { useEffect, useOptimistic, useRef, useState, useTransition, type ReactElement } from "react";
import type { StatusFormulir } from "@/lib/statusFormulir";
import Ikon from "@/komponen/ui/Ikon";

/*
 * Papan kanban generik (D4 §7.4, ditambah lencana, titik, dan dialogAlasan dari D6 §7.10; DESAIN F10). Dipakai CRM
 * (pipeline lead) dan Pemasaran (konten, tugas desain). Kartu bisa diseret ke kolom lain atau dipindah lewat pilihan
 * "Pindah ke tahap" (layar sentuh dan papan ketik). Pemindahan optimistis: kartu langsung pindah, kembali ke posisi
 * lama bila aksi `pindah` mengembalikan galat. Data segar datang dari revalidatePath di aksi.
 */

export type NadaKanban = "blue" | "emerald" | "rose" | "amber" | "slate";
export type KolomKanban = { id: string; judul: string; ringkasan?: string; nada?: NadaKanban; lebihBanyak?: { jumlah: number; href: string } };
export type KartuKanban = {
  id: string;
  kolomId: string;
  judul: string;
  subjudul?: string;
  baris?: string[];
  href?: string;
  /** lencana kecil di kaki kartu, dirender `lencana lencana-<nada>` */
  lencana?: { teks: string; nada: NadaKanban }[];
  /** kelas warna titik di depan subjudul, mis. "bg-pink-500" */
  titik?: string;
};
export type DialogAlasanKanban = { judul: string; label: string; wajib: boolean };

const GARIS_NADA: Record<NadaKanban, string> = {
  blue: "bg-blue-500",
  emerald: "bg-emerald-500",
  rose: "bg-rose-500",
  amber: "bg-amber-500",
  slate: "bg-slate-400",
};

type Permintaan = { kartuId: string; kolomId: string };

export default function Kanban({
  kolom,
  kartu,
  bolehPindah,
  pindah,
  dialogAlasan,
  kosong = "Belum ada kartu",
}: {
  kolom: KolomKanban[];
  kartu: KartuKanban[];
  bolehPindah: boolean;
  pindah: (kartuId: string, kolomId: string, alasan: string) => Promise<StatusFormulir>;
  /** per kolomId tujuan: pemindahan ke kolom itu meminta alasan lebih dulu */
  dialogAlasan?: Record<string, DialogAlasanKanban>;
  kosong?: string;
}): ReactElement {
  const [tampil, pindahOptimis] = useOptimistic(kartu, (daftar: KartuKanban[], p: Permintaan) => daftar.map((k) => (k.id === p.kartuId ? { ...k, kolomId: p.kolomId } : k)));
  const [, mulai] = useTransition();
  const [pesan, setPesan] = useState<{ galat: boolean; teks: string } | null>(null);
  const [dialog, setDialog] = useState<Permintaan | null>(null);
  const [sorot, setSorot] = useState<string | null>(null);

  const judulKolom = (id: string) => kolom.find((k) => k.id === id)?.judul ?? id;

  function jalankan(p: Permintaan, alasan: string) {
    setPesan(null);
    mulai(async () => {
      pindahOptimis(p);
      try {
        const hasil = await pindah(p.kartuId, p.kolomId, alasan);
        setPesan(hasil.galat ? { galat: true, teks: hasil.galat } : { galat: false, teks: `Dipindah ke ${judulKolom(p.kolomId)}` });
      } catch {
        setPesan({ galat: true, teks: "Kartu gagal dipindah. Coba lagi." });
      }
    });
  }

  function minta(kartuId: string, kolomId: string) {
    if (!bolehPindah) return;
    const k = tampil.find((x) => x.id === kartuId);
    if (!k || k.kolomId === kolomId || !kolom.some((x) => x.id === kolomId)) return;
    if (dialogAlasan?.[kolomId]) {
      setDialog({ kartuId, kolomId });
      return;
    }
    jalankan({ kartuId, kolomId }, "");
  }

  return (
    <div className="space-y-3">
      {pesan &&
        (pesan.galat ? (
          <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {pesan.teks}
          </p>
        ) : (
          <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {pesan.teks}
          </p>
        ))}

      <div className="flex gap-4 overflow-x-auto pb-2">
        {kolom.map((kol) => {
          const isi = tampil.filter((k) => k.kolomId === kol.id);
          return (
            <section
              key={kol.id}
              aria-label={kol.judul}
              className={`w-72 shrink-0 rounded-xl border border-slate-200 bg-slate-50/70 p-3 ${sorot === kol.id ? "ring-2 ring-blue-300" : ""}`}
              onDragOver={(e) => {
                if (!bolehPindah) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (sorot !== kol.id) setSorot(kol.id);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setSorot(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setSorot(null);
                const id = e.dataTransfer.getData("text/plain");
                if (id) minta(id, kol.id);
              }}
            >
              <header className="mb-3 space-y-0.5">
                <div className="flex items-center gap-2">
                  {kol.nada && <span className={`w-2 h-2 rounded-full shrink-0 ${GARIS_NADA[kol.nada]}`} aria-hidden="true" />}
                  <h3 className="font-heading text-sm font-bold text-slate-900 truncate">{kol.judul}</h3>
                  <span className="ml-auto text-xs text-slate-500 angka">{isi.length + (kol.lebihBanyak?.jumlah ?? 0)}</span>
                </div>
                {kol.ringkasan && <p className="text-xs text-slate-500">{kol.ringkasan}</p>}
              </header>

              <ul className="space-y-2">
                {isi.length === 0 && <li className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-400">{kosong}</li>}
                {isi.map((k) => (
                  <li
                    key={k.id}
                    draggable={bolehPindah}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", k.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm space-y-1.5"
                  >
                    <div className="flex items-start gap-1.5">
                      {bolehPindah && <Ikon nama="drag_indicator" className="!text-[18px] text-slate-300 cursor-grab shrink-0" />}
                      <div className="min-w-0 flex-1">
                        {k.href ? (
                          <Link href={k.href} className="block text-sm font-semibold text-slate-900 hover:text-blue-700 hover:underline break-words">
                            {k.judul}
                          </Link>
                        ) : (
                          <p className="text-sm font-semibold text-slate-900 break-words">{k.judul}</p>
                        )}
                        {k.subjudul && (
                          <p className="flex items-center gap-1.5 text-xs text-slate-500">
                            {k.titik && <span className={`w-2 h-2 rounded-full shrink-0 ${k.titik}`} aria-hidden="true" />}
                            <span className="truncate">{k.subjudul}</span>
                          </p>
                        )}
                      </div>
                    </div>
                    {k.baris?.map((b, i) => (
                      <p key={i} className="text-xs text-slate-600 break-words">
                        {b}
                      </p>
                    ))}
                    {k.lencana && k.lencana.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {k.lencana.map((l, i) => (
                          <span key={i} className={`lencana lencana-${l.nada}`}>
                            {l.teks}
                          </span>
                        ))}
                      </div>
                    )}
                    {bolehPindah && (
                      <select
                        aria-label="Pindah ke tahap"
                        value=""
                        onChange={(e) => {
                          const tujuan = e.target.value;
                          if (tujuan) minta(k.id, tujuan);
                        }}
                        className="isian isian-kecil"
                      >
                        <option value="">Pindah ke…</option>
                        {kolom
                          .filter((x) => x.id !== k.kolomId)
                          .map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.judul}
                            </option>
                          ))}
                      </select>
                    )}
                  </li>
                ))}
              </ul>

              {kol.lebihBanyak && kol.lebihBanyak.jumlah > 0 && (
                <Link href={kol.lebihBanyak.href} className="tombol-tautan mt-3 inline-block">
                  {`${kol.lebihBanyak.jumlah} lainnya`}
                </Link>
              )}
            </section>
          );
        })}
      </div>

      {dialog && dialogAlasan?.[dialog.kolomId] && (
        <DialogAlasan
          isi={dialogAlasan[dialog.kolomId]}
          onBatal={() => setDialog(null)}
          onKonfirmasi={(alasan) => {
            const p = dialog;
            setDialog(null);
            jalankan(p, alasan);
          }}
        />
      )}
    </div>
  );
}

/** Dialog alasan sebelum pindah ke kolom tertentu (mis. Kalah). Pola DialogVerifikasi; isian hilang saat ditutup. */
function DialogAlasan({ isi, onBatal, onKonfirmasi }: { isi: DialogAlasanKanban; onBatal: () => void; onKonfirmasi: (alasan: string) => void }) {
  const [alasan, setAlasan] = useState("");
  const kotak = useRef<HTMLTextAreaElement>(null);
  const kosong = isi.wajib && alasan.trim() === "";

  useEffect(() => {
    kotak.current?.focus();
    const tutup = (e: KeyboardEvent) => {
      if (e.key === "Escape") onBatal();
    };
    window.addEventListener("keydown", tutup);
    return () => window.removeEventListener("keydown", tutup);
  }, [onBatal]);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-slate-900/40" onClick={onBatal}>
      <div role="dialog" aria-modal="true" aria-labelledby="judul-alasan-kanban" className="muncul w-full max-w-lg rounded-xl bg-white shadow-xl border border-slate-200" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
          <Ikon nama="edit_note" className="!text-[22px] text-blue-600" />
          <h2 id="judul-alasan-kanban" className="font-heading text-base font-bold text-slate-900">
            {isi.judul}
          </h2>
        </div>
        <div className="px-5 py-4 bidang">
          <label className="label" htmlFor="alasan-kanban">
            {isi.wajib ? `${isi.label} *` : isi.label}
          </label>
          <textarea id="alasan-kanban" ref={kotak} rows={3} value={alasan} onChange={(e) => setAlasan(e.target.value)} className="isian h-auto py-2" />
        </div>
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 px-5 py-4 border-t border-slate-100">
          <button type="button" onClick={onBatal} className="tombol tombol-garis">
            Batal
          </button>
          <button type="button" disabled={kosong} onClick={() => onKonfirmasi(alasan.trim())} className="tombol tombol-utama">
            Konfirmasi
          </button>
        </div>
      </div>
    </div>
  );
}
