"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as KeyboardEventReact, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Ikon from "@/komponen/ui/Ikon";

/*
 * Laci samping kanan (D6 §7.10), pola DialogVerifikasi. Dibuka lewat parameter URL (mis. ?konten=id), jadi menutup
 * laci berarti pindah ke `tutupHref` (URL yang sama tanpa parameter laci). Escape, klik lapisan, dan tombol Tutup
 * menutup laci, kecuali sedang ada dialog lain di dalamnya (pratinjau gambar, dialog konfirmasi) yang memakai Escape
 * sendiri. Bila ada isian yang sudah diubah tetapi belum disimpan, laci menanyakan dulu lewat dialog kecil di dalamnya.
 * Fokus pindah ke judul saat dibuka dan saat judul berganti (mis. "Konten baru" menjadi "Detail konten" sesudah
 * simpan), Tab dan Shift+Tab berputar di dalam laci, halaman di belakangnya dibuat `inert`, dan gulirnya dikunci.
 * Server merender laci di tempatnya (tetap terbaca tanpa JavaScript). Sesudah terpasang di klien, laci dipindah ke
 * document.body lewat portal, karena anak langsung <main className="animasi-masuk"> menyisakan transform dari animasi
 * masuk, sehingga `fixed` di dalamnya hanya menutupi kolom konten, bukan seluruh layar.
 */

const BISA_DIFOKUS = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Elemen di dalam `wadah` yang bisa dicapai Tab dan sedang tampil (bukan di dalam <details> tertutup atau inert). */
function elemenFokus(wadah: HTMLElement): HTMLElement[] {
  return [...wadah.querySelectorAll<HTMLElement>(BISA_DIFOKUS)].filter((el) => el.getClientRects().length > 0 && !el.closest("[inert]"));
}

/**
 * Tab dan Shift+Tab berputar di dalam `wadah` (pola jebakFokus Kanban). Event React dari portal (mis. dialog pratinjau
 * gambar di document.body) tetap merambat ke panel laci; event yang asalnya di luar `wadah` dibiarkan supaya Tab di
 * dialog itu tidak direbut laci.
 */
function putarFokus(e: KeyboardEventReact<HTMLElement>, wadah: HTMLElement | null) {
  if (e.key !== "Tab" || !wadah) return;
  if (!(e.target instanceof Node) || !wadah.contains(e.target)) return;
  const bisa = elemenFokus(wadah);
  if (bisa.length === 0) {
    e.preventDefault();
    return;
  }
  const awal = bisa[0];
  const akhir = bisa[bisa.length - 1];
  const aktif = document.activeElement;
  const diLuar = !bisa.includes(aktif as HTMLElement);
  if (e.shiftKey && (aktif === awal || diLuar)) {
    e.preventDefault();
    akhir.focus();
  } else if (!e.shiftKey && (aktif === akhir || diLuar)) {
    e.preventDefault();
    awal.focus();
  }
}

/**
 * Isian yang nilainya sudah diubah pengguna dari nilai bawaannya. Hanya elemen yang pernah menerima input atau change
 * yang diperiksa, supaya pilihan terkendali (tanpa defaultSelected) tidak dianggap berubah. Formulir yang sukses
 * disimpan dipasang ulang FormulirAksi, jadi elemen lamanya sudah lepas dari dokumen.
 */
function adaIsianBerubah(panel: HTMLElement, disentuh: Set<Element>): boolean {
  for (const el of disentuh) {
    if (!el.isConnected || !panel.contains(el)) continue;
    if (el instanceof HTMLInputElement) {
      if (el.disabled || ["hidden", "submit", "button", "reset", "image"].includes(el.type)) continue;
      if (el.type === "checkbox" || el.type === "radio" ? el.checked !== el.defaultChecked : el.value !== el.defaultValue) return true;
    } else if (el instanceof HTMLTextAreaElement) {
      if (!el.disabled && el.value !== el.defaultValue) return true;
    } else if (el instanceof HTMLSelectElement) {
      if (el.disabled) continue;
      const opsi = [...el.options];
      const bawaan = opsi.some((o) => o.defaultSelected) ? opsi.map((o) => o.defaultSelected) : opsi.map((_, i) => i === 0 && !el.multiple);
      if (opsi.some((o, i) => o.selected !== bawaan[i])) return true;
    }
  }
  return false;
}

export default function Laci({ judul, tutupHref, children, lebar = "md" }: { judul: string; tutupHref: string; children: ReactNode; lebar?: "md" | "lg" }) {
  const router = useRouter();
  const idJudul = useId();
  const idTanya = useId();
  const akar = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const kepala = useRef<HTMLHeadingElement>(null);
  const tanya = useRef<HTMLDivElement>(null);
  const disentuh = useRef(new Set<Element>());
  const kembaliKeJudul = useRef(false);
  const [diPortal, setDiPortal] = useState(false);
  const [tanyaTutup, setTanyaTutup] = useState(false);

  // pindah ke document.body sekali sesudah hidrasi (render pertama harus sama dengan HTML server)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setDiPortal(true), []);

  // kunci gulir dan buat saudara laci di body `inert` selama laci terbuka; dipulihkan saat laci dilepas
  useEffect(() => {
    if (!diPortal) return;
    const lama = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // pengumum rute Next dibiarkan, supaya perpindahan isi laci (mis. sesudah simpan) tetap diumumkan pembaca layar
    const dibuatInert = [...document.body.children].filter(
      (el): el is HTMLElement => el instanceof HTMLElement && el !== akar.current && !el.inert && el.tagName !== "SCRIPT" && el.tagName !== "NEXT-ROUTE-ANNOUNCER",
    );
    for (const el of dibuatInert) el.inert = true;
    return () => {
      document.body.style.overflow = lama;
      for (const el of dibuatInert) el.inert = false;
    };
  }, [diPortal]);

  // fokus ke judul saat dibuka dan saat isi laci berganti (instance yang sama dipakai ulang sesudah pengalihan)
  useEffect(() => {
    if (!diPortal) return;
    disentuh.current.clear();
    kepala.current?.focus();
  }, [diPortal, judul]);

  const tutup = useCallback(() => router.push(tutupHref, { scroll: false }), [router, tutupHref]);

  /** Tutup langsung bila tidak ada isian berubah; selain itu tanya dulu di dalam laci. */
  const mintaTutup = useCallback(() => {
    if (panel.current && adaIsianBerubah(panel.current, disentuh.current)) setTanyaTutup(true);
    else tutup();
  }, [tutup]);

  /** Kembali ke isian tanpa menutup; fokus ke judul supaya tidak jatuh ke body saat dialog tanya hilang. */
  const batalTutup = useCallback(() => {
    kembaliKeJudul.current = true;
    setTanyaTutup(false);
  }, []);

  useEffect(() => {
    const tekan = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // dialog lain (modal) yang terbuka di dalam laci menangani Escape-nya sendiri
      const modalLain = [...document.querySelectorAll('[aria-modal="true"]')].some((el) => el !== panel.current);
      if (modalLain) return;
      e.preventDefault();
      if (tanyaTutup) batalTutup();
      else mintaTutup();
    };
    window.addEventListener("keydown", tekan);
    return () => window.removeEventListener("keydown", tekan);
  }, [mintaTutup, batalTutup, tanyaTutup]);

  // dialog tanya: fokus ke tombol aman; sesudah batal, fokus ke judul begitu isi laci tidak lagi inert
  useEffect(() => {
    if (tanyaTutup) tanya.current?.querySelector<HTMLButtonElement>("button")?.focus();
    else if (kembaliKeJudul.current) {
      kembaliKeJudul.current = false;
      kepala.current?.focus();
    }
  }, [tanyaTutup]);

  const catatSentuh = (e: { target: EventTarget }) => {
    if (e.target instanceof Element) disentuh.current.add(e.target);
  };

  const laci = (
    <div ref={akar} className="fixed inset-0 z-50 flex justify-end bg-slate-900/40" onClick={() => (tanyaTutup ? batalTutup() : mintaTutup())}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idJudul}
        className={`muncul h-full w-full ${lebar === "lg" ? "sm:max-w-3xl" : "sm:max-w-2xl"} overflow-y-auto bg-white shadow-xl`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => putarFokus(e, tanyaTutup ? tanya.current : panel.current)}
        onInputCapture={catatSentuh}
        onChangeCapture={catatSentuh}
      >
        <div inert={tanyaTutup} className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-100 bg-white px-5 py-4">
          <h2 id={idJudul} ref={kepala} tabIndex={-1} className="font-heading text-lg font-bold text-slate-900 outline-none">
            {judul}
          </h2>
          <Link
            href={tutupHref}
            scroll={false}
            className="tombol tombol-garis tombol-kecil !px-2"
            aria-label="Tutup"
            onClick={(e) => {
              if (panel.current && adaIsianBerubah(panel.current, disentuh.current)) {
                e.preventDefault();
                setTanyaTutup(true);
              }
            }}
          >
            <Ikon nama="close" className="!text-[20px]" />
          </Link>
        </div>
        <div inert={tanyaTutup} className="space-y-5 px-5 py-5">
          {children}
        </div>
        {tanyaTutup && (
          <div className="sticky bottom-0 z-20 border-t border-amber-200 bg-amber-50 px-5 py-4 shadow-lg">
            <div ref={tanya} role="alertdialog" aria-labelledby={idTanya} className="space-y-3">
              <p id={idTanya} className="text-sm font-semibold text-amber-900">
                Ada isian yang belum disimpan. Tutup laci dan buang perubahannya?
              </p>
              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                <button type="button" className="tombol tombol-garis min-h-11" onClick={batalTutup}>
                  Lanjut mengisi
                </button>
                <button
                  type="button"
                  className="tombol tombol-bahaya min-h-11"
                  onClick={() => {
                    setTanyaTutup(false);
                    tutup();
                  }}
                >
                  Buang perubahan
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
  return diPortal ? createPortal(laci, document.body) : laci;
}
