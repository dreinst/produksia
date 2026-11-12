import Link from "next/link";
import type { ReactNode } from "react";
import type { StatusTugasDesain } from "@/prisma-klien/enums";
import { db } from "@/lib/db";
import { punyaHak, type Hak, type PenggunaSesi } from "@/lib/hakAkses";
import { daftarPerusahaan, saringPerusahaan, type Lingkup } from "@/lib/perusahaan";
import { formatTanggal, tanggalIso } from "@/lib/waktu";
import { detailTugasDesain, type DetailTugasDesain } from "@/lib/desain";
import { teksTerbit } from "@/lib/konten";
import { pilihanPenanggungJawab } from "@/lib/pemasaran";
import { LABEL_PLATFORM, PRIORITAS_DESAIN, STATUS_DESAIN, URUTAN_PRIORITAS, URUTAN_STATUS_DESAIN } from "@/lib/labelPemasaran";
import { ajukanTinjauanDesainFormulir, arsipkanTugasDesainFormulir, buatTugasDesainFormulir, tinjauDesainFormulir, ubahTugasDesainFormulir } from "@/lib/aksi/desain";
import FormulirAksi from "@/komponen/FormulirAksi";
import KolomPerusahaan from "@/komponen/KolomPerusahaan";
import LampiranBerkas from "@/komponen/berkas/LampiranBerkas";
import Ikon from "@/komponen/ui/Ikon";
import Laci from "@/komponen/ui/Laci";
import LencanaPerusahaan from "@/komponen/ui/LencanaPerusahaan";
import { LencanaPrioritas, LencanaStatusDesain } from "@/komponen/pemasaran/LencanaPemasaran";
import RiwayatRevisiDesain from "@/komponen/pemasaran/RiwayatRevisiDesain";

/*
 * Laci tugas desain (D6 §7.5). Dibuka lewat ?tugas=id atau ?tugas=baru (prapengisian ?konten= dan ?kampanye=).
 * Komponen server: membaca detail tugas, pilihan formulir, dan hak pembaca sendiri. Tugas milik perusahaan di luar
 * lingkup aktif hanya memberi pemberitahuan (D6 §3.0 no. 5). Konten atau kampanye terkait yang tidak boleh dilihat
 * pembaca dikirim ulang sebagai isian tersembunyi, karena ubah tugas mengganti semua isian. Berkas hasil memakai jenis
 * lampiran hasil-desain bertag HASIL (kontrak P40).
 */

const STATUS_JALUR_SENDIRI: readonly StatusTugasDesain[] = ["DITINJAU", "REVISI"];
const STATUS_PENINJAU: readonly StatusTugasDesain[] = ["DISETUJUI", "SELESAI"];
const STATUS_BOLEH_AJUKAN: readonly StatusTugasDesain[] = ["DITUGASKAN", "DIKERJAKAN", "REVISI"];
const BATAS_PILIHAN = 200;

type Opsi = { id: string; nama: string };

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

export default async function LaciTugasDesain({
  id,
  pengguna,
  lingkup,
  tutupHref,
  kembali,
  kontenAwal,
  kampanyeAwal,
}: {
  id: string;
  pengguna: PenggunaSesi;
  lingkup: Lingkup;
  tutupHref: string;
  /** query string tampilan sekarang (tanpa tugas, konten, kampanye), dikirim sebagai isian tersembunyi `kembali` */
  kembali: string;
  kontenAwal?: string | null;
  kampanyeAwal?: string | null;
}) {
  const boleh = (h: Hak) => punyaHak(pengguna, h);
  const baru = id === "baru";
  const judulLaci = baru ? "Permintaan desain baru" : "Tugas desain";

  if (baru && !boleh("tugas-desain.buat")) {
    return (
      <Laci judul={judulLaci} tutupHref={tutupHref}>
        <p className="text-sm text-slate-600">Anda tidak punya hak membuat permintaan desain.</p>
      </Laci>
    );
  }
  const t = baru ? null : await detailTugasDesain(db, id, pengguna);
  if (!baru && !t) {
    return (
      <Laci judul={judulLaci} tutupHref={tutupHref}>
        <p className="text-sm text-slate-600">Tugas desain tidak ditemukan atau sudah diarsipkan.</p>
      </Laci>
    );
  }
  if (t && lingkup.perusahaanId !== null && t.perusahaanId !== lingkup.perusahaanId) {
    return (
      <Laci judul={judulLaci} tutupHref={tutupHref}>
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Data ini milik {t.perusahaan.nama}. Ganti perusahaan aktif untuk membukanya.
        </p>
      </Laci>
    );
  }

  const lihatKonten = boleh("konten.lihat");
  const lihatKampanye = boleh("kampanye.lihat");
  // prapengisian tugas baru dari konten atau kampanye (hanya yang aktif dan boleh dilihat pembaca)
  const [kontenPrefill, kampanyePrefill] = baru
    ? await Promise.all([
        kontenAwal && lihatKonten
          ? db.konten.findFirst({ where: { id: kontenAwal, diarsipkanPada: null }, select: { id: true, judul: true, perusahaanId: true, proyekId: true, perusahaan: { select: { nama: true } } } })
          : null,
        kampanyeAwal && lihatKampanye
          ? db.kampanye.findFirst({ where: { id: kampanyeAwal, diarsipkanPada: null }, select: { id: true, nama: true, perusahaanId: true, proyekId: true, perusahaan: { select: { nama: true } } } })
          : null,
      ])
    : [null, null];
  const induk = kontenPrefill ?? kampanyePrefill;
  // induk prapengisian milik perusahaan di luar lingkup aktif: hanya pemberitahuan, tanpa formulir dan tanpa membaca
  // pilihan perusahaan itu (perbaikan tinjauan P43 R1, D6 §3.0 no. 5)
  if (induk && lingkup.perusahaanId !== null && induk.perusahaanId !== lingkup.perusahaanId) {
    return (
      <Laci judul={judulLaci} tutupHref={tutupHref}>
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Data ini milik {induk.perusahaan.nama}. Ganti perusahaan aktif untuk membukanya.
        </p>
      </Laci>
    );
  }
  const perusahaanId = t?.perusahaanId ?? induk?.perusahaanId ?? lingkup.perusahaanId;
  const gabungan = lingkup.perusahaanId === null;
  const proyekTugas = t?.proyekId ?? (baru ? (kontenPrefill?.proyekId ?? kampanyePrefill?.proyekId ?? null) : null);
  const kontenSekarang = t?.kontenId ?? kontenPrefill?.id ?? null;
  const kampanyeSekarang = t?.kampanyeId ?? kampanyePrefill?.id ?? null;

  const [perusahaanAktif, proyek, desainer, pilihanKonten, pilihanKampanye] = await Promise.all([
    daftarPerusahaan(),
    db.proyek.findMany({ where: { status: { notIn: ["BATAL", "DIARSIP"] }, ...saringPerusahaan(perusahaanId) }, orderBy: { kode: "asc" }, select: { id: true, kode: true, nama: true, perusahaanId: true } }),
    pilihanPenanggungJawab(db, "tugas-desain.ubah"),
    lihatKonten
      ? Promise.all([
          db.konten.findMany({
            where: { diarsipkanPada: null, ...saringPerusahaan(perusahaanId), ...(proyekTugas ? { proyekId: proyekTugas } : {}) },
            orderBy: [{ dibuatPada: "desc" }, { id: "asc" }],
            take: BATAS_PILIHAN,
            select: { id: true, judul: true, perusahaanId: true },
          }),
          kontenSekarang ? db.konten.findUnique({ where: { id: kontenSekarang }, select: { id: true, judul: true, perusahaanId: true } }) : null,
        ]).then(([daftar, kini]) => (kini && !daftar.some((d) => d.id === kini.id) ? [...daftar, kini] : daftar))
      : [],
    lihatKampanye
      ? Promise.all([
          db.kampanye.findMany({ where: { diarsipkanPada: null, ...saringPerusahaan(perusahaanId) }, orderBy: [{ dibuatPada: "desc" }, { id: "asc" }], take: BATAS_PILIHAN, select: { id: true, nama: true, perusahaanId: true } }),
          kampanyeSekarang ? db.kampanye.findUnique({ where: { id: kampanyeSekarang }, select: { id: true, nama: true, perusahaanId: true } }) : null,
        ]).then(([daftar, kini]) => (kini && !daftar.some((d) => d.id === kini.id) ? [...daftar, kini] : daftar))
      : [],
  ]);
  const kodePerusahaan = new Map(perusahaanAktif.map((p) => [p.id, p.kode]));
  const awalanKode = (pid: string) => (gabungan && !perusahaanId ? `${kodePerusahaan.get(pid) ?? ""} · ` : "");
  const opsiProyek = t?.proyek && !proyek.some((p) => p.id === t.proyek!.id) ? [...proyek, { id: t.proyek.id, kode: t.proyek.kode, nama: t.proyek.nama, perusahaanId: t.perusahaanId }] : proyek;
  const opsiDesainer: Opsi[] = t?.desainer && !desainer.some((d) => d.id === t.desainer!.id) ? [...desainer, t.desainer] : desainer;

  const peninjau = boleh("tugas-desain.setujui");
  const statusSekarang: StatusTugasDesain = t?.status ?? "PERMINTAAN";
  const opsiStatus = URUTAN_STATUS_DESAIN.filter((s) => s === statusSekarang || (!STATUS_JALUR_SENDIRI.includes(s) && (peninjau || !STATUS_PENINJAU.includes(s))));
  const bolehUbah = baru || boleh("tugas-desain.ubah");
  const tertautKonten = !!(t?.kontenId ?? kontenPrefill);
  // Konten yang kuncinya dipegang tugas ini hanya boleh dilepas atau diganti peninjau atau pemegang tugas-desain.hapus
  // (penjaga ubahTugasDesain). Pembaca lain melihatnya sebagai teks dan nilainya dikirim tersembunyi (tinjauan P43 R5).
  const kontenTerkunci = !!t?.kunciKontenAktif && !peninjau && !boleh("tugas-desain.hapus");
  const judulKontenSekarang = pilihanKonten.find((k) => k.id === kontenSekarang)?.judul ?? "Konten terkait";

  const isian = (
    <>
      <div className="bidang md:col-span-2">
        <label className="label" htmlFor="tugas-judul">
          Judul tugas *
        </label>
        <input id="tugas-judul" name="judul" required maxLength={200} defaultValue={t?.judul ?? (kontenPrefill ? `Desain: ${kontenPrefill.judul}`.slice(0, 200) : "")} className="isian min-h-11" />
      </div>
      {baru && !induk && <KolomPerusahaan lingkup={lingkup} daftar={perusahaanAktif} />}
      <div className="bidang">
        <label className="label" htmlFor="tugas-proyek">
          Proyek
        </label>
        <select id="tugas-proyek" name="proyekId" defaultValue={proyekTugas ?? ""} className="isian min-h-11">
          <option value="">Tanpa proyek</option>
          {opsiProyek.map((p) => (
            <option key={p.id} value={p.id}>
              {awalanKode(p.perusahaanId)}
              {p.kode} - {p.nama}
            </option>
          ))}
        </select>
      </div>
      <div className="bidang">
        <label className="label" htmlFor="tugas-status">
          Status
        </label>
        <select id="tugas-status" name="status" defaultValue={statusSekarang} className="isian min-h-11">
          {opsiStatus.map((s) => (
            <option key={s} value={s}>
              {STATUS_DESAIN[s].label}
            </option>
          ))}
        </select>
      </div>
      <div className="bidang">
        <label className="label" htmlFor="tugas-prioritas">
          Prioritas
        </label>
        <select id="tugas-prioritas" name="prioritas" defaultValue={t?.prioritas ?? "SEDANG"} className="isian min-h-11">
          {URUTAN_PRIORITAS.map((p) => (
            <option key={p} value={p}>
              {PRIORITAS_DESAIN[p].label}
            </option>
          ))}
        </select>
      </div>
      <div className="bidang">
        <label className="label" htmlFor="tugas-tenggat">
          Tenggat
        </label>
        <input id="tugas-tenggat" name="tenggat" type="date" defaultValue={t?.tenggat ? tanggalIso(t.tenggat) : ""} className="isian min-h-11" />
      </div>
      <div className="bidang">
        <label className="label" htmlFor="tugas-desainer">
          Desainer
        </label>
        <select id="tugas-desainer" name="desainerId" defaultValue={t?.desainerId ?? ""} className="isian min-h-11">
          <option value="">Belum ditugaskan</option>
          {opsiDesainer.map((o) => (
            <option key={o.id} value={o.id}>
              {o.nama}
            </option>
          ))}
        </select>
      </div>
      {lihatKonten && kontenTerkunci ? (
        <div className="bidang">
          <span className="label">Konten terkait</span>
          <p className="min-h-11 py-2 text-sm text-slate-800 break-words">{judulKontenSekarang}</p>
          <p className="petunjuk">Hanya peninjau desain yang boleh melepas atau mengganti konten terkait.</p>
          <input type="hidden" name="kontenId" value={kontenSekarang ?? ""} />
        </div>
      ) : lihatKonten ? (
        <div className="bidang">
          <label className="label" htmlFor="tugas-konten">
            Konten terkait
          </label>
          <select id="tugas-konten" name="kontenId" defaultValue={kontenSekarang ?? ""} className="isian min-h-11">
            <option value="">Tanpa konten</option>
            {pilihanKonten.map((k) => (
              <option key={k.id} value={k.id}>
                {awalanKode(k.perusahaanId)}
                {k.judul}
              </option>
            ))}
          </select>
        </div>
      ) : (
        kontenSekarang && <input type="hidden" name="kontenId" value={kontenSekarang} />
      )}
      {lihatKampanye ? (
        <div className="bidang">
          <label className="label" htmlFor="tugas-kampanye">
            Kampanye terkait
          </label>
          <select id="tugas-kampanye" name="kampanyeId" defaultValue={kampanyeSekarang ?? ""} className="isian min-h-11">
            <option value="">Tanpa kampanye</option>
            {pilihanKampanye.map((k) => (
              <option key={k.id} value={k.id}>
                {awalanKode(k.perusahaanId)}
                {k.nama}
              </option>
            ))}
          </select>
        </div>
      ) : (
        kampanyeSekarang && <input type="hidden" name="kampanyeId" value={kampanyeSekarang} />
      )}
      <div className="bidang md:col-span-2">
        <label className="label" htmlFor="tugas-deskripsi">
          {tertautKonten ? "Instruksi tambahan" : "Deskripsi / brief"}
        </label>
        <textarea id="tugas-deskripsi" name="deskripsi" rows={4} maxLength={5000} defaultValue={t?.deskripsi ?? ""} className="isian" />
      </div>
      <input type="hidden" name="kembali" value={kembali} />
    </>
  );

  if (baru) {
    return (
      <Laci judul={judulLaci} tutupHref={tutupHref}>
        {kontenPrefill && <p className="petunjuk">Brief desain dibaca langsung dari konten &quot;{kontenPrefill.judul}&quot; di Perencana Konten.</p>}
        <FormulirAksi aksi={buatTugasDesainFormulir} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {isian}
          <div className="md:col-span-2">
            <button type="submit" className="tombol tombol-utama min-h-11 w-full sm:w-auto">
              Buat tugas
            </button>
          </div>
        </FormulirAksi>
      </Laci>
    );
  }

  const tugas = t as DetailTugasDesain;
  const bolehAjukan = boleh("tugas-desain.ubah") && STATUS_BOLEH_AJUKAN.includes(tugas.status);

  return (
    <Laci judul={judulLaci} tutupHref={tutupHref}>
      <div className="flex flex-wrap items-center gap-2">
        <LencanaStatusDesain status={tugas.status} />
        <LencanaPrioritas prioritas={tugas.prioritas} />
        <span className="lencana lencana-slate">Revisi #{tugas.jumlahRevisi}</span>
        {gabungan && <LencanaPerusahaan kode={tugas.perusahaan.kode} warna={tugas.perusahaan.warna} nama={tugas.perusahaan.nama} />}
      </div>

      {tugas.konten && lihatKonten && (
        <Bagian judul="Brief dari Perencana Konten" ikon="edit_note">
          <div className="text-sm space-y-1">
            <p className="font-semibold text-slate-800">{tugas.konten.judul}</p>
            <p className="text-slate-600">
              {[LABEL_PLATFORM[tugas.konten.platform], tugas.konten.jenisKonten, tugas.konten.pilar, teksTerbit(tugas.konten) ? `terbit ${teksTerbit(tugas.konten)}` : null].filter(Boolean).join(" · ")}
            </p>
            <p className="text-slate-600">Social Media Manager: {tugas.konten.smm?.nama ?? "-"}</p>
            <Link href={`/pemasaran/konten?konten=${tugas.konten.id}`} className="tombol-tautan inline-flex items-center gap-1">
              <Ikon nama="open_in_new" className="!text-[16px]" /> Perencana
            </Link>
          </div>
          {[tugas.konten.briefDesain, tugas.konten.caption, tugas.konten.cta, tugas.konten.tagar, tugas.konten.catatan].some(Boolean) ? (
            <dl className="grid grid-cols-1 sm:grid-cols-[minmax(0,8rem)_1fr] gap-x-4 gap-y-2 text-sm">
              {(
                [
                  ["Brief desain", tugas.konten.briefDesain],
                  ["Caption", tugas.konten.caption],
                  ["CTA", tugas.konten.cta],
                  ["Tagar", tugas.konten.tagar],
                  ["Catatan", tugas.konten.catatan],
                ] as const
              )
                .filter(([, v]) => v)
                .map(([label, v]) => (
                  <div key={label} className="contents">
                    <dt className="text-slate-500">{label}</dt>
                    <dd className="whitespace-pre-line break-words text-slate-800">{v}</dd>
                  </div>
                ))}
            </dl>
          ) : (
            <p className="text-sm text-slate-500">Brief belum ditulis. Minta Social Media Manager mengisi brief desain di perencana.</p>
          )}
          <LampiranBerkas jenisEntitas="konten" entitasId={tugas.konten.id} judul="Berkas referensi perencana" bolehUnggah={false} kosong="Belum ada berkas referensi." />
        </Bagian>
      )}
      {tugas.kontenDiarsipkan && lihatKonten && <p className="text-sm text-slate-500">Konten terkait sudah diarsipkan.</p>}

      {bolehUbah ? (
        <FormulirAksi aksi={ubahTugasDesainFormulir.bind(null, tugas.id)} pesanSukses="Tersimpan." className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {isian}
          <div className="md:col-span-2 flex flex-col sm:flex-row gap-2">
            <button type="submit" name="lanjut" value="" className="tombol tombol-utama min-h-11 w-full sm:w-auto">
              Simpan perubahan
            </button>
            {bolehAjukan && (
              <button type="submit" name="lanjut" value="tinjau" className="tombol tombol-garis min-h-11 w-full sm:w-auto">
                <Ikon nama="send" className="!text-[18px]" /> Simpan &amp; ajukan untuk ditinjau
              </button>
            )}
          </div>
        </FormulirAksi>
      ) : (
        <fieldset disabled className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {isian}
        </fieldset>
      )}

      {tugas.catatanRevisi && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 whitespace-pre-line">Catatan revisi terakhir: {tugas.catatanRevisi}</p>
      )}

      <LampiranBerkas jenisEntitas="tugas-desain" entitasId={tugas.id} tag="REFERENSI" judul="Berkas referensi" kosong="Belum ada berkas referensi." />
      <LampiranBerkas jenisEntitas="hasil-desain" entitasId={tugas.id} tag="HASIL" judul="Berkas hasil" kosong="Belum ada berkas hasil." />

      {bolehAjukan && (
        <Bagian judul="Ajukan untuk ditinjau" ikon="send">
          <p className="text-sm text-slate-600">
            {tugas.status === "REVISI" ? "Revisi sudah selesai? Unggah hasil baru dan ajukan lagi untuk ditinjau." : "Unggah berkas hasil, lalu ajukan desain untuk ditinjau."}
          </p>
          <FormulirAksi aksi={ajukanTinjauanDesainFormulir.bind(null, tugas.id)} pesanSukses="Diajukan untuk ditinjau.">
            <button type="submit" className="tombol tombol-utama min-h-11 w-full sm:w-auto">
              <Ikon nama="send" className="!text-[18px]" /> Ajukan untuk ditinjau
            </button>
          </FormulirAksi>
        </Bagian>
      )}

      {tugas.status === "DITINJAU" && (
        <Bagian judul="Tinjauan" ikon="rate_review">
          {peninjau ? (
            <FormulirAksi aksi={tinjauDesainFormulir.bind(null, tugas.id)} pesanSukses="Tinjauan tersimpan." className="space-y-3">
              <div className="bidang">
                <label className="label" htmlFor="tugas-tinjau-catatan">
                  Catatan revisi
                </label>
                <textarea id="tugas-tinjau-catatan" name="catatan" rows={3} maxLength={3000} className="isian" />
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <button type="submit" name="keputusan" value="SETUJUI" className="tombol tombol-utama min-h-11 w-full sm:w-auto">
                  <Ikon nama="check_circle" className="!text-[18px]" /> Setujui
                </button>
                <button type="submit" name="keputusan" value="REVISI" className="tombol tombol-garis min-h-11 w-full sm:w-auto">
                  <Ikon nama="rate_review" className="!text-[18px]" /> Minta revisi
                </button>
              </div>
            </FormulirAksi>
          ) : (
            <p className="text-sm text-slate-500">Menunggu tinjauan.</p>
          )}
        </Bagian>
      )}

      <Bagian judul="Riwayat revisi" ikon="history">
        <RiwayatRevisiDesain revisi={tugas.revisi} pengguna={pengguna} />
      </Bagian>

      {tugas.kampanye && lihatKampanye && !tugas.kampanye.diarsipkanPada && (
        <p className="text-sm text-slate-600">
          Kampanye terkait:{" "}
          <Link href={`/pemasaran/iklan/${tugas.kampanye.id}`} className="tombol-tautan">
            {tugas.kampanye.nama}
          </Link>
        </p>
      )}
      <p className="text-xs text-slate-500">
        Dibuat {formatTanggal(tugas.dibuatPada)} oleh {tugas.dibuatOlehNama}
      </p>

      {boleh("tugas-desain.hapus") && (
        <FormulirAksi aksi={arsipkanTugasDesainFormulir.bind(null, tugas.id)} pesanKonfirmasi="Arsipkan tugas desain ini? Konten yang tertaut bisa dikirim ke desain lagi.">
          <button type="submit" className="tombol tombol-bahaya tombol-kecil">
            Arsipkan
          </button>
        </FormulirAksi>
      )}
    </Laci>
  );
}
