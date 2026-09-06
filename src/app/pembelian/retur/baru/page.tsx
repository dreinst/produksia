import { db } from "@/lib/db";
import FormulirAksi from "@/komponen/FormulirAksi";
import { buatReturPembelianFormulir } from "@/lib/aksi/pembelian";
import PemilihBarisRetur from "@/komponen/penjualan/PemilihBarisRetur";

export default async function NewPurchaseReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ fakturId?: string }>;
}) {
  const { fakturId } = await searchParams;

  const [faktur, daftarGudang] = await Promise.all([
    fakturId
      ? db.fakturPembelian.findUnique({
          where: { id: fakturId },
          include: { pemasok: true, baris: { include: { barang: true } } },
        })
      : null,
    db.gudang.findMany({ orderBy: { nama: "asc" } }),
  ]);

  if (!fakturId || !faktur) {
    return (
      <div className="max-w-3xl space-y-4">
        <h1 className="judul-halaman">Retur Pembelian Baru</h1>
        <p className="redup">
          Pilih faktur dari halaman{" "}
          <a href="/pembelian/faktur" className="font-semibold text-blue-600 hover:underline">
            Faktur Pembelian
          </a>{" "}
          lalu klik &quot;Retur&quot;.
        </p>
      </div>
    );
  }

  const barisUntukPemilih = faktur.baris.map((l) => ({
    barangId: l.barangId,
    labelBarang: `${l.barang.kode} - ${l.barang.nama}`,
    jumlah: Number(l.jumlah),
  }));

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="judul-halaman">Retur untuk Faktur {faktur.nomor}</h1>
      <p className="redup">Pemasok: {faktur.pemasok.nama}</p>

      <FormulirAksi aksi={buatReturPembelianFormulir} className="kartu grid grid-cols-1 md:grid-cols-2 gap-4">
        <input type="hidden" name="fakturId" value={faktur.id} />

        <div className="bidang">
          <label className="label">Gudang Asal Barang *</label>
          <select name="gudangId" required className="isian">
            <option value="">-</option>
            {daftarGudang.map((w) => (
              <option key={w.id} value={w.id}>
                {w.kode} - {w.nama}
              </option>
            ))}
          </select>
        </div>

        <div className="bidang">
          <label className="label">Alasan</label>
          <input type="text" name="alasan" className="isian" />
        </div>

        <PemilihBarisRetur daftarBaris={barisUntukPemilih} />

        <div className="md:col-span-2">
          <button type="submit" className="tombol tombol-utama">
            Proses Retur
          </button>
        </div>
      </FormulirAksi>
    </div>
  );
}
