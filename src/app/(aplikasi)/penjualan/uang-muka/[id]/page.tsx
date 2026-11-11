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
import { BarisTurunan, DaftarInfo, Kartu, nomorTampil } from "../../_detail/bagian";

/**
 * Detail uang muka pelanggan sebagai kuitansi DP (D2 §7.3): termin yang dibayar, pemakaian di faktur, dan lampiran
 * bukti transfer. Keperluan kosong memakai bawaan data cetak kuitansi DP. Ubah tampilan dipasang P28; cetak milik P45.
 */
export default async function HalamanDetailUangMuka({ params }: { params: Promise<{ id: string }> }) {
  const pengguna = await wajibHak("uang-muka.lihat");
  const { id } = await params;
  const u = await db.uangMukaPelanggan.findUnique({
    where: { id },
    include: {
      pelanggan: { select: { nama: true } },
      perusahaan: { select: { nama: true } },
      akun: { select: { kode: true, nama: true } },
      kopSurat: { select: { nama: true } },
      pesanan: { select: { id: true, nomor: true, namaEvent: true, penawaran: { select: { nomor: true, nomorCetak: true } } } },
      rencanaTermin: { select: { no: true, label: true } },
      pemakaian: { select: { id: true, jumlah: true, faktur: { select: { id: true, nomor: true, nomorCetak: true, tanggal: true } } } },
    },
  });
  if (!u) notFound();

  const boleh = (hak: Hak) => punyaHak(pengguna, hak);
  const tampil = nomorTampil(u);
  const asal = u.pesanan.penawaran ? nomorTampil(u.pesanan.penawaran) : u.pesanan.nomor;
  // sama dengan keperluan bawaan kuitansi DP di dataCetakPenjualan
  const keperluan = u.keperluan || (u.rencanaTermin ? `Pembayaran ${u.rencanaTermin.label}${u.pesanan.namaEvent ? ` ${u.pesanan.namaEvent}` : ""}` : u.keterangan || `Uang muka ${asal}`);
  const dipakai = D(u.jumlahDipakai);

  return (
    <div className="space-y-6 max-w-4xl">
      <KepalaHalaman
        jejak={[{ label: "Penjualan" }, { label: "Uang Muka", href: "/penjualan/uang-muka" }, { label: tampil }]}
        judul={`Uang Muka ${tampil}`}
        subjudul={`${u.pelanggan.nama} · ${formatTanggal(u.tanggal)} · ${u.perusahaan.nama}`}
        lencana={<LencanaPersetujuan status={u.statusPersetujuan} />}
        aksi={
          <>
            {boleh("uang-muka.ubah") && (
              <Link href={`/penjualan/uang-muka/${u.id}/tampilan`} className="tombol tombol-garis">
              <Ikon nama="tune" className="!text-[18px]" />
              Ubah tampilan
            </Link>
            )}
            <TombolHapusDokumen kembaliKeDaftar jenis="uangMuka" id={u.id} nomor={u.nomor} boleh={boleh("uang-muka.hapus")} />
          </>
        }
      />

      <Kartu judul="Informasi">
        <DaftarInfo
          isi={[
            ["Nomor", <NomorDokumenCetak key="nomor" nomor={u.nomor} nomorCetak={u.nomorCetak} />],
            ["Tanggal", formatTanggal(u.tanggal)],
            ["Pelanggan", u.pelanggan.nama],
            [
              "Pesanan",
              boleh("pesanan.lihat") ? (
                <Link key="pesanan" href={`/penjualan/pesanan/${u.pesanan.id}`} className="tombol-tautan">
                  {u.pesanan.nomor}
                </Link>
              ) : (
                u.pesanan.nomor
              ),
            ],
            ["Termin", u.rencanaTermin ? `Termin ${u.rencanaTermin.no} · ${u.rencanaTermin.label}` : null],
            ["Akun kas/bank", `${u.akun.kode} · ${u.akun.nama}`],
            ["Metode", labelMetodeBayar(u.metodeBayar)],
            ["Jumlah", <Rp key="jumlah" nilai={D(u.jumlah)} />],
            ["Sudah dipakai faktur", <Rp key="dipakai" nilai={dipakai} />],
            ["Sisa", <Rp key="sisa" nilai={D(u.jumlah).minus(dipakai)} />],
            ["Keterangan", u.keterangan],
            ["Terima dari", u.terimaDari || u.pelanggan.nama],
            ["Keperluan", keperluan],
            ["Judul cetak", u.judulCetak],
            ["Kop surat", u.kopSurat?.nama ?? "Kop bawaan perusahaan"],
            ["Perusahaan penerbit", u.perusahaan.nama],
          ]}
        />
        {u.statusPersetujuan === "DITOLAK" && u.catatanPenolakan && <p className="text-sm text-rose-700">Ditolak: {u.catatanPenolakan}</p>}
      </Kartu>

      {u.pemakaian.length > 0 && (
        <Kartu judul="Dipakai di faktur">
          <ul className="text-sm divide-y divide-slate-100">
            {u.pemakaian.map((pk) => (
              <BarisTurunan key={pk.id} jenis="Faktur" nomor={pk.faktur.nomor} nomorCetak={pk.faktur.nomorCetak} tanggal={pk.faktur.tanggal} href={boleh("faktur.lihat") ? `/penjualan/faktur/${pk.faktur.id}` : undefined}>
                <Rp nilai={D(pk.jumlah)} />
              </BarisTurunan>
            ))}
          </ul>
        </Kartu>
      )}

      <LampiranBerkas jenisEntitas="uang-muka" entitasId={u.id} kosong="Belum ada lampiran. Unggah bukti transfer di sini." />
    </div>
  );
}
