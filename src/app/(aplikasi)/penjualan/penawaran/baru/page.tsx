import { wajibHak } from "@/lib/otentikasi";
import { db } from "@/lib/db";
import FormulirAksi from "@/komponen/FormulirAksi";
import { buatPenawaranFormulir } from "@/lib/aksi/penjualan";
import EditorBarisBarang from "@/komponen/penjualan/EditorBarisBarang";

export default async function HalamanPenawaranBaru() {
  await wajibHak("penawaran.buat");
  const [daftarPelanggan, daftarBarang] = await Promise.all([
    db.pelanggan.findMany({ orderBy: { nama: "asc" } }),
    db.barang.findMany({ orderBy: { nama: "asc" } }),
  ]);

  const opsiBarang = daftarBarang.map((i) => ({
    id: i.id,
    kode: i.kode,
    nama: i.nama,
    hargaBawaan: Number(i.hargaJual),
  }));

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="judul-halaman">Penawaran Penjualan Baru</h1>

      <FormulirAksi aksi={buatPenawaranFormulir} className="kartu grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bidang">
          <label className="label" htmlFor="pelangganId">Pelanggan *</label>
          <select id="pelangganId" name="pelangganId" required className="isian">
            <option value="">-</option>
            {daftarPelanggan.map((c) => (
              <option key={c.id} value={c.id}>
                {c.kode} - {c.nama}
              </option>
            ))}
          </select>
        </div>

        <div />

        <EditorBarisBarang daftarBarang={opsiBarang} />

        <div className="md:col-span-2">
          <button type="submit" className="tombol tombol-utama">
            Simpan Penawaran
          </button>
        </div>
      </FormulirAksi>
    </div>
  );
}
