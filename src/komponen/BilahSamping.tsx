"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import Ikon from "@/komponen/ui/Ikon";
import Logo from "@/komponen/ui/Logo";
import { KreditPembuat } from "@/komponen/ui/KakiHalaman";
import FormulirAksi from "@/komponen/FormulirAksi";
import PemilihLingkup from "@/komponen/PemilihLingkup";
import LencanaPerusahaan from "@/komponen/ui/LencanaPerusahaan";
import { gantiTahunBukuFormulir } from "@/lib/aksi/pengaturan";
import { punyaHak, type PenggunaSesi } from "@/lib/hakAkses";
import { aktifDi, menuBagian, type BagianMenu, type Grup, type KunciBagian } from "@/lib/menu";
import type { RingkasPerusahaan } from "@/lib/perusahaan";

/*
 * Tinggi baris: 44 px di HP (target sentuh), 32 px di desktop untuk tautan atas dan grup, 28 px untuk sub-tautan.
 * Label panjang dipotong dengan elipsis dan tetap terbaca lewat title.
 */
const BARIS = "min-h-11 md:min-h-8";
const BARIS_SUB = "min-h-11 md:min-h-7";

function GrupNavigasi({
  group,
  pathname,
  open,
  saatBuka,
  saatNavigasi,
}: {
  group: Grup;
  pathname: string;
  open: boolean;
  saatBuka: () => void;
  saatNavigasi: () => void;
}) {
  const memuatAktif = group.tautan.some((l) => aktifDi(l.href, pathname));
  const panelId = `nav-${group.judul.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div>
      <button
        type="button"
        onClick={saatBuka}
        aria-expanded={open}
        aria-controls={panelId}
        className={`flex w-full items-center gap-2.5 px-3 ${BARIS} rounded-lg text-sm font-medium text-left transition-colors select-none ${
          memuatAktif ? "text-slate-900" : "text-slate-600 hover:text-slate-900"
        } hover:bg-slate-50`}
      >
        <Ikon nama={group.ikon} className={`!text-[18px] shrink-0 ${memuatAktif ? "text-slate-700" : "text-slate-400"}`} />
        <span className="flex-1 min-w-0 truncate" title={group.judul}>{group.judul}</span>
        <Ikon nama="expand_more" className={`!text-[16px] shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {/* Panel tertutup tetap ada di DOM (atribut hidden) supaya tautannya ikut terbaca perayap dan uji asap. */}
      <div id={panelId} hidden={!open} className="ml-[21px] border-l border-slate-200/80 pl-[9px] py-0.5 space-y-0.5 text-[13px]">
        {group.tautan.map((l) => {
          const aktif = aktifDi(l.href, pathname);
          return (
            <Link
              key={l.href}
              href={l.href}
              onClick={saatNavigasi}
              aria-current={aktif ? "page" : undefined}
              className={`flex items-center justify-between gap-2 px-2.5 ${BARIS_SUB} rounded-md transition-all duration-150 ${
                aktif ? "bg-slate-100 text-navy font-semibold" : "text-slate-500 hover:text-navy hover:bg-slate-50 hover:translate-x-0.5"
              }`}
            >
              <span className="min-w-0 truncate" title={l.label}>{l.label}</span>
              {l.kode && <span className="mono shrink-0 text-[10px] text-slate-400">{l.kode}</span>}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function TautanTunggal({ href, label, ikon, pathname, saatNavigasi }: { href: string; label: string; ikon: string; pathname: string; saatNavigasi: () => void }) {
  const aktif = aktifDi(href, pathname);
  return (
    <Link
      href={href}
      onClick={saatNavigasi}
      aria-current={aktif ? "page" : undefined}
      className={`flex items-center gap-2.5 px-3 ${BARIS} rounded-lg text-sm font-medium transition-all ${
        aktif ? "menu-aktif text-white" : "text-slate-600 hover:text-slate-900 hover:bg-slate-50 hover:translate-x-0.5"
      }`}
    >
      <Ikon nama={ikon} className={`!text-[18px] shrink-0 ${aktif ? "" : "text-slate-400"}`} />
      <span className="min-w-0 truncate" title={label}>{label}</span>
    </Link>
  );
}

/*
 * Pilihan lipat bagian (Operasional, Keuangan, Administrasi) diingat di localStorage. Dibaca lewat
 * useSyncExternalStore: render server dan render pertama klien sama-sama memakai bawaan (snapshot null), pilihan
 * tersimpan baru dipakai sesudah hidrasi. Bila localStorage tidak bisa dipakai, pilihan hanya diingat di memori.
 */
const KUNCI_LIPAT = "produksia.bilah-samping.bagian";
type PilihanLipat = Partial<Record<KunciBagian, boolean>>;
const pendengarLipat = new Set<() => void>();
let lipatDiMemori: string | null = null;

function langgananLipat(f: () => void) {
  pendengarLipat.add(f);
  window.addEventListener("storage", f);
  return () => {
    pendengarLipat.delete(f);
    window.removeEventListener("storage", f);
  };
}

function bacaLipat(): string | null {
  try {
    return window.localStorage.getItem(KUNCI_LIPAT) ?? lipatDiMemori;
  } catch {
    return lipatDiMemori;
  }
}

function simpanLipat(pilihan: PilihanLipat) {
  lipatDiMemori = JSON.stringify(pilihan);
  try {
    window.localStorage.setItem(KUNCI_LIPAT, lipatDiMemori);
  } catch {
    // penyimpanan diblokir peramban: cukup di memori
  }
  pendengarLipat.forEach((f) => f());
}

function uraiLipat(teks: string | null): PilihanLipat {
  if (!teks) return {};
  try {
    const isi: unknown = JSON.parse(teks);
    return isi && typeof isi === "object" ? (isi as PilihanLipat) : {};
  } catch {
    return {};
  }
}

/**
 * Tiga bagian yang bisa dilipat, masing-masing berisi grup akordeon: di seluruh menu hanya satu grup terbuka.
 * Grup dan bagian yang memuat halaman aktif terbuka saat halaman dimuat (state direset lewat key={pathname}).
 */
function AkordeonNavigasi({ pengguna, pathname, saatNavigasi }: { pengguna: PenggunaSesi; pathname: string; saatNavigasi: () => void }) {
  // Data dan aturan penyaringan menu ada di src/lib/menu.ts; komponen ini hanya merender.
  const { atas, bagian } = menuBagian(pengguna);
  const memuatAktif = (g: Grup) => g.tautan.some((l) => aktifDi(l.href, pathname));

  const judulAktif = bagian.flatMap((b) => b.grup).find(memuatAktif)?.judul ?? null;
  const [judulTerbuka, setJudulTerbuka] = useState<string | null>(judulAktif);
  const alihkan = (judul: string) => setJudulTerbuka((cur) => (cur === judul ? null : judul));

  const pilihan = uraiLipat(useSyncExternalStore(langgananLipat, bacaLipat, () => null));
  const kunciAktif = bagian.find((b) => b.grup.some(memuatAktif))?.kunci ?? null;
  // Bagian halaman aktif terbuka apa pun pilihan tersimpannya; pengguna tetap bisa melipatnya sampai pindah halaman.
  const [aktifDilipat, setAktifDilipat] = useState(false);
  const terbuka = (b: BagianMenu) => {
    if (b.kunci === kunciAktif) return !aktifDilipat;
    const tersimpan = pilihan[b.kunci];
    return typeof tersimpan === "boolean" ? tersimpan : b.terbukaBawaan;
  };
  const alihkanBagian = (b: BagianMenu) => {
    const lanjut = !terbuka(b);
    if (b.kunci === kunciAktif) setAktifDilipat(!lanjut);
    simpanLipat({ ...pilihan, [b.kunci]: lanjut });
  };

  return (
    <nav className="space-y-2 pb-2" aria-label="Menu utama">
      {atas.length > 0 && (
        <div className="space-y-0.5">
          {atas.map((t) => (
            <TautanTunggal key={t.href} href={t.href} label={t.label} ikon={t.ikon} pathname={pathname} saatNavigasi={saatNavigasi} />
          ))}
        </div>
      )}

      {bagian.map((b) => {
        const buka = terbuka(b);
        const panelId = `bagian-${b.kunci}`;
        return (
          <div key={b.kunci}>
            <button
              type="button"
              onClick={() => alihkanBagian(b)}
              aria-expanded={buka}
              aria-controls={panelId}
              className="teks-label flex w-full items-center justify-between gap-2 px-3 min-h-11 md:min-h-7 rounded-lg text-left select-none transition-colors hover:text-slate-600 hover:bg-slate-50"
            >
              <span>{b.judul}</span>
              <Ikon nama="expand_more" className={`!text-[16px] shrink-0 transition-transform ${buka ? "rotate-180" : ""}`} />
            </button>
            <div id={panelId} hidden={!buka} className="space-y-0.5">
              {b.grup.map((g) => (
                <GrupNavigasi
                  key={g.judul}
                  group={g}
                  pathname={pathname}
                  open={judulTerbuka === g.judul}
                  saatBuka={() => alihkan(g.judul)}
                  saatNavigasi={saatNavigasi}
                />
              ))}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

/** Kaki bilah: titik status basis data (keterangannya di title dan teks pembaca layar) dan kredit pembuat. */
function KakiBilah() {
  const [keadaan, setKeadaan] = useState<"memeriksa" | "ok" | "galat">("memeriksa");
  useEffect(() => {
    let dibatalkan = false;
    fetch("/api/status")
      .then((r) => r.json())
      .then((j) => !dibatalkan && setKeadaan(j?.ok ? "ok" : "galat"))
      .catch(() => !dibatalkan && setKeadaan("galat"));
    return () => {
      dibatalkan = true;
    };
  }, []);
  const titik = keadaan === "ok" ? "bg-emerald-500" : keadaan === "galat" ? "bg-rose-500" : "bg-slate-300 animate-pulse";
  const keterangan = keadaan === "ok" ? "Basis data terhubung" : keadaan === "galat" ? "Basis data gagal" : "Memeriksa basis data";
  return (
    <div className="flex items-center justify-center gap-2 text-[11px] text-slate-400">
      <span className="inline-flex items-center" title={keterangan}>
        <span aria-hidden="true" className={`w-2 h-2 rounded-full ${titik}`} />
        <span className="sr-only">{keterangan}</span>
      </span>
      <KreditPembuat />
    </div>
  );
}

export default function BilahSamping({
  pengguna,
  namaPerusahaan,
  tahunBuku,
  daftarTahun,
  perusahaanAktif,
  daftarPerusahaan,
  bolehGabungan,
  open,
  saatTutup,
}: {
  pengguna: PenggunaSesi;
  namaPerusahaan: string;
  tahunBuku: number;
  daftarTahun: number[];
  /** lingkup perusahaan aktif; null = gabungan semua perusahaan */
  perusahaanAktif: RingkasPerusahaan | null;
  daftarPerusahaan: RingkasPerusahaan[];
  bolehGabungan: boolean;
  open: boolean;
  saatTutup: () => void;
}) {
  const pathname = usePathname();
  const hariIni = new Date();
  const tahunBerjalan = tahunBuku === hariIni.getFullYear();
  const akhirTahunBuku = tahunBerjalan ? `${tahunBuku}-${String(hariIni.getMonth() + 1).padStart(2, "0")}-${String(hariIni.getDate()).padStart(2, "0")}` : `${tahunBuku}-12-31`;
  const bolehGantiTahun = punyaHak(pengguna, "pengaturan.tulis");
  const gabungan = perusahaanAktif === null;
  const jumlahPerusahaanAktif = daftarPerusahaan.filter((p) => p.aktif).length;

  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-slate-900/40 md:hidden" onClick={saatTutup} aria-hidden="true" />}

      <aside
        aria-label="Navigasi utama"
        className={`fixed left-0 top-0 z-50 h-full w-72 max-w-[85vw] md:w-64 md:max-w-none kaca border-r border-slate-200/60 flex flex-col
          transition-transform duration-200 md:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        {/* Merek */}
        <div className="h-16 px-5 flex items-center justify-between border-b border-slate-100/80 shrink-0">
          <Link href="/" onClick={saatTutup} className="flex flex-col gap-1 min-w-0" aria-label="Produksia, ke beranda">
            <Logo tinggi={26} />
            <span className="text-[9px] font-semibold tracking-[0.12em] text-slate-400 uppercase pl-0.5">
              Sistem Akuntansi Terpadu
            </span>
          </Link>
          <div className="flex items-center gap-1">
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-slate-100 text-slate-500 font-mono">v0.2</span>
            <button
              type="button"
              onClick={saatTutup}
              aria-label="Tutup menu"
              className="md:hidden rounded p-1 text-slate-500 hover:bg-slate-100"
            >
              <Ikon nama="close" className="!text-[18px]" />
            </button>
          </div>
        </div>

        {/* Perusahaan / tahun buku */}
        <details className="p-3 shrink-0 relative group">
          <summary
            className="bg-slate-50 border border-slate-200/60 rounded-xl px-3.5 py-2.5 flex items-center justify-between list-none cursor-pointer select-none hover:bg-slate-100 [&::-webkit-details-marker]:hidden"
            aria-label="Perusahaan & tahun buku"
          >
            <div className="flex flex-col min-w-0 gap-0.5">
              <span className="flex items-center gap-1.5 min-w-0">
                {gabungan ? (
                  <Ikon nama="hub" className="!text-[16px] text-slate-400 shrink-0" />
                ) : (
                  <LencanaPerusahaan kode={perusahaanAktif.kode} warna={perusahaanAktif.warna} nama={perusahaanAktif.nama} />
                )}
                <span className="text-xs font-semibold text-slate-900 truncate">{namaPerusahaan}</span>
              </span>
              <span className="text-[11px] text-slate-500 font-medium">
                Tahun Buku {tahunBuku} • Rupiah{gabungan ? ` · ${jumlahPerusahaanAktif} perusahaan` : ""}
              </span>
            </div>
            <Ikon nama="unfold_more" className="!text-[18px] text-slate-400 group-open:rotate-180 transition-transform" />
          </summary>
          <div className="absolute left-3 right-3 z-40 mt-1 rounded-xl border border-slate-200 bg-white p-2 space-y-1 max-h-[75vh] overflow-y-auto" style={{ boxShadow: "var(--shadow-pop)" }}>
            <div className="border-b border-slate-100 pb-1">
              <PemilihLingkup daftar={daftarPerusahaan} aktifId={perusahaanAktif?.id ?? null} bolehGabungan={bolehGabungan} />
            </div>
            <div className="px-2 py-1.5 text-[11px] text-slate-500 space-y-0.5 border-b border-slate-100">
              <div className="text-xs font-semibold text-slate-900 truncate">{namaPerusahaan}</div>
              <div>Mata uang: <span className="font-medium text-slate-700">Rupiah (IDR)</span> · satu mata uang</div>
              <div>Tahun buku dibuka: <span className="font-medium text-slate-700">{tahunBuku}</span>{tahunBerjalan ? " (berjalan)" : ""}</div>
            </div>
            {bolehGantiTahun ? (
              <FormulirAksi aksi={gantiTahunBukuFormulir} className="px-2 py-1.5 flex flex-wrap items-center gap-2" pesanSukses={`Tahun buku dibuka.`}>
                <label className="text-[11px] font-semibold text-slate-600" htmlFor="tahunBuku">Buka tahun</label>
                <select id="tahunBuku" name="tahunBuku" defaultValue={tahunBuku} className="isian isian-kecil w-auto">
                  {daftarTahun.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <button type="submit" className="tombol tombol-utama tombol-kecil">Buka</button>
              </FormulirAksi>
            ) : (
              <div className="px-2 py-1.5 text-[11px] text-slate-500">Tahun buku diatur oleh Superadmin/Pemilik/Admin.</div>
            )}
            <div className="border-t border-slate-100 pt-1">
              <Link href={`/buku-besar/laba-rugi?dari=${tahunBuku}-01-01&sampai=${akhirTahunBuku}`} onClick={saatTutup} className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-slate-700 hover:bg-slate-50">
                <Ikon nama="trending_up" className="!text-[16px] text-slate-400" /> Laba Rugi {tahunBuku}
              </Link>
              <Link href={`/buku-besar/neraca?sampai=${akhirTahunBuku}`} onClick={saatTutup} className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-slate-700 hover:bg-slate-50">
                <Ikon nama="balance" className="!text-[16px] text-slate-400" /> Neraca per {akhirTahunBuku}
              </Link>
              <Link href={`/buku-besar/arus-kas?dari=${tahunBuku}-01-01&sampai=${akhirTahunBuku}`} onClick={saatTutup} className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-slate-700 hover:bg-slate-50">
                <Ikon nama="payments" className="!text-[16px] text-slate-400" /> Arus Kas {tahunBuku}
              </Link>
              {bolehGantiTahun && (
                <Link href={`/buku-besar/tutup-buku?tahun=${tahunBuku}`} onClick={saatTutup} className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-slate-700 hover:bg-slate-50">
                  <Ikon nama="lock" className="!text-[16px] text-slate-400" /> Tutup Buku {tahunBuku}
                </Link>
              )}
              {bolehGantiTahun && (
                <Link href="/pengaturan/perusahaan" onClick={saatTutup} className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-slate-700 hover:bg-slate-50">
                  <Ikon nama="settings" className="!text-[16px] text-slate-400" /> Perusahaan &amp; Pajak
                </Link>
              )}
            </div>
          </div>
        </details>

        {/* Menu */}
        <div className="px-3 py-1 flex-1 overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: "touch" }}>
          <AkordeonNavigasi key={pathname} pengguna={pengguna} pathname={pathname} saatNavigasi={saatTutup} />
        </div>

        {/* Kaki */}
        <div className="px-3 py-2.5 border-t border-slate-100 shrink-0">
          <KakiBilah />
        </div>
      </aside>
    </>
  );
}
