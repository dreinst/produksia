import { wajibHak } from "@/lib/otentikasi";
import { db } from "@/lib/db";
import { daftarAkunKasBank } from "@/lib/baganAkun";
import { ambilPengaturanPerusahaan } from "@/lib/pengaturanPerusahaan";
import FormulirAksi from "@/komponen/FormulirAksi";
import { buatPenerimaanFormulir } from "@/lib/aksi/penjualan";

export default async function HalamanPenerimaanPenjualanBaru({
  searchParams,
}: {
  searchParams: Promise<{ fakturId?: string }>;
}) {
  await wajibHak("penerimaan.buat");
  const { fakturId } = await searchParams;

  const [faktur, daftarAkun, pengaturan] = await Promise.all([
    fakturId
      ? db.fakturPenjualan.findUnique({
          where: { id: fakturId },
          include: { pelanggan: true, penerimaan: true, retur: { select: { total: true } } },
        })
      : null,
    daftarAkunKasBank(),
    ambilPengaturanPerusahaan(db),
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

  const paid = faktur.penerimaan.reduce((s, r) => s + Number(r.jumlah) + Number(r.potonganPajak), 0);
  const diretur = faktur.retur.reduce((s, r) => s + Number(r.total), 0);
  const uangMuka = Number(faktur.uangMuka);
  const sisa = Number(faktur.total) - uangMuka - paid - diretur;

  return (
    <div className="space-y-6 max-w-md">
      <h1 className="judul-halaman">Penerimaan untuk Faktur {faktur.nomor}</h1>
      <p className="redup">
        Pelanggan: {faktur.pelanggan.nama} &middot; Total {Number(faktur.total).toLocaleString("id-ID")}
        {Number(faktur.ppn) > 0 && <> (termasuk PPN {Number(faktur.ppn).toLocaleString("id-ID")})</>}
        {uangMuka > 0 && <> &middot; uang muka {uangMuka.toLocaleString("id-ID")}</>}
        {diretur > 0 && <> &middot; retur {diretur.toLocaleString("id-ID")}</>} &middot; Sisa tagihan: <strong>{sisa.toLocaleString("id-ID")}</strong>
      </p>

      <FormulirAksi aksi={buatPenerimaanFormulir} className="kartu flex flex-col gap-4">
        <input type="hidden" name="fakturId" value={faktur.id} />

        <div className="bidang">
          <label className="label" htmlFor="akunId">Akun Kas/Bank Penerima *</label>
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

        {pengaturan.akunPph23DimukaId ? (
          <div className="bidang">
            <label className="label" htmlFor="potonganPajak">Potongan PPh 23 oleh pelanggan</label>
            <input id="potonganPajak" type="number" name="potonganPajak" step="0.01" min={0} defaultValue={0} className="isian" />
            <span className="petunjuk">Bila klien memotong PPh 23 (mis. 2% dari DPP jasa), isi nominalnya: piutang berkurang sebesar bayar + potongan, potongan dicatat sebagai pajak dibayar dimuka</span>
          </div>
        ) : (
          <p className="text-xs text-slate-500">Potongan PPh 23 oleh pelanggan bisa dicatat setelah akun pajaknya diatur di Pengaturan › Perusahaan &amp; Pajak.</p>
        )}

        <div className="bidang">
          <label className="label" htmlFor="metodeBayar">Metode Pembayaran</label>
          <select id="metodeBayar" name="metodeBayar" defaultValue="TUNAI" className="isian">
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
