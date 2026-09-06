import { db } from "@/lib/db";
import FormulirAksi from "@/komponen/FormulirAksi";
import { buatPenerimaanFormulir } from "@/lib/aksi/penjualan";

export default async function NewReceiptPage({
  searchParams,
}: {
  searchParams: Promise<{ fakturId?: string }>;
}) {
  const { fakturId } = await searchParams;

  const [faktur, daftarAkun] = await Promise.all([
    fakturId
      ? db.fakturPenjualan.findUnique({
          where: { id: fakturId },
          include: { pelanggan: true, penerimaan: true },
        })
      : null,
    db.akun.findMany({ where: { jenis: "ASET" }, orderBy: { kode: "asc" } }),
  ]);

  if (!fakturId || !faktur) {
    return (
      <div className="max-w-3xl space-y-4">
        <h1 className="judul-halaman">Penerimaan Penjualan Baru</h1>
        <p className="redup">
          Pilih faktur dari halaman{" "}
          <a href="/penjualan/faktur" className="font-semibold text-blue-600 hover:underline">
            Faktur Penjualan
          </a>{" "}
          lalu klik &quot;Terima Bayar&quot;.
        </p>
      </div>
    );
  }

  const paid = faktur.penerimaan.reduce((s, r) => s + Number(r.jumlah), 0);
  const sisa = Number(faktur.total) - paid;

  return (
    <div className="space-y-6 max-w-md">
      <h1 className="judul-halaman">Penerimaan untuk Faktur {faktur.nomor}</h1>
      <p className="redup">
        Pelanggan: {faktur.pelanggan.nama} &middot; Sisa tagihan: {sisa.toLocaleString("id-ID")}
      </p>

      <FormulirAksi aksi={buatPenerimaanFormulir} className="kartu flex flex-col gap-4">
        <input type="hidden" name="fakturId" value={faktur.id} />

        <div className="bidang">
          <label className="label">Akun Kas/Bank Penerima *</label>
          <select name="akunId" required className="isian">
            <option value="">-</option>
            {daftarAkun.map((a) => (
              <option key={a.id} value={a.id}>
                {a.kode} - {a.nama}
              </option>
            ))}
          </select>
        </div>

        <div className="bidang">
          <label className="label">Jumlah Bayar *</label>
          <input
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
          <label className="label">Metode Pembayaran</label>
          <select name="metodeBayar" defaultValue="TUNAI" className="isian">
            <option value="TUNAI">Tunai</option>
            <option value="TRANSFER">Transfer</option>
            <option value="KARTU">Kartu</option>
          </select>
        </div>

        <button type="submit" className="tombol tombol-utama">
          Catat Penerimaan
        </button>
      </FormulirAksi>
    </div>
  );
}
