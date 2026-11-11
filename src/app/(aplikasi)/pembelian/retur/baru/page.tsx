import { wajibHak } from "@/lib/otentikasi";
import { db } from "@/lib/db";
import LencanaPerusahaan from "@/komponen/ui/LencanaPerusahaan";
import { lingkupPerusahaan, saringMilikAtauBersama } from "@/lib/perusahaan";
import FormulirAksi from "@/komponen/FormulirAksi";
import { buatReturPembelianFormulir } from "@/lib/aksi/pembelian";
import PemilihBarisRetur from "@/komponen/penjualan/PemilihBarisRetur";

export default async function HalamanReturPembelianBaru({
  searchParams,
}: {
  searchParams: Promise<{ fakturId?: string }>;
}) {
  await wajibHak("retur-pembelian.buat");
  const { fakturId } = await searchParams;

  const [faktur, lingkup] = await Promise.all([
    fakturId
      ? db.fakturPembelian.findUnique({
          where: { id: fakturId },
          include: { pemasok: true, baris: { include: { barang: true } }, perusahaan: { select: { kode: true, nama: true, warna: true } } },
        })
      : null,
    lingkupPerusahaan(),
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

  // Gudang milik perusahaan dokumen induk atau bersama (D1 §7.4 butir 3); server tetap menolak gudang perusahaan lain (P13)
  const daftarGudang = await db.gudang.findMany({ where: saringMilikAtauBersama(faktur.perusahaanId), orderBy: { nama: "asc" } });

  const barisUntukPemilih = faktur.baris.map((l) => ({
    barangId: l.barangId,
    labelBarang: `${l.barang.kode} - ${l.barang.nama}`,
    jumlah: Number(l.jumlah),
  }));

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="judul-halaman">Retur untuk Faktur {faktur.nomor}</h1>
      <p className="redup">
        Pemasok: {faktur.pemasok.nama}
        {/* perusahaan dokumen tampil bila berbeda dari lingkup (mis. gabungan); lingkup yang sama tetap seperti dulu */}
        {lingkup.perusahaanId !== faktur.perusahaanId && (
          <>
            {" "}&middot; Perusahaan <LencanaPerusahaan kode={faktur.perusahaan.kode} warna={faktur.perusahaan.warna} nama={faktur.perusahaan.nama} />
          </>
        )}
      </p>

      <FormulirAksi aksi={buatReturPembelianFormulir} className="kartu grid grid-cols-1 md:grid-cols-2 gap-4">
        <input type="hidden" name="fakturId" value={faktur.id} />

        <div className="bidang">
          <label className="label" htmlFor="gudangId">Gudang Asal Barang *</label>
          <select id="gudangId" name="gudangId" required className="isian">
            <option value="">-</option>
            {daftarGudang.map((w) => (
              <option key={w.id} value={w.id}>
                {w.kode} - {w.nama}
              </option>
            ))}
          </select>
        </div>

        <div className="bidang">
          <label className="label" htmlFor="alasan">Alasan</label>
          <input id="alasan" type="text" name="alasan" className="isian" />
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
