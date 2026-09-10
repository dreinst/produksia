"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import Ikon from "@/komponen/ui/Ikon";
import Logo from "@/komponen/ui/Logo";
import FormulirAksi from "@/komponen/FormulirAksi";
import { gantiTahunBukuFormulir } from "@/lib/aksi/pengaturan";
import { punyaHak, type Hak, type PenggunaSesi } from "@/lib/hakAkses";

type TautanNavigasi = { href: string; label: string; kode?: string; hak: Hak };
type Grup = { judul: string; ikon: string; tautan: TautanNavigasi[] };

const operasional: Grup[] = [
  {
    judul: "Penjualan",
    ikon: "point_of_sale",
    tautan: [
      { href: "/penjualan/penawaran", label: "Penawaran", kode: "PNW", hak: "penawaran.lihat" },
      { href: "/penjualan/pesanan", label: "Pesanan", kode: "PSJ", hak: "pesanan.lihat" },
      { href: "/penjualan/uang-muka", label: "Uang Muka", kode: "UM", hak: "uang-muka.lihat" },
      { href: "/penjualan/pengiriman", label: "Pengiriman", kode: "SJ", hak: "pengiriman.lihat" },
      { href: "/penjualan/faktur", label: "Faktur Penjualan", kode: "FJ", hak: "faktur.lihat" },
      { href: "/penjualan/penerimaan", label: "Penerimaan", kode: "TRM", hak: "penerimaan.lihat" },
      { href: "/penjualan/retur", label: "Retur Penjualan", kode: "RJ", hak: "retur-penjualan.lihat" },
    ],
  },
  {
    judul: "Pembelian",
    ikon: "shopping_bag",
    tautan: [
      { href: "/pembelian/pesanan", label: "Pesanan", kode: "PSB", hak: "pesanan-pembelian.lihat" },
      { href: "/pembelian/penerimaan-barang", label: "Penerimaan Barang", kode: "TB", hak: "penerimaan-barang.lihat" },
      { href: "/pembelian/faktur", label: "Faktur Pembelian", kode: "FB", hak: "faktur-pembelian.lihat" },
      { href: "/pembelian/pembayaran", label: "Pembayaran", kode: "BYR", hak: "pembayaran.lihat" },
      { href: "/pembelian/retur", label: "Retur Pembelian", kode: "RB", hak: "retur-pembelian.lihat" },
    ],
  },
  {
    judul: "Kas & Bank",
    ikon: "account_balance",
    tautan: [
      { href: "/kas-bank/masuk", label: "Kas Masuk", kode: "KM", hak: "kas-masuk.lihat" },
      { href: "/kas-bank/keluar", label: "Kas Keluar", kode: "KK", hak: "kas-keluar.lihat" },
      { href: "/kas-bank/prive", label: "Prive", kode: "PRV", hak: "prive.lihat" },
    ],
  },
  {
    judul: "Buku Besar",
    ikon: "menu_book",
    tautan: [
      { href: "/buku-besar/jurnal", label: "Jurnal Umum", kode: "JU", hak: "jurnal.lihat" },
      { href: "/buku-besar/mutasi", label: "Buku Besar Mutasi", hak: "buku-besar.lihat" },
      { href: "/buku-besar/tutup-buku", label: "Tutup Buku", kode: "TUTUP", hak: "buku-besar.lihat" },
    ],
  },
  {
    judul: "Laporan",
    ikon: "monitoring",
    tautan: [
      { href: "/buku-besar/neraca-saldo", label: "Neraca Saldo", hak: "buku-besar.lihat" },
      { href: "/laporan/piutang", label: "Laporan Piutang", hak: "buku-besar.lihat" },
      { href: "/laporan/hutang", label: "Laporan Hutang", hak: "buku-besar.lihat" },
      { href: "/buku-besar/neraca", label: "Neraca", hak: "buku-besar.lihat" },
      { href: "/buku-besar/laba-rugi", label: "Laba Rugi (per event / per waktu)", hak: "buku-besar.lihat" },
      { href: "/laporan/perubahan-modal", label: "Perubahan Modal", hak: "buku-besar.lihat" },
      { href: "/laporan/prive", label: "Laporan Prive", hak: "buku-besar.lihat" },
      { href: "/buku-besar/arus-kas", label: "Arus Kas", hak: "buku-besar.lihat" },
      { href: "/buku-besar/pajak", label: "Pajak & SPT", hak: "buku-besar.lihat" },
    ],
  },
  {
    judul: "Rekonsiliasi",
    ikon: "fact_check",
    tautan: [
      { href: "/rekonsiliasi", label: "Rekonsiliasi Event (LPJ)", kode: "LPJ", hak: "rekonsiliasi.lihat" },
      { href: "/rekonsiliasi/kas-bank", label: "Rekonsiliasi Kas/Bank", hak: "rekonsiliasi.lihat" },
      { href: "/rekonsiliasi/mutasi", label: "Impor Mutasi Rekening", kode: "CSV", hak: "rekonsiliasi.tulis" },
    ],
  },
  {
    judul: "Aset Tetap",
    ikon: "domain",
    tautan: [
      { href: "/aset-tetap", label: "Daftar Aset", hak: "aset.lihat" },
      { href: "/aset-tetap/penyusutan", label: "Hitung Penyusutan", kode: "PNY", hak: "penyusutan.lihat" },
    ],
  },
];

const persediaan: Grup = {
  judul: "Persediaan",
  ikon: "inventory_2",
  tautan: [
    { href: "/persediaan", label: "Stok per Gudang", hak: "persediaan.lihat" },
    { href: "/persediaan/penyesuaian", label: "Penyesuaian Stok", kode: "PS", hak: "penyesuaian.lihat" },
    { href: "/persediaan/pindah", label: "Pindah Barang", kode: "PB", hak: "pindah-barang.lihat" },
  ],
};

const dataInduk: Grup = {
  judul: "Data Induk",
  ikon: "dataset",
  tautan: [
    { href: "/data-induk/pelanggan", label: "Pelanggan", hak: "data-induk.lihat" },
    { href: "/data-induk/pemasok", label: "Pemasok", hak: "data-induk.lihat" },
    { href: "/data-induk/barang", label: "Barang & Jasa", hak: "data-induk.lihat" },
    { href: "/data-induk/kelompok-barang", label: "Kelompok Barang", hak: "data-induk.lihat" },
    { href: "/data-induk/gudang", label: "Gudang", hak: "data-induk.lihat" },
    { href: "/data-induk/akun", label: "Bagan Akun", hak: "data-induk.lihat" },
    { href: "/data-induk/departemen", label: "Departemen", hak: "data-induk.lihat" },
    { href: "/data-induk/karyawan", label: "Karyawan", hak: "data-induk.lihat" },
    { href: "/data-induk/proyek", label: "Proyek", hak: "data-induk.lihat" },
  ],
};

const tautanPengaturan: (TautanNavigasi & { ikon: string })[] = [
  { href: "/pengaturan/perusahaan", label: "Perusahaan & Pajak", ikon: "domain", hak: "pengaturan.tulis" },
  { href: "/pengaturan/pemetaan-akun", label: "Pemetaan Akun", ikon: "tune", hak: "pemetaan.tulis" },
  { href: "/pengaturan/bagan-akun", label: "Bagan Akun Standar", ikon: "account_tree", hak: "pengaturan.tulis" },
  { href: "/pengaturan/pengguna", label: "Pengguna", ikon: "group", hak: "pengguna.kelola" },
  { href: "/pengaturan/hak-akses", label: "Hak Akses", ikon: "shield", hak: "hak-akses.kelola" },
  { href: "/pengaturan/log-aktivitas", label: "Log Aktivitas", ikon: "history", hak: "log-aktivitas.lihat" },
];

/** Menyaring grup & tautan sesuai hak peran; grup tanpa tautan tersisa disembunyikan. */
function saringGrup(daftar: Grup[], pengguna: PenggunaSesi): Grup[] {
  return daftar
    .map((g) => ({ ...g, tautan: g.tautan.filter((l) => punyaHak(pengguna, l.hak)) }))
    .filter((g) => g.tautan.length > 0);
}

function aktifDi(pathname: string, href: string) {
  if (href === "/aset-tetap") return pathname === "/aset-tetap" || pathname === "/aset-tetap/baru" || /^\/aset-tetap\/[^/]+\/lepas$/.test(pathname);
  if (href === "/rekonsiliasi") return pathname === "/rekonsiliasi" || pathname.startsWith("/rekonsiliasi/event");
  return pathname === href || pathname.startsWith(href + "/");
}

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
  const memuatAktif = group.tautan.some((l) => aktifDi(pathname, l.href));
  const panelId = `nav-${group.judul.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div>
      <button
        type="button"
        onClick={saatBuka}
        aria-expanded={open}
        aria-controls={panelId}
        className={`flex w-full items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-colors select-none ${
          memuatAktif ? "text-slate-900" : "text-slate-600 hover:text-slate-900"
        } hover:bg-slate-50`}
      >
        <span className="flex items-center gap-3">
          <Ikon nama={group.ikon} className={`!text-[20px] ${memuatAktif ? "text-slate-700" : "text-slate-400"}`} />
          <span>{group.judul}</span>
        </span>
        <Ikon
          nama="expand_more"
          className={`!text-[18px] text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div id={panelId} className="pl-9 pr-2 py-1 space-y-0.5 text-[13px]">
          {group.tautan.map((l) => {
            const aktif = aktifDi(pathname, l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                onClick={saatNavigasi}
                aria-current={aktif ? "page" : undefined}
                className={`flex items-center justify-between gap-2 py-1.5 px-2 rounded-md transition-all duration-150 ${
                  aktif ? "bg-slate-100 text-navy font-semibold" : "text-slate-500 hover:text-navy hover:bg-slate-50 hover:translate-x-0.5"
                }`}
              >
                <span className="truncate">{l.label}</span>
                {l.kode && <span className="mono text-[10px] text-slate-400">{l.kode}</span>}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TautanTunggal({ href, label, ikon, pathname, saatNavigasi }: { href: string; label: string; ikon: string; pathname: string; saatNavigasi: () => void }) {
  const aktif = aktifDi(pathname, href);
  return (
    <Link
      href={href}
      onClick={saatNavigasi}
      aria-current={aktif ? "page" : undefined}
      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
        aktif ? "bg-navy text-white shadow-sm" : "text-slate-600 hover:text-slate-900 hover:bg-slate-50 hover:translate-x-0.5"
      }`}
    >
      <Ikon nama={ikon} className={`!text-[20px] ${aktif ? "" : "text-slate-400"}`} />
      <span>{label}</span>
    </Link>
  );
}

/** Accordion: satu grup terbuka; grup yang memuat halaman aktif terbuka otomatis (reset via key={pathname}). */
function AkordeonNavigasi({ pengguna, pathname, saatNavigasi }: { pengguna: PenggunaSesi; pathname: string; saatNavigasi: () => void }) {
  const grupOperasional = saringGrup(operasional, pengguna);
  const grupDataInduk = saringGrup([persediaan, dataInduk], pengguna);
  const pengaturanBoleh = tautanPengaturan.filter((l) => punyaHak(pengguna, l.hak));
  const semuaGrup = [...grupOperasional, ...grupDataInduk];

  const judulAktif = semuaGrup.find((g) => g.tautan.some((l) => aktifDi(pathname, l.href)))?.judul ?? null;
  const [judulTerbuka, setJudulTerbuka] = useState<string | null>(judulAktif);
  const alihkan = (judul: string) => setJudulTerbuka((cur) => (cur === judul ? null : judul));

  return (
    <nav className="space-y-5" aria-label="Menu utama">
      <div className="space-y-0.5">
        <TautanTunggal href="/" label="Beranda" ikon="space_dashboard" pathname={pathname} saatNavigasi={saatNavigasi} />
      </div>

      {grupOperasional.length > 0 && (
        <div className="space-y-1">
          <span className="px-3 teks-label">Operasional</span>
          {grupOperasional.map((g) => (
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
      )}

      {(grupDataInduk.length > 0 || pengaturanBoleh.length > 0) && (
        <div className="space-y-1">
          <span className="px-3 teks-label">Administrasi &amp; Pengaturan</span>
          {grupDataInduk.map((g) => (
            <GrupNavigasi
              key={g.judul}
              group={g}
              pathname={pathname}
              open={judulTerbuka === g.judul}
              saatBuka={() => alihkan(g.judul)}
              saatNavigasi={saatNavigasi}
            />
          ))}
          {pengaturanBoleh.map((l) => (
            <TautanTunggal key={l.href} href={l.href} label={l.label} ikon={l.ikon} pathname={pathname} saatNavigasi={saatNavigasi} />
          ))}
        </div>
      )}
    </nav>
  );
}

function StatusBasisData() {
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
  const label = keadaan === "ok" ? "Terhubung" : keadaan === "galat" ? "Gagal" : "…";
  return (
    <div className="flex items-center justify-between px-3 py-2 bg-slate-50 rounded-lg text-xs font-medium text-slate-600">
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${titik}`} />
        <span>PostgreSQL 18</span>
      </div>
      <span className="text-[10px] text-slate-400 font-mono">{label}</span>
    </div>
  );
}

export default function BilahSamping({ pengguna, namaPerusahaan, tahunBuku, daftarTahun, open, saatTutup }: { pengguna: PenggunaSesi; namaPerusahaan: string; tahunBuku: number; daftarTahun: number[]; open: boolean; saatTutup: () => void }) {
  const pathname = usePathname();
  const hariIni = new Date();
  const tahunBerjalan = tahunBuku === hariIni.getFullYear();
  const akhirTahunBuku = tahunBerjalan ? `${tahunBuku}-${String(hariIni.getMonth() + 1).padStart(2, "0")}-${String(hariIni.getDate()).padStart(2, "0")}` : `${tahunBuku}-12-31`;
  const bolehGantiTahun = punyaHak(pengguna, "pengaturan.tulis");

  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-slate-900/40 md:hidden" onClick={saatTutup} aria-hidden="true" />}

      <aside
        aria-label="Navigasi utama"
        className={`fixed left-0 top-0 z-50 h-full w-72 max-w-[85vw] md:w-64 md:max-w-none bg-white border-r border-slate-100 flex flex-col
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
            <div className="flex flex-col min-w-0">
              <span className="text-xs font-semibold text-slate-900 truncate">{namaPerusahaan}</span>
              <span className="text-[11px] text-slate-500 font-medium">Tahun Buku {tahunBuku} • Rupiah</span>
            </div>
            <Ikon nama="unfold_more" className="!text-[18px] text-slate-400 group-open:rotate-180 transition-transform" />
          </summary>
          <div className="absolute left-3 right-3 z-40 mt-1 rounded-xl border border-slate-200 bg-white p-2 space-y-1" style={{ boxShadow: "var(--shadow-pop)" }}>
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
        <div className="px-3 py-1 flex-1 overflow-y-auto">
          <AkordeonNavigasi key={pathname} pengguna={pengguna} pathname={pathname} saatNavigasi={saatTutup} />
        </div>

        {/* Kaki */}
        <div className="p-3 border-t border-slate-100 shrink-0">
          <StatusBasisData />
        </div>
      </aside>
    </>
  );
}
