import { wajibHak } from "@/lib/otentikasi";
import { punyaHak, PERAN_TERTINGGI } from "@/lib/hakAkses";
import { PERUSAHAAN_UTAMA, daftarPerusahaan, lingkupPerusahaan, perusahaanFormulir } from "@/lib/perusahaan";
import { buatPesananFormulir } from "@/lib/aksi/penjualan";
import FormulirDokumenPenjualan, { PilihPerusahaanPenerbit, muatOpsiDokumenPenjualan } from "@/komponen/penjualan/FormulirDokumenPenjualan";

export default async function HalamanPesananPenjualanBaru({ searchParams }: { searchParams: Promise<{ perusahaan?: string | string[] }> }) {
  const pengguna = await wajibHak("pesanan.buat");
  const q = await searchParams;
  const pilihan = typeof q.perusahaan === "string" ? q.perusahaan : undefined;
  const [lingkup, perusahaanAktif] = await Promise.all([lingkupPerusahaan(), daftarPerusahaan()]);
  // lingkup satu perusahaan aktif = perusahaan itu; gabungan dan lingkup arsip memilih perusahaan penerbit (D2 §7.1)
  const p = perusahaanFormulir(lingkup);
  const terpilih = perusahaanAktif.find((x) => x.id === (p ?? pilihan)) ?? null;

  if (!terpilih) {
    return (
      <div className="space-y-6">
        <h1 className="judul-halaman">Pesanan Penjualan Baru</h1>
        <PilihPerusahaanPenerbit daftar={perusahaanAktif} href={(id) => `/penjualan/pesanan/baru?perusahaan=${encodeURIComponent(id)}`} />
      </div>
    );
  }

  const opsi = await muatOpsiDokumenPenjualan(terpilih.id, "pesanan");
  return (
    <div className="space-y-6 max-w-6xl">
      <h1 className="judul-halaman">Pesanan Penjualan Baru</h1>
      <FormulirDokumenPenjualan
        jenis="pesanan"
        aksi={buatPesananFormulir}
        perusahaan={terpilih}
        // pola formulir akar halaman lama (KONTRAK-TAMBAHAN): utama hanya isian tersembunyi
        tampilPerusahaan={p === PERUSAHAAN_UTAMA ? "tersembunyi" : p ? "bacaSaja" : { gantiHref: "/penjualan/pesanan/baru" }}
        opsi={opsi}
        bolehNego={punyaHak(pengguna, "harga.nego")}
        bolehBawahMinimum={PERAN_TERTINGGI.includes(pengguna.peran)}
        tombolLain={
          <>
            <button type="submit" name="lanjut" value="faktur" className="tombol tombol-garis">
              Simpan &amp; Buat Faktur
            </button>
            <span className="petunjuk">Untuk jasa yang sudah selesai dikerjakan: pesanan tercatat, lalu langsung ke faktur (SJ hanya perlu bila ada barang fisik).</span>
          </>
        }
      />
    </div>
  );
}
