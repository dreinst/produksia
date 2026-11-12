import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { punyaHak, type Hak, type PenggunaSesi } from "@/lib/hakAkses";
import { bacaParamDaftar } from "@/lib/daftar";
import { D, type Desimal } from "@/lib/uang";
import { formatTanggal } from "@/lib/waktu";
import { NAMA_TANPA_KATEGORI, daftarDokumenMitra, rincianRealisasi, ringkasanKeuanganProyek, type BagiHasilProyek, type ProyekKeuangan, type RingkasanKeuangan } from "@/lib/keuanganProyek";
import { statusSinkronAnggaran } from "@/lib/sinkronAnggaran";
import { progresTermin } from "@/lib/rencanaTermin";
import { hapusBarisAnggaranFormulir, samakanAnggaranBiayaProyekFormulir, sinkronAnggaranDariDokumenFormulir, tambahBarisAnggaranFormulir, ubahBarisAnggaranFormulir } from "@/lib/aksi/anggaranProyek";
import { siapkanKategoriBawaanFormulir } from "@/lib/aksi/kategoriAnggaran";
import { simpanLaporanKeuanganKeBerkasFormulir } from "@/lib/aksi/laporanKeuanganProyek";
import { bolehAksesBerkas } from "@/lib/berkas";
import { hapusMitraProyekFormulir, pindahUrutanMitraFormulir, tambahMitraProyekFormulir, ubahMitraProyekFormulir } from "@/lib/aksi/bagiHasil";
import FormulirAksi from "@/komponen/FormulirAksi";
import { SelPersetujuan } from "@/komponen/KontrolPersetujuan";
import TombolHapusDokumen from "@/komponen/TombolHapusDokumen";
import Ikon from "@/komponen/ui/Ikon";
import KartuKpi from "@/komponen/ui/KartuKpi";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import KontrolDaftar from "@/komponen/ui/KontrolDaftar";
import { LencanaPersetujuan, LencanaStatus, NomorDokumen, Rp } from "@/komponen/ui/Lencana";
import LencanaPerusahaan from "@/komponen/ui/LencanaPerusahaan";
import BilahPersen from "@/komponen/ui/BilahPersen";
import TabTautan from "@/komponen/ui/TabTautan";
import AngkaMargin from "@/komponen/proyek/AngkaMargin";
import TitikWarnaProyek from "@/komponen/proyek/TitikWarnaProyek";

/*
 * Detail keuangan satu proyek (D5 §7.2): tujuh KPI, rekonsiliasi dengan LPJ, lalu tab Anggaran vs realisasi, Anggaran,
 * Biaya aktual, Pendapatan, dan Bagi hasil. Halaman detail memakai perusahaan proyek itu sendiri, bukan lingkup aktif
 * (D5 §4.7). Tab Bagi hasil dan data mitra hanya dimuat untuk pemegang bagi-hasil.lihat; tab Biaya membuang baris bagi
 * laba per mitra bagi yang tidak memegangnya (tinjauan P35 R4). Kepala halaman memuat Pratinjau PDF, Unduh PDF
 * (/cetak/proyek/[id]/keuangan), dan Simpan PDF ke berkas bagi yang boleh mengunggah lampiran laporan keuangan proyek.
 */

type Tab = "ringkasan" | "anggaran" | "biaya" | "pendapatan" | "bagi-hasil";
const TAB: Tab[] = ["ringkasan", "anggaran", "biaya", "pendapatan", "bagi-hasil"];
const UKURAN_BIAYA = 50;

const rp = (v: { toString(): string }) => `Rp ${Number(v.toString()).toLocaleString("id-ID")}`;
const pct = (v: Desimal | null) => (v === null ? null : Number(v.toString()));
const teksPersen = (v: Desimal | null) => (v === null ? "-" : `${Number(v.toString()).toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`);
const ambilTeks = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

const JUDUL_PENDAPATAN: Record<RingkasanKeuangan["sumberPendapatan"], string> = {
  KONTRAK: "Nilai kontrak",
  FAKTUR: "Ditagih (belum ada kontrak)",
  PENAWARAN: "Penawaran (belum disetujui)",
  MANUAL: "Nilai kontrak (isian manual)",
  TIDAK_ADA: "Pendapatan",
};

export default async function HalamanDetailKeuanganProyek({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const pengguna = await wajibHak("anggaran-proyek.lihat");
  const boleh = (h: Hak) => punyaHak(pengguna, h);
  const { id } = await params;
  const sp = await searchParams;
  const lihatBagi = boleh("bagi-hasil.lihat");
  const tabMentah = ambilTeks(sp.tab) as Tab;
  const tab: Tab = TAB.includes(tabMentah) && (tabMentah !== "bagi-hasil" || lihatBagi) ? tabMentah : "ringkasan";

  const kp = await ringkasanKeuanganProyek(db, id, { denganBagiHasil: lihatBagi && tab === "bagi-hasil" });
  if (!kp) notFound();
  const { proyek, ringkasan: r } = kp;
  const dasar = `/proyek/${proyek.id}/keuangan`;

  const tabs = [
    { kunci: "ringkasan", label: "Anggaran vs realisasi", href: dasar },
    { kunci: "anggaran", label: "Anggaran", href: `${dasar}?tab=anggaran` },
    { kunci: "biaya", label: "Biaya aktual", href: `${dasar}?tab=biaya` },
    { kunci: "pendapatan", label: "Pendapatan", href: `${dasar}?tab=pendapatan` },
    ...(lihatBagi ? [{ kunci: "bagi-hasil", label: "Bagi hasil", href: `${dasar}?tab=bagi-hasil` }] : []),
  ];
  const piutangNegatif = r.piutang.lt(0);

  return (
    <div className="space-y-6">
      <KepalaHalaman
        jejak={[{ label: "Keuangan Proyek", href: "/proyek/keuangan" }, { label: proyek.kode }]}
        judul={`Keuangan ${proyek.kode} · ${proyek.nama}`}
        subjudul={`${proyek.klien ?? "Tanpa klien"} · ${proyek.perusahaan.nama} · Pendapatan dihitung tanpa PPN.`}
        lencana={
          <span className="flex items-center gap-2">
            <TitikWarnaProyek warna={proyek.warna} />
            <LencanaStatus status={proyek.status} />
            <LencanaPerusahaan kode={proyek.perusahaan.kode} warna={proyek.perusahaan.warna} nama={proyek.perusahaan.nama} />
          </span>
        }
        aksi={
          <>
            <a href={`/cetak/proyek/${proyek.id}/keuangan`} target="_blank" rel="noopener" className="tombol tombol-garis">
              <Ikon nama="open_in_new" className="!text-[18px]" />
              Pratinjau PDF
            </a>
            <a href={`/cetak/proyek/${proyek.id}/keuangan?unduh=1`} className="tombol tombol-garis">
              <Ikon nama="picture_as_pdf" className="!text-[18px]" />
              Unduh PDF
            </a>
            {bolehAksesBerkas(pengguna, { jenisEntitas: "laporan-keuangan-proyek" }, "unggah") && (
              <FormulirAksi aksi={simpanLaporanKeuanganKeBerkasFormulir.bind(null, proyek.id)} pesanSukses="Laporan disimpan ke Berkas proyek" className="inline">
                <button type="submit" className="tombol tombol-garis">
                  <Ikon nama="attach_file" className="!text-[18px]" />
                  Simpan PDF ke berkas
                </button>
              </FormulirAksi>
            )}
            {boleh("rekonsiliasi.lihat") && (
              <Link href={`/rekonsiliasi/event/${proyek.id}`} className="tombol tombol-garis">
                <Ikon nama="fact_check" className="!text-[18px]" />
                LPJ
              </Link>
            )}
            {boleh("proyek.lihat") && (
              <Link href={`/proyek/${proyek.id}`} className="tombol tombol-garis">
                <Ikon nama="event_note" className="!text-[18px]" />
                Ringkasan proyek
              </Link>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KartuKpi judul={JUDUL_PENDAPATAN[r.sumberPendapatan]} ikon="savings" nilai={rp(r.pendapatanRencana)} sub={`Ditagih ${rp(r.ditagih)} · Diterima ${rp(r.diterima)}`} />
        <KartuKpi judul="Anggaran" ikon="category" nilai={rp(r.anggaran)} sub={r.anggaran.gt(0) ? `${teksPersen(r.persenTerpakai)} terpakai` : "Belum ada anggaran"} />
        <KartuKpi
          judul="Biaya aktual"
          ikon="account_balance_wallet"
          nilai={rp(r.aktual)}
          sub={r.sisaAnggaran.lt(0) ? `Lebih anggaran ${rp(r.sisaAnggaran.neg())}` : `Sisa ${rp(r.sisaAnggaran)}`}
          lencana={r.sisaAnggaran.lt(0) ? { teks: "Lebih", cls: "lencana-rose" } : undefined}
        />
        <KartuKpi judul={`Margin kas (${teksPersen(r.persenMarginKas)})`} ikon="pie_chart" nilai={rp(r.marginKas)} sub="Diterima dikurangi biaya aktual, dasar bagi hasil" />
        <KartuKpi judul={`Margin rencana (${teksPersen(r.persenMarginRencana)})`} ikon="pie_chart" nilai={rp(r.marginRencana)} sub="Kontrak dikurangi anggaran" />
        <KartuKpi judul={`Margin perkiraan (${teksPersen(r.persenMarginPerkiraan)})`} ikon="pie_chart" nilai={rp(r.marginPerkiraan)} sub="Kontrak dikurangi nilai terbesar antara anggaran dan aktual per kategori" />
        <KartuKpi
          judul="Piutang"
          ikon="payments"
          nilai={piutangNegatif ? "Rp 0" : rp(r.piutang)}
          sub={piutangNegatif ? `Uang muka diterima lebih dulu ${rp(r.piutang.neg())}` : r.belumDitagih.gt(0) ? `Belum ditagih ${rp(r.belumDitagih)}` : "Semua sudah ditagih"}
        />
      </div>

      <p className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
        Biaya aktual {rp(r.aktual)} + bagi hasil mitra dibayar {rp(r.bagiHasilDibayar)} = total beban di LPJ {rp(r.aktual.plus(r.bagiHasilDibayar))}
        {boleh("rekonsiliasi.lihat") && (
          <>
            {" "}
            <Link href={`/rekonsiliasi/event/${proyek.id}`} className="tombol-tautan">
              Buka LPJ
            </Link>
          </>
        )}
      </p>

      {!proyek.perusahaan.aktif && (boleh("talangan-mitra.buat") || boleh("pembayaran-mitra.buat")) && (
        <p role="status" className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Perusahaan {proyek.perusahaan.nama} sudah diarsipkan; aktifkan dulu untuk mencatat dokumen mitra.
        </p>
      )}

      <TabTautan aktif={tab} daftar={tabs} label="Bagian keuangan proyek" />

      {tab === "ringkasan" && <TabRingkasan r={r} pengguna={pengguna} />}
      {tab === "anggaran" && <TabAnggaran proyek={proyek} pengguna={pengguna} sp={sp} />}
      {tab === "biaya" && <TabBiaya proyek={proyek} r={r} pengguna={pengguna} searchParams={searchParams} lihatBagi={lihatBagi} />}
      {tab === "pendapatan" && <TabPendapatan proyek={proyek} pengguna={pengguna} />}
      {tab === "bagi-hasil" && kp.bagiHasil && <TabBagiHasil proyek={proyek} r={r} bh={kp.bagiHasil} pengguna={pengguna} sp={sp} />}
    </div>
  );
}

// ---------- Anggaran vs realisasi ----------

async function TabRingkasan({ r, pengguna }: { r: RingkasanKeuangan; pengguna: PenggunaSesi }) {
  const ubahKategori = punyaHak(pengguna, "kategori-anggaran.ubah");
  const adaKategori = (await db.kategoriAnggaran.count()) > 0;
  const adaTanpaKategori = r.kategori.some((k) => k.kategoriId === null && k.nama === NAMA_TANPA_KATEGORI);
  const total = r.kategori.reduce((t, k) => ({ rencana: t.rencana.plus(k.rencana), aktual: t.aktual.plus(k.aktual) }), { rencana: D(0), aktual: D(0) });
  return (
    <section className="space-y-4">
      {!adaKategori && (
        <div role="status" className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 flex flex-wrap items-center gap-3">
          <span>Kategori anggaran belum disiapkan.</span>
          {ubahKategori && (
            <FormulirAksi aksi={siapkanKategoriBawaanFormulir} pesanSukses="Kategori bawaan disiapkan." className="inline">
              <button type="submit" className="tombol tombol-garis tombol-kecil">
                <Ikon nama="category" className="!text-[16px]" />
                Siapkan kategori bawaan
              </button>
            </FormulirAksi>
          )}
        </div>
      )}
      <div className="kartu kartu-tabel">
        <div className="bungkus-tabel">
          <table className="tabel min-w-[48rem]">
            <thead>
              <tr>
                <th>Kategori</th>
                <th className="text-right">Anggaran</th>
                <th className="text-right">Realisasi</th>
                <th className="text-right">Sisa</th>
                <th>Terpakai</th>
                <th>Catatan</th>
              </tr>
            </thead>
            <tbody>
              {r.kategori.length === 0 ? (
                <tr>
                  <td colSpan={6} className="kosong">
                    Belum ada anggaran maupun biaya untuk dibandingkan.
                  </td>
                </tr>
              ) : (
                r.kategori.map((k) => (
                  <tr key={k.kategoriId ?? "tanpa"}>
                    <td className="font-semibold text-slate-800">{k.nama}</td>
                    <td className="text-right">
                      <Rp nilai={k.rencana} />
                    </td>
                    <td className="text-right">
                      <Rp nilai={k.aktual} />
                    </td>
                    <td className="text-right">
                      <AngkaMargin nilai={k.sisa} />
                    </td>
                    <td>
                      <BilahPersen persen={pct(k.persenTerpakai)} lebih={k.lebih} />
                    </td>
                    <td>
                      {k.lebih && <span className="lencana lencana-rose">Lebih anggaran</span>}
                      {k.tanpaAnggaran && <span className="lencana lencana-amber">Tanpa anggaran</span>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {r.kategori.length > 0 && (
              <tfoot>
                <tr>
                  <th className="text-left">Total</th>
                  <th className="text-right">
                    <Rp nilai={total.rencana} />
                  </th>
                  <th className="text-right">
                    <Rp nilai={total.aktual} />
                  </th>
                  <th className="text-right">
                    <AngkaMargin nilai={total.rencana.minus(total.aktual)} />
                  </th>
                  <th colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
      {adaTanpaKategori && (
        <p className="petunjuk">
          Akun beban yang belum dipetakan ke kategori masuk ke {NAMA_TANPA_KATEGORI}. Atur di{" "}
          {ubahKategori ? (
            <Link href="/pengaturan/kategori-anggaran" className="tombol-tautan">
              Pengaturan › Kategori Anggaran Proyek
            </Link>
          ) : (
            "Pengaturan › Kategori Anggaran Proyek"
          )}
          .
        </p>
      )}
    </section>
  );
}

// ---------- Anggaran ----------

function bannerSinkron(sp: Record<string, string | string[] | undefined>): string[] | null {
  const nomor = ambilTeks(sp.sinkron);
  if (!nomor) return null;
  const n = (k: string) => Math.max(0, Number.parseInt(ambilTeks(sp[k]), 10) || 0);
  const [a, u, h, k] = [n("tambah"), n("ubah"), n("hapus"), n("kategoriBaru")];
  const pesan =
    ambilTeks(sp.pertama) === "1"
      ? `${a} baris diimpor dari ${nomor}. Isi rencana biaya tiap baris.`
      : a + u + h === 0
        ? `Anggaran sudah sesuai dengan ${nomor}.`
        : `Anggaran diperbarui dari ${nomor}: ${u} harga berubah, ${a} ditambah, ${h} tidak ada lagi di dokumen. Rencana biaya yang sudah diisi tidak berubah.`;
  return k > 0 ? [pesan, `${k} kategori baru dibuat dari bagian dokumen; petakan akun bebannya di Pengaturan › Kategori Anggaran Proyek.`] : [pesan];
}

function IsianBarisAnggaran({ kategori, awal, idAwalan }: { kategori: { id: string; nama: string }[]; awal?: { kategoriId: string; deskripsi: string; rencana: string; vendor: string; catatan: string }; idAwalan: string }) {
  return (
    <>
      <div className="space-y-1">
        <label htmlFor={`${idAwalan}-kategori`} className="label">
          Kategori
        </label>
        <select id={`${idAwalan}-kategori`} name="kategoriId" defaultValue={awal?.kategoriId ?? ""} className="isian">
          <option value="">Pilih kategori</option>
          {kategori.map((k) => (
            <option key={k.id} value={k.id}>
              {k.nama}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor={`${idAwalan}-kategori-baru`} className="label">
          Atau kategori baru
        </label>
        <input id={`${idAwalan}-kategori-baru`} name="kategoriBaru" maxLength={60} className="isian" />
      </div>
      <div className="space-y-1">
        <label htmlFor={`${idAwalan}-uraian`} className="label">
          Uraian *
        </label>
        <input id={`${idAwalan}-uraian`} name="deskripsi" required maxLength={200} defaultValue={awal?.deskripsi ?? ""} className="isian" />
      </div>
      <div className="space-y-1">
        <label htmlFor={`${idAwalan}-rencana`} className="label">
          Rencana biaya (Rp)
        </label>
        <input id={`${idAwalan}-rencana`} name="rencana" type="number" min="0" step="0.01" defaultValue={awal?.rencana ?? ""} className="isian angka" />
      </div>
      <div className="space-y-1">
        <label htmlFor={`${idAwalan}-vendor`} className="label">
          Vendor / mitra
        </label>
        <input id={`${idAwalan}-vendor`} name="vendor" maxLength={120} defaultValue={awal?.vendor ?? ""} className="isian" />
      </div>
      <div className="space-y-1">
        <label htmlFor={`${idAwalan}-catatan`} className="label">
          Catatan
        </label>
        <textarea id={`${idAwalan}-catatan`} name="catatan" maxLength={1000} defaultValue={awal?.catatan ?? ""} className="isian h-auto min-h-24 py-2" />
      </div>
    </>
  );
}

async function TabAnggaran({ proyek, pengguna, sp }: { proyek: ProyekKeuangan; pengguna: PenggunaSesi; sp: Record<string, string | string[] | undefined> }) {
  const boleh = (h: Hak) => punyaHak(pengguna, h);
  const [buat, ubah, hapus] = [boleh("anggaran-proyek.buat"), boleh("anggaran-proyek.ubah"), boleh("anggaran-proyek.hapus")];
  const lihatPnw = boleh("penawaran.lihat");
  const lihatPsj = boleh("pesanan.lihat");
  const kategori = await db.kategoriAnggaran.findMany({ orderBy: [{ urutan: "asc" }, { nama: "asc" }], select: { id: true, nama: true } });
  const baris = await db.barisAnggaranProyek.findMany({
    where: { proyekId: proyek.id },
    orderBy: [{ kategori: { urutan: "asc" } }, { kategori: { nama: "asc" } }, { dibuatPada: "asc" }, { id: "asc" }],
    include: { kategori: { select: { nama: true } }, sumberPenawaran: { select: { nomor: true } }, sumberPesanan: { select: { nomor: true } } },
  });
  const status = await statusSinkronAnggaran(db, proyek.id);
  const sumberDok = [
    ...(lihatPnw ? (await db.penawaranPenjualan.findMany({ where: { proyekId: proyek.id, perusahaanId: proyek.perusahaan.id }, orderBy: [{ tanggal: "desc" }, { nomor: "desc" }], select: { id: true, nomor: true, status: true } })).map((d) => ({ ...d, jenis: "penawaran" as const, label: "Penawaran" })) : []),
    ...(lihatPsj ? (await db.pesananPenjualan.findMany({ where: { proyekId: proyek.id, perusahaanId: proyek.perusahaan.id }, orderBy: [{ tanggal: "desc" }, { nomor: "desc" }], select: { id: true, nomor: true, status: true } })).map((d) => ({ ...d, jenis: "pesanan" as const, label: "Pesanan" })) : []),
  ];
  const basi = [...status.values()].filter((s) => s.basi && (s.jenis === "penawaran" ? lihatPnw : lihatPsj));
  const totalRencana = baris.reduce((t, b) => t.plus(D(b.rencana)), D(0));
  const ubahId = ambilTeks(sp.ubahBaris);
  const banner = bannerSinkron(sp);
  const anggaranLpj = (await db.proyek.findUnique({ where: { id: proyek.id }, select: { anggaranBiaya: true } }))?.anggaranBiaya ?? null;
  // kontrak perbaikan P34 R3: tombol Samakan hanya bila proyek sudah punya baris anggaran
  const tampilSamakan = baris.length > 0 && ubah && boleh("data-induk.tulis") && (anggaranLpj === null || !D(anggaranLpj).equals(totalRencana));

  return (
    <section className="space-y-4">
      {banner && (
        <div role="status" className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 space-y-1">
          {banner.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </div>
      )}
      {basi.map((s) => (
        <div key={`${s.jenis}:${s.id}`} role="status" className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 flex flex-wrap items-center gap-3">
          <span>
            {s.nomor} berubah sejak anggaran terakhir diimpor ({s.jumlahBaris.toLocaleString("id-ID")} baris).
          </span>
          {buat && (
            <FormulirAksi aksi={sinkronAnggaranDariDokumenFormulir.bind(null, proyek.id)} className="inline">
              <input type="hidden" name="sumber" value={`${s.jenis}:${s.id}`} />
              <button type="submit" className="tombol tombol-garis tombol-kecil">
                <Ikon nama="sync" className="!text-[16px]" />
                Perbarui anggaran
              </button>
            </FormulirAksi>
          )}
        </div>
      ))}

      {buat && sumberDok.length > 0 && (
        <div className="kartu space-y-3">
          <h2 className="judul-kartu">Impor dari penawaran / pesanan</h2>
          <FormulirAksi aksi={sinkronAnggaranDariDokumenFormulir.bind(null, proyek.id)} className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label htmlFor="sumber-anggaran" className="label">
                Dokumen sumber
              </label>
              <select id="sumber-anggaran" name="sumber" required className="isian w-96 max-w-full">
                {sumberDok.map((d) => {
                  const st = status.get(`${d.jenis}:${d.id}`);
                  return (
                    <option key={`${d.jenis}:${d.id}`} value={`${d.jenis}:${d.id}`}>
                      {`${d.nomor} · ${d.label} · ${d.status}${st ? (st.basi ? " · perlu diperbarui" : " · sudah diimpor") : ""}`}
                    </option>
                  );
                })}
              </select>
            </div>
            <button type="submit" className="tombol tombol-garis">
              <Ikon nama="sync" className="!text-[18px]" />
              Impor / perbarui
            </button>
          </FormulirAksi>
        </div>
      )}

      {buat && (
        <div className="kartu space-y-3">
          <h2 className="judul-kartu">Tambah baris anggaran</h2>
          <FormulirAksi aksi={tambahBarisAnggaranFormulir.bind(null, proyek.id)} pesanSukses="Baris anggaran ditambahkan" className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <IsianBarisAnggaran kategori={kategori} idAwalan="baru" />
            <div className="md:col-span-2">
              <button type="submit" className="tombol tombol-utama min-h-11 w-full sm:w-auto">
                <Ikon nama="add" className="!text-[18px]" />
                Tambah baris
              </button>
            </div>
          </FormulirAksi>
        </div>
      )}

      <div className="kartu kartu-tabel">
        <div className="bungkus-tabel">
          <table className="tabel min-w-[52rem]">
            <thead>
              <tr>
                <th>Kategori</th>
                <th>Uraian</th>
                <th>Vendor</th>
                <th className="text-right">Harga dokumen</th>
                <th className="text-right">Rencana</th>
                <th className="th-lekat" aria-label="Aksi" />
              </tr>
            </thead>
            <tbody>
              {baris.length === 0 ? (
                <tr>
                  <td colSpan={6} className="kosong">
                    Belum ada baris anggaran.
                  </td>
                </tr>
              ) : (
                baris.map((b) => {
                  const nomorSumber = b.sumberPenawaran?.nomor ?? b.sumberPesanan?.nomor ?? null;
                  if (ubah && ubahId === b.id)
                    return (
                      <tr key={b.id}>
                        <td colSpan={6}>
                          <FormulirAksi aksi={ubahBarisAnggaranFormulir.bind(null, proyek.id, b.id)} className="grid grid-cols-1 md:grid-cols-2 gap-4 py-2">
                            <IsianBarisAnggaran
                              kategori={kategori}
                              idAwalan={`ubah-${b.id}`}
                              awal={{ kategoriId: b.kategoriId, deskripsi: b.deskripsi, rencana: D(b.rencana).toFixed(2), vendor: b.vendor ?? "", catatan: b.catatan ?? "" }}
                            />
                            <div className="md:col-span-2 flex flex-wrap gap-3">
                              <button type="submit" className="tombol tombol-utama">
                                Simpan baris
                              </button>
                              <Link href={`/proyek/${proyek.id}/keuangan?tab=anggaran`} className="tombol tombol-garis">
                                Batal
                              </Link>
                            </div>
                          </FormulirAksi>
                        </td>
                      </tr>
                    );
                  return (
                    <tr key={b.id}>
                      <td className="text-slate-600">{b.kategori.nama}</td>
                      <td>
                        <div className="font-semibold text-slate-800">{b.deskripsi}</div>
                        {nomorSumber && <div className="text-xs text-slate-500">dari {nomorSumber}</div>}
                        {b.dihapusDariSumber && nomorSumber && <span className="lencana lencana-amber mt-1">Tidak ada lagi di {nomorSumber}</span>}
                        {b.catatan && <div className="text-xs text-slate-500">{b.catatan}</div>}
                      </td>
                      <td className="text-slate-600">{b.vendor ?? "-"}</td>
                      <td className="text-right">{b.nilaiAcuan === null ? "-" : <Rp nilai={b.nilaiAcuan} />}</td>
                      <td className="text-right">
                        <Rp nilai={b.rencana} />
                      </td>
                      <td className="td-lekat whitespace-nowrap">
                        <span className="flex items-center gap-3">
                          {ubah && (
                            <Link href={`/proyek/${proyek.id}/keuangan?tab=anggaran&ubahBaris=${b.id}`} className="tombol-tautan">
                              Ubah
                            </Link>
                          )}
                          {hapus && (
                            <FormulirAksi aksi={hapusBarisAnggaranFormulir.bind(null, proyek.id, b.id)} pesanKonfirmasi={`Hapus baris anggaran ${b.deskripsi}?`} className="inline">
                              <button type="submit" className="tombol-tautan-bahaya">
                                Hapus
                              </button>
                            </FormulirAksi>
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {baris.length > 0 && (
              <tfoot>
                <tr>
                  <th colSpan={4} className="text-left">
                    Total anggaran
                  </th>
                  <th className="text-right">
                    <Rp nilai={totalRencana} />
                  </th>
                  <th />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {tampilSamakan && (
        <div className="kartu flex flex-wrap items-center gap-3 text-sm">
          <span>
            Anggaran biaya event di LPJ {anggaranLpj === null ? "belum diisi" : rp(anggaranLpj)}, total anggaran per kategori {rp(totalRencana)}.
          </span>
          <FormulirAksi aksi={samakanAnggaranBiayaProyekFormulir.bind(null, proyek.id)} pesanSukses="Anggaran biaya LPJ disamakan." className="inline">
            <button type="submit" className="tombol tombol-garis tombol-kecil">
              Samakan anggaran biaya LPJ
            </button>
          </FormulirAksi>
        </div>
      )}
    </section>
  );
}

// ---------- Biaya aktual ----------

async function TabBiaya({
  proyek,
  r,
  pengguna,
  searchParams,
  lihatBagi,
}: {
  proyek: ProyekKeuangan;
  r: RingkasanKeuangan;
  pengguna: PenggunaSesi;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  lihatBagi: boolean;
}) {
  const param = await bacaParamDaftar(searchParams, UKURAN_BIAYA);
  const rinci = await rincianRealisasi(db, proyek.id, { pengguna, denganBagiHasil: lihatBagi });
  const q = param.q.toLowerCase();
  const tersaring = q
    ? rinci.baris.filter((b) => [b.nomorJurnal, b.keterangan ?? "", b.akun.kode, b.akun.nama, b.kategori, b.didanaiOleh].some((x) => x.toLowerCase().includes(q)))
    : rinci.baris;
  const halaman = tersaring.slice(param.lewati, param.lewati + param.ambil);
  const totalBiaya = tersaring.filter((b) => !b.bagiHasil).reduce((t, b) => t.plus(b.jumlah), D(0));
  // tinjauan P37 S2: dokumen mitra tidak bisa dicatat untuk perusahaan yang diarsipkan, jadi tombolnya disembunyikan
  const bolehTalangan = punyaHak(pengguna, "talangan-mitra.buat") && proyek.perusahaan.aktif;
  const bolehKas = punyaHak(pengguna, "kas-keluar.buat");
  return (
    <section className="space-y-4">
      <p className="text-sm text-slate-600">Biaya aktual dibaca dari jurnal yang bertanda proyek ini, sama dengan LPJ. Bagi hasil mitra tidak termasuk.</p>
      {(bolehTalangan || bolehKas) && (
        <div className="flex flex-wrap items-center gap-3">
          {bolehTalangan && (
            <Link href={`/proyek/${proyek.id}/keuangan/talangan/baru`} className="tombol tombol-garis">
              <Ikon nama="handshake" className="!text-[18px]" />
              Catat talangan mitra
            </Link>
          )}
          {bolehKas && (
            <span className="text-sm text-slate-600">
              <Link href="/kas-bank/keluar" className="tombol-tautan">
                Catat lewat Kas Keluar
              </Link>{" "}
              Pilih event {proyek.kode} di formulirnya.
            </span>
          )}
        </div>
      )}
      {rinci.terpotong && (
        <p role="status" className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Menampilkan {rinci.batas.toLocaleString("id-ID")} baris jurnal terbaru. Baris yang lebih lama tidak tampil di sini, tetapi tetap dihitung di biaya aktual {rp(r.aktual)} dan di LPJ.
        </p>
      )}
      <div className="kartu kartu-tabel">
        <KontrolDaftar param={param} total={tersaring.length} placeholder="Cari jurnal, keterangan, akun, atau kategori…" tambahan={{ tab: "biaya" }} adaSaringan={!!param.q} />
        <div className="bungkus-tabel">
          <table className="tabel min-w-[64rem]">
            <thead>
              <tr>
                <th>Tanggal</th>
                <th>Jurnal</th>
                <th>Keterangan</th>
                <th>Akun</th>
                <th>Kategori</th>
                <th>Didanai oleh</th>
                <th className="text-right">Jumlah</th>
                <th>Lampiran</th>
              </tr>
            </thead>
            <tbody>
              {halaman.length === 0 ? (
                <tr>
                  <td colSpan={8} className="kosong">
                    {param.q ? "Tidak ada biaya yang cocok dengan pencarian." : "Belum ada biaya yang dijurnal untuk proyek ini."}
                  </td>
                </tr>
              ) : (
                halaman.map((b) => (
                  <tr key={b.barisId}>
                    <td className="whitespace-nowrap text-slate-500">{formatTanggal(b.tanggal)}</td>
                    <td>
                      <NomorDokumen nomor={b.nomorJurnal} />
                    </td>
                    <td className="text-slate-600">
                      {b.keterangan ?? "-"}
                      {b.bagiHasil && <span className="lencana lencana-slate ml-2">Bagi hasil, di luar biaya aktual</span>}
                    </td>
                    <td className="text-slate-600 whitespace-nowrap">
                      <span className="mono text-xs">{b.akun.kode}</span> {b.akun.nama}
                    </td>
                    <td className="text-slate-600">{b.kategori}</td>
                    <td className="text-slate-600">{b.didanaiOleh}</td>
                    <td className="text-right">
                      <AngkaMargin nilai={b.jumlah} />
                    </td>
                    <td className="whitespace-nowrap text-slate-600">
                      {b.lampiran ? (
                        <span className="inline-flex items-center gap-1">
                          <Ikon nama="attach_file" className="!text-[16px]" />
                          {b.lampiran.toLocaleString("id-ID")}
                        </span>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {tersaring.length > 0 && (
              <tfoot>
                <tr>
                  <th colSpan={6} className="text-left">
                    Total biaya {param.q ? "yang cocok" : rinci.terpotong ? `(${rinci.batas.toLocaleString("id-ID")} baris terbaru)` : ""}
                  </th>
                  <th className="text-right">
                    <AngkaMargin nilai={totalBiaya} />
                  </th>
                  <th />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
      {rinci.bagiLabaTersembunyi && !rinci.bagiLabaTersembunyi.isZero() && (
        <p className="petunjuk">
          Total beban di LPJ termasuk bagi laba mitra {rp(rinci.bagiLabaTersembunyi)}. Rincian per mitra hanya terlihat oleh pemegang hak bagi hasil.
        </p>
      )}
    </section>
  );
}

// ---------- Pendapatan ----------

async function TabPendapatan({ proyek, pengguna }: { proyek: ProyekKeuangan; pengguna: PenggunaSesi }) {
  const boleh = (h: Hak) => punyaHak(pengguna, h);
  const lihatBayar = boleh("uang-muka.lihat") && boleh("penerimaan.lihat");
  // tinjauan P37 R5: dokumen perusahaan lain yang masih menaut proyek tetap dihitung (sama dengan ringkasan), tetapi diberi
  // lencana perusahaannya supaya bedanya dengan kartu impor di tab Anggaran terlihat
  type PerusahaanDok = { id: string; kode: string; nama: string; warna: string | null };
  type Dok = { kunci: string; href: string; nomor: string; jenis: string; status: string; persetujuan?: boolean; tanggal: Date; nilai: Desimal; catatan?: string; perusahaan: PerusahaanDok };
  const pilihPerusahaan = { select: { id: true, kode: true, nama: true, warna: true } } as const;
  const dok: Dok[] = [];
  if (boleh("penawaran.lihat"))
    for (const d of await db.penawaranPenjualan.findMany({ where: { proyekId: proyek.id }, orderBy: [{ tanggal: "desc" }, { nomor: "desc" }], select: { id: true, nomor: true, status: true, tanggal: true, total: true, perusahaan: pilihPerusahaan } }))
      dok.push({ kunci: `pnw-${d.id}`, href: `/penjualan/penawaran/${d.id}`, nomor: d.nomor, jenis: "Penawaran", status: d.status, tanggal: d.tanggal, nilai: D(d.total), perusahaan: d.perusahaan });
  const pesanan = boleh("pesanan.lihat")
    ? await db.pesananPenjualan.findMany({ where: { proyekId: proyek.id }, orderBy: [{ tanggal: "desc" }, { nomor: "desc" }], select: { id: true, nomor: true, status: true, tanggal: true, total: true, perusahaan: pilihPerusahaan } })
    : [];
  for (const d of pesanan) dok.push({ kunci: `psj-${d.id}`, href: `/penjualan/pesanan/${d.id}`, nomor: d.nomor, jenis: "Pesanan", status: d.status, tanggal: d.tanggal, nilai: D(d.total), perusahaan: d.perusahaan });
  if (boleh("faktur.lihat"))
    for (const d of await db.fakturPenjualan.findMany({ where: { pesanan: { proyekId: proyek.id } }, orderBy: [{ tanggal: "desc" }, { nomor: "desc" }], select: { id: true, nomor: true, status: true, statusPersetujuan: true, tanggal: true, dpp: true, perusahaan: pilihPerusahaan } }))
      dok.push({ kunci: `fj-${d.id}`, href: `/penjualan/faktur/${d.id}`, nomor: d.nomor, jenis: "Faktur", status: d.status, tanggal: d.tanggal, nilai: D(d.dpp), catatan: d.statusPersetujuan === "DISETUJUI" ? undefined : "tidak dihitung", perusahaan: d.perusahaan });
  if (boleh("uang-muka.lihat"))
    for (const d of await db.uangMukaPelanggan.findMany({ where: { pesanan: { proyekId: proyek.id } }, orderBy: [{ tanggal: "desc" }, { nomor: "desc" }], select: { id: true, nomor: true, tanggal: true, jumlah: true, statusPersetujuan: true, rencanaTermin: { select: { label: true } }, perusahaan: pilihPerusahaan } }))
      dok.push({ kunci: `um-${d.id}`, href: `/penjualan/uang-muka/${d.id}`, nomor: d.nomor, jenis: "Uang muka", status: d.statusPersetujuan, persetujuan: true, tanggal: d.tanggal, nilai: D(d.jumlah), catatan: d.rencanaTermin ? `termin ${d.rencanaTermin.label}, termasuk PPN` : "termasuk PPN", perusahaan: d.perusahaan });
  const termin: { pesanan: { id: string; nomor: string }; butir: NonNullable<Awaited<ReturnType<typeof progresTermin>>>["butir"] }[] = [];
  for (const p of pesanan) {
    const pr = await progresTermin(db, p.id);
    if (pr && pr.butir.length > 0) termin.push({ pesanan: p, butir: pr.butir });
  }
  return (
    <section className="space-y-4">
      <p className="text-sm text-slate-600">Nilai tanpa PPN. Faktur yang belum disetujui tidak dihitung sebagai ditagih.</p>
      {dok.some((d) => d.perusahaan.id !== proyek.perusahaan.id) && (
        <p role="status" className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Dokumen berlencana kode perusahaan milik perusahaan lain, bukan {proyek.perusahaan.nama}. Dokumen itu tetap dihitung di ringkasan, tetapi tidak bisa diimpor ke anggaran.
        </p>
      )}
      <div className="kartu kartu-tabel">
        <div className="bungkus-tabel">
          <table className="tabel min-w-[44rem]">
            <thead>
              <tr>
                <th>Dokumen</th>
                <th>Jenis</th>
                <th>Status</th>
                <th>Tanggal</th>
                <th className="text-right">Nilai (tanpa PPN)</th>
              </tr>
            </thead>
            <tbody>
              {dok.length === 0 ? (
                <tr>
                  <td colSpan={5} className="kosong">
                    Belum ada penawaran, pesanan, atau faktur untuk proyek ini.
                  </td>
                </tr>
              ) : (
                dok.map((d) => (
                  <tr key={d.kunci}>
                    <td>
                      <span className="inline-flex flex-wrap items-center gap-2">
                        <Link href={d.href} className="hover:underline">
                          <NomorDokumen nomor={d.nomor} />
                        </Link>
                        {d.perusahaan.id !== proyek.perusahaan.id && <LencanaPerusahaan kode={d.perusahaan.kode} warna={d.perusahaan.warna} nama={`Milik ${d.perusahaan.nama}, bukan perusahaan proyek`} />}
                      </span>
                    </td>
                    <td className="text-slate-600">{d.jenis}</td>
                    <td>{d.persetujuan ? <LencanaPersetujuan status={d.status} /> : <LencanaStatus status={d.status} />}</td>
                    <td className="whitespace-nowrap text-slate-500">{formatTanggal(d.tanggal)}</td>
                    <td className="text-right">
                      <Rp nilai={d.nilai} />
                      {d.catatan && <div className="text-xs text-slate-500">{d.catatan}</div>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      {termin.map((t) => (
        <div key={t.pesanan.id} className="kartu kartu-tabel">
          <div className="kepala-kartu">
            <h2 className="judul-kartu">Termin {t.pesanan.nomor}</h2>
          </div>
          <div className="bungkus-tabel">
            <table className="tabel min-w-[40rem]">
              <thead>
                <tr>
                  <th>Termin</th>
                  <th className="text-right">Jumlah (tanpa PPN)</th>
                  <th>Jatuh tempo</th>
                  <th>Ditagih</th>
                  {lihatBayar && <th className="text-right">Dibayar</th>}
                </tr>
              </thead>
              <tbody>
                {t.butir.map((b) => (
                  <tr key={b.id}>
                    <td className="font-semibold text-slate-800">{b.label}</td>
                    <td className="text-right">
                      <Rp nilai={b.jumlah} />
                    </td>
                    <td className="whitespace-nowrap text-slate-500">{b.jatuhTempo ? formatTanggal(b.jatuhTempo) : "-"}</td>
                    <td className="whitespace-nowrap text-slate-500">{b.ditagihPada ? formatTanggal(b.ditagihPada) : "-"}</td>
                    {lihatBayar && (
                      <td className="text-right">
                        <Rp nilai={b.dibayar} />
                        <div className="text-xs text-slate-500">{b.status}</div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </section>
  );
}

// ---------- Bagi hasil ----------

async function TabBagiHasil({ proyek, r, bh, pengguna, sp }: { proyek: ProyekKeuangan; r: RingkasanKeuangan; bh: BagiHasilProyek; pengguna: PenggunaSesi; sp: Record<string, string | string[] | undefined> }) {
  const boleh = (h: Hak) => punyaHak(pengguna, h);
  const [buatMitra, ubahMitra, hapusMitra] = [boleh("bagi-hasil.buat"), boleh("bagi-hasil.ubah"), boleh("bagi-hasil.hapus")];
  // tinjauan P37 S2: pembuat dokumen mitra disembunyikan bila perusahaan proyek diarsipkan
  const aktif = proyek.perusahaan.aktif;
  const bayar = boleh("pembayaran-mitra.buat") && aktif;
  const lihatTalangan = boleh("talangan-mitra.lihat");
  const lihatBayar = boleh("pembayaran-mitra.lihat");
  const catatan = new Map((await db.mitraProyek.findMany({ where: { proyekId: proyek.id }, select: { id: true, catatan: true } })).map((m) => [m.id, m.catatan]));
  const dokumen = lihatTalangan || lihatBayar ? await daftarDokumenMitra(db, proyek.id) : { talangan: [], pembayaran: [] };
  const ubahId = ambilTeks(sp.ubahMitra);
  const mitraBaru = ambilTeks(sp.mitraBaru) === "1";
  const ps = bh.penyelesaian;
  const modalMitra = bh.mitra.reduce((t, m) => t.plus(m.modalMasuk), D(0));
  const persenKembali = Number(ps.persenModalKembali.toString());
  const totalModalMasuk = modalMitra.plus(bh.perusahaan.modalMasuk);
  const totalModalKembali = ps.modalKembaliMitra.plus(bh.perusahaan.modalKembali);
  const totalLaba = ps.labaMitra.plus(bh.perusahaan.realisasi);
  const ketentuan = (m: { mode: string; nilai: Desimal }) => (m.mode === "NOMINAL" ? `${rp(m.nilai)} tetap` : `${Number(m.nilai.toString()).toLocaleString("id-ID")}% dari sisa`);

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KartuKpi judul="Margin dibagi" ikon="pie_chart" nilai={rp(ps.marginDibagi)} sub={`Diterima ${rp(ps.diterima)} dikurangi biaya aktual ${rp(ps.biayaAktual)}`} />
        <KartuKpi
          judul="Modal kembali ke mitra"
          ikon="handshake"
          nilai={rp(ps.modalKembaliMitra)}
          sub={ps.danaMitra.gt(0) ? `Mitra menalangi ${rp(ps.danaMitra)} dari biaya${persenKembali < 100 ? ` · ${ps.persenModalKembali.toString().replace(".", ",")}% kembali` : ""}` : "Tidak ada biaya yang ditalangi mitra"}
        />
        <KartuKpi judul="Laba untuk mitra" ikon="savings" nilai={rp(ps.labaMitra)} sub={`Perusahaan menyimpan laba ${rp(bh.perusahaan.realisasi)}`} />
        <KartuKpi judul="Sisa yang harus dibayar" ikon="account_balance_wallet" nilai={rp(bh.terutangTotal)} sub={`Sudah dibayar ${rp(bh.dibayarTotal)} dari ${rp(ps.totalHakMitra)}`} />
      </div>
      <p className="text-sm text-slate-600">Perkiraan (kontrak dikurangi anggaran): {rp(r.marginRencana)}. Hanya untuk rencana; yang dibayarkan hanya bagian dari margin kas.</p>
      {bh.peringatan.length > 0 && (
        <div role="status" className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 space-y-1">
          {bh.peringatan.map((p) => (
            <p key={p} className="flex items-start gap-2">
              <Ikon nama="error" className="!text-[18px]" />
              {p}
            </p>
          ))}
        </div>
      )}

      <div className="kartu kartu-tabel">
        <div className="kepala-kartu flex flex-wrap items-center justify-between gap-3">
          <h2 className="judul-kartu">Mitra dan pembagian</h2>
          {buatMitra && !mitraBaru && (
            <Link href={`/proyek/${proyek.id}/keuangan?tab=bagi-hasil&mitraBaru=1`} className="tombol tombol-garis">
              <Ikon nama="add" className="!text-[18px]" />
              Tambah mitra
            </Link>
          )}
        </div>
        {buatMitra && mitraBaru && (
          <div className="px-4 pb-4 space-y-2">
            <FormulirAksi aksi={tambahMitraProyekFormulir.bind(null, proyek.id)} pesanSukses="Mitra ditambahkan" className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <IsianMitra idAwalan="baru" />
              <div className="md:col-span-2 flex flex-wrap gap-3">
                <button type="submit" className="tombol tombol-utama">
                  Simpan mitra
                </button>
                <Link href={`/proyek/${proyek.id}/keuangan?tab=bagi-hasil`} className="tombol tombol-garis">
                  Tutup
                </Link>
              </div>
            </FormulirAksi>
            <p className="petunjuk">Nominal tetap dibayar lebih dulu sesuai urutan. Persen dihitung dari sisa setelah nominal tetap, dan sisanya untuk perusahaan.</p>
          </div>
        )}
        <div className="bungkus-tabel">
          <table className="tabel min-w-[72rem]">
            <thead>
              <tr>
                <th>No</th>
                <th>Mitra</th>
                <th>Ketentuan</th>
                <th className="text-right">Modal masuk</th>
                <th className="text-right">Modal kembali</th>
                <th className="text-right">Bagian laba</th>
                <th className="text-right">Total hak</th>
                <th className="text-right">Dibayar</th>
                <th className="text-right">Terutang</th>
                <th>Status</th>
                <th className="th-lekat" aria-label="Aksi" />
              </tr>
            </thead>
            <tbody>
              {bh.mitra.length === 0 && (
                <tr>
                  <td colSpan={11} className="kosong">
                    Belum ada mitra untuk proyek ini. Seluruh margin tetap milik perusahaan.
                  </td>
                </tr>
              )}
              {bh.mitra.map((m, i) =>
                ubahMitra && ubahId === m.id ? (
                  <tr key={m.id}>
                    <td colSpan={11}>
                      <FormulirAksi aksi={ubahMitraProyekFormulir.bind(null, proyek.id, m.id)} className="grid grid-cols-1 md:grid-cols-2 gap-4 py-2">
                        <IsianMitra idAwalan={`ubah-${m.id}`} awal={{ nama: m.nama, mode: m.mode, nilai: m.nilai.toFixed(2), catatan: catatan.get(m.id) ?? "" }} />
                        <div className="md:col-span-2 flex flex-wrap gap-3">
                          <button type="submit" className="tombol tombol-utama">
                            Simpan mitra
                          </button>
                          <Link href={`/proyek/${proyek.id}/keuangan?tab=bagi-hasil`} className="tombol tombol-garis">
                            Batal
                          </Link>
                        </div>
                      </FormulirAksi>
                    </td>
                  </tr>
                ) : (
                  <tr key={m.id}>
                    <td className="angka">{i + 1}</td>
                    <td>
                      <div className="font-semibold text-slate-800">{m.nama}</div>
                      {catatan.get(m.id) && <div className="text-xs text-slate-500">{catatan.get(m.id)}</div>}
                    </td>
                    <td className="text-slate-600 whitespace-nowrap">{ketentuan(m)}</td>
                    <td className="text-right">
                      <Rp nilai={m.modalMasuk} />
                    </td>
                    <td className="text-right">
                      <Rp nilai={m.modalKembali} />
                    </td>
                    <td className="text-right">
                      <Rp nilai={m.realisasi} />
                      <div className="text-xs text-slate-500">perk. {rp(m.estimasi)}</div>
                    </td>
                    <td className="text-right font-semibold">
                      <Rp nilai={m.totalHak} />
                    </td>
                    <td className="text-right">
                      <Rp nilai={m.dibayar} />
                    </td>
                    <td className="text-right">
                      <AngkaMargin nilai={m.terutang} />
                    </td>
                    <td>
                      <LencanaStatus status={m.status} />
                    </td>
                    <td className="td-lekat whitespace-nowrap">
                      <span className="flex items-center gap-2">
                        {bayar && (
                          <Link href={`/proyek/${proyek.id}/keuangan/bayar/baru?mitra=${m.id}`} className="tombol-tautan">
                            Bayar
                          </Link>
                        )}
                        {ubahMitra && (
                          <>
                            <Link href={`/proyek/${proyek.id}/keuangan?tab=bagi-hasil&ubahMitra=${m.id}`} className="tombol-tautan">
                              Ubah
                            </Link>
                            <FormulirAksi aksi={pindahUrutanMitraFormulir.bind(null, proyek.id, m.id, "naik")} className="inline">
                              <button type="submit" aria-label="Naikkan urutan" title="Naikkan urutan" className="tombol tombol-garis tombol-kecil disabled:opacity-40" disabled={i === 0}>
                                <Ikon nama="arrow_upward" className="!text-[18px]" />
                              </button>
                            </FormulirAksi>
                            <FormulirAksi aksi={pindahUrutanMitraFormulir.bind(null, proyek.id, m.id, "turun")} className="inline">
                              <button type="submit" aria-label="Turunkan urutan" title="Turunkan urutan" className="tombol tombol-garis tombol-kecil disabled:opacity-40" disabled={i === bh.mitra.length - 1}>
                                <Ikon nama="arrow_downward" className="!text-[18px]" />
                              </button>
                            </FormulirAksi>
                          </>
                        )}
                        {hapusMitra && (
                          <FormulirAksi aksi={hapusMitraProyekFormulir.bind(null, proyek.id, m.id)} pesanKonfirmasi={`Hapus mitra ${m.nama}?`} className="inline">
                            <button type="submit" className="tombol-tautan-bahaya">
                              Hapus
                            </button>
                          </FormulirAksi>
                        )}
                      </span>
                    </td>
                  </tr>
                ),
              )}
              <tr>
                <td />
                <td className="font-semibold text-slate-800">Perusahaan (sisa)</td>
                <td className="text-slate-600">sisa</td>
                <td className="text-right">
                  <Rp nilai={bh.perusahaan.modalMasuk} />
                </td>
                <td className="text-right">
                  <Rp nilai={bh.perusahaan.modalKembali} />
                </td>
                <td className="text-right">
                  <Rp nilai={bh.perusahaan.realisasi} />
                  <div className="text-xs text-slate-500">perk. {rp(bh.perusahaan.estimasi)}</div>
                </td>
                <td className="text-right font-semibold">
                  <Rp nilai={bh.perusahaan.total} />
                </td>
                <td />
                <td />
                <td />
                <td className="td-lekat" />
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <th colSpan={3} className="text-left">
                  Total
                </th>
                <th className="text-right">
                  <Rp nilai={totalModalMasuk} />
                </th>
                <th className="text-right">
                  <Rp nilai={totalModalKembali} />
                </th>
                <th className="text-right">
                  <Rp nilai={totalLaba} />
                </th>
                <th className="text-right">
                  <Rp nilai={ps.totalTerdistribusi} />
                </th>
                <th className="text-right">
                  <Rp nilai={bh.dibayarTotal} />
                </th>
                <th className="text-right">
                  <Rp nilai={bh.terutangTotal} />
                </th>
                <th colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="px-4 py-3 text-sm text-slate-600">
          Total hak = modal kembali + bagian laba. Terdistribusi {rp(ps.totalTerdistribusi)} dari {rp(ps.diterima)} yang diterima.
          {ps.biayaAktual.gt(0) ? ` Modal kembali ${ps.persenModalKembali.toString().replace(".", ",")}%.` : ""}
        </p>
      </div>
      <p className="text-sm text-slate-600">
        Urutan pembagian: modal setiap pemodal dikembalikan lebih dulu (pro rata bila uang yang diterima belum menutup biaya); mitra nominal tetap dibayar sesuai urutan, masing-masing paling banyak sebesar sisa; mitra persen mendapat persennya dari sisa setelah nominal tetap; sisanya bagian perusahaan. Rugi tidak dibagi.
      </p>

      {lihatTalangan && (
        <div className="kartu kartu-tabel">
          <div className="kepala-kartu flex flex-wrap items-center justify-between gap-3">
            <h2 className="judul-kartu">Talangan mitra</h2>
            {boleh("talangan-mitra.buat") && aktif && (
              <Link href={`/proyek/${proyek.id}/keuangan/talangan/baru`} className="tombol tombol-garis">
                <Ikon nama="add" className="!text-[18px]" />
                Catat talangan
              </Link>
            )}
          </div>
          <div className="bungkus-tabel">
            <table className="tabel min-w-[64rem]">
              <thead>
                <tr>
                  <th>Nomor</th>
                  <th>Tanggal</th>
                  <th>Mitra</th>
                  <th>Akun beban</th>
                  <th>Uraian</th>
                  <th className="text-right">Jumlah</th>
                  <th>Status</th>
                  <th className="th-lekat" aria-label="Aksi" />
                </tr>
              </thead>
              <tbody>
                {dokumen.talangan.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="kosong">
                      Belum ada talangan mitra.
                    </td>
                  </tr>
                ) : (
                  dokumen.talangan.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <Link href={`/proyek/${proyek.id}/keuangan/talangan/${d.id}`} className="hover:underline">
                          <NomorDokumen nomor={d.nomor} />
                        </Link>
                      </td>
                      <td className="whitespace-nowrap text-slate-500">{formatTanggal(d.tanggal)}</td>
                      <td className="text-slate-700">{d.mitra.nama}</td>
                      <td className="text-slate-600 whitespace-nowrap">
                        <span className="mono text-xs">{d.akunBeban.kode}</span> {d.akunBeban.nama}
                      </td>
                      <td className="text-slate-600">
                        {d.deskripsi}
                        {d.vendor && <div className="text-xs text-slate-500">{d.vendor}</div>}
                      </td>
                      <td className="text-right">
                        <Rp nilai={d.jumlah} />
                        {d.statusPersetujuan !== "DISETUJUI" && <div className="text-xs text-slate-500">belum dihitung</div>}
                      </td>
                      <td>
                        <SelPersetujuan jenis="talanganMitra" kode="talangan-mitra" id={d.id} nomor={d.nomor} status={d.statusPersetujuan} diajukanOlehId={d.diajukanOlehId} pengguna={pengguna} catatanPenolakan={d.catatanPenolakan} />
                      </td>
                      <td className="td-lekat whitespace-nowrap">
                        <span className="flex items-center gap-3">
                          <Link href={`/proyek/${proyek.id}/keuangan/talangan/${d.id}`} className="tombol-tautan">
                            Lihat
                          </Link>
                          <TombolHapusDokumen jenis="talanganMitra" id={d.id} nomor={d.nomor} boleh={boleh("talangan-mitra.hapus")} />
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {lihatBayar && (
        <div className="kartu kartu-tabel">
          <div className="kepala-kartu flex flex-wrap items-center justify-between gap-3">
            <h2 className="judul-kartu">Pembayaran ke mitra</h2>
            {bayar && bh.mitra.length > 0 && (
              <Link href={`/proyek/${proyek.id}/keuangan/bayar/baru`} className="tombol tombol-garis">
                <Ikon nama="account_balance_wallet" className="!text-[18px]" />
                Bayar mitra
              </Link>
            )}
          </div>
          <div className="bungkus-tabel">
            <table className="tabel min-w-[60rem]">
              <thead>
                <tr>
                  <th>Nomor</th>
                  <th>Tanggal</th>
                  <th>Mitra</th>
                  <th>Jenis</th>
                  <th>Catatan</th>
                  <th className="text-right">Jumlah</th>
                  <th>Status</th>
                  <th className="th-lekat" aria-label="Aksi" />
                </tr>
              </thead>
              <tbody>
                {dokumen.pembayaran.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="kosong">
                      Belum ada pembayaran ke mitra.
                    </td>
                  </tr>
                ) : (
                  dokumen.pembayaran.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <Link href={`/proyek/${proyek.id}/keuangan/bayar/${d.id}`} className="hover:underline">
                          <NomorDokumen nomor={d.nomor} />
                        </Link>
                      </td>
                      <td className="whitespace-nowrap text-slate-500">{formatTanggal(d.tanggal)}</td>
                      <td className="text-slate-700">{d.mitra.nama}</td>
                      <td className="text-slate-600">{d.jenis === "MODAL" ? "Pengembalian modal" : "Bagi laba"}</td>
                      <td className="text-slate-600">{d.catatan ?? "-"}</td>
                      <td className="text-right">
                        <Rp nilai={d.jumlah} />
                        {d.statusPersetujuan !== "DISETUJUI" && <div className="text-xs text-slate-500">belum dihitung</div>}
                      </td>
                      <td>
                        <SelPersetujuan jenis="pembayaranMitra" kode="pembayaran-mitra" id={d.id} nomor={d.nomor} status={d.statusPersetujuan} diajukanOlehId={d.diajukanOlehId} pengguna={pengguna} catatanPenolakan={d.catatanPenolakan} />
                      </td>
                      <td className="td-lekat whitespace-nowrap">
                        <span className="flex items-center gap-3">
                          <Link href={`/proyek/${proyek.id}/keuangan/bayar/${d.id}`} className="tombol-tautan">
                            Lihat
                          </Link>
                          <TombolHapusDokumen jenis="pembayaranMitra" id={d.id} nomor={d.nomor} boleh={boleh("pembayaran-mitra.hapus")} />
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="kartu space-y-3">
        <h2 className="judul-kartu">Penyelesaian</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
          {(
            [
              ["Uang diterima", ps.diterima],
              ["Biaya aktual", ps.biayaAktual],
              ["Dana perusahaan", ps.danaPerusahaan],
              ["Dana mitra (talangan)", ps.danaMitra],
              ["Margin dibagi", ps.marginDibagi],
              ["Modal belum kembali", ps.modalBelumKembali],
              ["Modal kembali ke mitra", ps.modalKembaliMitra],
              ["Laba untuk mitra", ps.labaMitra],
              ["Total hak mitra", ps.totalHakMitra],
              ["Total perusahaan", ps.totalPerusahaan],
              ["Total terdistribusi", ps.totalTerdistribusi],
            ] as const
          ).map(([label, nilai]) => (
            <div key={label}>
              <dt className="teks-label">{label}</dt>
              <dd className="mt-1 font-semibold angka">{rp(nilai)}</dd>
            </div>
          ))}
          <div>
            <dt className="teks-label">Modal kembali</dt>
            <dd className="mt-1 font-semibold angka">{ps.persenModalKembali.toString().replace(".", ",")}%</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

function IsianMitra({ idAwalan, awal }: { idAwalan: string; awal?: { nama: string; mode: string; nilai: string; catatan: string } }) {
  return (
    <>
      <div className="space-y-1">
        <label htmlFor={`${idAwalan}-nama`} className="label">
          Nama mitra *
        </label>
        <input id={`${idAwalan}-nama`} name="nama" required maxLength={120} defaultValue={awal?.nama ?? ""} className="isian" />
      </div>
      <div className="space-y-1">
        <label htmlFor={`${idAwalan}-mode`} className="label">
          Jenis bagian
        </label>
        <select id={`${idAwalan}-mode`} name="mode" defaultValue={awal?.mode ?? "PERSEN"} className="isian">
          <option value="PERSEN">Persen dari laba</option>
          <option value="NOMINAL">Nominal tetap (Rp)</option>
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor={`${idAwalan}-nilai`} className="label">
          Nilai *
        </label>
        <input id={`${idAwalan}-nilai`} name="nilai" type="number" min="0.01" step="0.01" required defaultValue={awal?.nilai ?? ""} className="isian angka" />
        <p className="petunjuk">Persen bila jenisnya persen, rupiah bila nominal tetap</p>
      </div>
      <div className="space-y-1">
        <label htmlFor={`${idAwalan}-catatan`} className="label">
          Catatan
        </label>
        <input id={`${idAwalan}-catatan`} name="catatan" maxLength={500} defaultValue={awal?.catatan ?? ""} className="isian" />
      </div>
    </>
  );
}
