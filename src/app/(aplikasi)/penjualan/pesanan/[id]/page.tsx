import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { punyaHak, type Hak } from "@/lib/hakAkses";
import { D } from "@/lib/uang";
import { formatTanggal } from "@/lib/waktu";
import { hitungProgresTermin } from "@/lib/rencanaTermin";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import Ikon from "@/komponen/ui/Ikon";
import { LencanaPersetujuan, LencanaStatus, Rp } from "@/komponen/ui/Lencana";
import TombolHapusDokumen from "@/komponen/TombolHapusDokumen";
import LampiranBerkas from "@/komponen/berkas/LampiranBerkas";
import NomorDokumenCetak from "@/komponen/penjualan/NomorDokumenCetak";
import PanelTermin from "@/komponen/penjualan/PanelTermin";
import RingkasanNilaiDokumen from "@/komponen/penjualan/RingkasanNilaiDokumen";
import TabelBarisDokumen, { barisTampil } from "@/komponen/penjualan/TabelBarisDokumen";
import { BarisTurunan, DaftarInfo, Kartu, KartuTeksSurat, LABEL_TAMPILAN_EVENT, nomorTampil } from "../../_detail/bagian";

/**
 * Detail pesanan penjualan (D2 §7.3) dengan termin pembayaran. Tombol Kirim, Uang Muka, dan Fakturkan memakai syarat
 * yang sama dengan daftar pesanan. Ubah tampilan dan ubah termin dipasang P28; cetak tagihan milik P45.
 */
export default async function HalamanDetailPesanan({ params }: { params: Promise<{ id: string }> }) {
  const pengguna = await wajibHak("pesanan.lihat");
  const { id } = await params;
  const p = await db.pesananPenjualan.findUnique({
    where: { id },
    include: {
      pelanggan: { select: { nama: true } },
      perusahaan: { select: { nama: true } },
      proyek: { select: { kode: true, nama: true } },
      kopSurat: { select: { nama: true } },
      penawaran: { select: { id: true, nomor: true, nomorCetak: true } },
      baris: { orderBy: [{ urutan: "asc" }, { id: "asc" }], include: { barang: { select: { kode: true, nama: true, satuan: true } } } },
      rencanaTermin: { orderBy: { no: "asc" }, select: { id: true, no: true, label: true, jumlah: true, persen: true, jatuhTempo: true, ditagihPada: true, nomorCetak: true } },
      pengiriman: { orderBy: [{ tanggal: "asc" }, { nomor: "asc" }], select: { id: true, nomor: true, tanggal: true, status: true } },
      faktur: {
        orderBy: [{ tanggal: "asc" }, { nomor: "asc" }],
        select: { id: true, nomor: true, nomorCetak: true, tanggal: true, total: true, status: true, statusPersetujuan: true, penerimaan: { select: { jumlah: true, potonganPajak: true } } },
      },
      uangMuka: {
        orderBy: [{ tanggal: "asc" }, { nomor: "asc" }],
        select: { id: true, nomor: true, nomorCetak: true, tanggal: true, jumlah: true, rencanaTerminId: true, statusPersetujuan: true, rencanaTermin: { select: { label: true } } },
      },
    },
  });
  if (!p) notFound();

  const boleh = (hak: Hak) => punyaHak(pengguna, hak);
  const tampil = nomorTampil(p);
  // syarat tombol sama dengan daftar pesanan (src/app/(aplikasi)/penjualan/pesanan/page.tsx)
  const terkirimSemua = p.baris.every((l) => Number(l.jumlahTerkirim) >= Number(l.jumlah));
  const difakturSemua = p.baris.every((l) => Number(l.jumlahDifaktur) >= Number(l.jumlah));
  const progres =
    p.rencanaTermin.length > 0
      ? hitungProgresTermin({ total: p.total, ppnPersen: p.ppnPersen, butir: p.rencanaTermin, uangMuka: p.uangMuka, penerimaan: p.faktur.flatMap((f) => f.penerimaan) })
      : null;
  const adaTurunan = p.penawaran || p.pengiriman.length > 0 || p.faktur.length > 0 || p.uangMuka.length > 0;

  return (
    <div className="space-y-6 max-w-6xl">
      <KepalaHalaman
        jejak={[{ label: "Penjualan" }, { label: "Pesanan", href: "/penjualan/pesanan" }, { label: tampil }]}
        judul={`Pesanan ${tampil}`}
        subjudul={`${p.pelanggan.nama} · ${formatTanggal(p.tanggal)} · ${p.perusahaan.nama}`}
        lencana={
          <span className="flex flex-wrap items-center gap-2">
            <LencanaStatus status={p.status} />
            {p.mode === "EVENT" && (
              <span className="lencana lencana-indigo inline-flex items-center gap-1">
                <Ikon nama="event" className="!text-[14px]" />
                Event
              </span>
            )}
          </span>
        }
        aksi={
          <>
            {!terkirimSemua && boleh("pengiriman.buat") && (
              <Link href={`/penjualan/pengiriman/baru?pesananId=${p.id}`} className="tombol tombol-garis">
                <Ikon nama="local_shipping" className="!text-[18px]" />
                Kirim
              </Link>
            )}
            {!difakturSemua && boleh("uang-muka.buat") && (
              <Link href={`/penjualan/uang-muka/baru?pesananId=${p.id}`} className="tombol tombol-garis">
                <Ikon nama="payments" className="!text-[18px]" />
                Uang Muka
              </Link>
            )}
            {!difakturSemua && boleh("faktur.buat") && (
              <Link href={`/penjualan/faktur/baru?pesananId=${p.id}`} className="tombol tombol-utama">
                <Ikon nama="receipt_long" className="!text-[18px]" />
                Fakturkan
              </Link>
            )}
            {boleh("pesanan.ubah") && (
              <Link href={`/penjualan/pesanan/${p.id}/termin`} className="tombol tombol-garis">
              <Ikon nama="payments" className="!text-[18px]" />
              Ubah termin
            </Link>
            )}
            {boleh("pesanan.ubah") && (
              <Link href={`/penjualan/pesanan/${p.id}/tampilan`} className="tombol tombol-garis">
              <Ikon nama="tune" className="!text-[18px]" />
              Ubah tampilan
            </Link>
            )}
            <TombolHapusDokumen kembaliKeDaftar jenis="pesanan" id={p.id} nomor={p.nomor} boleh={boleh("pesanan.hapus")} />
          </>
        }
      />

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
              ["Nomor", <NomorDokumenCetak key="nomor" nomor={p.nomor} />],
              ["Kop surat", p.kopSurat?.nama ?? "Kop bawaan perusahaan"],
              ["Perusahaan penerbit", p.perusahaan.nama],
            ]}
          />
        </Kartu>
        <Kartu judul="Ringkasan">
          <RingkasanNilaiDokumen jenis="pesanan" dokumen={p} />
        </Kartu>
      </div>

      <section className="kartu kartu-tabel" aria-label="Rincian">
        <div className="kepala-kartu">
          <h2 className="judul-kartu">Rincian</h2>
        </div>
        <TabelBarisDokumen baris={p.baris.map(barisTampil)} mode={p.mode} />
      </section>

      {progres && (
        <Kartu judul="Termin pembayaran">
          <PanelTermin jenis="pesanan" pesananId={p.id} progres={progres} bolehUbah={boleh("pesanan.ubah")} bolehBayar={!difakturSemua && boleh("uang-muka.buat")} />
        </Kartu>
      )}

      <KartuTeksSurat teks={p} />

      <LampiranBerkas jenisEntitas="pesanan" entitasId={p.id} />

      {adaTurunan && (
        <Kartu judul="Dokumen turunan">
          <ul className="text-sm divide-y divide-slate-100">
            {p.penawaran && (
              <BarisTurunan jenis="Penawaran asal" nomor={p.penawaran.nomor} nomorCetak={p.penawaran.nomorCetak} href={boleh("penawaran.lihat") ? `/penjualan/penawaran/${p.penawaran.id}` : undefined} />
            )}
            {boleh("pengiriman.lihat") &&
              p.pengiriman.map((s) => (
                <BarisTurunan key={s.id} jenis="Surat jalan" nomor={s.nomor} tanggal={s.tanggal}>
                  <LencanaStatus status={s.status} />
                </BarisTurunan>
              ))}
            {boleh("uang-muka.lihat") &&
              p.uangMuka.map((u) => (
                <BarisTurunan key={u.id} jenis={u.rencanaTermin ? `Uang muka · ${u.rencanaTermin.label}` : "Uang muka"} nomor={u.nomor} nomorCetak={u.nomorCetak} tanggal={u.tanggal} href={`/penjualan/uang-muka/${u.id}`}>
                  <Rp nilai={D(u.jumlah)} />
                  <LencanaPersetujuan status={u.statusPersetujuan} />
                </BarisTurunan>
              ))}
            {boleh("faktur.lihat") &&
              p.faktur.map((f) => (
                <BarisTurunan key={f.id} jenis="Faktur" nomor={f.nomor} nomorCetak={f.nomorCetak} tanggal={f.tanggal} href={`/penjualan/faktur/${f.id}`}>
                  <Rp nilai={D(f.total)} />
                  <LencanaStatus status={f.status} />
                  <LencanaPersetujuan status={f.statusPersetujuan} />
                </BarisTurunan>
              ))}
          </ul>
        </Kartu>
      )}
    </div>
  );
}
