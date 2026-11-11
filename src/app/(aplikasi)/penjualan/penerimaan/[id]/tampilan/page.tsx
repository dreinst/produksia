import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { ubahTampilanDokumenFormulir } from "@/lib/aksi/dokumenPenjualan";
import FormulirAksi from "@/komponen/FormulirAksi";
import IsianKwitansi from "@/komponen/penjualan/IsianKwitansi";
import { nomorTampil } from "../../../_detail/bagian";
import { KepalaTampilan, muatOpsiTampilan } from "../../../_tampilan/bagian";

/** Ubah tampilan kuitansi penerimaan (D2 §7.1): judul, nomor kuitansi, terima dari, digunakan untuk, kop, catatan. */
export default async function HalamanTampilanPenerimaan({ params }: { params: Promise<{ id: string }> }) {
  await wajibHak("penerimaan.ubah");
  const { id } = await params;
  const r = await db.penerimaanPenjualan.findUnique({ where: { id }, include: { pelanggan: { select: { nama: true } } } });
  if (!r) notFound();
  const { daftarKop } = await muatOpsiTampilan(r.perusahaanId);

  return (
    <div className="space-y-6 max-w-3xl">
      <KepalaTampilan jenis="penerimaan" id={r.id} tampil={nomorTampil(r)} />
      <FormulirAksi aksi={ubahTampilanDokumenFormulir.bind(null, "penerimaan", r.id)} pesanSukses="Tampilan tersimpan." className="kartu space-y-4">
        <h2 className="judul-kartu">Detail kuitansi</h2>
        <IsianKwitansi
          nilai={{ judulCetak: r.judulCetak, nomorCetak: r.nomorCetak, terimaDari: r.terimaDari, keperluan: r.keperluan, catatan: r.catatan, kopSuratId: r.kopSuratId }}
          daftarKop={daftarKop}
          namaPelanggan={r.pelanggan.nama}
          denganCatatan
        />
        <p className="petunjuk">Nomor kuitansi kosong = nomor internal dokumen. Digunakan untuk kosong = &quot;Pembayaran&quot; diikuti nomor faktur.</p>
        <div>
          <button type="submit" className="tombol tombol-utama">
            Simpan tampilan
          </button>
        </div>
      </FormulirAksi>
    </div>
  );
}
