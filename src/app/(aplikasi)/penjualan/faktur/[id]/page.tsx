import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { punyaHak, type Hak } from "@/lib/hakAkses";
import { D, jumlahkan } from "@/lib/uang";
import { formatTanggal } from "@/lib/waktu";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import Ikon from "@/komponen/ui/Ikon";
import { LencanaPersetujuan, LencanaStatus, Rp, labelMetodeBayar } from "@/komponen/ui/Lencana";
import KontrolPersetujuan from "@/komponen/KontrolPersetujuan";
import TombolHapusDokumen from "@/komponen/TombolHapusDokumen";
import LampiranBerkas from "@/komponen/berkas/LampiranBerkas";
import NomorDokumenCetak from "@/komponen/penjualan/NomorDokumenCetak";
import RingkasanNilaiDokumen from "@/komponen/penjualan/RingkasanNilaiDokumen";
import TabelBarisDokumen, { barisTampil } from "@/komponen/penjualan/TabelBarisDokumen";
import { BarisTurunan, DaftarInfo, Kartu, KartuTeksSurat, LABEL_TAMPILAN_EVENT, nomorTampil } from "../../_detail/bagian";

/**
 * Detail faktur penjualan (D2 §7.3): persetujuan, uang muka terpakai, penerimaan, dan retur. Terima Bayar dan Retur
 * memakai syarat daftar faktur (hanya faktur DISETUJUI). Ubah tampilan (P28) dan cetak (P45) belum dipasang.
 */
export default async function HalamanDetailFaktur({ params }: { params: Promise<{ id: string }> }) {
  const pengguna = await wajibHak("faktur.lihat");
  const { id } = await params;
  const f = await db.fakturPenjualan.findUnique({
    where: { id },
    include: {
      pelanggan: { select: { nama: true } },
      perusahaan: { select: { nama: true } },
      kopSurat: { select: { nama: true } },
      mataUang: { select: { kode: true } },
      pesanan: { select: { id: true, nomor: true, proyek: { select: { kode: true, nama: true } } } },
      pengiriman: { select: { nomor: true } },
      baris: { orderBy: [{ urutan: "asc" }, { id: "asc" }], include: { barang: { select: { kode: true, nama: true, satuan: true } } } },
      penerimaan: {
        orderBy: [{ tanggal: "asc" }, { nomor: "asc" }],
        select: { id: true, nomor: true, nomorCetak: true, tanggal: true, jumlah: true, potonganPajak: true, metodeBayar: true, statusPersetujuan: true },
      },
      retur: { orderBy: [{ tanggal: "asc" }, { nomor: "asc" }], select: { id: true, nomor: true, tanggal: true, total: true, statusPersetujuan: true } },
      pemakaianUangMuka: { select: { id: true, jumlah: true, uangMuka: { select: { id: true, nomor: true, nomorCetak: true, tanggal: true, rencanaTermin: { select: { label: true } } } } } },
    },
  });
  if (!f) notFound();

  const boleh = (hak: Hak) => punyaHak(pengguna, hak);
  const tampil = nomorTampil(f);
  const disetujui = f.statusPersetujuan === "DISETUJUI";
  const terbayar = jumlahkan(f.penerimaan.map((r) => D(r.jumlah).plus(D(r.potonganPajak))));
  const retur = jumlahkan(f.retur.map((r) => r.total));
  // urut tanggal kuitansi DP, sama dengan data cetak faktur
  const pemakaian = [...f.pemakaianUangMuka].sort((a, b) => a.uangMuka.tanggal.getTime() - b.uangMuka.tanggal.getTime() || a.uangMuka.nomor.localeCompare(b.uangMuka.nomor));

  return (
    <div className="space-y-6 max-w-6xl">
      <KepalaHalaman
        jejak={[{ label: "Penjualan" }, { label: "Faktur", href: "/penjualan/faktur" }, { label: tampil }]}
        judul={`Faktur ${tampil}`}
        subjudul={`${f.pelanggan.nama} · ${formatTanggal(f.tanggal)} · ${f.perusahaan.nama}`}
        lencana={
          <span className="flex flex-wrap items-center gap-2">
            <LencanaStatus status={f.status} />
            <LencanaPersetujuan status={f.statusPersetujuan} />
            {f.mode === "EVENT" && (
              <span className="lencana lencana-indigo inline-flex items-center gap-1">
                <Ikon nama="event" className="!text-[14px]" />
                Event
              </span>
            )}
          </span>
        }
        aksi={
          <>
            <KontrolPersetujuan
              jenis="faktur"
              kode="faktur"
              id={f.id}
              nomor={f.nomor}
              status={f.statusPersetujuan}
              diajukanOlehId={f.diajukanOlehId}
              pengguna={pengguna}
              catatanPenolakan={f.catatanPenolakan}
            />
            {disetujui && f.status !== "LUNAS" && boleh("penerimaan.buat") && (
              <Link href={`/penjualan/penerimaan/baru?fakturId=${f.id}`} className="tombol tombol-utama">
                <Ikon nama="payments" className="!text-[18px]" />
                Terima Bayar
              </Link>
            )}
            {disetujui && boleh("retur-penjualan.buat") && (
              <Link href={`/penjualan/retur/baru?fakturId=${f.id}`} className="tombol tombol-garis">
                Retur
              </Link>
            )}
            <TombolHapusDokumen kembaliKeDaftar jenis="faktur" id={f.id} nomor={f.nomor} boleh={boleh("faktur.hapus")} />
          </>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Kartu judul="Informasi" className="lg:col-span-2">
          <DaftarInfo
            isi={[
              ["Kepada", f.kepada || f.pelanggan.nama],
              ["U.p.", f.kepadaUp],
              ["Alamat tujuan", f.kepadaAlamat],
              ["Telepon tujuan", f.kepadaTelepon],
              ["Email tujuan", f.kepadaEmail],
              ["Referensi", f.referensi],
              ["Perihal", f.perihal],
              ["Lampiran", f.lampiran],
              ["Jatuh tempo", f.jatuhTempo ? formatTanggal(f.jatuhTempo) : null],
              ["Mata uang", f.mataUang ? `${f.mataUang.kode} · kurs ${D(f.kurs).toNumber().toLocaleString("id-ID")}${f.nilaiAsli ? ` · nilai ${D(f.nilaiAsli).toNumber().toLocaleString("id-ID")} ${f.mataUang.kode}` : ""}` : null],
              [
                "Pesanan asal",
                f.pesanan ? (
                  boleh("pesanan.lihat") ? (
                    <Link key="pesanan" href={`/penjualan/pesanan/${f.pesanan.id}`} className="tombol-tautan">
                      {f.pesanan.nomor}
                    </Link>
                  ) : (
                    f.pesanan.nomor
                  )
                ) : null,
              ],
              ["Surat jalan", f.pengiriman?.nomor],
              ["Proyek", f.pesanan?.proyek ? `${f.pesanan.proyek.kode} · ${f.pesanan.proyek.nama}` : null],
              ["Nama event", f.namaEvent],
              ["Venue", f.venue],
              ["Tanggal event", f.tanggalEvent],
              ["Tampilan cetak event", f.mode === "EVENT" ? LABEL_TAMPILAN_EVENT[f.tampilanEvent] : null],
              ["Nomor", <NomorDokumenCetak key="nomor" nomor={f.nomor} nomorCetak={f.nomorCetak} />],
              ["Judul cetak", f.judulCetak],
              ["Kop surat", f.kopSurat?.nama ?? "Kop bawaan perusahaan"],
              ["Perusahaan penerbit", f.perusahaan.nama],
            ]}
          />
          {f.statusPersetujuan === "DITOLAK" && f.catatanPenolakan && <p className="text-sm text-rose-700">Ditolak: {f.catatanPenolakan}</p>}
        </Kartu>
        <Kartu judul="Ringkasan">
          <RingkasanNilaiDokumen
            jenis="faktur"
            dokumen={f}
            uangMuka={pemakaian.map((pk) => ({
              label: `${nomorTampil(pk.uangMuka)}${pk.uangMuka.rencanaTermin ? ` (${pk.uangMuka.rencanaTermin.label})` : ""}`,
              jumlah: pk.jumlah,
              href: boleh("uang-muka.lihat") ? `/penjualan/uang-muka/${pk.uangMuka.id}` : undefined,
            }))}
            terbayar={terbayar}
            retur={retur}
          />
        </Kartu>
      </div>

      <section className="kartu kartu-tabel" aria-label="Rincian">
        <div className="kepala-kartu">
          <h2 className="judul-kartu">Rincian</h2>
        </div>
        <TabelBarisDokumen baris={f.baris.map(barisTampil)} mode={f.mode} />
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Kartu judul="Penerimaan">
          {f.penerimaan.length === 0 ? (
            <p className="text-sm text-slate-500">Belum ada penerimaan.</p>
          ) : (
            <ul className="text-sm divide-y divide-slate-100">
              {f.penerimaan.map((r) => (
                <BarisTurunan key={r.id} jenis="Penerimaan" nomor={r.nomor} nomorCetak={r.nomorCetak} tanggal={r.tanggal} href={boleh("penerimaan.lihat") ? `/penjualan/penerimaan/${r.id}` : undefined}>
                  <Rp nilai={D(r.jumlah)} />
                  {D(r.potonganPajak).gt(0) && (
                    <span className="text-slate-500">
                      + PPh 23 <Rp nilai={D(r.potonganPajak)} />
                    </span>
                  )}
                  <span className="text-slate-500">{labelMetodeBayar(r.metodeBayar)}</span>
                </BarisTurunan>
              ))}
            </ul>
          )}
        </Kartu>
        <Kartu judul="Retur">
          {f.retur.length === 0 ? (
            <p className="text-sm text-slate-500">Belum ada retur.</p>
          ) : (
            <ul className="text-sm divide-y divide-slate-100">
              {f.retur.map((r) => (
                <BarisTurunan key={r.id} jenis="Retur" nomor={r.nomor} tanggal={r.tanggal}>
                  <Rp nilai={D(r.total)} />
                  <LencanaPersetujuan status={r.statusPersetujuan} />
                </BarisTurunan>
              ))}
            </ul>
          )}
        </Kartu>
      </div>

      <KartuTeksSurat teks={f} />

      <LampiranBerkas jenisEntitas="faktur" entitasId={f.id} />
    </div>
  );
}
