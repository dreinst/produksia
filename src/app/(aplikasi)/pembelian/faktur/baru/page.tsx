import { wajibHak } from "@/lib/otentikasi";
import Link from "next/link";
import { db } from "@/lib/db";
import { nomorDokumenBerikutnya } from "@/lib/penomoran";
import { ambilPengaturanPerusahaan, tanggalJatuhTempo } from "@/lib/pengaturanPerusahaan";
import { buatFakturPembelianFormulir } from "@/lib/aksi/pembelian";
import PenyusunFaktur from "@/komponen/PenyusunFaktur";
import { opsiMataUangDokumen } from "@/lib/mataUang";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import LencanaPerusahaan from "@/komponen/ui/LencanaPerusahaan";
import { lingkupPerusahaan } from "@/lib/perusahaan";

export default async function HalamanFakturPembelianBaru({ searchParams }: { searchParams: Promise<{ pesananId?: string }> }) {
  await wajibHak("faktur-pembelian.buat");
  const { pesananId } = await searchParams;

  const pesanan = pesananId
    ? await db.pesananPembelian.findUnique({
        where: { id: pesananId },
        include: { pemasok: true, baris: { include: { barang: true } }, penerimaanBarang: { orderBy: { tanggal: "asc" } }, perusahaan: { select: { kode: true, nama: true, warna: true } } },
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

  const [lingkup, pemetaan, nomorBerikut] = await Promise.all([
    lingkupPerusahaan(),
    db.pemetaanAkun.findUnique({ where: { id: "default" }, include: { utangUsaha: true, persediaan: true } }),
    nomorDokumenBerikutnya(db.fakturPembelian, "FB"),
  ]);

  // PPN, termin, dan akun pajak dari perusahaan pesanan, sama dengan yang dipakai aksi (D1 §7.4 butir 3, P13)
  const pengaturan = await ambilPengaturanPerusahaan(db, pesanan.perusahaanId);
  const [akunPpn, akunBelumDitagih] = await Promise.all([
    pengaturan.akunPpnMasukanId ? db.akun.findUnique({ where: { id: pengaturan.akunPpnMasukanId } }) : null,
    pemetaan?.barangBelumDitagihId ? db.akun.findUnique({ where: { id: pemetaan.barangBelumDitagihId } }) : null,
  ]);
  const opsiMataUang = await opsiMataUangDokumen(db);
  const hariIni = new Date();
  const tempo = tanggalJatuhTempo(pengaturan.terminHari, hariIni);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const label = (a: { kode: string; nama: string }) => `${a.kode} • ${a.nama}`;

  const penyusun = (
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
      pemetaan={
        pemetaan
          ? {
              akunLawan: label(pemetaan.utangUsaha),
              pendapatanAtauPersediaan: label(akunBelumDitagih ?? pemetaan.persediaan),
              ppn: akunPpn ? label(akunPpn) : undefined,
            }
          : null
      }
      pajak={{ pkp: pengaturan.pkp, tarif: Number(pengaturan.tarifPpnPersen) }}
      terminHari={pengaturan.terminHari}
      mataUang={{ daftar: opsiMataUang, bawaanId: pesanan.pemasok.mataUangId }}
    />
  );
  // Perusahaan pesanan ditampilkan bila berbeda dari lingkup (mis. gabungan), karena PPN, termin, dan akun pajak di
  // formulir ini milik perusahaan itu (tinjauan P16 R4). PenyusunFaktur milik P26, jadi keterangannya di luar komponen.
  if (lingkup.perusahaanId === pesanan.perusahaanId) return penyusun;
  return (
    <div className="space-y-4">
      <p className="redup">
        Pesanan {pesanan.nomor} milik perusahaan <LencanaPerusahaan kode={pesanan.perusahaan.kode} warna={pesanan.perusahaan.warna} nama={pesanan.perusahaan.nama} />. PPN, termin, dan akun pajak memakai pengaturan perusahaan ini.
      </p>
      {penyusun}
    </div>
  );
}
