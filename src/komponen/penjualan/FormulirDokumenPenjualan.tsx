import Link from "next/link";
import type { ReactNode } from "react";
import { db } from "@/lib/db";
import type { StatusFormulir } from "@/lib/statusFormulir";
import { PERINGATAN_TANPA_EVENT } from "@/lib/verifikasi";
import { daftarProyekAktif } from "@/lib/proyek";
import { KODE_BARANG_LAIN } from "@/lib/barangLainLain";
import { ambilPengaturanPerusahaan } from "@/lib/pengaturanPerusahaan";
import { saringMilikAtauBersama, type RingkasPerusahaan } from "@/lib/perusahaan";
import { SEKSI_BAWAAN, TEKS_PEMBUKA_BAWAAN, TEKS_PENUTUP_BAWAAN } from "@/lib/dokumenPenjualan";
import { tanggalIso } from "@/lib/waktu";
import FormulirAksi from "@/komponen/FormulirAksi";
import LencanaPerusahaan from "@/komponen/ui/LencanaPerusahaan";
import PenyusunDokumenPenjualan, { type NilaiAwalPenyusun } from "@/komponen/penjualan/PenyusunDokumenPenjualan";
import IsianTeksDokumen, { type KopPilihan, type NilaiTeksDokumen } from "@/komponen/penjualan/IsianTeksDokumen";
import type { OpsiBarangPenjualan } from "@/komponen/penjualan/EditorBarisPenjualan";

/*
 * Formulir penawaran dan pesanan penjualan (D2 §7.2) untuk satu perusahaan penerbit. Pilihan barang, proyek, kop,
 * seksi, pajak, dan bawaan teks dimuat untuk perusahaan itu (muatOpsiDokumenPenjualan); server tetap memvalidasi.
 * Isian perusahaan mengikuti pola formulir akar halaman lama (KONTRAK-TAMBAHAN): lingkup utama hanya isian
 * tersembunyi, lingkup perusahaan lain bidang baca saja, gabungan bidang baca saja dengan tautan ganti perusahaan.
 */

export type OpsiDokumenPenjualan = Awaited<ReturnType<typeof muatOpsiDokumenPenjualan>>;

/** Pilihan formulir untuk perusahaan dokumen. Barang JASA-LAIN tidak ditawarkan (baris bebas memakai barangId kosong). */
export async function muatOpsiDokumenPenjualan(perusahaanId: string, jenis: "penawaran" | "pesanan") {
  const [daftarPelanggan, barang, daftarProyek, kop, pengaturanDokumen, pengaturan, formatNomor] = await Promise.all([
    db.pelanggan.findMany({ orderBy: { nama: "asc" } }),
    db.barang.findMany({ where: { kode: { not: KODE_BARANG_LAIN }, ...saringMilikAtauBersama(perusahaanId) }, orderBy: { nama: "asc" } }),
    daftarProyekAktif(db, perusahaanId),
    db.kopSurat.findMany({ where: { perusahaanId, dihapusPada: null }, orderBy: [{ bawaan: "desc" }, { nama: "asc" }], select: { id: true, nama: true, bawaan: true } }),
    db.pengaturanDokumenPenjualan.findUnique({ where: { perusahaanId } }),
    ambilPengaturanPerusahaan(db, perusahaanId),
    jenis === "penawaran" ? db.formatNomor.findUnique({ where: { perusahaanId_jenis: { perusahaanId, jenis: "penawaran" } }, select: { aktif: true } }) : null,
  ]);
  const daftarBarang: OpsiBarangPenjualan[] = barang.map((i) => ({
    id: i.id,
    kode: i.kode,
    nama: i.nama,
    satuan: i.satuan,
    deskripsi: i.deskripsi,
    hargaBawaan: Number(i.hargaJual),
    hargaMinimum: Number(i.hargaMinimum),
  }));
  return {
    daftarPelanggan: daftarPelanggan.map((c) => ({ id: c.id, kode: c.kode, nama: c.nama })),
    daftarProyek: daftarProyek.map((p) => ({ id: p.id, kode: p.kode, nama: p.nama })),
    daftarBarang,
    daftarKop: kop satisfies KopPilihan[],
    daftarSeksi: pengaturanDokumen?.daftarSeksi.length ? pengaturanDokumen.daftarSeksi : [...SEKSI_BAWAAN],
    tampilanEvent: pengaturanDokumen?.tampilanEvent ?? "RINCI",
    teksAwal: {
      syaratPembayaran: pengaturanDokumen?.syaratPembayaran ?? null,
      ...(jenis === "penawaran"
        ? { teksPembuka: pengaturanDokumen?.teksPembukaPenawaran ?? TEKS_PEMBUKA_BAWAAN, teksPenutup: pengaturanDokumen?.teksPenutupPenawaran ?? TEKS_PENUTUP_BAWAAN }
        : {}),
    } as NilaiTeksDokumen,
    pajak: { pkp: pengaturan.pkp, tarif: Number(pengaturan.tarifPpnPersen) },
    nomorOtomatis: !!formatNomor?.aktif,
  };
}

/** Bidang perusahaan dokumen: tersembunyi (lingkup utama), atau baca saja dengan petunjuk atau tautan ganti. */
function BidangPerusahaan({ perusahaan, tampil }: { perusahaan: RingkasPerusahaan; tampil: TampilPerusahaan }) {
  if (tampil === "tersembunyi") return <input type="hidden" name="perusahaanId" value={perusahaan.id} />;
  return (
    <>
      <div className="bidang">
        <input type="hidden" name="perusahaanId" value={perusahaan.id} />
        <span className="label">Perusahaan</span>
        <div className="isian flex items-center gap-2 bg-slate-50 text-slate-700" aria-readonly="true">
          <LencanaPerusahaan kode={perusahaan.kode} warna={perusahaan.warna} />
          <span className="truncate">{perusahaan.nama}</span>
        </div>
        {tampil === "bacaSaja" ? (
          <span className="petunjuk">Ganti lewat pemilih perusahaan di bilah samping</span>
        ) : tampil === "tetap" ? (
          <span className="petunjuk">Perusahaan dokumen tidak bisa diganti</span>
        ) : tampil.gantiHref ? (
          <Link href={tampil.gantiHref} className="petunjuk text-blue-600 hover:underline">
            Ganti perusahaan penerbit
          </Link>
        ) : (
          <span className="petunjuk">Mengikuti perusahaan lead</span>
        )}
      </div>
      <div className="hidden md:block" />
    </>
  );
}

/** "tetap" = halaman ubah: baca saja, perusahaan dokumen yang sudah tersimpan tidak bisa diganti. */
export type TampilPerusahaan = "tersembunyi" | "bacaSaja" | "tetap" | { gantiHref: string | null };

export default function FormulirDokumenPenjualan({
  jenis,
  aksi,
  perusahaan,
  tampilPerusahaan,
  opsi,
  bolehNego,
  bolehBawahMinimum,
  lead = null,
  nilaiAwal = {},
  labelSimpan,
  tombolLain,
  pesanSukses,
  alihkanKe,
  petunjukNomor,
}: {
  jenis: "penawaran" | "pesanan";
  aksi: (sebelumnya: StatusFormulir, dataFormulir: FormData) => Promise<StatusFormulir>;
  perusahaan: RingkasPerusahaan;
  tampilPerusahaan: TampilPerusahaan;
  opsi: OpsiDokumenPenjualan;
  bolehNego: boolean;
  bolehBawahMinimum: boolean;
  /**
   * prapengisian dari lead CRM (D4 §8 no. 16). `href` diisi halaman hanya bila pengguna berhak melihat lead dan lead itu
   * ada di lingkupnya; tanpa itu nama lead tampil sebagai teks biasa.
   */
  lead?: { id: string; nama: string; namaUsaha: string | null; pelangganId: string; href?: string | null } | null;
  nilaiAwal?: { pelangganId?: string; proyekId?: string | null; berlakuSampai?: string | null; teks?: NilaiTeksDokumen; penyusun?: NilaiAwalPenyusun };
  labelSimpan?: string;
  /** tombol tambahan sesudah tombol simpan (mis. "Simpan & Buat Faktur") */
  tombolLain?: ReactNode;
  /** pesan sukses dan tujuan sesudah berhasil untuk aksi yang tidak mengalihkan sendiri (halaman ubah) */
  pesanSukses?: string;
  alihkanKe?: string;
  /** petunjuk isian nomor cetak khusus (halaman ubah: isian kosong tidak mengubah nomor) */
  petunjukNomor?: string;
}) {
  const pelangganAwal = lead?.pelangganId ?? nilaiAwal.pelangganId;
  const penawaran = jenis === "penawaran";
  return (
    <FormulirAksi
      aksi={aksi}
      verifikasi={{ judul: penawaran ? "Periksa penawaran" : "Periksa pesanan penjualan", peringatan: [PERINGATAN_TANPA_EVENT] }}
      pesanSukses={pesanSukses}
      alihkanKe={alihkanKe}
      className="kartu grid grid-cols-1 md:grid-cols-2 gap-4"
    >
      <BidangPerusahaan perusahaan={perusahaan} tampil={tampilPerusahaan} />
      {lead && (
        <div className="md:col-span-2 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
          Dari lead{" "}
          {lead.href ? (
            <Link href={lead.href} target="_blank" rel="noopener noreferrer" className="font-medium underline underline-offset-2">
              {lead.nama}
            </Link>
          ) : (
            lead.nama
          )}
          {lead.namaUsaha ? ` · ${lead.namaUsaha}` : ""}
        </div>
      )}
      <div className="bidang">
        <label className="label" htmlFor="pelangganId">Pelanggan *</label>
        <select id="pelangganId" name="pelangganId" required className="isian" defaultValue={pelangganAwal}>
          <option value="">-</option>
          {opsi.daftarPelanggan.map((c) => (
            <option key={c.id} value={c.id}>
              {c.kode} - {c.nama}
            </option>
          ))}
        </select>
      </div>
      <div className="bidang">
        <label className="label" htmlFor="proyekId">Proyek / Event</label>
        <select id="proyekId" name="proyekId" className="isian" defaultValue={nilaiAwal.proyekId ?? ""}>
          <option value="">Tanpa event</option>
          {opsi.daftarProyek.map((p) => (
            <option key={p.id} value={p.id}>
              {p.kode} - {p.nama}
            </option>
          ))}
        </select>
        <span className="petunjuk">Dipakai untuk Laba Rugi per event dan LPJ. Ikut ke semua dokumen turunannya.</span>
      </div>

      {penawaran ? (
        <div className="bidang">
          <label className="label" htmlFor="berlakuSampai">Berlaku sampai</label>
          {/* min hanya untuk formulir tanpa nilai awal: tanggal tersimpan yang sudah lewat tetap boleh disimpan ulang (ubahPenawaran) */}
          <input id="berlakuSampai" name="berlakuSampai" type="date" min={nilaiAwal.berlakuSampai ? undefined : tanggalIso(new Date())} defaultValue={nilaiAwal.berlakuSampai ?? ""} className="isian" />
        </div>
      ) : (
        <div />
      )}
      {penawaran && <div className="hidden md:block" />}

      <PenyusunDokumenPenjualan
        jenis={jenis}
        daftarBarang={opsi.daftarBarang}
        daftarSeksi={opsi.daftarSeksi}
        bolehNego={bolehNego}
        bolehBawahMinimum={bolehBawahMinimum}
        pajak={opsi.pajak}
        tampilanEventBawaan={opsi.tampilanEvent}
        nilaiAwal={nilaiAwal.penyusun}
      />

      <details className="md:col-span-2 ubin">
        <summary className="cursor-pointer font-semibold text-sm">Detail surat &amp; cetak</summary>
        <div className="mt-3">
          <IsianTeksDokumen jenis={jenis} nilai={{ ...opsi.teksAwal, ...nilaiAwal.teks }} daftarKop={opsi.daftarKop} nomorOtomatis={opsi.nomorOtomatis} petunjukNomor={petunjukNomor} />
        </div>
      </details>

      {lead && <input type="hidden" name="leadId" value={lead.id} />}
      <div className="md:col-span-2 flex flex-wrap items-center gap-2">
        <button type="submit" className="tombol tombol-utama">
          {labelSimpan ?? (penawaran ? "Simpan Penawaran" : "Simpan Pesanan")}
        </button>
        {tombolLain}
      </div>
    </FormulirAksi>
  );
}

/** Kartu pilih perusahaan penerbit untuk lingkup gabungan (D2 §7.1). */
export function PilihPerusahaanPenerbit({ daftar, href }: { daftar: RingkasPerusahaan[]; href: (id: string) => string }) {
  const aktif = daftar.filter((p) => p.aktif);
  return (
    <div className="kartu space-y-3 max-w-xl">
      <h2 className="judul-kartu">Pilih perusahaan penerbit</h2>
      <p className="redup text-sm">Barang, proyek, kop surat, pajak, dan nomor cetak mengikuti perusahaan yang dipilih.</p>
      <ul className="space-y-2">
        {aktif.map((p) => (
          <li key={p.id}>
            <Link href={href(p.id)} className="flex items-center gap-2 rounded border border-slate-200 px-3 py-2 hover:bg-slate-50">
              <LencanaPerusahaan kode={p.kode} warna={p.warna} />
              <span>{p.nama}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
