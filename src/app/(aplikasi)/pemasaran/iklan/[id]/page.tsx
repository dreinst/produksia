import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { punyaHak } from "@/lib/hakAkses";
import { lingkupPerusahaan } from "@/lib/perusahaan";
import { daftarBerkasTerlihat } from "@/lib/berkas";
import { formatTanggal } from "@/lib/waktu";
import { aturanHasil, kampanyeLengkap } from "@/lib/iklan";
import { LABEL_GENDER, LABEL_TUJUAN } from "@/lib/labelPemasaran";
import { arsipkanKampanyeFormulir, buatIklanFormulir, buatSetIklanFormulir, catatMetrikIklanFormulir, hapusIklanFormulir, hapusSetIklanFormulir, ubahIklanFormulir, ubahSetIklanFormulir } from "@/lib/aksi/iklan";
import FormulirAksi from "@/komponen/FormulirAksi";
import LampiranBerkas from "@/komponen/berkas/LampiranBerkas";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import KartuKpi from "@/komponen/ui/KartuKpi";
import Ikon from "@/komponen/ui/Ikon";
import LencanaPerusahaan from "@/komponen/ui/LencanaPerusahaan";
import LencanaProyek from "@/komponen/proyek/LencanaProyek";
import { LencanaPrioritas, LencanaStatusDesain, LencanaStatusKampanye } from "@/komponen/pemasaran/LencanaPemasaran";
import FormulirSetIklan from "@/komponen/iklan/FormulirSetIklan";
import FormulirIklan, { type KelompokKreatif } from "@/komponen/iklan/FormulirIklan";
import FormulirLaporanIklan from "@/komponen/iklan/FormulirLaporanIklan";
import TabelLaporanIklan, { duaDesimal } from "@/komponen/iklan/TabelLaporanIklan";

/*
 * Detail kampanye iklan (D6 §7.8): KPI, set iklan, iklan, laporan harian, lampiran kampanye, dan tugas desain terkait.
 * kampanyeLengkap menyaring berkas kreatif dan tugas desain menurut hak pembaca (perbaikan tinjauan P41 R4), dan pilihan
 * kreatif hanya memuat berkas yang terlihat (daftarBerkasTerlihat). Formulir per baris berada di <details> dengan id
 * isian berawalan unik (spec/06 §7.2). Kampanye milik perusahaan di luar lingkup aktif hanya memberi pemberitahuan.
 */

const rupiah = (n: { toString(): string }) => Number(n.toString()).toLocaleString("id-ID");

function Kartu({ judul, ikon, aksi, children }: { judul: string; ikon: string; aksi?: ReactNode; children: ReactNode }) {
  return (
    <section className="kartu space-y-4" aria-label={judul}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Ikon nama={ikon} className="!text-[20px] text-slate-500" />
          <h2 className="judul-kartu">{judul}</h2>
        </div>
        {aksi}
      </div>
      {children}
    </section>
  );
}

function Lipat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="rounded-lg border border-slate-200 p-3">
      <summary className="cursor-pointer text-sm font-semibold text-slate-700">{label}</summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

export default async function HalamanDetailKampanye({ params }: { params: Promise<{ id: string }> }) {
  const pengguna = await wajibHak("kampanye.lihat");
  const { id } = await params;
  const k = await kampanyeLengkap(db, id, pengguna);
  if (!k) notFound();
  const lingkup = await lingkupPerusahaan();
  const jejak = [{ label: "Pemasaran" }, { label: "Perencana Iklan Meta", href: "/pemasaran/iklan" }, { label: k.nama }];
  if (lingkup.perusahaanId !== null && k.perusahaanId !== lingkup.perusahaanId) {
    return (
      <div className="space-y-6">
        <KepalaHalaman jejak={jejak} judul={k.nama} />
        <p className="kartu text-sm text-amber-800">Data ini milik {k.perusahaan.nama}. Ganti perusahaan aktif untuk membukanya.</p>
      </div>
    );
  }

  const boleh = { buat: punyaHak(pengguna, "kampanye.buat"), ubah: punyaHak(pengguna, "kampanye.ubah"), hapus: punyaHak(pengguna, "kampanye.hapus") };
  const aturan = aturanHasil(k.tujuan);
  const t = k.total;
  // pilihan kreatif: lampiran kampanye dan berkas hasil tugas desain yang menaut kampanye ini, hanya yang terlihat
  const [lampiran, ...hasilTugas] = await Promise.all([
    daftarBerkasTerlihat(db, pengguna, { jenisEntitas: "kampanye", entitasId: k.id }, { lewati: 0, ambil: 200 }),
    ...k.tugasDesain.map((tg) => daftarBerkasTerlihat(db, pengguna, { jenisEntitas: "hasil-desain", entitasId: tg.id, tag: "HASIL" }, { lewati: 0, ambil: 100 })),
  ]);
  const kreatif: KelompokKreatif[] = [
    { label: "Lampiran kampanye", berkas: lampiran.baris.map((b) => ({ id: b.id, nama: b.namaBerkas })) },
    ...k.tugasDesain.map((tg, i) => ({ label: `Hasil desain: ${tg.judul}`, berkas: hasilTugas[i].baris.map((b) => ({ id: b.id, nama: b.namaBerkas })) })),
  ];
  const setPilihan = k.setIklan.map((s) => ({ id: s.id, nama: s.nama }));
  const periode = [k.tanggalMulai ? formatTanggal(k.tanggalMulai) : null, k.tanggalSelesai ? formatTanggal(k.tanggalSelesai) : null];
  const teksPeriode = periode[0] && periode[1] ? `${periode[0]} sampai ${periode[1]}` : periode[0] ? `mulai ${periode[0]}` : periode[1] ? `sampai ${periode[1]}` : "tanpa tanggal";

  return (
    <div className="space-y-6">
      <KepalaHalaman
        jejak={jejak}
        judul={k.nama}
        lencana={
          <>
            <LencanaStatusKampanye status={k.status} />
            {k.proyek && <LencanaProyek proyek={k.proyek} />}
            {lingkup.perusahaanId === null && <LencanaPerusahaan kode={k.perusahaan.kode} warna={k.perusahaan.warna} nama={k.perusahaan.nama} />}
          </>
        }
        subjudul={`${LABEL_TUJUAN[k.tujuan]} · Anggaran Rp ${rupiah(k.anggaran)} · ${teksPeriode}`}
        aksi={
          <>
            {boleh.ubah && (
              <Link href={`/pemasaran/iklan/${k.id}/ubah`} className="tombol tombol-garis min-h-11 w-full sm:w-auto">
                <Ikon nama="edit" className="!text-[18px]" /> Ubah
              </Link>
            )}
            {boleh.hapus && (
              <FormulirAksi aksi={arsipkanKampanyeFormulir.bind(null, k.id)} pesanKonfirmasi="Arsipkan kampanye ini? Set iklan, iklan, dan laporannya ikut tersembunyi.">
                <button type="submit" className="tombol tombol-bahaya min-h-11 w-full sm:w-auto">
                  Arsipkan
                </button>
              </FormulirAksi>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <KartuKpi judul="Belanja" ikon="payments" nilai={Number(t.belanja.toString())} />
        <KartuKpi judul="Jangkauan (jumlah harian)" ikon="group" nilai={t.jangkauan} awalan="" />
        <KartuKpi judul="CTR · CPC · CPM" ikon="ads_click" nilai={`${duaDesimal(t.ctr)}%`} sub={`CPC Rp ${rupiah(t.cpc)} · CPM Rp ${rupiah(t.cpm)}`} />
        <KartuKpi judul="Leads / Konversi" ikon="campaign" nilai={`${t.leads.toLocaleString("id-ID")} / ${t.konversi.toLocaleString("id-ID")}`} />
        <KartuKpi judul="Biaya per hasil" ikon="payments" nilai={Number((t.cpr ?? 0).toString())} sub={aturan ? `Hasil = ${aturan}` : "Hasil diisi manual"} />
        <KartuKpi judul="ROAS" ikon="monitoring" nilai={`${duaDesimal(t.roas)}x`} sub={`Rp ${rupiah(t.pendapatan)} pendapatan`} />
      </div>

      <Kartu judul="Set iklan" ikon="group">
        {boleh.buat && (
          <Lipat label="Tambah set iklan">
            <FormulirSetIklan aksi={buatSetIklanFormulir.bind(null, k.id)} awalan="set-baru-" tombol="Tambah set iklan" pesanSukses="Set iklan ditambahkan." />
          </Lipat>
        )}
        {k.setIklan.length === 0 ? (
          <p className="text-sm text-slate-500">Belum ada set iklan</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {k.setIklan.map((s) => (
              <li key={s.id} className="py-3 space-y-2">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                  <div className="min-w-0 text-sm">
                    <p className="font-semibold text-slate-800">{s.nama}</p>
                    <p className="text-slate-600">{[s.audiens, s.lokasi, s.usia, LABEL_GENDER[s.gender], s.penempatan, `Rp ${rupiah(s.anggaran)}`].filter(Boolean).join(" · ")}</p>
                    {s.catatan && <p className="text-xs text-slate-500 whitespace-pre-line">{s.catatan}</p>}
                  </div>
                  {boleh.hapus && (
                    <FormulirAksi aksi={hapusSetIklanFormulir.bind(null, s.id)} pesanKonfirmasi={`Hapus set iklan ${s.nama}?`}>
                      <button type="submit" className="tombol-tautan-bahaya text-sm">
                        Hapus
                      </button>
                    </FormulirAksi>
                  )}
                </div>
                {boleh.ubah && (
                  <Lipat label="Ubah">
                    <FormulirSetIklan
                      aksi={ubahSetIklanFormulir.bind(null, s.id)}
                      awalan={`ubah-set-${s.id}-`}
                      nilai={{ ...s, anggaran: s.anggaran.toString() }}
                      tombol="Simpan set iklan"
                      pesanSukses="Set iklan tersimpan."
                    />
                  </Lipat>
                )}
              </li>
            ))}
          </ul>
        )}
      </Kartu>

      <Kartu judul="Iklan" ikon="ads_click">
        {boleh.buat && k.setIklan.length > 0 && (
          <Lipat label="Tambah iklan">
            <FormulirIklan
              aksi={buatIklanFormulir.bind(null, k.id)}
              awalan="iklan-baru-"
              nilai={{ nama: "", setIklanId: k.setIklan[0].id, berkasKreatifId: null, judulIklan: null, cta: null, urlTujuan: null, teksUtama: null, catatan: null }}
              setIklan={setPilihan}
              kreatif={kreatif}
              tombol="Tambah iklan"
              pesanSukses="Iklan ditambahkan."
            />
          </Lipat>
        )}
        {k.iklan.length === 0 ? (
          <p className="text-sm text-slate-500">{k.setIklan.length === 0 ? "Belum ada iklan. Buat set iklan dulu." : "Belum ada iklan"}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {k.iklan.map((i) => (
              <li key={i.id} className="py-3 space-y-2">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                  <div className="min-w-0 text-sm space-y-0.5">
                    <p className="font-semibold text-slate-800">
                      {i.nama} <span className="font-normal text-xs text-slate-500">· {i.setIklan.nama}</span>
                    </p>
                    {(i.judulIklan || i.cta) && <p className="text-slate-700">{[i.judulIklan, i.cta].filter(Boolean).join(" · ")}</p>}
                    {i.teksUtama && <p className="line-clamp-2 text-slate-600">{i.teksUtama}</p>}
                    {i.urlTujuan && (
                      <a href={i.urlTujuan} target="_blank" rel="noopener noreferrer" className="tombol-tautan break-all">
                        {i.urlTujuan}
                      </a>
                    )}
                    {i.berkasKreatif && !i.berkasKreatif.dihapusPada && (
                      <p className="text-xs">
                        Kreatif:{" "}
                        <a href={`/api/berkas/${i.berkasKreatif.id}`} target="_blank" rel="noopener noreferrer" className="tombol-tautan">
                          {i.berkasKreatif.namaBerkas}
                        </a>
                      </p>
                    )}
                    {i.kreatifTersembunyi && <p className="text-xs text-slate-500">Kreatif: berkas tidak tersedia untuk Anda</p>}
                  </div>
                  {boleh.hapus && (
                    <FormulirAksi aksi={hapusIklanFormulir.bind(null, i.id)} pesanKonfirmasi={`Hapus iklan ${i.nama}?`}>
                      <button type="submit" className="tombol-tautan-bahaya text-sm">
                        Hapus
                      </button>
                    </FormulirAksi>
                  )}
                </div>
                {boleh.ubah && (
                  <Lipat label="Ubah">
                    <FormulirIklan
                      aksi={ubahIklanFormulir.bind(null, i.id)}
                      awalan={`ubah-iklan-${i.id}-`}
                      nilai={{ ...i, setIklanId: i.setIklanId }}
                      setIklan={setPilihan}
                      kreatif={kreatif}
                      kreatifSekarang={i.berkasKreatifId ? { id: i.berkasKreatifId, nama: i.berkasKreatif?.namaBerkas ?? "Berkas tersembunyi" } : null}
                      tombol="Simpan iklan"
                      pesanSukses="Iklan tersimpan."
                    />
                  </Lipat>
                )}
              </li>
            ))}
          </ul>
        )}
      </Kartu>

      <Kartu judul="Laporan harian" ikon="monitoring">
        {boleh.buat && (
          <Lipat label="Tambah laporan">
            <FormulirLaporanIklan aksi={catatMetrikIklanFormulir.bind(null, k.id)} awalan="laporan-baru-" aturan={aturan} tombol="Simpan laporan" pesanSukses="Laporan tersimpan." />
          </Lipat>
        )}
        <TabelLaporanIklan laporan={k.laporan} total={k.total} aturan={aturan} bolehUbah={boleh.ubah} bolehHapus={boleh.hapus} />
      </Kartu>

      <div className="space-y-2">
        <LampiranBerkas jenisEntitas="kampanye" entitasId={k.id} judul="Berkas kampanye" kosong="Belum ada berkas kampanye." />
        <p className="petunjuk">Unggah materi kreatif di sini atau di tugas desain yang tertaut, lalu pilih di iklan.</p>
      </div>

      {punyaHak(pengguna, "tugas-desain.lihat") && (
        <Kartu
          judul="Tugas desain terkait"
          ikon="palette"
          aksi={
            punyaHak(pengguna, "tugas-desain.buat") ? (
              <Link href={`/pemasaran/desain?tugas=baru&kampanye=${k.id}`} className="tombol tombol-garis tombol-kecil">
                <Ikon nama="add" className="!text-[16px]" /> Minta desain
              </Link>
            ) : undefined
          }
        >
          {k.tugasDesain.length === 0 ? (
            <p className="text-sm text-slate-500">Belum ada tugas desain untuk kampanye ini.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {k.tugasDesain.map((tg) => (
                <li key={tg.id} className="py-2 flex flex-wrap items-center gap-2 text-sm">
                  <Link href={`/pemasaran/desain?tugas=${tg.id}`} className="tombol-tautan font-medium">
                    {tg.judul}
                  </Link>
                  <LencanaStatusDesain status={tg.status} />
                  <LencanaPrioritas prioritas={tg.prioritas} />
                  <span className="text-slate-500">
                    {tg.desainer?.nama ?? "Belum ditugaskan"} · tenggat {tg.tenggat ? formatTanggal(tg.tenggat) : "-"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Kartu>
      )}

      {k.catatan && (
        <Kartu judul="Catatan" ikon="edit_note">
          <p className="text-sm text-slate-700 whitespace-pre-line">{k.catatan}</p>
        </Kartu>
      )}
    </div>
  );
}
