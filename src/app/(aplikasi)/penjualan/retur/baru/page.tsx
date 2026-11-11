import { wajibHak } from "@/lib/otentikasi";
import { db } from "@/lib/db";
import FormulirAksi from "@/komponen/FormulirAksi";
import { buatReturFormulir } from "@/lib/aksi/penjualan";
import PemilihBarisRetur from "@/komponen/penjualan/PemilihBarisRetur";
import { saringMilikAtauBersama } from "@/lib/perusahaan";
import { sisaReturPerBaris } from "@/lib/dokumenPenjualan";
import { D } from "@/lib/uang";

export default async function HalamanReturPenjualanBaru({
  searchParams,
}: {
  searchParams: Promise<{ fakturId?: string }>;
}) {
  await wajibHak("retur-penjualan.buat");
  const { fakturId } = await searchParams;

  const faktur = fakturId
    ? await db.fakturPenjualan.findUnique({
        where: { id: fakturId },
        include: {
          pelanggan: true,
          baris: { include: { barang: true }, orderBy: [{ urutan: "asc" }, { id: "asc" }] },
          retur: { select: { baris: { select: { barisFakturId: true, barangId: true, jumlah: true } } } },
        },
      })
    : null;
  // dokumen anak (D1 §8.4): gudang milik perusahaan faktur atau bersama
  const daftarGudang = await db.gudang.findMany({ where: saringMilikAtauBersama(faktur?.perusahaanId), orderBy: { nama: "asc" } });

  if (!fakturId || !faktur) {
    return (
      <div className="max-w-3xl space-y-4">
        <h1 className="judul-halaman">Retur Penjualan Baru</h1>
        <p className="redup">
          Pilih faktur dari halaman{" "}
          <a href="/penjualan/faktur" className="font-semibold text-blue-600 hover:underline">
            Faktur Penjualan
          </a>{" "}
          lalu klik &quot;Retur&quot;.
        </p>
      </div>
    );
  }

  // per baris faktur (D2 §7.6): retur menunjuk barisFakturId, sisa sudah dikurangi retur sebelumnya
  const sisa = sisaReturPerBaris(faktur.baris, faktur.retur.flatMap((r) => r.baris));
  const barisUntukPemilih = faktur.baris.map((l) => {
    const frekuensi = D(l.frekuensi);
    const frek = frekuensi.equals(1) ? "" : ` · ${Number(l.jumlah).toLocaleString("id-ID")} × ${frekuensi.toNumber().toLocaleString("id-ID")}${l.satuanFrekuensi ? ` ${l.satuanFrekuensi}` : ""}`;
    return {
      id: l.id,
      barangId: l.barangId,
      labelBarang: `${l.barang.kode} - ${l.nama ?? l.barang.nama}${l.bagian ? ` · ${l.bagian}` : ""}${frek}`,
      jumlah: Number(l.jumlah),
      sisa: Math.max(Number(sisa.get(l.id) ?? 0), 0),
    };
  });

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="judul-halaman">Retur untuk Faktur {faktur.nomor}</h1>
      <p className="redup">Pelanggan: {faktur.pelanggan.nama}</p>

      <FormulirAksi aksi={buatReturFormulir} className="kartu grid grid-cols-1 md:grid-cols-2 gap-4">
        <input type="hidden" name="fakturId" value={faktur.id} />

        <div className="bidang">
          <label className="label" htmlFor="gudangId">Gudang Penerima Retur *</label>
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
