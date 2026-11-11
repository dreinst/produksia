import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { punyaHak, type Hak } from "@/lib/hakAkses";
import { D } from "@/lib/uang";
import { formatTanggal } from "@/lib/waktu";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import Ikon from "@/komponen/ui/Ikon";
import { LencanaPersetujuan, Rp, labelMetodeBayar } from "@/komponen/ui/Lencana";
import TombolHapusDokumen from "@/komponen/TombolHapusDokumen";
import LampiranBerkas from "@/komponen/berkas/LampiranBerkas";
import NomorDokumenCetak from "@/komponen/penjualan/NomorDokumenCetak";
import { DaftarInfo, Kartu, nomorTampil } from "../../_detail/bagian";

/**
 * Detail penerimaan penjualan sebagai kuitansi (D2 §7.3) dengan lampiran bukti transfer. Terima dari dan keperluan
 * kosong memakai bawaan data cetak kuitansi. Ubah tampilan dipasang P28; cetak milik P45.
 */
export default async function HalamanDetailPenerimaan({ params }: { params: Promise<{ id: string }> }) {
  const pengguna = await wajibHak("penerimaan.lihat");
  const { id } = await params;
  const r = await db.penerimaanPenjualan.findUnique({
    where: { id },
    include: {
      pelanggan: { select: { nama: true } },
      perusahaan: { select: { nama: true } },
      akun: { select: { kode: true, nama: true } },
      kopSurat: { select: { nama: true } },
      mataUang: { select: { kode: true } },
      faktur: { select: { id: true, nomor: true, nomorCetak: true } },
    },
  });
  if (!r) notFound();

  const boleh = (hak: Hak) => punyaHak(pengguna, hak);
  const tampil = nomorTampil(r);
  const nomorFaktur = nomorTampil(r.faktur);
  const potongan = D(r.potonganPajak);

  return (
    <div className="space-y-6 max-w-4xl">
      <KepalaHalaman
        jejak={[{ label: "Penjualan" }, { label: "Penerimaan", href: "/penjualan/penerimaan" }, { label: tampil }]}
        judul={`Penerimaan ${tampil}`}
        subjudul={`${r.pelanggan.nama} · ${formatTanggal(r.tanggal)} · ${r.perusahaan.nama}`}
        lencana={<LencanaPersetujuan status={r.statusPersetujuan} />}
        aksi={
          <>
            {boleh("penerimaan.ubah") && (
              <Link href={`/penjualan/penerimaan/${r.id}/tampilan`} className="tombol tombol-garis">
              <Ikon nama="tune" className="!text-[18px]" />
              Ubah tampilan
            </Link>
            )}
            <TombolHapusDokumen kembaliKeDaftar jenis="penerimaan" id={r.id} nomor={r.nomor} boleh={boleh("penerimaan.hapus")} />
          </>
        }
      />

      <Kartu judul="Informasi">
        <DaftarInfo
          isi={[
            ["Nomor", <NomorDokumenCetak key="nomor" nomor={r.nomor} nomorCetak={r.nomorCetak} />],
            ["Tanggal", formatTanggal(r.tanggal)],
            ["Pelanggan", r.pelanggan.nama],
            [
              "Faktur",
              boleh("faktur.lihat") ? (
                <Link key="faktur" href={`/penjualan/faktur/${r.faktur.id}`} className="tombol-tautan">
                  {nomorFaktur}
                </Link>
              ) : (
                nomorFaktur
              ),
            ],
            ["Akun kas/bank", `${r.akun.kode} · ${r.akun.nama}`],
            ["Metode", labelMetodeBayar(r.metodeBayar)],
            ["Jumlah diterima", <Rp key="jumlah" nilai={D(r.jumlah)} />],
            ["Potongan PPh 23", potongan.gt(0) ? <Rp key="potongan" nilai={potongan} /> : null],
            ["Piutang dilunasi", potongan.gt(0) ? <Rp key="lunas" nilai={D(r.jumlah).plus(potongan)} /> : null],
            ["Mata uang", r.mataUang ? `${r.mataUang.kode} · kurs ${D(r.kurs).toNumber().toLocaleString("id-ID")}${r.nilaiAsli ? ` · nilai ${D(r.nilaiAsli).toNumber().toLocaleString("id-ID")} ${r.mataUang.kode}` : ""}` : null],
            ["Terima dari", r.terimaDari || r.pelanggan.nama],
            ["Keperluan", r.keperluan || `Pembayaran ${nomorFaktur}`],
            ["Catatan", r.catatan],
            ["Judul cetak", r.judulCetak],
            ["Kop surat", r.kopSurat?.nama ?? "Kop bawaan perusahaan"],
            ["Perusahaan penerbit", r.perusahaan.nama],
          ]}
        />
        {r.statusPersetujuan === "DITOLAK" && r.catatanPenolakan && <p className="text-sm text-rose-700">Ditolak: {r.catatanPenolakan}</p>}
      </Kartu>

      <LampiranBerkas jenisEntitas="penerimaan" entitasId={r.id} kosong="Belum ada lampiran. Unggah bukti transfer di sini." />
    </div>
  );
}
