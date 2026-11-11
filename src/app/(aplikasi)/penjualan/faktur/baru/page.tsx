import { wajibHak } from "@/lib/otentikasi";
import Link from "next/link";
import { db } from "@/lib/db";
import { nomorDokumenBerikutnya } from "@/lib/penomoran";
import { ambilPengaturanPerusahaan, tanggalJatuhTempo } from "@/lib/pengaturanPerusahaan";
import { buatFakturFormulir } from "@/lib/aksi/penjualan";
import PenyusunFaktur from "@/komponen/PenyusunFaktur";
import { opsiMataUangDokumen } from "@/lib/mataUang";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import { tanggalIso } from "@/lib/waktu";
import { KOLOM_TEKS_FAKTUR, subtotalBaris } from "@/lib/dokumenPenjualan";
import { KUNCI_AKUN_FEE } from "@/lib/akuntansi";
import { akunPemetaanTambahan } from "@/lib/baganAkun";

/** Pendapatan diakui setelah acara (PSAK 72): event tanpa tanggal selesai dianggap boleh difaktur. */
function eventSudahSelesai(tanggalSelesai: Date | null) {
  return !tanggalSelesai || tanggalSelesai.getTime() <= Date.now();
}

export default async function HalamanFakturPenjualanBaru({ searchParams }: { searchParams: Promise<{ pesananId?: string }> }) {
  await wajibHak("faktur.buat");
  const { pesananId } = await searchParams;

  const pesanan = pesananId
    ? await db.pesananPenjualan.findUnique({
        where: { id: pesananId },
        include: {
          pelanggan: true,
          baris: { include: { barang: true }, orderBy: [{ urutan: "asc" }, { id: "asc" }] },
          pengiriman: { orderBy: { tanggal: "asc" } },
          uangMuka: true,
          proyek: { select: { kode: true, nama: true, tanggalSelesai: true } },
          faktur: { select: { fee: true, diskon: true } },
          rencanaTermin: { select: { id: true } },
        },
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
      include: { piutangUsaha: true, pendapatanPenjualan: true, hpp: true, persediaan: true, barangTerkirim: true, uangMukaPelanggan: true, diskonPenjualan: true },
    }),
    nomorDokumenBerikutnya(db.fakturPenjualan, "FJ"),
  ]);

  // dokumen anak (D1 §8.4): pajak, termin, kop, dan nomor cetak dari perusahaan pesanan
  const perusahaanId = pesanan.perusahaanId;
  const [pengaturan, daftarKop, pengaturanDokumen, formatNomor, akunFee] = await Promise.all([
    ambilPengaturanPerusahaan(db, perusahaanId),
    db.kopSurat.findMany({ where: { perusahaanId, dihapusPada: null }, orderBy: [{ bawaan: "desc" }, { nama: "asc" }], select: { id: true, nama: true, bawaan: true } }),
    db.pengaturanDokumenPenjualan.findUnique({ where: { perusahaanId }, select: { syaratPembayaran: true } }),
    db.formatNomor.findUnique({ where: { perusahaanId_jenis: { perusahaanId, jenis: "faktur" } }, select: { aktif: true } }),
    akunPemetaanTambahan(db, KUNCI_AKUN_FEE),
  ]);
  const akunPpn = pengaturan.akunPpnKeluaranId ? await db.akun.findUnique({ where: { id: pengaturan.akunPpnKeluaranId } }) : null;
  const opsiMataUang = await opsiMataUangDokumen(db);
  const hariIni = new Date();
  const tempo = tanggalJatuhTempo(pengaturan.terminHari, hariIni);
  // tanggal kalender lokal (B-11): toISOString memberi tanggal UTC yang salah antara 00.00 dan 07.00 WIB
  const iso = (d: Date) => tanggalIso(d);
  // teks surat warisan pesanan; syarat pembayaran kosong memakai bawaan perusahaan (sama dengan bacaTeksDokumen server)
  const teksWarisan: Record<string, string | null> = { kopSuratId: pesanan.kopSuratId };
  for (const k of KOLOM_TEKS_FAKTUR) teksWarisan[k] = k === "judulCetak" ? null : pesanan[k];
  teksWarisan.syaratPembayaran = pesanan.syaratPembayaran?.trim() ? pesanan.syaratPembayaran : (pengaturanDokumen?.syaratPembayaran ?? null);
  const label = (a: { kode: string; nama: string }) => `${a.kode} • ${a.nama}`;
  // PPN awal komposer = PPN pesanan (D2 §3.9) bila pesanan bertermin (termin bruto dan batas uang muka dihitung dengan
  // PPN itu) atau PPN-nya bukan 0. Pesanan lama tanpa termin bernilai 0 bawaan migrasi, jadi tetap mulai dari tarif
  // perusahaan seperti semula.
  const ppnAwalPesanan = pesanan.rencanaTermin.length > 0 || Number(pesanan.ppnPersen) > 0 ? Number(pesanan.ppnPersen) : undefined;

  return (
    <PenyusunFaktur
      event={
        pesanan.proyek
          ? {
              kode: pesanan.proyek.kode,
              nama: pesanan.proyek.nama,
              tanggalSelesai: pesanan.proyek.tanggalSelesai ? pesanan.proyek.tanggalSelesai.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : null,
              selesai: eventSudahSelesai(pesanan.proyek.tanggalSelesai),
            }
          : null
      }
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
        nama: l.nama ?? l.barang.nama,
        satuan: l.satuan ?? l.barang.satuan,
        jumlahDipesan: Number(l.jumlah),
        sisa: Math.max(Number(l.jumlah) - Number(l.jumlahDifaktur), 0),
        harga: Number(l.harga),
        hargaBeli: Number(l.barang.hargaBeli),
        frekuensi: Number(l.frekuensi),
        satuanFrekuensi: l.satuanFrekuensi,
        bagian: l.bagian,
        deskripsi: l.deskripsi,
      }))}
      penjualan={{
        mode: pesanan.mode,
        diskon: { jenis: pesanan.jenisDiskon, nilai: Number(pesanan.nilaiDiskon), diskonPesanan: Number(pesanan.diskon), diskonLain: pesanan.faktur.reduce((t, f) => t + Number(f.diskon), 0) },
        fee: { jenis: pesanan.jenisFee, nilai: Number(pesanan.nilaiFee), feePesanan: Number(pesanan.fee), feeLain: pesanan.faktur.reduce((t, f) => t + Number(f.fee), 0) },
        subtotalPesanan: Number(subtotalBaris(pesanan.baris)),
        akunFee: akunFee ? label(akunFee) : null,
        teks: { nilai: teksWarisan, daftarKop },
        nomorOtomatis: !!formatNomor?.aktif,
        ppnAwal: ppnAwalPesanan,
      }}
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
              diskon: pemetaan.diskonPenjualan ? label(pemetaan.diskonPenjualan) : undefined,
            }
          : null
      }
      pajak={{ pkp: pengaturan.pkp, tarif: Number(pengaturan.tarifPpnPersen) }}
      terminHari={pengaturan.terminHari}
      mataUang={{ daftar: opsiMataUang, bawaanId: pesanan.pelanggan.mataUangId }}
      uangMukaTersedia={pesanan.uangMuka.reduce((s, u) => s + Number(u.jumlah) - Number(u.jumlahDipakai), 0)}
    />
  );
}
