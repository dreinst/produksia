import { wajibHak } from "@/lib/otentikasi";
import { db } from "@/lib/db";
import { daftarAkunKasBank } from "@/lib/baganAkun";
import { ambilPengaturanPerusahaan } from "@/lib/pengaturanPerusahaan";
import FormulirAksi from "@/komponen/FormulirAksi";
import { buatPembayaranPembelianFormulir } from "@/lib/aksi/pembelian";

export default async function HalamanPembayaranPembelianBaru({
  searchParams,
}: {
  searchParams: Promise<{ fakturId?: string }>;
}) {
  await wajibHak("pembayaran.buat");
  const { fakturId } = await searchParams;

  const [faktur, daftarAkun, pengaturan] = await Promise.all([
    fakturId
      ? db.fakturPembelian.findUnique({
          where: { id: fakturId },
          include: { pemasok: true, pembayaran: true, retur: { select: { total: true } } },
        })
      : null,
    daftarAkunKasBank(),
    ambilPengaturanPerusahaan(db),
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

  const paid = faktur.pembayaran.reduce((s, p) => s + Number(p.jumlah) + Number(p.potonganPajak), 0);
  const diretur = faktur.retur.reduce((s, r) => s + Number(r.total), 0);
  const sisa = Number(faktur.total) - paid - diretur;

  return (
    <div className="space-y-6 max-w-md">
      <h1 className="judul-halaman">Pembayaran untuk Faktur {faktur.nomor}</h1>
      <p className="redup">
        Pemasok: {faktur.pemasok.nama} &middot; Total {Number(faktur.total).toLocaleString("id-ID")}
        {Number(faktur.ppn) > 0 && <> (termasuk PPN {Number(faktur.ppn).toLocaleString("id-ID")})</>}
        {diretur > 0 && <> &middot; retur {diretur.toLocaleString("id-ID")}</>} &middot; Sisa hutang: <strong>{sisa.toLocaleString("id-ID")}</strong>
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

        {pengaturan.akunPph23DipotongId ? (
          <div className="bidang">
            <label className="label" htmlFor="potonganPajak">Potongan PPh 23 (kita potong dari vendor)</label>
            <input id="potonganPajak" type="number" name="potonganPajak" step="0.01" min={0} defaultValue={0} className="isian" />
            <span className="petunjuk">Untuk jasa kena PPh 23 (mis. 2% dari DPP): hutang berkurang sebesar bayar + potongan, potongan dicatat sebagai Hutang PPh 23 untuk disetor</span>
          </div>
        ) : (
          <p className="text-xs text-slate-500">Pemotongan PPh 23 ke vendor bisa dicatat setelah akun Hutang PPh 23 diatur di Pengaturan › Perusahaan &amp; Pajak.</p>
        )}

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
