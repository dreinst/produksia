import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { ubahTampilanDokumenFormulir } from "@/lib/aksi/dokumenPenjualan";
import FormulirAksi from "@/komponen/FormulirAksi";
import IsianKwitansi from "@/komponen/penjualan/IsianKwitansi";
import { nomorTampil } from "../../../_detail/bagian";
import { KepalaTampilan, muatOpsiTampilan } from "../../../_tampilan/bagian";

/** Ubah tampilan kuitansi uang muka (D2 §7.1): judul, nomor kuitansi, terima dari, digunakan untuk, kop. */
export default async function HalamanTampilanUangMuka({ params }: { params: Promise<{ id: string }> }) {
  await wajibHak("uang-muka.ubah");
  const { id } = await params;
  const u = await db.uangMukaPelanggan.findUnique({ where: { id }, include: { pelanggan: { select: { nama: true } } } });
  if (!u) notFound();
  const { daftarKop } = await muatOpsiTampilan(u.perusahaanId);

  return (
    <div className="space-y-6 max-w-3xl">
      <KepalaTampilan jenis="uangMuka" id={u.id} tampil={nomorTampil(u)} />
      <FormulirAksi aksi={ubahTampilanDokumenFormulir.bind(null, "uangMuka", u.id)} pesanSukses="Tampilan tersimpan." className="kartu space-y-4">
        <h2 className="judul-kartu">Detail kuitansi</h2>
        <IsianKwitansi
          nilai={{ judulCetak: u.judulCetak, nomorCetak: u.nomorCetak, terimaDari: u.terimaDari, keperluan: u.keperluan, kopSuratId: u.kopSuratId }}
          daftarKop={daftarKop}
          namaPelanggan={u.pelanggan.nama}
        />
        <p className="petunjuk">Nomor kuitansi kosong = nomor internal dokumen. Digunakan untuk kosong = teks otomatis dari termin atau keterangan.</p>
        <div>
          <button type="submit" className="tombol tombol-utama">
            Simpan tampilan
          </button>
        </div>
      </FormulirAksi>
    </div>
  );
}
