import { wajibHak } from "@/lib/otentikasi";
import Link from "next/link";
import { db } from "@/lib/db";
import { nomorDokumenBerikutnya } from "@/lib/penomoran";
import { ambilPengaturanPerusahaan, tanggalJatuhTempo } from "@/lib/pengaturanPerusahaan";
import { buatFakturFormulir } from "@/lib/aksi/penjualan";
import PenyusunFaktur from "@/komponen/PenyusunFaktur";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";

export default async function HalamanFakturPenjualanBaru({ searchParams }: { searchParams: Promise<{ pesananId?: string }> }) {
  await wajibHak("penjualan.tulis");
  const { pesananId } = await searchParams;

  const pesanan = pesananId
    ? await db.pesananPenjualan.findUnique({
        where: { id: pesananId },
        include: { pelanggan: true, baris: { include: { barang: true } }, pengiriman: { orderBy: { tanggal: "asc" } }, uangMuka: true },
      })
    : null;

  if (!pesananId || !pesanan) {
    return (
      <div className="space-y-6">
        <KepalaHalaman jejak={[{ label: "Penjualan" }, { label: "Faktur Penjualan", href: "/penjualan/faktur" }, { label: "Buat Faktur" }]} judul="Faktur Penjualan Baru" />
        <div className="kartu max-w-xl">
          <p className="redup">
            Faktur dibuat dari pesanan yang sudah ada. Buka{" "}
            <Link href="/penjualan/pesanan" className="font-semibold text-blue-600 hover:underline">Pesanan Penjualan</Link>{" "}
            lalu klik <strong>Fakturkan</strong> pada pesanan yang dimaksud.
          </p>
        </div>
      </div>
    );
  }

  const [pemetaan, nomorBerikut] = await Promise.all([
    db.pemetaanAkun.findUnique({
      where: { id: "default" },
      include: { piutangUsaha: true, pendapatanPenjualan: true, hpp: true, persediaan: true, barangTerkirim: true, uangMukaPelanggan: true },
    }),
    nomorDokumenBerikutnya(db.fakturPenjualan, "FJ"),
  ]);

  const pengaturan = await ambilPengaturanPerusahaan(db);
  const akunPpn = pengaturan.akunPpnKeluaranId ? await db.akun.findUnique({ where: { id: pengaturan.akunPpnKeluaranId } }) : null;
  const hariIni = new Date();
  const tempo = tanggalJatuhTempo(pengaturan.terminHari, hariIni);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const label = (a: { kode: string; nama: string }) => `${a.kode} • ${a.nama}`;

  return (
    <PenyusunFaktur
      mode="penjualan"
      aksi={buatFakturFormulir}
      tautanKembali="/penjualan/pesanan"
      tautanDaftar="/penjualan/faktur"
      nomorBerikut={nomorBerikut}
      tanggal={iso(hariIni)}
      jatuhTempo={iso(tempo)}
      pesanan={{ id: pesanan.id, nomor: pesanan.nomor, tanggal: pesanan.tanggal.toISOString(), status: pesanan.status }}
      rekanan={{ kode: pesanan.pelanggan.kode, nama: pesanan.pelanggan.nama }}
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
      dokumenSebelumnya={pesanan.pengiriman.map((d) => ({ nomor: d.nomor, tanggal: d.tanggal.toISOString() }))}
      pemetaan={
        pemetaan
          ? {
              akunLawan: label(pemetaan.piutangUsaha),
              pendapatanAtauPersediaan: label(pemetaan.pendapatanPenjualan),
              hpp: label(pemetaan.hpp),
              persediaan: label(pemetaan.persediaan),
              ppn: akunPpn ? label(akunPpn) : undefined,
              barangTerkirim: pemetaan.barangTerkirim ? label(pemetaan.barangTerkirim) : undefined,
              uangMuka: pemetaan.uangMukaPelanggan ? label(pemetaan.uangMukaPelanggan) : undefined,
            }
          : null
      }
      pajak={{ pkp: pengaturan.pkp, tarif: Number(pengaturan.tarifPpnPersen) }}
      terminHari={pengaturan.terminHari}
      uangMukaTersedia={pesanan.uangMuka.reduce((s, u) => s + Number(u.jumlah) - Number(u.jumlahDipakai), 0)}
    />
  );
}
