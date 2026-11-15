import { SEKSI_BAWAAN } from "@/lib/dokumenPenjualan";
import { simpanPengaturanDokumenPenjualanFormulir } from "@/lib/aksi/dokumenPenjualan";
import FormulirAksi from "@/komponen/FormulirAksi";

/*
 * Editor seksi baris dokumen penjualan satu perusahaan di halaman Daftar Pilihan (P44 e.12). Memakai aksi dan hak
 * halaman Dokumen & Nomor Cetak yang sudah ada (simpanPengaturanDokumenPenjualan, wajib pengaturan.tulis). Aksi itu
 * menyimpan semua bawaan dokumen sekaligus, jadi isian lainnya (syarat pembayaran, tampilan event, paragraf pembuka
 * dan penutup) dikirim ulang apa adanya lewat isian tersembunyi supaya tidak terhapus. Halaman pemasang memegang
 * wajibHak("pengaturan.tulis") dan pilihan perusahaan aktif.
 */
export type BawaanDokumen = {
  syaratPembayaran: string | null;
  tampilanEvent: "RINCI" | "RINGKAS";
  daftarSeksi: string[];
  teksPembukaPenawaran: string | null;
  teksPenutupPenawaran: string | null;
} | null;

export default function EditorSeksiDokumen({ perusahaan, dokumen }: { perusahaan: { id: string; nama: string }; dokumen: BawaanDokumen }) {
  const id = `seksi-${perusahaan.id}`;
  return (
    <FormulirAksi key={`seksi-${perusahaan.id}`} aksi={simpanPengaturanDokumenPenjualanFormulir} pesanSukses="Daftar seksi tersimpan." className="space-y-3">
      <input type="hidden" name="perusahaanId" value={perusahaan.id} />
      <input type="hidden" name="syaratPembayaran" value={dokumen?.syaratPembayaran ?? ""} />
      <input type="hidden" name="tampilanEvent" value={dokumen?.tampilanEvent ?? "RINCI"} />
      <input type="hidden" name="teksPembukaPenawaran" value={dokumen?.teksPembukaPenawaran ?? ""} />
      <input type="hidden" name="teksPenutupPenawaran" value={dokumen?.teksPenutupPenawaran ?? ""} />
      <div className="bidang">
        <label className="label" htmlFor={id}>
          Daftar seksi (satu per baris)
        </label>
        <textarea id={id} name="daftarSeksi" rows={6} defaultValue={dokumen?.daftarSeksi.join("\n") ?? ""} placeholder={SEKSI_BAWAAN.join("\n")} className="isian" />
        <span className="petunjuk">Kosong = daftar bawaan. Mengubah daftar tidak mengubah dokumen yang sudah ada.</span>
      </div>
      <button type="submit" className="tombol tombol-utama min-h-11 w-full sm:w-auto">
        Simpan seksi
      </button>
    </FormulirAksi>
  );
}
