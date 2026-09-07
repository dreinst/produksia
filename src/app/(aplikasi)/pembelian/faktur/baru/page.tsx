import { wajibHak } from "@/lib/otentikasi";
import Link from "next/link";
import { db } from "@/lib/db";
import { nomorDokumenBerikutnya } from "@/lib/penomoran";
import { buatFakturPembelianFormulir } from "@/lib/aksi/pembelian";
import PenyusunFaktur from "@/komponen/PenyusunFaktur";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";

export default async function HalamanFakturPembelianBaru({ searchParams }: { searchParams: Promise<{ pesananId?: string }> }) {
  await wajibHak("pembelian.tulis");
  const { pesananId } = await searchParams;

  const pesanan = pesananId
    ? await db.pesananPembelian.findUnique({
        where: { id: pesananId },
        include: { pemasok: true, baris: { include: { barang: true } }, penerimaanBarang: { orderBy: { tanggal: "asc" } } },
      })
    : null;

  if (!pesananId || !pesanan) {
    return (
      <div className="space-y-6">
        <KepalaHalaman jejak={[{ label: "Pembelian" }, { label: "Faktur Pembelian", href: "/pembelian/faktur" }, { label: "Buat Faktur" }]} judul="Faktur Pembelian Baru" />
        <div className="kartu max-w-xl">
          <p className="redup">
            Faktur dibuat dari pesanan yang sudah ada. Buka{" "}
            <Link href="/pembelian/pesanan" className="font-semibold text-blue-600 hover:underline">Pesanan Pembelian</Link>{" "}
            lalu klik <strong>Fakturkan</strong> pada pesanan yang dimaksud.
          </p>
        </div>
      </div>
    );
  }

  const [pemetaan, nomorBerikut] = await Promise.all([
    db.pemetaanAkun.findUnique({ where: { id: "default" }, include: { utangUsaha: true, persediaan: true } }),
    nomorDokumenBerikutnya(db.fakturPembelian, "FB"),
  ]);

  const hariIni = new Date();
  const tempo = new Date(hariIni.getTime() + 14 * 24 * 60 * 60 * 1000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const label = (a: { kode: string; nama: string }) => `${a.kode} • ${a.nama}`;

  return (
    <PenyusunFaktur
      mode="pembelian"
      aksi={buatFakturPembelianFormulir}
      tautanKembali="/pembelian/pesanan"
      tautanDaftar="/pembelian/faktur"
      nomorBerikut={nomorBerikut}
      tanggal={iso(hariIni)}
      jatuhTempo={iso(tempo)}
      pesanan={{ id: pesanan.id, nomor: pesanan.nomor, tanggal: pesanan.tanggal.toISOString(), status: pesanan.status }}
      rekanan={{ kode: pesanan.pemasok.kode, nama: pesanan.pemasok.nama }}
      daftarBaris={pesanan.baris.map((l) => ({
        id: l.id,
        barangId: l.barangId,
        kode: l.barang.kode,
        nama: l.barang.nama,
        satuan: l.barang.satuan,
        jumlahDipesan: Number(l.jumlah),
        sisa: Math.max(Number(l.jumlah) - Number(l.jumlahDifaktur), 0),
        harga: Number(l.harga),
        hargaBeli: Number(l.barang.hargaBeli),
      }))}
      dokumenSebelumnya={pesanan.penerimaanBarang.map((r) => ({ nomor: r.nomor, tanggal: r.tanggal.toISOString() }))}
      pemetaan={pemetaan ? { akunLawan: label(pemetaan.utangUsaha), pendapatanAtauPersediaan: label(pemetaan.persediaan) } : null}
    />
  );
}
