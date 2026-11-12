import Link from "next/link";
import type { ReactNode } from "react";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { punyaHak } from "@/lib/hakAkses";
import { lingkupPerusahaan, saringPerusahaan } from "@/lib/perusahaan";
import { bacaParamDaftar } from "@/lib/daftar";
import { bacaFilterProyek, filterProyekSah } from "@/lib/filterProyek";
import { formatTanggal, tanggalIso } from "@/lib/waktu";
import { tanggalDariIso } from "@/lib/pemasaran";
import { bacaSaringanKonten, bulanBerjalan, geserBulan, kartuKanbanKonten, kolomKanbanKonten, kontenDaftar, kontenKalender, kontenKanban, teksTerbit } from "@/lib/konten";
import { LABEL_PLATFORM, STATUS_DESAIN, STATUS_KONTEN, URUTAN_PLATFORM, URUTAN_STATUS_KONTEN } from "@/lib/labelPemasaran";
import { pindahStatusKontenDariPapan } from "@/lib/aksi/konten";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import KontrolDaftar from "@/komponen/ui/KontrolDaftar";
import Kanban from "@/komponen/ui/Kanban";
import Ikon from "@/komponen/ui/Ikon";
import LencanaPerusahaan from "@/komponen/ui/LencanaPerusahaan";
import FilterProyek from "@/komponen/proyek/FilterProyek";
import LencanaProyek from "@/komponen/proyek/LencanaProyek";
import KalenderKonten, { type SelKalenderKonten } from "@/komponen/pemasaran/KalenderKonten";
import LaciKonten from "@/komponen/pemasaran/LaciKonten";
import { LencanaPersetujuanKonten, LencanaStatusKonten, TitikPlatform } from "@/komponen/pemasaran/LencanaPemasaran";

/*
 * Perencana Konten (D6 §7.2): tampilan kalender (bawaan), kanban, dan daftar konten media sosial menurut lingkup
 * perusahaan aktif, dengan laci ?konten= untuk konten baru dan detail (D6 §7.3). Semua saringan berupa parameter URL,
 * jadi tautan, tombol tutup laci, dan isian `kembali` formulir mempertahankan tampilan yang sedang dibuka.
 */

type Tampilan = "kalender" | "kanban" | "daftar";
const TAMPILAN: { kunci: Tampilan; label: string; ikon: string }[] = [
  { kunci: "kalender", label: "Kalender", ikon: "calendar_month" },
  { kunci: "kanban", label: "Kanban", ikon: "view_kanban" },
  { kunci: "daftar", label: "Daftar", ikon: "view_list" },
];
const PILIHAN_PERSETUJUAN = [
  { nilai: "MENUNGGU", label: "Menunggu" },
  { nilai: "DISETUJUI", label: "Disetujui" },
  { nilai: "DITOLAK", label: "Ditolak" },
] as const;
const POLA_TANGGAL = /^\d{4}-\d{2}-\d{2}$/;

const satu = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v ?? "").trim();

/** "2026-11" menjadi "November 2026". */
function judulBulan(bulan: string): string {
  const [y, m] = bulan.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("id-ID", { month: "long", year: "numeric", timeZone: "UTC" });
}

export default async function HalamanPerencanaKonten({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const pengguna = await wajibHak("konten.lihat");
  const sp = await searchParams;
  const lingkup = await lingkupPerusahaan();
  const gabungan = lingkup.perusahaanId === null;
  const tampilanMentah = satu(sp.tampilan);
  const tampilan: Tampilan = tampilanMentah === "kanban" || tampilanMentah === "daftar" ? tampilanMentah : "kalender";
  const saringan = bacaSaringanKonten(sp);
  saringan.proyek = await filterProyekSah(db, bacaFilterProyek(sp));
  if (tampilan !== "daftar") saringan.persetujuan = "";
  const bulan = saringan.bulan!;
  const param = await bacaParamDaftar(Promise.resolve(sp));

  // parameter tampilan yang dipertahankan semua tautan halaman ini
  const dasar: Record<string, string> = {
    tampilan: tampilan === "kalender" ? "" : tampilan,
    bulan: tampilan !== "daftar" && bulan !== bulanBerjalan() ? bulan : "",
    platform: saringan.platform ?? "",
    status: saringan.status ?? "",
    persetujuan: saringan.persetujuan ?? "",
    proyek: saringan.proyek ?? "",
    q: tampilan === "daftar" ? param.q : "",
    hal: tampilan === "daftar" && param.hal > 1 ? String(param.hal) : "",
  };
  const qs = (ubah: Record<string, string | undefined> = {}) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...dasar, ...ubah })) if (v) u.set(k, v);
    return u.toString();
  };
  const url = (ubah: Record<string, string | undefined> = {}) => {
    const s = qs(ubah);
    return s ? `/pemasaran/konten?${s}` : "/pemasaran/konten";
  };

  const bolehBuat = punyaHak(pengguna, "konten.buat");
  const lihatDesain = punyaHak(pengguna, "tugas-desain.lihat");
  const penyetuju = punyaHak(pengguna, "konten.setujui");
  const [proyekLingkup, menunggu] = await Promise.all([
    db.proyek.findMany({ where: saringPerusahaan(lingkup.perusahaanId), orderBy: { kode: "asc" }, select: { id: true, kode: true, nama: true, status: true } }),
    penyetuju ? db.konten.count({ where: { diarsipkanPada: null, statusPersetujuan: "MENUNGGU", ...saringPerusahaan(lingkup.perusahaanId) } }) : 0,
  ]);

  const idLaci = satu(sp.konten);
  const tanggalAwal = POLA_TANGGAL.test(satu(sp.tanggal)) && tanggalDariIso(satu(sp.tanggal)) ? satu(sp.tanggal) : null;
  const navigasiBulan = { sebelum: url({ bulan: geserBulan(bulan, -1), hal: "" }), hariIni: url({ bulan: "", hal: "" }), sesudah: url({ bulan: geserBulan(bulan, 1), hal: "" }) };

  let isi: ReactNode;
  if (tampilan === "kalender") {
    const { sel, tanpaTanggal } = await kontenKalender(db, saringan, lingkup.perusahaanId);
    const hariIni = tanggalIso(new Date());
    const selKalender: SelKalenderKonten[] = sel.map((s) => ({
      tanggal: s.tanggal,
      hari: String(Number(s.tanggal.slice(8))),
      label: formatTanggal(tanggalDariIso(s.tanggal)!),
      diBulanIni: s.tanggal.startsWith(bulan),
      hariIni: s.tanggal === hariIni,
      konten: s.konten.map((k) => ({ id: k.id, href: url({ konten: k.id }), judul: k.judul, jam: k.jamTerbit, platform: k.platform })),
    }));
    isi = (
      <div className="space-y-2">
        <KalenderKonten judulBulan={judulBulan(bulan)} sel={selKalender} navigasi={navigasiBulan} bolehBuat={bolehBuat} hrefBaru={url({ konten: "baru" })} />
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
          {bolehBuat && <span>Klik dua kali pada tanggal untuk merencanakan konten baru.</span>}
          {tanpaTanggal > 0 && (
            <Link href={url({ tampilan: "daftar", bulan: "" })} className="tombol-tautan">
              {tanpaTanggal.toLocaleString("id-ID")} konten belum dijadwalkan.
            </Link>
          )}
        </div>
      </div>
    );
  } else if (tampilan === "kanban") {
    const kolom = await kontenKanban(db, saringan, lingkup.perusahaanId);
    const kartu = kolom.flatMap((k) => k.konten.map((x) => kartuKanbanKonten(x, { lihatDesain, href: (id) => url({ konten: id }) })));
    isi = (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="judul-kartu capitalize">{judulBulan(bulan)}</h2>
          <div className="flex items-center gap-1">
            <Link href={navigasiBulan.sebelum} className="tombol tombol-garis tombol-kecil !px-2" aria-label="Bulan sebelumnya">
              <Ikon nama="chevron_left" className="!text-[18px]" />
            </Link>
            <Link href={navigasiBulan.hariIni} className="tombol tombol-garis tombol-kecil">
              <Ikon nama="today" className="!text-[16px]" /> Hari ini
            </Link>
            <Link href={navigasiBulan.sesudah} className="tombol tombol-garis tombol-kecil !px-2" aria-label="Bulan berikutnya">
              <Ikon nama="chevron_right" className="!text-[18px]" />
            </Link>
          </div>
        </div>
        <p className="text-xs text-slate-500">Konten bertanggal terbit di bulan ini ditambah konten yang belum dijadwalkan.</p>
        <Kanban
          kolom={kolomKanbanKonten(kolom, (status) => url({ tampilan: "daftar", status, bulan: "", hal: "" }))}
          kartu={kartu}
          bolehPindah={punyaHak(pengguna, "konten.ubah")}
          pindah={pindahStatusKontenDariPapan}
          kosong="Belum ada konten"
        />
      </div>
    );
  } else {
    const { total, baris } = await kontenDaftar(db, saringan, param, lingkup.perusahaanId);
    const adaSaringan = !!(saringan.platform || saringan.status || saringan.persetujuan || saringan.proyek);
    isi = (
      <div className="kartu kartu-tabel">
        <KontrolDaftar
          param={param}
          total={total}
          placeholder="Cari judul, caption, tagar…"
          tambahan={{ tampilan: "daftar", platform: dasar.platform, status: dasar.status, persetujuan: dasar.persetujuan, proyek: dasar.proyek }}
          adaSaringan={adaSaringan}
        />
        <div className="bungkus-tabel">
          <table className="tabel min-w-[64rem]">
            <thead>
              <tr>
                <th>Judul</th>
                {gabungan && <th>Perusahaan</th>}
                <th>Proyek</th>
                <th>Platform</th>
                <th>Jenis</th>
                <th>Terbit</th>
                <th>Status</th>
                <th>Persetujuan</th>
                <th>Desain</th>
                <th>SMM</th>
              </tr>
            </thead>
            <tbody>
              {baris.map((k) => (
                <tr key={k.id}>
                  <td className="max-w-xs">
                    <Link href={url({ konten: k.id })} scroll={false} className="tombol-tautan font-medium">
                      {k.judul}
                    </Link>
                  </td>
                  {gabungan && (
                    <td>
                      <LencanaPerusahaan kode={k.perusahaan.kode} warna={k.perusahaan.warna} nama={k.perusahaan.nama} />
                    </td>
                  )}
                  <td>{k.proyek ? <LencanaProyek proyek={k.proyek} /> : <span className="text-slate-400">-</span>}</td>
                  <td>
                    <TitikPlatform platform={k.platform} denganLabel />
                  </td>
                  <td>{k.jenisKonten ?? "-"}</td>
                  <td className="whitespace-nowrap angka">{teksTerbit(k) ?? <span className="text-slate-400">Belum dijadwalkan</span>}</td>
                  <td>
                    <LencanaStatusKonten status={k.status} />
                  </td>
                  <td>
                    <LencanaPersetujuanKonten status={k.statusPersetujuan} />
                  </td>
                  <td>{lihatDesain && k.tugasAktif ? STATUS_DESAIN[k.tugasAktif.status].label : "-"}</td>
                  <td>{k.smm?.nama ?? "-"}</td>
                </tr>
              ))}
              {baris.length === 0 && (
                <tr>
                  <td colSpan={gabungan ? 10 : 9} className="kosong">
                    {param.q || adaSaringan ? "Tidak ada yang cocok dengan pencarian." : "Belum ada konten yang direncanakan"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <KepalaHalaman
        jejak={[{ label: "Pemasaran" }, { label: "Perencana Konten" }]}
        judul="Perencana Konten"
        subjudul="Rencanakan, tinjau, dan jadwalkan konten untuk Instagram, Facebook, TikTok, dan Threads."
        lencana={
          penyetuju && menunggu > 0 ? (
            <Link href={`/pemasaran/konten?tampilan=daftar&persetujuan=MENUNGGU`} className="lencana lencana-amber">
              {menunggu.toLocaleString("id-ID")} menunggu persetujuan
            </Link>
          ) : undefined
        }
        aksi={
          bolehBuat ? (
            <Link href={url({ konten: "baru" })} scroll={false} className="tombol tombol-utama min-h-11 w-full sm:w-auto">
              <Ikon nama="add" className="!text-[18px]" /> Konten baru
            </Link>
          ) : undefined
        }
      />

      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
        <nav className="flex gap-1 rounded-lg bg-slate-100 p-1 self-start" aria-label="Tampilan">
          {TAMPILAN.map((t) => (
            <Link
              key={t.kunci}
              href={url({ tampilan: t.kunci === "kalender" ? "" : t.kunci, hal: "", q: "", persetujuan: t.kunci === "daftar" ? dasar.persetujuan : "" })}
              aria-current={t.kunci === tampilan ? "page" : undefined}
              className={`inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium ${t.kunci === tampilan ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
            >
              <Ikon nama={t.ikon} className="!text-[18px]" /> {t.label}
            </Link>
          ))}
        </nav>
        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-3">
          <FilterProyek nilai={saringan.proyek ?? ""} daftar={proyekLingkup} tambahan={{ ...dasar, hal: "" }} label="Proyek" />
          <form method="get" className="flex flex-wrap items-center gap-2" aria-label="Saringan konten">
            {Object.entries({ tampilan: dasar.tampilan, bulan: dasar.bulan, proyek: dasar.proyek, q: dasar.q }).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
            <select name="platform" defaultValue={dasar.platform} aria-label="Platform" className="isian isian-kecil w-auto">
              <option value="">Semua platform</option>
              {URUTAN_PLATFORM.map((p) => (
                <option key={p} value={p}>
                  {LABEL_PLATFORM[p]}
                </option>
              ))}
            </select>
            <select name="status" defaultValue={dasar.status} aria-label="Status" className="isian isian-kecil w-auto">
              <option value="">Semua status</option>
              {URUTAN_STATUS_KONTEN.map((s) => (
                <option key={s} value={s}>
                  {STATUS_KONTEN[s].label}
                </option>
              ))}
            </select>
            {tampilan === "daftar" && (
              <select name="persetujuan" defaultValue={dasar.persetujuan} aria-label="Persetujuan" className="isian isian-kecil w-auto">
                <option value="">Semua</option>
                {PILIHAN_PERSETUJUAN.map((p) => (
                  <option key={p.nilai} value={p.nilai}>
                    {p.label}
                  </option>
                ))}
              </select>
            )}
            <button type="submit" className="tombol tombol-garis tombol-kecil">
              Terapkan
            </button>
          </form>
        </div>
      </div>

      {isi}

      {idLaci && (
        <LaciKonten
          id={idLaci}
          pengguna={pengguna}
          lingkup={lingkup}
          tutupHref={url()}
          kembali={qs()}
          tanggalAwal={tanggalAwal}
          proyekAwal={saringan.proyek && saringan.proyek !== "tanpa" ? saringan.proyek : null}
        />
      )}
    </div>
  );
}
