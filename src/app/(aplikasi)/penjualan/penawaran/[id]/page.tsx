import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { punyaHak, type Hak } from "@/lib/hakAkses";
import { formatTanggal, tanggalIso } from "@/lib/waktu";
import { konversiPenawaranKePesananFormulir } from "@/lib/aksi/penjualan";
import { ubahStatusPenawaranFormulir } from "@/lib/aksi/dokumenPenjualan";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import Ikon from "@/komponen/ui/Ikon";
import { LencanaStatus } from "@/komponen/ui/Lencana";
import FormulirAksi from "@/komponen/FormulirAksi";
import TombolHapusDokumen from "@/komponen/TombolHapusDokumen";
import LampiranBerkas from "@/komponen/berkas/LampiranBerkas";
import LencanaStatusKomersial, { DAFTAR_STATUS_KOMERSIAL, GAYA_STATUS_KOMERSIAL } from "@/komponen/penjualan/LencanaStatusKomersial";
import NomorDokumenCetak from "@/komponen/penjualan/NomorDokumenCetak";
import PanelTermin from "@/komponen/penjualan/PanelTermin";
import RingkasanNilaiDokumen from "@/komponen/penjualan/RingkasanNilaiDokumen";
import TabelBarisDokumen, { barisTampil } from "@/komponen/penjualan/TabelBarisDokumen";
import { DaftarInfo, Kartu, KartuTeksSurat, LABEL_TAMPILAN_EVENT, nomorTampil } from "../../_detail/bagian";

/**
 * Detail penawaran penjualan (D2 §7.3). Tidak mengikuti lingkup perusahaan (lingkup hanya pilihan tampilan, D1).
 * Ubah (draf) dan Ubah tampilan dipasang P28; tombol cetak milik P45.
 */
export default async function HalamanDetailPenawaran({ params }: { params: Promise<{ id: string }> }) {
  const pengguna = await wajibHak("penawaran.lihat");
  const { id } = await params;
  const p = await db.penawaranPenjualan.findUnique({
    where: { id },
    include: {
      pelanggan: { select: { nama: true } },
      perusahaan: { select: { nama: true } },
      proyek: { select: { kode: true, nama: true } },
      kopSurat: { select: { nama: true } },
      lead: { select: { nama: true, namaUsaha: true } },
      baris: { orderBy: [{ urutan: "asc" }, { id: "asc" }], include: { barang: { select: { kode: true, nama: true, satuan: true } } } },
      rencanaTermin: { orderBy: { no: "asc" } },
      pesanan: { select: { id: true, nomor: true, status: true, tanggal: true } },
    },
  });
  if (!p) notFound();

  const boleh = (hak: Hak) => punyaHak(pengguna, hak);
  const draf = p.status === "DRAF";
  const lewatBerlaku = draf && !!p.berlakuSampai && tanggalIso(p.berlakuSampai) < tanggalIso(new Date());
  const tampil = nomorTampil(p);

  return (
    <div className="space-y-6 max-w-6xl">
      <KepalaHalaman
        jejak={[{ label: "Penjualan" }, { label: "Penawaran", href: "/penjualan/penawaran" }, { label: tampil }]}
        judul={`Penawaran ${tampil}`}
        subjudul={`${p.pelanggan.nama} · ${formatTanggal(p.tanggal)} · ${p.perusahaan.nama}`}
        lencana={
          <span className="flex flex-wrap items-center gap-2">
            <LencanaStatus status={p.status} />
            <LencanaStatusKomersial status={p.statusKomersial} />
            {p.mode === "EVENT" && (
              <span className="lencana lencana-indigo inline-flex items-center gap-1">
                <Ikon nama="event" className="!text-[14px]" />
                Event
              </span>
            )}
            {lewatBerlaku && <span className="lencana lencana-amber">Lewat masa berlaku</span>}
          </span>
        }
        aksi={
          <>
            {draf && boleh("pesanan.buat") && (
              <FormulirAksi aksi={konversiPenawaranKePesananFormulir.bind(null, p.id)} pesanKonfirmasi={`Konversi penawaran ${p.nomor} menjadi Pesanan Penjualan?`} className="inline">
                <button type="submit" className="tombol tombol-utama">
                  Konversi ke Pesanan
                </button>
              </FormulirAksi>
            )}
            {draf && boleh("penawaran.ubah") && (
              <Link href={`/penjualan/penawaran/${p.id}/ubah`} className="tombol tombol-garis">
              <Ikon nama="edit_note" className="!text-[18px]" />
              Ubah
            </Link>
            )}
            {boleh("penawaran.ubah") && (
              <Link href={`/penjualan/penawaran/${p.id}/tampilan`} className="tombol tombol-garis">
              <Ikon nama="tune" className="!text-[18px]" />
              Ubah tampilan
            </Link>
            )}
            <TombolHapusDokumen kembaliKeDaftar jenis="penawaran" id={p.id} nomor={p.nomor} boleh={boleh("penawaran.hapus")} />
          </>
        }
      />

      {draf && boleh("penawaran.ubah") && (
        <FormulirAksi aksi={ubahStatusPenawaranFormulir.bind(null, p.id)} pesanSukses="Status klien tersimpan." className="kartu flex flex-wrap items-end gap-3">
          <div>
            <label className="label" htmlFor="statusKomersial">
              Status klien
            </label>
            <select id="statusKomersial" name="statusKomersial" className="isian" defaultValue={p.statusKomersial}>
              {DAFTAR_STATUS_KOMERSIAL.map((s) => (
                <option key={s} value={s}>
                  {GAYA_STATUS_KOMERSIAL[s].label}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="tombol tombol-garis">
            Simpan status
          </button>
        </FormulirAksi>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Kartu judul="Informasi" className="lg:col-span-2">
          <DaftarInfo
            isi={[
              ["Kepada", p.kepada || p.pelanggan.nama],
              ["U.p.", p.kepadaUp],
              ["Alamat tujuan", p.kepadaAlamat],
              ["Telepon tujuan", p.kepadaTelepon],
              ["Email tujuan", p.kepadaEmail],
              ["Referensi", p.referensi],
              ["Perihal", p.perihal],
              ["Lampiran", p.lampiran],
              ["Proyek", p.proyek ? `${p.proyek.kode} · ${p.proyek.nama}` : null],
              ["Nama event", p.namaEvent],
              ["Venue", p.venue],
              ["Tanggal event", p.tanggalEvent],
              ["Tampilan cetak event", p.mode === "EVENT" ? LABEL_TAMPILAN_EVENT[p.tampilanEvent] : null],
              ["Berlaku sampai", p.berlakuSampai ? formatTanggal(p.berlakuSampai) : null],
              ["Lead", p.lead && boleh("lead.lihat") ? `${p.lead.namaUsaha} · ${p.lead.nama}` : null],
              ["Nomor", <NomorDokumenCetak key="nomor" nomor={p.nomor} nomorCetak={p.nomorCetak} />],
              ["Judul cetak", p.judulCetak],
              ["Kop surat", p.kopSurat?.nama ?? "Kop bawaan perusahaan"],
              ["Perusahaan penerbit", p.perusahaan.nama],
            ]}
          />
        </Kartu>
        <Kartu judul="Ringkasan">
          <RingkasanNilaiDokumen jenis="penawaran" dokumen={p} />
        </Kartu>
      </div>

      <section className="kartu kartu-tabel" aria-label="Rincian">
        <div className="kepala-kartu">
          <h2 className="judul-kartu">Rincian</h2>
        </div>
        <TabelBarisDokumen baris={p.baris.map(barisTampil)} mode={p.mode} />
      </section>

      {p.rencanaTermin.length > 0 && (
        <Kartu judul="Skema pembayaran">
          <PanelTermin jenis="penawaran" butir={p.rencanaTermin} ppnPersen={p.ppnPersen} />
        </Kartu>
      )}

      <KartuTeksSurat teks={p} />

      <LampiranBerkas jenisEntitas="penawaran" entitasId={p.id} />

      {p.pesanan && (
        <Kartu judul="Dokumen turunan">
          <ul className="text-sm space-y-2">
            <li className="flex flex-wrap items-center gap-3">
              {boleh("pesanan.lihat") ? (
                <Link href={`/penjualan/pesanan/${p.pesanan.id}`} className="tombol-tautan">
                  Pesanan {p.pesanan.nomor}
                </Link>
              ) : (
                <span>Pesanan {p.pesanan.nomor}</span>
              )}
              <span className="text-slate-500">{formatTanggal(p.pesanan.tanggal)}</span>
              <LencanaStatus status={p.pesanan.status} />
            </li>
          </ul>
        </Kartu>
      )}
    </div>
  );
}
