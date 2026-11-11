import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { punyaHak, PERAN_TERTINGGI } from "@/lib/hakAkses";
import { tanggalIso } from "@/lib/waktu";
import { KODE_BARANG_LAIN, PILIHAN_BEBAS } from "@/lib/barangLainLain";
import { KOLOM_TEKS_PENAWARAN } from "@/lib/dokumenPenjualan";
import { ubahPenawaranFormulir } from "@/lib/aksi/dokumenPenjualan";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import FormulirDokumenPenjualan, { muatOpsiDokumenPenjualan } from "@/komponen/penjualan/FormulirDokumenPenjualan";
import type { NilaiTeksDokumen } from "@/komponen/penjualan/IsianTeksDokumen";
import type { NilaiAwalPenyusun } from "@/komponen/penjualan/PenyusunDokumenPenjualan";
import { nomorTampil } from "../../../_detail/bagian";

/**
 * Ubah penawaran draf (D2 §7.1): FormulirDokumenPenjualan terisi nilai tersimpan dengan ubahPenawaranFormulir. Formulir
 * selalu mengirim seluruh isian (kontrak P25), jadi baris, rencana termin, dan teks diganti seluruhnya. Penawaran yang
 * sudah dikonversi hanya mendapat kartu info dan tautan ke Ubah tampilan.
 */
export default async function HalamanUbahPenawaran({ params }: { params: Promise<{ id: string }> }) {
  const pengguna = await wajibHak("penawaran.ubah");
  const { id } = await params;
  const p = await db.penawaranPenjualan.findUnique({
    where: { id },
    include: {
      perusahaan: { select: { id: true, kode: true, nama: true, warna: true, aktif: true, urutan: true } },
      proyek: { select: { id: true, kode: true, nama: true } },
      baris: { orderBy: [{ urutan: "asc" }, { id: "asc" }], include: { barang: true } },
      rencanaTermin: { orderBy: { no: "asc" } },
    },
  });
  if (!p) notFound();

  const tampil = nomorTampil(p);
  const jejak = [{ label: "Penjualan" }, { label: "Penawaran", href: "/penjualan/penawaran" }, { label: tampil, href: `/penjualan/penawaran/${p.id}` }, { label: "Ubah" }];

  if (p.status !== "DRAF" || !p.perusahaan.aktif) {
    return (
      <div className="space-y-6 max-w-3xl">
        <KepalaHalaman jejak={jejak} judul={`Ubah Penawaran ${tampil}`} />
        <div className="kartu space-y-3">
          <p className="text-sm text-slate-700">
            {p.status !== "DRAF"
              ? "Penawaran ini sudah dikonversi menjadi pesanan, jadi isi dan nilainya tidak bisa diubah lagi. Teks surat, nomor cetak, dan tampilan baris masih bisa diubah."
              : `Perusahaan ${p.perusahaan.nama} sudah diarsipkan, jadi penawarannya tidak bisa diubah. Teks surat dan tampilan masih bisa diubah.`}
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href={`/penjualan/penawaran/${p.id}/tampilan`} className="tombol tombol-utama">
              Ubah tampilan
            </Link>
            <Link href={`/penjualan/penawaran/${p.id}`} className="tombol tombol-garis">
              Kembali ke penawaran
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const opsi = await muatOpsiDokumenPenjualan(p.perusahaanId, "penawaran");
  // pilihan yang tersimpan tetapi tidak ada di daftar (proyek selesai atau arsip, barang yang sudah tidak ditawarkan)
  // tetap ditampilkan supaya tidak hilang diam-diam saat disimpan; server tetap memvalidasi kepemilikannya
  if (p.proyek && !opsi.daftarProyek.some((x) => x.id === p.proyek!.id)) opsi.daftarProyek.push({ id: p.proyek.id, kode: p.proyek.kode, nama: p.proyek.nama });
  for (const b of p.baris) {
    if (b.barang.kode === KODE_BARANG_LAIN || opsi.daftarBarang.some((x) => x.id === b.barangId)) continue;
    opsi.daftarBarang.push({
      id: b.barang.id,
      kode: b.barang.kode,
      nama: b.barang.nama,
      satuan: b.barang.satuan,
      deskripsi: b.barang.deskripsi,
      hargaBawaan: Number(b.barang.hargaJual),
      hargaMinimum: Number(b.barang.hargaMinimum),
    });
  }

  const event = p.mode === "EVENT";
  const teks: NilaiTeksDokumen = { judulCetak: p.judulCetak, nomorCetak: p.nomorCetak, kopSuratId: p.kopSuratId };
  for (const k of KOLOM_TEKS_PENAWARAN) teks[k] = p[k];
  const terakhir = p.rencanaTermin.length - 1;
  const penyusun: NilaiAwalPenyusun = {
    mode: p.mode,
    tampilanEvent: p.tampilanEvent,
    namaEvent: p.namaEvent,
    venue: p.venue,
    tanggalEvent: p.tanggalEvent,
    baris: p.baris.map((b) => ({
      // baris JASA-LAIN = item bebas; kirimannya barangId kosong dan nama, sama seperti saat dibuat
      barangId: b.barang.kode === KODE_BARANG_LAIN ? PILIHAN_BEBAS : b.barangId,
      nama: b.nama ?? "",
      deskripsi: b.deskripsi ?? "",
      jumlah: b.jumlah.toString(),
      satuan: b.satuan ?? "",
      frekuensi: event ? b.frekuensi.toString() : "",
      satuanFrekuensi: b.satuanFrekuensi ?? "",
      harga: b.harga.toString(),
      bagian: b.bagian ?? "",
      keterangan: b.keterangan ?? "",
    })),
    jenisDiskon: p.jenisDiskon,
    nilaiDiskon: Number(p.nilaiDiskon) ? p.nilaiDiskon.toString() : "",
    jenisFee: p.jenisFee,
    nilaiFee: Number(p.nilaiFee) ? p.nilaiFee.toString() : "",
    ppnPersen: Number(p.ppnPersen),
    nilaiAddOn: p.nilaiAddOn?.toString() ?? "",
    keteranganAddOn: p.keteranganAddOn,
    rencanaTermin: p.rencanaTermin.map((b, i) => ({
      label: b.label,
      mode: b.mode,
      // butir terakhir selalu menutup sisa, nilainya tidak diisi
      nilai: i === terakhir ? "" : b.nilai.toString(),
      jatuhTempo: b.jatuhTempo ? tanggalIso(b.jatuhTempo) : "",
    })),
  };

  return (
    <div className="space-y-6 max-w-6xl">
      <KepalaHalaman
        jejak={jejak}
        judul={`Ubah Penawaran ${tampil}`}
        subjudul="Baris, termin, dan teks surat diganti seluruhnya dengan isi formulir ini."
        aksi={
          <Link href={`/penjualan/penawaran/${p.id}`} className="tombol tombol-garis">
            Kembali ke penawaran
          </Link>
        }
      />
      <FormulirDokumenPenjualan
        jenis="penawaran"
        aksi={ubahPenawaranFormulir.bind(null, p.id)}
        perusahaan={p.perusahaan}
        tampilPerusahaan="tetap"
        opsi={opsi}
        bolehNego={punyaHak(pengguna, "harga.nego")}
        bolehBawahMinimum={PERAN_TERTINGGI.includes(pengguna.peran)}
        nilaiAwal={{
          pelangganId: p.pelangganId,
          proyekId: p.proyekId,
          berlakuSampai: p.berlakuSampai ? tanggalIso(p.berlakuSampai) : null,
          teks,
          penyusun,
        }}
        labelSimpan="Simpan Perubahan"
        pesanSukses="Penawaran tersimpan. Membuka halaman penawaran…"
        alihkanKe={`/penjualan/penawaran/${p.id}`}
      />
    </div>
  );
}
