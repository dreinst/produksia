import { db } from "@/lib/db";
import { punyaHak, type PenggunaSesi } from "@/lib/hakAkses";
import { ringkasanKontenBeranda, type RingkasanKontenBeranda } from "@/lib/konten";
import { ringkasanDesainBeranda, type RingkasanDesainBeranda } from "@/lib/desain";
import { ringkasanIklan, type RingkasanIklan } from "@/lib/iklan";
import { KELAS_BATANG, LABEL_PLATFORM, STATUS_DESAIN, STATUS_KONTEN, STATUS_PERSETUJUAN_KONTEN, TITIK_PLATFORM, kelasLencana } from "@/lib/labelPemasaran";
import { daftarPerusahaan } from "@/lib/perusahaan";
import { formatTanggal } from "@/lib/waktu";
import KartuKpi from "@/komponen/ui/KartuKpi";
import BatangStatus from "@/komponen/ui/BatangStatus";
import LencanaPerusahaan from "@/komponen/ui/LencanaPerusahaan";

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

/**
 * Tab "Pemasaran" beranda (D7 §7.4): kartu Konten, Tugas desain, dan Iklan Meta, masing-masing bersyarat hak.
 * Tautan ke halaman Pemasaran dipasang paket Pemasaran setelah halamannya ada.
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
          <h2 className="judul-kartu">Iklan Meta</h2>
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
                        const persetujuan = STATUS_PERSETUJUAN_KONTEN[k.statusPersetujuan];
                        return (
                          <li key={k.id} className="py-2 flex items-start justify-between gap-3 text-sm">
                            <div className="min-w-0">
                              <div className="font-medium text-slate-800 truncate">{k.judul}</div>
                              <div className="text-xs text-slate-500 flex items-center gap-1.5">
                                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${TITIK_PLATFORM[k.platform]}`} aria-hidden="true" />
                                {LABEL_PLATFORM[k.platform]} · {formatTanggal(k.tanggalTerbit)}
                                {k.jamTerbit ? `, ${k.jamTerbit.replace(":", ".")}` : ""}
                              </div>
                            </div>
                            <div className="flex flex-wrap justify-end items-center gap-1.5 shrink-0">
                              {p && <LencanaPerusahaan kode={p.kode} warna={p.warna} nama={p.nama} />}
                              <span className={kelasLencana(STATUS_KONTEN[k.status].warna)}>{STATUS_KONTEN[k.status].label}</span>
                              {persetujuan && k.statusPersetujuan !== "DISETUJUI" && <span className={kelasLencana(persetujuan.warna)}>{persetujuan.label}</span>}
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
            </div>
          )}
        </div>
      )}
    </div>
  );
}
