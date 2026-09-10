import Link from "next/link";
import { wajibHak } from "@/lib/otentikasi";
import { db } from "@/lib/db";
import { daftarAkunKasBank } from "@/lib/baganAkun";
import { ambilPengaturanPerusahaan, hitungPpn } from "@/lib/pengaturanPerusahaan";
import { D } from "@/lib/uang";
import FormulirAksi from "@/komponen/FormulirAksi";
import { buatUangMukaFormulir } from "@/lib/aksi/penjualan";
import { NomorDokumen } from "@/komponen/ui/Lencana";

export default async function HalamanUangMukaBaru({ searchParams }: { searchParams: Promise<{ pesananId?: string }> }) {
  await wajibHak("penjualan.tulis");
  const { pesananId } = await searchParams;
  const [pesanan, daftarAkun, pengaturan] = await Promise.all([
    pesananId ? db.pesananPenjualan.findUnique({ where: { id: pesananId }, include: { pelanggan: true, baris: true, uangMuka: { orderBy: { tanggal: "asc" } } } }) : null,
    daftarAkunKasBank(),
    ambilPengaturanPerusahaan(db),
  ]);

  if (!pesananId || !pesanan) {
    return (
      <div className="max-w-3xl space-y-4">
        <h1 className="judul-halaman">Uang Muka Pelanggan Baru</h1>
        <p className="redup">
          Uang muka dicatat atas sebuah pesanan. Buka{" "}
          <Link href="/penjualan/pesanan" className="font-semibold text-blue-600 hover:underline">Pesanan Penjualan</Link>{" "}
          lalu klik <strong>Uang Muka</strong> pada pesanan yang dimaksud.
        </p>
      </div>
    );
  }

  const rp = (n: number) => n.toLocaleString("id-ID");
  const nilaiBruto = Number(pesanan.total) + (pengaturan.pkp ? Number(hitungPpn(D(pesanan.total), pengaturan.tarifPpnPersen)) : 0);
  const sudahDp = pesanan.uangMuka.reduce((s, u) => s + Number(u.jumlah), 0);
  const dipakai = pesanan.uangMuka.reduce((s, u) => s + Number(u.jumlahDipakai), 0);
  const maks = Math.max(nilaiBruto - sudahDp, 0);
  const difakturSemua = pesanan.baris.every((b) => Number(b.jumlahDifaktur) >= Number(b.jumlah));

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h1 className="judul-halaman">Uang Muka untuk Pesanan {pesanan.nomor}</h1>
        <p className="redup">
          Pelanggan: {pesanan.pelanggan.nama} &middot; Nilai pesanan {rp(Number(pesanan.total))}
          {pengaturan.pkp && <> (+ PPN {pengaturan.tarifPpnPersen.toString()}% = {rp(nilaiBruto)})</>}
          {sudahDp > 0 && <> &middot; DP sudah diterima {rp(sudahDp)} (dipakai faktur {rp(dipakai)})</>}
        </p>
      </div>

      {pesanan.uangMuka.length > 0 && (
        <div className="kartu space-y-2">
          <h2 className="judul-kartu">Uang muka sebelumnya</h2>
          <ul className="text-sm space-y-1">
            {pesanan.uangMuka.map((u) => (
              <li key={u.id} className="flex items-center justify-between gap-3">
                <NomorDokumen nomor={u.nomor} />
                <span className="angka">{rp(Number(u.jumlah))}<span className="text-slate-400"> · sisa {rp(Number(u.jumlah) - Number(u.jumlahDipakai))}</span></span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {difakturSemua ? (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">Pesanan ini sudah difaktur seluruhnya; uang muka tidak lagi bisa ditambahkan. Catat pembayaran lewat Penerimaan pada fakturnya.</div>
      ) : (
        <FormulirAksi aksi={buatUangMukaFormulir} className="kartu flex flex-col gap-4">
          <input type="hidden" name="pesananId" value={pesanan.id} />
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
            <label className="label" htmlFor="jumlah">Jumlah Uang Muka *</label>
            <input id="jumlah" type="number" name="jumlah" step="0.01" min={0} max={maks} defaultValue={maks} required className="isian" />
            <span className="petunjuk">Maksimal {rp(maks)} (nilai pesanan dikurangi DP yang sudah ada). Dicatat Dr Kas/Bank / Cr Uang Muka Pelanggan; saat faktur dibuat, DP dipakai mengurangi piutang.</span>
          </div>
          <div className="bidang">
            <label className="label" htmlFor="metodeBayar">Metode Pembayaran</label>
            <select id="metodeBayar" name="metodeBayar" defaultValue="TRANSFER" className="isian">
              <option value="TRANSFER">Transfer</option>
              <option value="TUNAI">Tunai</option>
              <option value="KARTU">Kartu</option>
            </select>
          </div>
          <div className="bidang">
            <label className="label" htmlFor="keterangan">Keterangan</label>
            <input id="keterangan" name="keterangan" placeholder="mis. DP 30% sesuai kontrak" className="isian" />
          </div>
          <button type="submit" className="tombol tombol-utama">
            Catat Uang Muka
          </button>
        </FormulirAksi>
      )}
    </div>
  );
}
