import { wajibHak } from "@/lib/otentikasi";
import { db } from "@/lib/db";
import FormulirAksi from "@/komponen/FormulirAksi";
import { buatPengirimanFormulir } from "@/lib/aksi/penjualan";
import PemilihBarisPesanan from "@/komponen/penjualan/PemilihBarisPesanan";

export default async function HalamanPengirimanBaru({
  searchParams,
}: {
  searchParams: Promise<{ pesananId?: string }>;
}) {
  await wajibHak("pengiriman.buat");
  const { pesananId } = await searchParams;

  const [pesanan, daftarGudang] = await Promise.all([
    pesananId
      ? db.pesananPenjualan.findUnique({
          where: { id: pesananId },
          include: { pelanggan: true, baris: { include: { barang: true } } },
        })
      : null,
    db.gudang.findMany({ orderBy: { nama: "asc" } }),
  ]);

  if (!pesananId || !pesanan) {
    return (
      <div className="max-w-3xl space-y-4">
        <h1 className="judul-halaman">Pengiriman Pesanan Baru</h1>
        <p className="redup">
          Pilih pesanan dari halaman{" "}
          <a href="/penjualan/pesanan" className="font-semibold text-blue-600 hover:underline">
            Pesanan Penjualan
          </a>{" "}
          lalu klik &quot;Kirim&quot;.
        </p>
      </div>
    );
  }

  const barisUntukPemilih = pesanan.baris.map((l) => ({
    id: l.id,
    barangId: l.barangId,
    labelBarang: `${l.barang.kode} - ${l.barang.nama}`,
    jumlah: Number(l.jumlah),
    jumlahTerkirim: Number(l.jumlahTerkirim),
  }));

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="judul-halaman">Pengiriman untuk Pesanan {pesanan.nomor}</h1>
      <p className="redup">Pelanggan: {pesanan.pelanggan.nama}</p>

      <FormulirAksi aksi={buatPengirimanFormulir} className="kartu grid grid-cols-1 md:grid-cols-2 gap-4">
        <input type="hidden" name="pesananId" value={pesanan.id} />

        <div className="bidang">
          <label className="label" htmlFor="gudangId">Gudang *</label>
          <select id="gudangId" name="gudangId" required className="isian">
            <option value="">-</option>
            {daftarGudang.map((w) => (
              <option key={w.id} value={w.id}>
                {w.kode} - {w.nama}
              </option>
            ))}
          </select>
        </div>

        <div />

        <PemilihBarisPesanan daftarBaris={barisUntukPemilih} />

        <div className="md:col-span-2">
          <button type="submit" className="tombol tombol-utama">
            Proses Pengiriman
          </button>
        </div>
      </FormulirAksi>
    </div>
  );
}
