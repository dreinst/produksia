import Link from "next/link";
import type { ReactNode } from "react";
import type { StatusKonten } from "@/prisma-klien/enums";
import { db } from "@/lib/db";
import { punyaHak, type Hak, type PenggunaSesi } from "@/lib/hakAkses";
import { daftarPerusahaan, saringPerusahaan, type Lingkup } from "@/lib/perusahaan";
import { tanggalIso, formatTanggal } from "@/lib/waktu";
import { detailKonten, tenggatBawaanDesain, type DetailKonten } from "@/lib/konten";
import { ambilPengaturanPemasaran, pilihanPenanggungJawab } from "@/lib/pemasaran";
import { LABEL_PLATFORM, PRIORITAS_DESAIN, STATUS_KONTEN, URUTAN_PLATFORM, URUTAN_PRIORITAS, URUTAN_STATUS_KONTEN } from "@/lib/labelPemasaran";
import { arsipkanKontenFormulir, buatKontenFormulir, kirimKeDesainFormulir, tinjauKontenFormulir, ubahKontenFormulir } from "@/lib/aksi/konten";
import { tinjauDesainFormulir } from "@/lib/aksi/desain";
import FormulirAksi from "@/komponen/FormulirAksi";
import KolomPerusahaan from "@/komponen/KolomPerusahaan";
import LampiranBerkas from "@/komponen/berkas/LampiranBerkas";
import Ikon from "@/komponen/ui/Ikon";
import Laci from "@/komponen/ui/Laci";
import LencanaPerusahaan from "@/komponen/ui/LencanaPerusahaan";
import { LencanaPersetujuanKonten, LencanaPrioritas, LencanaStatusDesain, LencanaStatusKonten } from "@/komponen/pemasaran/LencanaPemasaran";
import RiwayatPersetujuanKonten from "@/komponen/pemasaran/RiwayatPersetujuanKonten";
import RiwayatRevisiDesain from "@/komponen/pemasaran/RiwayatRevisiDesain";

/*
 * Laci konten di Perencana Konten (D6 §7.3). Dibuka lewat ?konten=id atau ?konten=baru. Komponen server: membaca
 * detail konten, pilihan formulir, dan hak pembaca sendiri, lalu merender isinya di dalam Laci (klien). Konten milik
 * perusahaan di luar lingkup aktif hanya memberi pemberitahuan (D6 §3.0 no. 5). Tombol hanya disembunyikan menurut
 * hak; aksi server tetap memeriksa hak dan keadaan konten.
 */

const STATUS_PENYETUJU: readonly StatusKonten[] = ["DISETUJUI", "TERJADWAL", "TERBIT"];
const STATUS_DESAIN_BERES = ["DISETUJUI", "SELESAI"];

type Opsi = { id: string; nama: string };

/** Pilihan dengan nilai sekarang selalu ikut, walau sudah tidak ada di daftar. */
function denganNilai(daftar: Opsi[], nilai: Opsi | null | undefined): Opsi[] {
  return nilai && !daftar.some((d) => d.id === nilai.id) ? [...daftar, nilai] : daftar;
}

function denganTeks(daftar: readonly string[], nilai: string | null | undefined): string[] {
  return nilai && !daftar.includes(nilai) ? [...daftar, nilai] : [...daftar];
}

function Bagian({ judul, ikon, children }: { judul: string; ikon: string; children: ReactNode }) {
  return (
    <section className="kartu space-y-3" aria-label={judul}>
      <div className="flex items-center gap-2">
        <Ikon nama={ikon} className="!text-[20px] text-slate-500" />
        <h3 className="judul-kartu">{judul}</h3>
      </div>
      {children}
    </section>
  );
}

export default async function LaciKonten({
  id,
  pengguna,
  lingkup,
  tutupHref,
  kembali,
  tanggalAwal,
  proyekAwal,
}: {
  id: string;
  pengguna: PenggunaSesi;
  lingkup: Lingkup;
  tutupHref: string;
  /** query string tampilan sekarang (tanpa konten dan tanggal), dikirim sebagai isian tersembunyi `kembali` */
  kembali: string;
  /** prapengisian tanggal terbit konten baru ("YYYY-MM-DD") */
  tanggalAwal?: string | null;
  /** prapengisian proyek konten baru (saringan halaman yang menunjuk satu proyek) */
  proyekAwal?: string | null;
}) {
  const boleh = (h: Hak) => punyaHak(pengguna, h);
  const baru = id === "baru";

  if (baru && !boleh("konten.buat")) {
    return (
      <Laci judul="Konten baru" tutupHref={tutupHref}>
        <p className="text-sm text-slate-600">Anda tidak punya hak membuat konten.</p>
      </Laci>
    );
  }
  const k = baru ? null : await detailKonten(db, id, pengguna);
  if (!baru && !k) {
    return (
      <Laci judul="Detail konten" tutupHref={tutupHref}>
        <p className="text-sm text-slate-600">Konten tidak ditemukan atau sudah diarsipkan.</p>
      </Laci>
    );
  }
  if (k && lingkup.perusahaanId !== null && k.perusahaanId !== lingkup.perusahaanId) {
    return (
      <Laci judul="Detail konten" tutupHref={tutupHref}>
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Data ini milik {k.perusahaan.nama}. Ganti perusahaan aktif untuk membukanya.
        </p>
      </Laci>
    );
  }

  const gabungan = lingkup.perusahaanId === null;
  const perusahaanId = k?.perusahaanId ?? lingkup.perusahaanId;
  const [perusahaanAktif, proyek, smm, desainer] = await Promise.all([
    daftarPerusahaan(),
    // pola daftarProyekAktif (tanpa batal dan arsip) ditambah perusahaan, untuk kode perusahaan di lingkup gabungan
    db.proyek.findMany({
      where: { status: { notIn: ["BATAL", "DIARSIP"] }, ...saringPerusahaan(perusahaanId) },
      orderBy: { kode: "asc" },
      select: { id: true, kode: true, nama: true, perusahaanId: true },
    }),
    pilihanPenanggungJawab(db, "konten.ubah"),
    pilihanPenanggungJawab(db, "tugas-desain.ubah"),
  ]);
  // Konten baru di lingkup gabungan belum punya perusahaan: pilihan jenis dan pilar = gabungan daftar semua perusahaan aktif.
  const pengaturan = perusahaanId
    ? [await ambilPengaturanPemasaran(db, perusahaanId)]
    : await Promise.all(perusahaanAktif.filter((p) => p.aktif).map((p) => ambilPengaturanPemasaran(db, p.id)));
  const jenisKonten = denganTeks([...new Set(pengaturan.flatMap((p) => p.jenisKonten))], k?.jenisKonten);
  const pilarKonten = denganTeks([...new Set(pengaturan.flatMap((p) => p.pilarKonten))], k?.pilar);
  const opsiProyek = k?.proyek && !proyek.some((p) => p.id === k.proyek!.id) ? [...proyek, { id: k.proyek.id, kode: k.proyek.kode, nama: k.proyek.nama, perusahaanId: k.perusahaanId }] : proyek;
  const opsiSmm = denganNilai(smm, k?.smm);
  const opsiDesainer = denganNilai(desainer, k?.desainer);
  const kodePerusahaan = new Map(perusahaanAktif.map((p) => [p.id, p.kode]));

  const penyetuju = boleh("konten.setujui");
  const statusSekarang: StatusKonten = k?.status ?? "IDE";
  const opsiStatus = URUTAN_STATUS_KONTEN.filter((s) => s === statusSekarang || (s !== "DITINJAU" && (penyetuju || !STATUS_PENYETUJU.includes(s))));
  const bolehUbah = baru || boleh("konten.ubah");
  const proyekBawaan = baru ? (opsiProyek.some((p) => p.id === proyekAwal) ? proyekAwal! : "") : (k?.proyekId ?? "");

  const isian = (
    <>
      {baru && <KolomPerusahaan lingkup={lingkup} daftar={perusahaanAktif} />}
      <div className="bidang md:col-span-2">
        <label className="label" htmlFor="konten-judul">
          Judul konten *
        </label>
        <input id="konten-judul" name="judul" required maxLength={200} defaultValue={k?.judul ?? ""} className="isian min-h-11" />
      </div>
      <div className="bidang">
        <label className="label" htmlFor="konten-proyek">
          Proyek
        </label>
        <select id="konten-proyek" name="proyekId" defaultValue={proyekBawaan} className="isian min-h-11">
          <option value="">Tanpa proyek</option>
          {opsiProyek.map((p) => (
            <option key={p.id} value={p.id}>
              {gabungan && baru ? `${kodePerusahaan.get(p.perusahaanId) ?? ""} · ` : ""}
              {p.kode} - {p.nama}
            </option>
          ))}
        </select>
      </div>
      <div className="bidang">
        <label className="label" htmlFor="konten-platform">
          Platform
        </label>
        <select id="konten-platform" name="platform" defaultValue={k?.platform ?? "INSTAGRAM"} className="isian min-h-11">
          {URUTAN_PLATFORM.map((p) => (
            <option key={p} value={p}>
              {LABEL_PLATFORM[p]}
            </option>
          ))}
        </select>
      </div>
      <div className="bidang">
        <label className="label" htmlFor="konten-status">
          Status
        </label>
        <select id="konten-status" name="status" defaultValue={statusSekarang} className="isian min-h-11">
          {opsiStatus.map((s) => (
            <option key={s} value={s}>
              {STATUS_KONTEN[s].label}
            </option>
          ))}
        </select>
      </div>
      <div className="bidang">
        <label className="label" htmlFor="konten-jenis">
          Jenis konten
        </label>
        <select id="konten-jenis" name="jenisKonten" defaultValue={k?.jenisKonten ?? ""} className="isian min-h-11">
          <option value="">Belum dipilih</option>
          {jenisKonten.map((j) => (
            <option key={j} value={j}>
              {j}
            </option>
          ))}
        </select>
      </div>
      <div className="bidang">
        <label className="label" htmlFor="konten-pilar">
          Pilar konten
        </label>
        <select id="konten-pilar" name="pilar" defaultValue={k?.pilar ?? ""} className="isian min-h-11">
          <option value="">Belum dipilih</option>
          {pilarKonten.map((j) => (
            <option key={j} value={j}>
              {j}
            </option>
          ))}
        </select>
      </div>
      <div className="bidang">
        <label className="label" htmlFor="konten-tanggal">
          Tanggal terbit
        </label>
        <input id="konten-tanggal" name="tanggalTerbit" type="date" defaultValue={k?.tanggalTerbit ? tanggalIso(k.tanggalTerbit) : (tanggalAwal ?? "")} className="isian min-h-11" />
      </div>
      <div className="bidang">
        <label className="label" htmlFor="konten-jam">
          Jam terbit
        </label>
        <input id="konten-jam" name="jamTerbit" type="time" defaultValue={k?.jamTerbit ?? ""} className="isian min-h-11" />
      </div>
      <div className="bidang">
        <label className="label" htmlFor="konten-smm">
          Social Media Manager
        </label>
        <select id="konten-smm" name="smmId" defaultValue={k?.smmId ?? ""} className="isian min-h-11">
          <option value="">Belum ditentukan</option>
          {opsiSmm.map((o) => (
            <option key={o.id} value={o.id}>
              {o.nama}
            </option>
          ))}
        </select>
      </div>
      <div className="bidang">
        <label className="label" htmlFor="konten-desainer">
          Desainer
        </label>
        <select id="konten-desainer" name="desainerId" defaultValue={k?.desainerId ?? ""} className="isian min-h-11">
          <option value="">Belum ditentukan</option>
          {opsiDesainer.map((o) => (
            <option key={o.id} value={o.id}>
              {o.nama}
            </option>
          ))}
        </select>
      </div>
      <div className="bidang md:col-span-2">
        <label className="label" htmlFor="konten-brief">
          Brief desain (konsep visual, format/ukuran, teks di visual, suasana, referensi)
        </label>
        <textarea id="konten-brief" name="briefDesain" rows={5} maxLength={5000} defaultValue={k?.briefDesain ?? ""} className="isian" />
      </div>
      <div className="bidang md:col-span-2">
        <label className="label" htmlFor="konten-caption">
          Caption
        </label>
        <textarea id="konten-caption" name="caption" rows={4} maxLength={5000} defaultValue={k?.caption ?? ""} className="isian" />
      </div>
      <div className="bidang">
        <label className="label" htmlFor="konten-cta">
          CTA
        </label>
        <input id="konten-cta" name="cta" maxLength={500} defaultValue={k?.cta ?? ""} className="isian min-h-11" />
      </div>
      <div className="bidang">
        <label className="label" htmlFor="konten-tagar">
          Tagar
        </label>
        <input id="konten-tagar" name="tagar" maxLength={1000} defaultValue={k?.tagar ?? ""} className="isian min-h-11" />
      </div>
      <div className="bidang md:col-span-2">
        <label className="label" htmlFor="konten-catatan">
          Catatan
        </label>
        <textarea id="konten-catatan" name="catatan" rows={3} maxLength={5000} defaultValue={k?.catatan ?? ""} className="isian" />
      </div>
      <input type="hidden" name="kembali" value={kembali} />
    </>
  );

  if (baru) {
    return (
      <Laci judul="Konten baru" tutupHref={tutupHref}>
        <FormulirAksi aksi={buatKontenFormulir} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {isian}
          <div className="md:col-span-2">
            <button type="submit" className="tombol tombol-utama min-h-11 w-full sm:w-auto">
              Buat konten
            </button>
          </div>
        </FormulirAksi>
      </Laci>
    );
  }

  const konten = k as DetailKonten;
  const tugas = konten.tugasAktif;
  const desainBelumBeres = !!tugas && !STATUS_DESAIN_BERES.includes(tugas.status);
  const bolehKirim = boleh("tugas-desain.buat") && !konten.adaTugasAktif;
  const tenggatBawaan = tenggatBawaanDesain(konten.tanggalTerbit);

  return (
    <Laci judul="Detail konten" tutupHref={tutupHref}>
      <div className="flex flex-wrap items-center gap-2">
        <LencanaStatusKonten status={konten.status} />
        <LencanaPersetujuanKonten status={konten.statusPersetujuan} />
        {gabungan && <LencanaPerusahaan kode={konten.perusahaan.kode} warna={konten.perusahaan.warna} nama={konten.perusahaan.nama} />}
      </div>

      {bolehUbah ? (
        <FormulirAksi aksi={ubahKontenFormulir.bind(null, konten.id)} pesanSukses="Tersimpan." className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {isian}
          <div className="md:col-span-2 flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2">
            <button type="submit" name="lanjut" value="" className="tombol tombol-utama min-h-11 w-full sm:w-auto">
              Simpan perubahan
            </button>
            {konten.statusPersetujuan !== "MENUNGGU" && (
              <>
                <button type="submit" name="lanjut" value="ajukan" disabled={desainBelumBeres} className="tombol tombol-garis min-h-11 w-full sm:w-auto">
                  <Ikon nama="send" className="!text-[18px]" /> Simpan &amp; ajukan persetujuan
                </button>
                {desainBelumBeres && <span className="petunjuk">Desain harus disetujui dulu</span>}
              </>
            )}
          </div>
          {bolehKirim && (
            <details className="md:col-span-2 rounded-lg border border-slate-200 p-3">
              <summary className="cursor-pointer text-sm font-semibold text-slate-700">Kirim ke desain</summary>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
                <p className="petunjuk md:col-span-2">Brief desain, caption, dan berkas referensi di atas otomatis tampil untuk desainer dan selalu mengikuti perencana ini.</p>
                <IsianKirimDesain awalan="desain" opsiDesainer={opsiDesainer} desainerAwal={konten.desainerId} tenggatAwal={tenggatBawaan} />
                <div className="md:col-span-2">
                  <button type="submit" name="lanjut" value="desain" className="tombol tombol-garis min-h-11 w-full sm:w-auto">
                    <Ikon nama="palette" className="!text-[18px]" /> Simpan &amp; kirim ke desain
                  </button>
                </div>
              </div>
            </details>
          )}
        </FormulirAksi>
      ) : (
        <fieldset disabled className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {isian}
        </fieldset>
      )}

      <LampiranBerkas jenisEntitas="konten" entitasId={konten.id} judul="Referensi desain" kosong="Belum ada berkas referensi." />

      {(boleh("tugas-desain.lihat") || boleh("tugas-desain.buat")) && (
        <Bagian judul="Tugas desain" ikon="palette">
          {!konten.adaTugasAktif ? (
            boleh("tugas-desain.buat") && !boleh("konten.ubah") ? (
              <FormulirAksi aksi={kirimKeDesainFormulir.bind(null, konten.id)} pesanSukses="Tugas desain dibuat." className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <p className="petunjuk md:col-span-2">Belum ada tugas desain. Brief dan referensi konten ini otomatis tampil untuk desainer.</p>
                <IsianKirimDesain awalan="" opsiDesainer={opsiDesainer} desainerAwal={konten.desainerId} tenggatAwal={tenggatBawaan} />
                <div className="md:col-span-2">
                  <button type="submit" className="tombol tombol-utama min-h-11 w-full sm:w-auto">
                    Buat &amp; tugaskan
                  </button>
                </div>
              </FormulirAksi>
            ) : (
              <p className="text-sm text-slate-500">Belum ada tugas desain.</p>
            )
          ) : !tugas ? (
            // detailKonten tidak mengirim tugas aktif kepada pembaca tanpa tugas-desain.lihat (perbaikan tinjauan P41 R4)
            <p className="text-sm text-slate-500">Konten ini sudah punya tugas desain.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <LencanaStatusDesain status={tugas.status} />
                <LencanaPrioritas prioritas={tugas.prioritas} />
              </div>
              <p className="text-sm text-slate-600">
                {tugas.desainer?.nama ?? "Belum ditugaskan"} · tenggat {tugas.tenggat ? formatTanggal(tugas.tenggat) : "-"} · Rev {tugas.jumlahRevisi}
              </p>
              {tugas.status === "REVISI" && tugas.catatanRevisi && (
                <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 whitespace-pre-line">Revisi diminta: {tugas.catatanRevisi}</p>
              )}
              {tugas.status === "DITINJAU" &&
                (boleh("tugas-desain.setujui") ? (
                  <FormulirAksi aksi={tinjauDesainFormulir.bind(null, tugas.id)} className="space-y-3">
                    <p className="text-sm text-slate-700">Desainer sudah mengajukan desain ini untuk ditinjau.</p>
                    <div className="bidang">
                      <label className="label" htmlFor="konten-tinjau-desain-catatan">
                        Catatan revisi (wajib bila meminta revisi)
                      </label>
                      <textarea id="konten-tinjau-desain-catatan" name="catatan" rows={3} maxLength={3000} className="isian" />
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <button type="submit" name="keputusan" value="SETUJUI" className="tombol tombol-utama min-h-11 w-full sm:w-auto">
                        <Ikon nama="check_circle" className="!text-[18px]" /> Setujui desain
                      </button>
                      <button type="submit" name="keputusan" value="REVISI" className="tombol tombol-garis min-h-11 w-full sm:w-auto">
                        <Ikon nama="rate_review" className="!text-[18px]" /> Minta revisi
                      </button>
                    </div>
                  </FormulirAksi>
                ) : (
                  <p className="text-sm text-slate-500">Menunggu tinjauan desain.</p>
                ))}
              {desainBelumBeres && <p className="petunjuk">Konten bisa diajukan untuk persetujuan setelah desainnya disetujui.</p>}
              <Link href={`/pemasaran/desain?tugas=${tugas.id}`} className="tombol-tautan inline-flex items-center gap-1 text-sm">
                <Ikon nama="open_in_new" className="!text-[16px]" /> Buka tugas desain
              </Link>
              <LampiranBerkas jenisEntitas="hasil-desain" entitasId={tugas.id} tag="HASIL" judul="Hasil desain" bolehUnggah={false} kosong="Belum ada berkas hasil." />
              <div>
                <h4 className="text-sm font-semibold text-slate-700 mb-1">Riwayat revisi</h4>
                <RiwayatRevisiDesain revisi={tugas.revisi} />
              </div>
            </div>
          )}
        </Bagian>
      )}

      <Bagian judul="Persetujuan" ikon="verified">
        {konten.statusPersetujuan === "MENUNGGU" &&
          (penyetuju ? (
            <FormulirAksi aksi={tinjauKontenFormulir.bind(null, konten.id)} className="space-y-3">
              <div className="bidang">
                <label className="label" htmlFor="konten-masukan">
                  Masukan / catatan revisi (wajib bila menolak)
                </label>
                <textarea id="konten-masukan" name="masukan" rows={3} maxLength={3000} className="isian" />
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <button type="submit" name="keputusan" value="SETUJUI" className="tombol tombol-utama min-h-11 w-full sm:w-auto">
                  <Ikon nama="check_circle" className="!text-[18px]" /> Setujui
                </button>
                <button type="submit" name="keputusan" value="TOLAK" className="tombol tombol-garis min-h-11 w-full sm:w-auto">
                  <Ikon nama="cancel" className="!text-[18px]" /> Tolak
                </button>
              </div>
            </FormulirAksi>
          ) : (
            <p className="text-sm text-slate-500">Menunggu persetujuan Pemilik.</p>
          ))}
        <RiwayatPersetujuanKonten riwayat={konten.riwayat} />
      </Bagian>

      {boleh("konten.hapus") && (
        <FormulirAksi aksi={arsipkanKontenFormulir.bind(null, konten.id)} pesanKonfirmasi="Arsipkan konten ini? Konten tidak tampil lagi di perencana. Tugas desain yang tertaut tetap ada.">
          <button type="submit" className="tombol tombol-bahaya tombol-kecil">
            Arsipkan
          </button>
        </FormulirAksi>
      )}
    </Laci>
  );
}

/** Empat isian "Kirim ke desain" (D6 §3.1.5): nama berawalan `desain` di formulir konten, tanpa awalan di formulir kecil. */
function IsianKirimDesain({ awalan, opsiDesainer, desainerAwal, tenggatAwal }: { awalan: "" | "desain"; opsiDesainer: Opsi[]; desainerAwal: string | null; tenggatAwal: Date | null }) {
  const n = (k: string) => (awalan ? `${awalan}${k[0].toUpperCase()}${k.slice(1)}` : k);
  const idAwal = awalan ? "konten-desain" : "konten-kirim";
  return (
    <>
      <div className="bidang">
        <label className="label" htmlFor={`${idAwal}-desainer`}>
          Desainer
        </label>
        <select id={`${idAwal}-desainer`} name={n("desainerId")} defaultValue={desainerAwal ?? ""} className="isian min-h-11">
          <option value="">Belum ditentukan</option>
          {opsiDesainer.map((o) => (
            <option key={o.id} value={o.id}>
              {o.nama}
            </option>
          ))}
        </select>
      </div>
      <div className="bidang">
        <label className="label" htmlFor={`${idAwal}-tenggat`}>
          Tenggat
        </label>
        <input id={`${idAwal}-tenggat`} name={n("tenggat")} type="date" defaultValue={tenggatAwal ? tanggalIso(tenggatAwal) : ""} className="isian min-h-11" />
      </div>
      <div className="bidang">
        <label className="label" htmlFor={`${idAwal}-prioritas`}>
          Prioritas
        </label>
        <select id={`${idAwal}-prioritas`} name={n("prioritas")} defaultValue="SEDANG" className="isian min-h-11">
          {URUTAN_PRIORITAS.map((p) => (
            <option key={p} value={p}>
              {PRIORITAS_DESAIN[p].label}
            </option>
          ))}
        </select>
      </div>
      <div className="bidang md:col-span-2">
        <label className="label" htmlFor={`${idAwal}-deskripsi`}>
          Instruksi tambahan (opsional)
        </label>
        <textarea id={`${idAwal}-deskripsi`} name={n("deskripsi")} rows={3} maxLength={5000} className="isian" />
      </div>
    </>
  );
}
