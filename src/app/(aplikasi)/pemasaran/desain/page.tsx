import Link from "next/link";
import type { ReactNode } from "react";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { punyaHak } from "@/lib/hakAkses";
import { lingkupPerusahaan, saringPerusahaan } from "@/lib/perusahaan";
import { bacaParamDaftar } from "@/lib/daftar";
import { bacaFilterProyek, filterProyekSah } from "@/lib/filterProyek";
import { formatTanggal } from "@/lib/waktu";
import { LABEL_PLATFORM, PRIORITAS_DESAIN, STATUS_DESAIN, URUTAN_PRIORITAS, URUTAN_STATUS_DESAIN } from "@/lib/labelPemasaran";
import { bacaSaringanTugas, kartuKanbanTugas, kolomKanbanTugas, tugasDaftar, tugasKanban, tugasLewatTenggat } from "@/lib/desain";
import { pindahStatusDesainDariPapan } from "@/lib/aksi/desain";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import KontrolDaftar from "@/komponen/ui/KontrolDaftar";
import Kanban from "@/komponen/ui/Kanban";
import Ikon from "@/komponen/ui/Ikon";
import LencanaPerusahaan from "@/komponen/ui/LencanaPerusahaan";
import FilterProyek from "@/komponen/proyek/FilterProyek";
import LencanaProyek from "@/komponen/proyek/LencanaProyek";
import LaciTugasDesain from "@/komponen/pemasaran/LaciTugasDesain";
import { LencanaPrioritas, LencanaStatusDesain } from "@/komponen/pemasaran/LencanaPemasaran";

/*
 * Tugas Desain (D6 §7.4): papan kanban (bawaan) dan daftar tugas desain menurut lingkup perusahaan aktif, dengan laci
 * ?tugas= untuk permintaan baru dan detail (D6 §7.5). Seret ke kolom Revisi oleh peninjau meminta catatan revisi
 * lewat dialog; pengguna lain mendapat galat dari server.
 */

type Tampilan = "kanban" | "daftar";
const satu = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v ?? "").trim();

export default async function HalamanTugasDesain({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const pengguna = await wajibHak("tugas-desain.lihat");
  const sp = await searchParams;
  const lingkup = await lingkupPerusahaan();
  const gabungan = lingkup.perusahaanId === null;
  const tampilan: Tampilan = satu(sp.tampilan) === "daftar" ? "daftar" : "kanban";
  const saringan = bacaSaringanTugas(sp);
  saringan.proyek = await filterProyekSah(db, bacaFilterProyek(sp));
  if (tampilan !== "daftar") saringan.status = "";
  const param = await bacaParamDaftar(Promise.resolve(sp));

  const dasar: Record<string, string> = {
    tampilan: tampilan === "kanban" ? "" : tampilan,
    saya: saringan.saya ? "1" : "",
    proyek: saringan.proyek ?? "",
    prioritas: saringan.prioritas ?? "",
    status: saringan.status ?? "",
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
    return s ? `/pemasaran/desain?${s}` : "/pemasaran/desain";
  };

  const peninjau = punyaHak(pengguna, "tugas-desain.setujui");
  const [proyekLingkup, menunggu] = await Promise.all([
    db.proyek.findMany({ where: saringPerusahaan(lingkup.perusahaanId), orderBy: { kode: "asc" }, select: { id: true, kode: true, nama: true, status: true } }),
    peninjau ? db.tugasDesain.count({ where: { diarsipkanPada: null, status: "DITINJAU", ...saringPerusahaan(lingkup.perusahaanId) } }) : 0,
  ]);

  let isi: ReactNode;
  if (tampilan === "kanban") {
    const kolom = await tugasKanban(db, saringan, pengguna.id, lingkup.perusahaanId);
    const sekarang = new Date();
    const kartu = kolom.flatMap((k) => k.tugas.map((t) => kartuKanbanTugas(t, { href: (id) => url({ tugas: id }), sekarang })));
    isi = (
      <div className="space-y-3">
        <p className="text-xs text-slate-500">
          Kolom Selesai hanya memuat tugas yang selesai 30 hari terakhir.{peninjau ? " Memindah kartu ke kolom Revisi meminta catatan revisi." : ""}
        </p>
        <Kanban
          kolom={kolomKanbanTugas(kolom, (status) => url({ tampilan: "daftar", status, hal: "" }))}
          kartu={kartu}
          bolehPindah={punyaHak(pengguna, "tugas-desain.ubah")}
          pindah={pindahStatusDesainDariPapan}
          dialogAlasan={peninjau ? { REVISI: { judul: "Minta revisi", label: "Catatan revisi", wajib: true } } : undefined}
          kosong="Belum ada tugas"
        />
      </div>
    );
  } else {
    const { total, baris } = await tugasDaftar(db, saringan, param, pengguna.id, lingkup.perusahaanId);
    const adaSaringan = !!(saringan.saya || saringan.prioritas || saringan.status || saringan.proyek);
    const sekarang = new Date();
    isi = (
      <div className="kartu kartu-tabel">
        <KontrolDaftar
          param={param}
          total={total}
          placeholder="Cari judul atau deskripsi…"
          tambahan={{ tampilan: "daftar", saya: dasar.saya, proyek: dasar.proyek, prioritas: dasar.prioritas, status: dasar.status }}
          adaSaringan={adaSaringan}
        />
        <div className="bungkus-tabel">
          <table className="tabel min-w-[56rem]">
            <thead>
              <tr>
                <th>Tugas</th>
                {gabungan && <th>Perusahaan</th>}
                <th>Proyek</th>
                <th>Status</th>
                <th>Prioritas</th>
                <th>Desainer</th>
                <th>Tenggat</th>
                <th className="text-right">Revisi</th>
              </tr>
            </thead>
            <tbody>
              {baris.map((t) => {
                const konten = t.konten && !t.konten.diarsipkanPada ? t.konten : null;
                const lewat = tugasLewatTenggat(t, sekarang);
                return (
                  <tr key={t.id}>
                    <td className="max-w-xs">
                      <Link href={url({ tugas: t.id })} scroll={false} className="tombol-tautan font-medium">
                        {t.judul}
                      </Link>
                      {konten && (
                        <div className="text-xs text-slate-500">
                          Perencana · {LABEL_PLATFORM[konten.platform]}
                          {konten.tanggalTerbit ? ` · terbit ${formatTanggal(konten.tanggalTerbit)}` : ""}
                        </div>
                      )}
                    </td>
                    {gabungan && (
                      <td>
                        <LencanaPerusahaan kode={t.perusahaan.kode} warna={t.perusahaan.warna} nama={t.perusahaan.nama} />
                      </td>
                    )}
                    <td>{t.proyek ? <LencanaProyek proyek={t.proyek} /> : <span className="text-slate-400">-</span>}</td>
                    <td>
                      <LencanaStatusDesain status={t.status} />
                    </td>
                    <td>
                      <LencanaPrioritas prioritas={t.prioritas} />
                    </td>
                    <td>{t.desainer?.nama ?? <span className="text-slate-400">Belum ditugaskan</span>}</td>
                    <td className="whitespace-nowrap">
                      {t.tenggat ? <span className={lewat ? "text-rose-700 font-medium" : ""}>{formatTanggal(t.tenggat)}</span> : "-"}
                      {lewat && <div className="text-xs text-rose-700">Lewat tenggat</div>}
                    </td>
                    <td className="text-right angka">{t.jumlahRevisi}</td>
                  </tr>
                );
              })}
              {baris.length === 0 && (
                <tr>
                  <td colSpan={gabungan ? 8 : 7} className="kosong">
                    {param.q || adaSaringan ? "Tidak ada yang cocok dengan pencarian." : "Belum ada tugas desain"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  const idLaci = satu(sp.tugas);
  return (
    <div className="space-y-6">
      <KepalaHalaman
        jejak={[{ label: "Pemasaran" }, { label: "Tugas Desain" }]}
        judul="Tugas Desain"
        subjudul="Permintaan, ditugaskan, dikerjakan, ditinjau, revisi, disetujui, selesai."
        lencana={
          peninjau && menunggu > 0 ? (
            <Link href="/pemasaran/desain?tampilan=daftar&status=DITINJAU" className="lencana lencana-amber">
              {menunggu.toLocaleString("id-ID")} menunggu tinjauan
            </Link>
          ) : undefined
        }
        aksi={
          <>
            <Link href={url({ saya: saringan.saya ? "" : "1", hal: "" })} className="tombol tombol-garis min-h-11 w-full sm:w-auto" aria-pressed={saringan.saya}>
              <Ikon nama={saringan.saya ? "group" : "person"} className="!text-[18px]" /> {saringan.saya ? "Semua tugas" : "Tugas saya"}
            </Link>
            {punyaHak(pengguna, "tugas-desain.buat") && (
              <Link href={url({ tugas: "baru" })} scroll={false} className="tombol tombol-utama min-h-11 w-full sm:w-auto">
                <Ikon nama="add" className="!text-[18px]" /> Permintaan baru
              </Link>
            )}
          </>
        }
      />

      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
        <nav className="flex gap-1 rounded-lg bg-slate-100 p-1 self-start" aria-label="Tampilan">
          {(
            [
              { kunci: "kanban", label: "Kanban", ikon: "view_kanban" },
              { kunci: "daftar", label: "Daftar", ikon: "view_list" },
            ] as const
          ).map((t) => (
            <Link
              key={t.kunci}
              href={url({ tampilan: t.kunci === "kanban" ? "" : t.kunci, hal: "", q: "", status: t.kunci === "daftar" ? dasar.status : "" })}
              aria-current={t.kunci === tampilan ? "page" : undefined}
              className={`inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium ${t.kunci === tampilan ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
            >
              <Ikon nama={t.ikon} className="!text-[18px]" /> {t.label}
            </Link>
          ))}
        </nav>
        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-3">
          <FilterProyek nilai={saringan.proyek ?? ""} daftar={proyekLingkup} tambahan={{ ...dasar, hal: "" }} label="Proyek" />
          <form method="get" className="flex flex-wrap items-center gap-2" aria-label="Saringan tugas desain">
            {Object.entries({ tampilan: dasar.tampilan, saya: dasar.saya, proyek: dasar.proyek, q: dasar.q }).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
            <select name="prioritas" defaultValue={dasar.prioritas} aria-label="Prioritas" className="isian isian-kecil w-auto">
              <option value="">Semua prioritas</option>
              {URUTAN_PRIORITAS.map((p) => (
                <option key={p} value={p}>
                  {PRIORITAS_DESAIN[p].label}
                </option>
              ))}
            </select>
            {tampilan === "daftar" && (
              <select name="status" defaultValue={dasar.status} aria-label="Status" className="isian isian-kecil w-auto">
                <option value="">Semua status</option>
                {URUTAN_STATUS_DESAIN.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_DESAIN[s].label}
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
        <LaciTugasDesain
          id={idLaci}
          pengguna={pengguna}
          lingkup={lingkup}
          tutupHref={url()}
          kembali={qs()}
          kontenAwal={satu(sp.konten) || null}
          kampanyeAwal={satu(sp.kampanye) || null}
        />
      )}
    </div>
  );
}
