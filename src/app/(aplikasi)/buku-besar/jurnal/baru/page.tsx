import { wajibHak } from "@/lib/otentikasi";
import { db } from "@/lib/db";
import FormulirAksi from "@/komponen/FormulirAksi";
import { buatJurnalManualFormulir } from "@/lib/aksi/jurnal";
import EditorBarisJurnal from "@/komponen/buku-besar/EditorBarisJurnal";

export default async function HalamanJurnalBaru() {
  await wajibHak("buku-besar.tulis");
  const daftarAkun = await db.akun.findMany({ orderBy: { kode: "asc" } });

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="judul-halaman">Jurnal Umum Baru</h1>

      <FormulirAksi aksi={buatJurnalManualFormulir} className="kartu grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bidang md:col-span-2">
          <label className="label" htmlFor="keterangan">Keterangan</label>
          <input id="keterangan" type="text" name="keterangan" className="isian" />
        </div>

        <EditorBarisJurnal daftarAkun={daftarAkun} />

        <div className="md:col-span-2">
          <button type="submit" className="tombol tombol-utama">
            Simpan Jurnal
          </button>
        </div>
      </FormulirAksi>
    </div>
  );
}
