import Link from "next/link";
import { db } from "@/lib/db";
import { wajibMasuk } from "@/lib/otentikasi";
import { bacaParamDaftar } from "@/lib/daftar";
import { LABEL_JENIS_NOTIFIKASI, syaratDaftarNotifikasi } from "@/lib/notifikasi";
import { periksaPengingat } from "@/lib/pengingat";
import { formatWaktu } from "@/lib/waktu";
import { bukaNotifikasiFormulir, tandaiNotifikasiDibacaFormulir, tandaiSemuaNotifikasiDibacaFormulir } from "@/lib/aksi/notifikasi";
import FormulirAksi from "@/komponen/FormulirAksi";
import Ikon from "@/komponen/ui/Ikon";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import KontrolDaftar from "@/komponen/ui/KontrolDaftar";

const UKURAN_HALAMAN_NOTIFIKASI = 20;

/** Semua notifikasi milik pengguna yang masuk, lintas perusahaan (D7 §7.5). Tidak ada di menu; dibuka dari lonceng. */
export default async function HalamanNotifikasi({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const pengguna = await wajibMasuk();
  await periksaPengingat(pengguna);
  const param = await bacaParamDaftar(searchParams, UKURAN_HALAMAN_NOTIFIKASI);
  const mentah = (await searchParams).belum;
  const belum = (Array.isArray(mentah) ? mentah[0] : mentah) === "1";

  const where = syaratDaftarNotifikasi(pengguna.id, { belum, q: param.q });
  const [total, daftar, adaBelum] = await Promise.all([
    db.notifikasi.count({ where }),
    db.notifikasi.findMany({
      where,
      select: { id: true, judul: true, isi: true, jenis: true, dibaca: true, dibuatPada: true, perusahaan: { select: { nama: true } } },
      orderBy: [{ dibuatPada: "desc" }, { id: "desc" }],
      skip: param.lewati,
      take: param.ambil,
    }),
    db.notifikasi.count({ where: { penggunaId: pengguna.id, dibaca: false } }),
  ]);

  return (
    <div className="space-y-6">
      <KepalaHalaman
        jejak={[{ label: "Beranda", href: "/" }, { label: "Notifikasi" }]}
        judul="Notifikasi"
        subjudul="Penugasan, permintaan dan hasil persetujuan, serta pengingat jatuh tempo dari semua perusahaan."
        aksi={
          <>
            <Link href={belum ? "/notifikasi" : "/notifikasi?belum=1"} className="tombol tombol-garis">
              {belum ? "Tampilkan semua" : "Belum dibaca saja"}
            </Link>
            {adaBelum > 0 && (
              <FormulirAksi aksi={tandaiSemuaNotifikasiDibacaFormulir} pesanSukses="Semua notifikasi ditandai dibaca.">
                <button type="submit" className="tombol tombol-garis">
                  <Ikon nama="done_all" className="!text-[18px]" />
                  Tandai semua dibaca
                </button>
              </FormulirAksi>
            )}
          </>
        }
      />
      <div className="kartu kartu-tabel">
        <KontrolDaftar param={param} total={total} placeholder="Cari judul notifikasi…" tambahan={{ belum: belum ? "1" : undefined }} />
        {daftar.length === 0 ? (
          <p className="px-5 md:px-6 py-8 text-sm text-slate-500 text-center">{belum ? "Tidak ada notifikasi yang belum dibaca." : "Belum ada notifikasi."}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {daftar.map((n) => {
              const jenis = LABEL_JENIS_NOTIFIKASI[n.jenis];
              return (
                <li key={n.id} className="flex items-start gap-2 px-3 md:px-4 py-1">
                  <FormulirAksi aksi={bukaNotifikasiFormulir.bind(null, n.id)} className="flex-1 min-w-0">
                    <button type="submit" className="w-full flex items-start gap-3 px-2 py-2.5 rounded-lg text-left hover:bg-slate-50">
                      <span className={`mt-1.5 w-2 h-2 shrink-0 rounded-full ${n.dibaca ? "bg-transparent" : "bg-blue-600"}`} aria-hidden="true" />
                      <span className="min-w-0 flex-1 space-y-0.5">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className={`text-sm text-slate-900 ${n.dibaca ? "" : "font-semibold"}`}>{n.judul}</span>
                          <span className={jenis.cls}>{jenis.label}</span>
                        </span>
                        {n.isi && <span className="block text-sm text-slate-600">{n.isi}</span>}
                        <span className="block text-xs text-slate-400">
                          {formatWaktu(n.dibuatPada)}
                          {n.perusahaan ? ` · ${n.perusahaan.nama}` : ""}
                        </span>
                      </span>
                    </button>
                  </FormulirAksi>
                  {!n.dibaca && (
                    <FormulirAksi aksi={tandaiNotifikasiDibacaFormulir.bind(null, n.id)} className="shrink-0 pt-2">
                      <button type="submit" className="tombol tombol-garis tombol-kecil" title="Tandai dibaca">
                        <Ikon nama="mark_email_read" className="!text-[16px]" />
                        <span className="hidden sm:inline">Tandai dibaca</span>
                      </button>
                    </FormulirAksi>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
