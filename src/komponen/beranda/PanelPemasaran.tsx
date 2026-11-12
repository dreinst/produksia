import Link from "next/link";
import type { ReactNode } from "react";
import { db } from "@/lib/db";
import { punyaHak, type PenggunaSesi } from "@/lib/hakAkses";
import { ringkasanKontenBeranda, type RingkasanKontenBeranda } from "@/lib/konten";
import { ringkasanDesainBeranda, type RingkasanDesainBeranda } from "@/lib/desain";
import { ringkasanIklan, type RingkasanIklan } from "@/lib/iklan";
import { KELAS_BATANG, STATUS_DESAIN, STATUS_KONTEN } from "@/lib/labelPemasaran";
import { daftarPerusahaan } from "@/lib/perusahaan";
import { formatTanggal } from "@/lib/waktu";
import KartuKpi from "@/komponen/ui/KartuKpi";
import BatangStatus from "@/komponen/ui/BatangStatus";
import LencanaPerusahaan from "@/komponen/ui/LencanaPerusahaan";
import Ikon from "@/komponen/ui/Ikon";
import { LencanaPersetujuanKonten, LencanaStatusKonten, TitikPlatform } from "@/komponen/pemasaran/LencanaPemasaran";

export type DataPemasaran = {
  konten: RingkasanKontenBeranda | null;
  desain: RingkasanDesainBeranda | null;
  iklan: RingkasanIklan | null;
};

/**
 * Data tab Pemasaran (D7 §3.5): konten bila konten.lihat, tugas desain bila tugas-desain.lihat, iklan bila
 * kampanye.lihat. Bagian tanpa hak bernilai null dan kuerinya tidak dijalankan. Semua menurut lingkup perusahaan.
 */
export async function muatDataPemasaran(pengguna: PenggunaSesi, perusahaanId: string | null): Promise<DataPemasaran> {
  const [konten, desain, iklan] = await Promise.all([
    punyaHak(pengguna, "konten.lihat") ? ringkasanKontenBeranda(db, perusahaanId) : Promise.resolve(null),
    punyaHak(pengguna, "tugas-desain.lihat") ? ringkasanDesainBeranda(db, pengguna.id, perusahaanId) : Promise.resolve(null),
    punyaHak(pengguna, "kampanye.lihat") ? ringkasanIklan(db, {}, perusahaanId) : Promise.resolve(null),
  ]);
  return { konten, desain, iklan };
}

const rupiah = (n: { toString(): string }) => `Rp ${Number(n).toLocaleString("id-ID")}`;
/** ROAS dua desimal dengan koma, mis. "3,84x". */
const kali = (n: { toFixed(d: number): string }) => `${Number(n.toFixed(2)).toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`;

/** Tautan "Buka ..." di kaki kartu, menuju halaman modul yang haknya sama dengan syarat kartu itu. */
function TautanBuka({ href, ikon, children }: { href: string; ikon: string; children: ReactNode }) {
  return (
    <Link href={href} className="tombol tombol-lembut tombol-kecil">
      <Ikon nama={ikon} className="!text-[18px] text-slate-500" />
      {children}
    </Link>
  );
}

/**
 * Tab "Pemasaran" beranda (D7 §7.4): kartu Konten, Tugas desain, dan Iklan Meta, masing-masing bersyarat hak, dengan
 * tautan "Buka kalender konten" (konten.lihat), "Buka tugas desain" (tugas-desain.lihat), dan "Buka iklan"
 * (kampanye.lihat). Judul konten mendatang membuka lacinya di Perencana Konten. Lencana memakai LencanaPemasaran.
 */
export default async function PanelPemasaran({ pengguna, perusahaanId }: { pengguna: PenggunaSesi; perusahaanId: string | null }) {
  if (!punyaHak(pengguna, "konten.lihat") && !punyaHak(pengguna, "tugas-desain.lihat") && !punyaHak(pengguna, "kampanye.lihat")) return null;
  const [data, perusahaan] = await Promise.all([muatDataPemasaran(pengguna, perusahaanId), perusahaanId === null ? daftarPerusahaan(true) : Promise.resolve([])]);
  const petaPerusahaan = new Map(perusahaan.map((p) => [p.id, p]));
  const { konten, desain, iklan } = data;

  return (
    <div className="space-y-7">
      {iklan && (
        <section className="space-y-3" aria-label="Iklan Meta">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="judul-kartu">Iklan Meta</h2>
            <TautanBuka href="/pemasaran/iklan" ikon="ads_click">
              Buka iklan
            </TautanBuka>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            <KartuKpi judul="Kampanye aktif" ikon="bolt" nilai={iklan.aktif} awalan="" sub={`dari ${iklan.jumlahKampanye.toLocaleString("id-ID")} kampanye`} />
            <KartuKpi judul="Belanja iklan" ikon="payments" nilai={Number(iklan.total.belanja)} sub={`Anggaran rencana ${rupiah(iklan.anggaranRencana)}`} />
            <KartuKpi judul="Leads" ikon="group" nilai={iklan.total.leads} awalan="" sub={`${iklan.total.klik.toLocaleString("id-ID")} klik`} />
            <KartuKpi judul="ROAS" ikon="monitoring" nilai={kali(iklan.total.roas)} sub={`Pendapatan ${rupiah(iklan.total.pendapatan)}`} />
          </div>
        </section>
      )}

      {(konten || desain) && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-7">
          {konten && (
            <div className={`kartu ${desain ? "lg:col-span-8" : "lg:col-span-12"}`}>
              <div className="kepala-kartu">
                <div>
                  <h2 className="judul-kartu">Konten</h2>
                  <p className="subjudul-kartu">Konten per status dan jadwal terbit 14 hari ke depan.</p>
                </div>
                <TautanBuka href="/pemasaran/konten" ikon="calendar_month">
                  Buka kalender konten
                </TautanBuka>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <BatangStatus
                    label="Jumlah konten per status"
                    data={konten.perStatus.map((s) => ({ label: STATUS_KONTEN[s.status].label, nilai: s.jumlah, cls: KELAS_BATANG[STATUS_KONTEN[s.status].warna] }))}
                  />
                  <p className="text-xs text-slate-500 mt-3">Menunggu persetujuan: <span className="angka font-semibold text-slate-700">{konten.menungguPersetujuan.toLocaleString("id-ID")}</span></p>
                </div>
                <div>
                  <h3 className="text-xs font-semibold text-slate-500 mb-2">Akan terbit</h3>
                  {konten.mendatang.length === 0 ? (
                    <p className="text-sm text-slate-500">Tidak ada konten terjadwal 14 hari ke depan.</p>
                  ) : (
                    <ul className="divide-y divide-slate-100">
                      {konten.mendatang.map((k) => {
                        const p = petaPerusahaan.get(k.perusahaanId);
                        return (
                          // Judul memakai lebar penuh; platform dan tanggal tidak dipatahkan; lencana boleh turun ke baris berikutnya.
                          <li key={k.id} className="py-2 text-sm space-y-1">
                            <Link href={`/pemasaran/konten?konten=${k.id}`} className="block font-medium text-slate-800 truncate hover:text-blue-700 hover:underline" title={k.judul}>
                              {k.judul}
                            </Link>
                            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                              <div className="text-xs text-slate-500 flex items-center gap-1.5 whitespace-nowrap">
                                <TitikPlatform platform={k.platform} denganLabel /> · {formatTanggal(k.tanggalTerbit)}
                                {k.jamTerbit ? `, ${k.jamTerbit.replace(":", ".")}` : ""}
                              </div>
                              <div className="flex flex-wrap items-center gap-1.5">
                                {p && <LencanaPerusahaan kode={p.kode} warna={p.warna} nama={p.nama} />}
                                <LencanaStatusKonten status={k.status} />
                                {k.statusPersetujuan !== "DISETUJUI" && <LencanaPersetujuanKonten status={k.statusPersetujuan} />}
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          )}
          {desain && (
            <div className={`kartu ${konten ? "lg:col-span-4" : "lg:col-span-12"}`}>
              <div className="kepala-kartu">
                <div>
                  <h2 className="judul-kartu">Tugas desain</h2>
                  <p className="subjudul-kartu">Semua tugas desain aktif per status.</p>
                </div>
              </div>
              <BatangStatus
                label="Jumlah tugas desain per status"
                data={desain.perStatus.map((s) => ({ label: STATUS_DESAIN[s.status].label, nilai: s.jumlah, cls: KELAS_BATANG[STATUS_DESAIN[s.status].warna] }))}
              />
              <p className="text-xs text-slate-500 mt-3">Menunggu tinjauan: <span className="angka font-semibold text-slate-700">{desain.menungguTinjauan.toLocaleString("id-ID")}</span></p>
              <div className="mt-4">
                <TautanBuka href="/pemasaran/desain" ikon="palette">
                  Buka tugas desain
                </TautanBuka>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
