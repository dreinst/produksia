import { db } from "@/lib/db";
import { ambilPengaturanPemasaran } from "@/lib/pemasaran";
import { simpanPengaturanPemasaranFormulir } from "@/lib/aksi/pengaturanPemasaran";
import FormulirAksi from "@/komponen/FormulirAksi";

/*
 * Editor daftar jenis dan pilar konten satu perusahaan (D6 §7.9). Dipasang halaman Daftar Pilihan (P44) sebagai bagian
 * "Jenis & pilar konten"; halaman itu yang memegang wajibHak dan pilihan perusahaan. Isi awal dari
 * ambilPengaturanPemasaran (bawaan bila perusahaan belum punya baris). Id isian berawalan perusahaan supaya unik bila
 * beberapa editor tampil di satu halaman.
 */
export default async function PengaturanDaftarPemasaran({ perusahaanId }: { perusahaanId: string }) {
  const { jenisKonten, pilarKonten } = await ambilPengaturanPemasaran(db, perusahaanId);
  const awalan = `daftar-pemasaran-${perusahaanId}`;
  return (
    <FormulirAksi aksi={simpanPengaturanPemasaranFormulir} pesanSukses="Daftar tersimpan." className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <input type="hidden" name="perusahaanId" value={perusahaanId} />
      <div className="bidang">
        <label className="label" htmlFor={`${awalan}-jenis`}>
          Jenis konten (satu per baris)
        </label>
        <textarea id={`${awalan}-jenis`} name="jenisKonten" rows={7} defaultValue={jenisKonten.join("\n")} className="isian" />
      </div>
      <div className="bidang">
        <label className="label" htmlFor={`${awalan}-pilar`}>
          Pilar konten (satu per baris)
        </label>
        <textarea id={`${awalan}-pilar`} name="pilarKonten" rows={7} defaultValue={pilarKonten.join("\n")} className="isian" />
      </div>
      <p className="petunjuk md:col-span-2">Mengubah daftar tidak mengubah konten yang sudah ada.</p>
      <div className="md:col-span-2">
        <button type="submit" className="tombol tombol-utama min-h-11 w-full sm:w-auto">
          Simpan daftar
        </button>
      </div>
    </FormulirAksi>
  );
}
