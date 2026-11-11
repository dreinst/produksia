import type { ReactNode } from "react";
import Link from "next/link";
import { db } from "@/lib/db";
import { SEKSI_BAWAAN, type JenisDokumenPenjualan } from "@/lib/dokumenPenjualan";
import { KODE_BARANG_LAIN } from "@/lib/barangLainLain";
import { ubahTampilanDokumenFormulir } from "@/lib/aksi/dokumenPenjualan";
import FormulirAksi from "@/komponen/FormulirAksi";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import IsianTeksDokumen, { type KopPilihan, type NilaiTeksDokumen } from "@/komponen/penjualan/IsianTeksDokumen";
import EditorTeksBaris, { type BarisTeksAwal } from "@/komponen/penjualan/EditorTeksBaris";

/*
 * Potongan bersama halaman Ubah tampilan dokumen penjualan (P28, D2 §7.1). Folder berawalan garis bawah tidak menjadi
 * rute. Semua formulir memakai ubahTampilanDokumenFormulir: hanya kolom daftar putih KOLOM_TAMPILAN yang ditulis,
 * jadi nilai uang tidak pernah berubah lewat halaman ini.
 */

export const LABEL_JENIS_TAMPILAN: Record<JenisDokumenPenjualan, { daftar: string; href: string }> = {
  penawaran: { daftar: "Penawaran", href: "/penjualan/penawaran" },
  pesanan: { daftar: "Pesanan", href: "/penjualan/pesanan" },
  faktur: { daftar: "Faktur", href: "/penjualan/faktur" },
  penerimaan: { daftar: "Penerimaan", href: "/penjualan/penerimaan" },
  uangMuka: { daftar: "Uang Muka", href: "/penjualan/uang-muka" },
};

/** Kepala halaman tampilan dengan jejak ke daftar dan detail dokumen. */
export function KepalaTampilan({ jenis, id, tampil }: { jenis: JenisDokumenPenjualan; id: string; tampil: string }) {
  const j = LABEL_JENIS_TAMPILAN[jenis];
  return (
    <KepalaHalaman
      jejak={[{ label: "Penjualan" }, { label: j.daftar, href: j.href }, { label: tampil, href: `${j.href}/${id}` }, { label: "Ubah tampilan" }]}
      judul={`Ubah Tampilan ${tampil}`}
      subjudul="Teks surat, kop, nomor cetak, dan tampilan baris. Nilai uang dan barang tidak berubah di sini."
      aksi={
        <Link href={`${j.href}/${id}`} className="tombol tombol-garis">
          Kembali ke dokumen
        </Link>
      }
    />
  );
}

/** Kop surat (belum dihapus, bawaan dulu) dan daftar seksi perusahaan dokumen. */
export async function muatOpsiTampilan(perusahaanId: string) {
  const [daftarKop, pengaturan] = await Promise.all([
    db.kopSurat.findMany({ where: { perusahaanId, dihapusPada: null }, orderBy: [{ bawaan: "desc" }, { nama: "asc" }], select: { id: true, nama: true, bawaan: true } }),
    db.pengaturanDokumenPenjualan.findUnique({ where: { perusahaanId }, select: { daftarSeksi: true } }),
  ]);
  return { daftarKop: daftarKop satisfies KopPilihan[], daftarSeksi: pengaturan?.daftarSeksi.length ? pengaturan.daftarSeksi : [...SEKSI_BAWAAN] };
}

type BarisPrisma = {
  id: string;
  nama: string | null;
  deskripsi: string | null;
  satuan: string | null;
  keterangan: string | null;
  bagian: string | null;
  barang: { kode: string; nama: string; satuan: string };
};

/** Baris dokumen menjadi nilai awal EditorTeksBaris. Baris JASA-LAIN tidak menampilkan kode sistemnya. */
export function barisTeksAwal(baris: readonly BarisPrisma[]): BarisTeksAwal[] {
  return baris.map((b) => ({
    id: b.id,
    label: b.barang.kode === KODE_BARANG_LAIN ? "Item bebas" : `${b.barang.kode} - ${b.barang.nama}`,
    namaKatalog: b.barang.nama,
    satuanKatalog: b.barang.satuan,
    nama: b.nama ?? "",
    deskripsi: b.deskripsi ?? "",
    satuan: b.satuan ?? "",
    keterangan: b.keterangan ?? "",
    bagian: b.bagian ?? "",
  }));
}

/** Isian event (namaEvent, venue, tanggalEvent, tampilanEvent) untuk dokumen bermode event. */
export function IsianEvent({ nilai }: { nilai: { tampilanEvent: string; namaEvent: string | null; venue: string | null; tanggalEvent: string | null } }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="bidang">
        <label className="label" htmlFor="tampilanEvent">
          Tampilan cetak event
        </label>
        <select id="tampilanEvent" name="tampilanEvent" defaultValue={nilai.tampilanEvent} className="isian">
          <option value="RINCI">Rinci: satu halaman</option>
          <option value="RINGKAS">Ringkas: ringkasan + lampiran RAB</option>
        </select>
      </div>
      <div className="bidang">
        <label className="label" htmlFor="namaEvent">
          Nama event
        </label>
        <input id="namaEvent" name="namaEvent" maxLength={160} defaultValue={nilai.namaEvent ?? ""} className="isian" />
      </div>
      <div className="bidang">
        <label className="label" htmlFor="venue">
          Venue
        </label>
        <input id="venue" name="venue" maxLength={160} defaultValue={nilai.venue ?? ""} className="isian" />
      </div>
      <div className="bidang">
        <label className="label" htmlFor="tanggalEvent">
          Tanggal event (teks)
        </label>
        <input id="tanggalEvent" name="tanggalEvent" maxLength={80} defaultValue={nilai.tanggalEvent ?? ""} placeholder="mis. 12 - 14 Desember 2026" className="isian" />
        <span className="petunjuk">Kosong = rentang tanggal proyek</span>
      </div>
    </div>
  );
}

/**
 * Formulir tampilan penawaran, pesanan, dan faktur: isian khusus jenis (`tambahan`), isian event bila mode event,
 * teks surat (`IsianTeksDokumen`), dan teks baris (`EditorTeksBaris`). Nomor cetak kosong berarti nomor internal,
 * karena ubah tampilan tidak mengalokasikan nomor otomatis.
 */
export function FormulirTampilanSurat({
  jenis,
  id,
  teks,
  event,
  baris,
  opsi,
  bolehNego,
  tambahan,
  catatanNomor,
}: {
  jenis: "penawaran" | "pesanan" | "faktur";
  id: string;
  teks: NilaiTeksDokumen;
  event: { tampilanEvent: string; namaEvent: string | null; venue: string | null; tanggalEvent: string | null } | null;
  baris: BarisTeksAwal[];
  opsi: { daftarKop: KopPilihan[]; daftarSeksi: string[] };
  bolehNego: boolean;
  tambahan?: ReactNode;
  catatanNomor?: string;
}) {
  return (
    <FormulirAksi aksi={ubahTampilanDokumenFormulir.bind(null, jenis, id)} pesanSukses="Tampilan tersimpan." className="space-y-6">
      {tambahan && (
        <section className="kartu space-y-4">
          <h2 className="judul-kartu">Informasi</h2>
          {tambahan}
        </section>
      )}
      {event && (
        <section className="kartu space-y-4">
          <h2 className="judul-kartu">Event</h2>
          <IsianEvent nilai={event} />
        </section>
      )}
      <section className="kartu space-y-4">
        <h2 className="judul-kartu">Detail surat &amp; cetak</h2>
        {catatanNomor && <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{catatanNomor}</p>}
        <IsianTeksDokumen jenis={jenis} nilai={teks} daftarKop={opsi.daftarKop} nomorOtomatis={false} />
      </section>
      <section className="kartu space-y-4">
        <h2 className="judul-kartu">Rincian</h2>
        <EditorTeksBaris baris={baris} event={!!event} bolehNego={bolehNego} daftarSeksi={opsi.daftarSeksi} />
      </section>
      <div>
        <button type="submit" className="tombol tombol-utama">
          Simpan tampilan
        </button>
      </div>
    </FormulirAksi>
  );
}
