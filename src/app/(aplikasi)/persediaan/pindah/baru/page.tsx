import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { buatPindahBarangFormulir } from "@/lib/aksi/persediaan";
import FormulirAksi from "@/komponen/FormulirAksi";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import EditorBarisPindah from "@/komponen/persediaan/EditorBarisPindah";

export default async function HalamanPindahBarangBaru() {
  await wajibHak("persediaan.tulis");
  const [daftarGudang, daftarBarang, daftarStok] = await Promise.all([
    db.gudang.findMany({ orderBy: { kode: "asc" } }),
    db.barang.findMany({ where: { jenis: "BARANG" }, orderBy: { kode: "asc" } }),
    db.stokBarang.findMany(),
  ]);
  const petaStok: Record<string, Record<string, number>> = {};
  for (const s of daftarStok) (petaStok[s.gudangId] ??= {})[s.barangId] = Number(s.jumlah);

  return (
    <div className="space-y-6 max-w-4xl">
      <KepalaHalaman
        jejak={[{ label: "Persediaan" }, { label: "Pindah Barang", href: "/persediaan/pindah" }]}
        judul="Pindah Barang Baru"
        subjudul="Stok fisik berpindah dari gudang asal ke gudang tujuan; harga pokok dan nilai persediaan tidak berubah (tanpa jurnal)."
      />

      {daftarGudang.length < 2 ? (
        <div className="kartu">
          <p className="redup">Pindah barang butuh minimal dua gudang. Tambahkan gudang di Data Induk → Gudang.</p>
        </div>
      ) : (
        <FormulirAksi aksi={buatPindahBarangFormulir} className="kartu grid grid-cols-1 md:grid-cols-2 gap-4">
          <EditorBarisPindah
            daftarGudang={daftarGudang.map((g) => ({ id: g.id, kode: g.kode, nama: g.nama }))}
            petaStok={petaStok}
            daftarBarang={daftarBarang.map((b) => ({ id: b.id, kode: b.kode, nama: b.nama, satuan: b.satuan }))}
          />
          <div className="md:col-span-2">
            <button type="submit" className="tombol tombol-utama">
              Simpan Pindah Barang
            </button>
          </div>
        </FormulirAksi>
      )}
    </div>
  );
}
