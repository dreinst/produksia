import { wajibHak } from "@/lib/otentikasi";
import { db } from "@/lib/db";
import { daftarProyekAktif } from "@/lib/proyek";
import FormulirAksi from "@/komponen/FormulirAksi";
import { buatPesananPembelianFormulir } from "@/lib/aksi/pembelian";
import EditorBarisBarang from "@/komponen/penjualan/EditorBarisBarang";

export default async function HalamanPesananPembelianBaru() {
  await wajibHak("pesanan-pembelian.buat");
  const [daftarPemasok, daftarBarang, daftarProyek] = await Promise.all([
    db.pemasok.findMany({ orderBy: { nama: "asc" } }),
    db.barang.findMany({ orderBy: { nama: "asc" } }),
    daftarProyekAktif(),
  ]);

  const opsiBarang = daftarBarang.map((i) => ({
    id: i.id,
    kode: i.kode,
    nama: i.nama,
    hargaBawaan: Number(i.hargaBeli),
  }));

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="judul-halaman">Pesanan Pembelian Baru</h1>

      <FormulirAksi aksi={buatPesananPembelianFormulir} className="kartu grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bidang">
          <label className="label" htmlFor="pemasokId">Pemasok *</label>
          <select id="pemasokId" name="pemasokId" required className="isian">
            <option value="">-</option>
            {daftarPemasok.map((s) => (
              <option key={s.id} value={s.id}>
                {s.kode} - {s.nama}
              </option>
            ))}
          </select>
        </div>
        <div className="bidang">
          <label className="label" htmlFor="proyekId">Proyek / Event</label>
          <select id="proyekId" name="proyekId" className="isian" defaultValue="">
            <option value="">— tanpa event</option>
            {daftarProyek.map((p) => (
              <option key={p.id} value={p.id}>
                {p.kode} - {p.nama}
              </option>
            ))}
          </select>
          <span className="petunjuk">Dimensi untuk Laba Rugi per event dan Rekonsiliasi Event (LPJ); diwariskan ke semua dokumen & jurnal turunannya</span>
        </div>

        <div />

        <EditorBarisBarang daftarBarang={opsiBarang} />

        <div className="md:col-span-2">
          <button type="submit" className="tombol tombol-utama">
            Simpan Pesanan
          </button>
        </div>
      </FormulirAksi>
    </div>
  );
}
