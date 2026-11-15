import { punyaHak, type PenggunaSesi } from "@/lib/hakAkses";
import { JENIS_CETAK_KE_LAMPIRAN, bolehAksesBerkas } from "@/lib/berkas";
import { HAK_CETAK_PENJUALAN, infoPanelCetak, type JenisCetakPenjualan } from "@/lib/dataCetakPenjualan";
import { simpanPdfDokumenFormulir } from "@/lib/aksi/pdfPenjualan";
import PanelCetak from "@/komponen/cetak/PanelCetak";
import Ikon from "@/komponen/ui/Ikon";

/**
 * Tombol "Cetak" di kepala halaman detail dokumen penjualan (D2 §7.2, DESAIN G10). Membuka panel cetak P31 (kop,
 * ukuran, tanda tangan, tampilan event) dengan Pratinjau PDF di tab baru, Unduh PDF, dan Simpan PDF ke Lampiran.
 * Tidak tampil tanpa hak lihat jenis cetak; Simpan hanya bila pengguna boleh mengunggah lampiran dokumen itu. Nilai
 * panel dibaca infoPanelCetak (kueri ringan, tinjauan P45 R3), bukan data cetak lengkap.
 */
export default async function TombolCetakDokumen({ jenis, id, pengguna }: { jenis: JenisCetakPenjualan; id: string; pengguna: PenggunaSesi }) {
  if (!punyaHak(pengguna, HAK_CETAK_PENJUALAN[jenis])) return null;
  const data = await infoPanelCetak(jenis, id);
  if (!data) return null;
  const bolehSimpan = bolehAksesBerkas(pengguna, { jenisEntitas: JENIS_CETAK_KE_LAMPIRAN[jenis] }, "unggah");
  return (
    <details className="relative open:max-lg:w-full">
      <summary className="tombol tombol-garis cursor-pointer list-none">
        <Ikon nama="print" className="!text-[18px]" />
        Cetak
      </summary>
      {/* Di bawah lg tombol ini berada di sisi kiri kepala halaman, jadi panel yang menempel ke tepi kanan tombol
          terpotong di kiri layar. Di sana panel mengalir biasa di bawah tombol dan baris tombol terbuka selebar
          baris (open:max-lg:w-full). Position fixed tidak dipakai karena pembungkus halaman memegang animasi
          transform sehingga menjadi acuan fixed. Mulai lg panel tetap melayang di bawah tombol, rata kanan. */}
      <div className="z-30 mt-2 rounded-lg border border-slate-200 bg-white p-3 shadow-lg lg:absolute lg:right-0 lg:w-[36rem]">
        <PanelCetak
          jenis={jenis}
          id={id}
          perusahaanId={data.perusahaanId}
          kopSuratId={data.kopSuratId}
          draf={data.draf}
          modeEvent={data.modeEvent}
          tampilan={data.tampilan}
          pengguna={pengguna}
          aksiSimpan={bolehSimpan ? simpanPdfDokumenFormulir.bind(null, jenis, id) : undefined}
        />
      </div>
    </details>
  );
}
