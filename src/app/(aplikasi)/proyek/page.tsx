import Link from "next/link";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { hakDataInduk, punyaHak } from "@/lib/hakAkses";
import { bacaParamDaftar } from "@/lib/daftar";
import { lingkupPerusahaan } from "@/lib/perusahaan";
import { daftarProyekUntukHalaman } from "@/lib/keuanganProyek";
import { penghitungTerlihat } from "@/lib/hitunganModulProyek";
import { LABEL_STATUS_PROYEK, STATUS_PROYEK, statusProyekSah } from "@/lib/proyek";
import { formatTanggal } from "@/lib/waktu";
import Ikon from "@/komponen/ui/Ikon";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import KontrolDaftar from "@/komponen/ui/KontrolDaftar";
import { LencanaStatus } from "@/komponen/ui/Lencana";
import LencanaPerusahaan from "@/komponen/ui/LencanaPerusahaan";
import TitikWarnaProyek from "@/komponen/proyek/TitikWarnaProyek";

/*
 * Proyek & Event (D5 §7.2): daftar proyek dalam lingkup perusahaan beserta jumlah pekerjaan per modul yang boleh
 * dilihat pengguna, tanpa angka keuangan. Saringan status bawaan menyembunyikan proyek diarsipkan. Tautan Keuangan
 * dipasang paket halaman keuangan proyek bersama rutenya.
 */

/** Nilai saringan status: kosong = semua kecuali diarsipkan, "semua" = semua status, selain itu satu status. */
const SEMUA = "semua";

function jadwalProyek(mulai: Date | null, selesai: Date | null): string {
  if (mulai && selesai) return `${formatTanggal(mulai)} s.d. ${formatTanggal(selesai)}`;
  if (mulai) return formatTanggal(mulai);
  if (selesai) return formatTanggal(selesai);
  return "-";
}

export default async function HalamanProyek({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const pengguna = await wajibHak("proyek.lihat");
  const boleh = (h: Parameters<typeof punyaHak>[1]) => punyaHak(pengguna, h);
  const param = await bacaParamDaftar(searchParams);
  const sp = await searchParams;
  const statusMentah = typeof sp.status === "string" ? sp.status.trim() : "";
  const status = statusMentah === SEMUA || statusProyekSah(statusMentah) ? statusMentah : "";
  const lingkup = await lingkupPerusahaan();
  const gabungan = lingkup.perusahaanId === null;

  const { total, baris } = await daftarProyekUntukHalaman(
    db,
    pengguna,
    { q: param.q, lewati: param.lewati, ambil: param.ambil, ...(status === "" ? { kecualiStatus: ["DIARSIP"] } : status === SEMUA ? {} : { status }) },
    lingkup.perusahaanId,
  );
  const penghitung = penghitungTerlihat((h) => boleh(h));
  const adaSaringan = !!param.q || status !== "";
  const lihatLpj = boleh("rekonsiliasi.lihat");
  const kolom = 3 + (gabungan ? 1 : 0) + penghitung.length + 1;

  return (
    <div className="space-y-6">
      <KepalaHalaman
        jejak={[{ label: "Proyek & Event" }]}
        judul="Proyek & Event"
        subjudul="Semua proyek beserta jumlah pekerjaan per modul. Proyek yang diarsipkan disembunyikan kecuali dipilih di filter status."
        aksi={
          boleh(hakDataInduk("proyek").tulis) && boleh(hakDataInduk("proyek").lihat) ? (
            <Link href="/data-induk/proyek" className="tombol tombol-utama">
              <Ikon nama="add" className="!text-[18px]" />
              Proyek baru
            </Link>
          ) : undefined
        }
      />

      <form method="get" className="kartu flex flex-wrap items-end gap-3">
        {param.q && <input type="hidden" name="q" value={param.q} />}
        <div className="space-y-1">
          <label htmlFor="saring-status" className="label">
            Status
          </label>
          <select id="saring-status" name="status" defaultValue={status} className="isian w-60">
            <option value="">Semua kecuali diarsipkan</option>
            {STATUS_PROYEK.map((s) => (
              <option key={s} value={s}>
                {LABEL_STATUS_PROYEK[s]}
              </option>
            ))}
            <option value={SEMUA}>Semua status</option>
          </select>
        </div>
        <button type="submit" className="tombol tombol-garis">
          Terapkan
        </button>
        {status !== "" && (
          <Link href={param.q ? `/proyek?${new URLSearchParams({ q: param.q })}` : "/proyek"} className="tombol-tautan">
            Atur ulang status
          </Link>
        )}
      </form>

      <div className="kartu kartu-tabel">
        <KontrolDaftar param={param} total={total} placeholder="Cari kode, nama proyek, atau klien…" tambahan={{ status: status || undefined }} adaSaringan={adaSaringan} />
        <div className="bungkus-tabel">
          <table className="tabel min-w-[48rem]">
            <thead>
              <tr>
                <th>Proyek</th>
                <th>Status</th>
                <th>Jadwal</th>
                {gabungan && <th>Perusahaan</th>}
                {penghitung.map((p) => (
                  <th key={p.kunci}>{p.label}</th>
                ))}
                <th className="th-lekat" aria-label="Aksi" />
              </tr>
            </thead>
            <tbody>
              {baris.length === 0 ? (
                <tr>
                  <td colSpan={kolom} className="kosong">
                    {adaSaringan ? "Tidak ada proyek yang cocok dengan pencarian." : "Belum ada proyek."}
                  </td>
                </tr>
              ) : (
                baris.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <div className="flex items-center gap-2">
                        <TitikWarnaProyek warna={p.warna} />
                        <span className="mono text-xs text-slate-500">{p.kode}</span>
                        <Link href={`/proyek/${p.id}`} className="font-semibold text-slate-900 hover:underline">
                          {p.nama}
                        </Link>
                        {p.terbatas && (
                          <span title="Berkas proyek ini dibatasi" className="inline-flex text-amber-700">
                            <Ikon nama="lock" className="!text-[16px]" />
                            <span className="sr-only">Berkas proyek dibatasi</span>
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">{p.klien ?? "Tanpa klien"}</div>
                    </td>
                    <td>
                      <LencanaStatus status={p.status} />
                    </td>
                    <td className="whitespace-nowrap text-slate-600">{jadwalProyek(p.tanggalMulai, p.tanggalSelesai)}</td>
                    {gabungan && (
                      <td>
                        <LencanaPerusahaan kode={p.perusahaan.kode} warna={p.perusahaan.warna} nama={p.perusahaan.nama} />
                      </td>
                    )}
                    {penghitung.map((h) => {
                      const n = p.hitungan[h.kunci] ?? { total: 0, terbuka: 0 };
                      const teks = `${n.terbuka.toLocaleString("id-ID")} terbuka · ${n.total.toLocaleString("id-ID")}`;
                      return (
                        <td key={h.kunci} className="whitespace-nowrap text-sm">
                          {h.tautan ? (
                            <Link href={h.tautan(p.id)} className="tombol-tautan">
                              {teks}
                            </Link>
                          ) : (
                            <span className="text-slate-600">{teks}</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="td-lekat whitespace-nowrap">
                      <span className="flex items-center gap-3">
                        <Link href={`/proyek/${p.id}`} className="tombol-tautan">
                          Ringkasan
                        </Link>
                        {lihatLpj && (
                          <Link href={`/rekonsiliasi/event/${p.id}`} className="tombol-tautan">
                            LPJ
                          </Link>
                        )}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
