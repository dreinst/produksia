import { wajibHak } from "@/lib/otentikasi";
import { db } from "@/lib/db";
import { daftarAkunKasBank } from "@/lib/baganAkun";
import FormulirAksi from "@/komponen/FormulirAksi";
import { buatPembayaranPembelianFormulir } from "@/lib/aksi/pembelian";

export default async function HalamanPembayaranPembelianBaru({
  searchParams,
}: {
  searchParams: Promise<{ fakturId?: string }>;
}) {
  await wajibHak("pembelian.tulis");
  const { fakturId } = await searchParams;

  const [faktur, daftarAkun] = await Promise.all([
    fakturId
      ? db.fakturPembelian.findUnique({
          where: { id: fakturId },
          include: { pemasok: true, pembayaran: true },
        })
      : null,
    daftarAkunKasBank(),
  ]);

  if (!fakturId || !faktur) {
    return (
      <div className="max-w-3xl space-y-4">
        <h1 className="judul-halaman">Pembayaran Pembelian Baru</h1>
        <p className="redup">
          Pilih faktur dari halaman{" "}
          <a href="/pembelian/faktur" className="font-semibold text-blue-600 hover:underline">
            Faktur Pembelian
          </a>{" "}
          lalu klik &quot;Bayar&quot;.
        </p>
      </div>
    );
  }

  const paid = faktur.pembayaran.reduce((s, p) => s + Number(p.jumlah), 0);
  const sisa = Number(faktur.total) - paid;

  return (
    <div className="space-y-6 max-w-md">
      <h1 className="judul-halaman">Pembayaran untuk Faktur {faktur.nomor}</h1>
      <p className="redup">
        Pemasok: {faktur.pemasok.nama} &middot; Sisa utang: {sisa.toLocaleString("id-ID")}
      </p>

      <FormulirAksi aksi={buatPembayaranPembelianFormulir} className="kartu flex flex-col gap-4">
        <input type="hidden" name="fakturId" value={faktur.id} />

        <div className="bidang">
          <label className="label" htmlFor="akunId">Akun Kas/Bank Sumber *</label>
          <select id="akunId" name="akunId" required className="isian">
            <option value="">-</option>
            {daftarAkun.map((a) => (
              <option key={a.id} value={a.id}>
                {a.kode} - {a.nama}
              </option>
            ))}
          </select>
        </div>

        <div className="bidang">
          <label className="label" htmlFor="jumlah">Jumlah Bayar *</label>
          <input id="jumlah"
            type="number"
            name="jumlah"
            step="0.01"
            min={0}
            max={sisa}
            defaultValue={sisa}
            required
            className="isian"
          />
        </div>

        <div className="bidang">
          <label className="label" htmlFor="metodeBayar">Metode Pembayaran</label>
          <select id="metodeBayar" name="metodeBayar" defaultValue="TRANSFER" className="isian">
            <option value="TRANSFER">Transfer</option>
            <option value="TUNAI">Tunai</option>
          </select>
        </div>

        <button type="submit" className="tombol tombol-utama">
          Catat Pembayaran
        </button>
      </FormulirAksi>
    </div>
  );
}
