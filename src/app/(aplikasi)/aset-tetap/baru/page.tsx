import { wajibHak } from "@/lib/otentikasi";
import { db } from "@/lib/db";
import FormulirAksi from "@/komponen/FormulirAksi";
import { buatAsetTetapFormulir } from "@/lib/aksi/asetTetap";
import KolomPerusahaan from "@/komponen/KolomPerusahaan";
import { PERUSAHAAN_UTAMA, daftarPerusahaan, lingkupPerusahaan, perusahaanFormulir, saringMilikAtauBersama } from "@/lib/perusahaan";

export default async function HalamanAsetTetapBaru() {
  await wajibHak("aset.buat");
  // Dokumen akar (D1 §7.4 butir 2, KONTRAK-TAMBAHAN P18): lingkup satu perusahaan = akun milik perusahaan itu atau
  // bersama; gabungan dan lingkup arsip = semua akun, yang berpemilik diberi akhiran kode. Server tetap memvalidasi.
  const lingkup = await lingkupPerusahaan();
  const p = perusahaanFormulir(lingkup);
  const [daftarAkun, semuaPerusahaan] = await Promise.all([
    // gabungan dan lingkup arsip: akun milik perusahaan arsip tidak ditawarkan, karena pasti ditolak server (tinjauan P18 R3)
    db.akun.findMany({ where: { kelompok: false, ...(p ? saringMilikAtauBersama(p) : { OR: [{ perusahaanId: null }, { perusahaan: { aktif: true } }] }) }, include: { perusahaan: { select: { kode: true } } }, orderBy: { kode: "asc" } }),
    daftarPerusahaan(),
  ]);
  const akhiran = (milik: { kode: string } | null) => (!p && milik ? ` · ${milik.kode}` : "");
  const hariIni = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="judul-halaman">Aset Tetap Baru</h1>

      <FormulirAksi aksi={buatAsetTetapFormulir} className="kartu grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* pola formulir akar halaman lama (KONTRAK-TAMBAHAN): utama hanya isian tersembunyi supaya tampilan peran lama
            tetap sama; lingkup lain bidang baca saja; gabungan dan lingkup arsip pilihan wajib */}
        {lingkup.perusahaanId === PERUSAHAAN_UTAMA && p ? (
          <input type="hidden" name="perusahaanId" value={p} />
        ) : (
          <>
            <KolomPerusahaan lingkup={lingkup} daftar={semuaPerusahaan} />
            <div className="hidden md:block" />
          </>
        )}
        <div className="bidang">
          <label className="label" htmlFor="kode">Kode *</label>
          <input id="kode" type="text" name="kode" required className="isian" />
        </div>

        <div className="bidang">
          <label className="label" htmlFor="nama">Nama Aset *</label>
          <input id="nama" type="text" name="nama" required className="isian" />
        </div>

        <div className="bidang">
          <label className="label" htmlFor="tanggalPerolehan">Tanggal Perolehan</label>
          <input id="tanggalPerolehan" type="date" name="tanggalPerolehan" defaultValue={hariIni} className="isian" />
        </div>

        <div className="bidang">
          <label className="label" htmlFor="hargaPerolehan">Harga Perolehan *</label>
          <input id="hargaPerolehan" type="number" name="hargaPerolehan" step="0.01" min={0} required className="isian" />
        </div>

        <div className="bidang">
          <label className="label" htmlFor="nilaiSisa">Nilai Sisa (Salvage)</label>
          <input id="nilaiSisa" type="number" name="nilaiSisa" step="0.01" min={0} defaultValue={0} className="isian" />
        </div>

        <div className="bidang">
          <label className="label" htmlFor="umurBulan">Umur Ekonomis (bulan) *</label>
          <input id="umurBulan" type="number" name="umurBulan" min={1} required className="isian" />
        </div>

        <div className="bidang">
          <label className="label" htmlFor="akunAsetId">Akun Aset (Aset Tetap) *</label>
          <select id="akunAsetId" name="akunAsetId" required className="isian">
            <option value="">-</option>
            {daftarAkun.filter((a) => a.jenis === "ASET").map((a) => (
              <option key={a.id} value={a.id}>{a.kode} - {a.nama}{akhiran(a.perusahaan)}</option>
            ))}
          </select>
        </div>

        <div className="bidang">
          <label className="label" htmlFor="akunBebanPenyusutanId">Akun Beban Penyusutan *</label>
          <select id="akunBebanPenyusutanId" name="akunBebanPenyusutanId" required className="isian">
            <option value="">-</option>
            {daftarAkun.filter((a) => a.jenis === "BEBAN").map((a) => (
              <option key={a.id} value={a.id}>{a.kode} - {a.nama}{akhiran(a.perusahaan)}</option>
            ))}
          </select>
        </div>

        <div className="bidang">
          <label className="label" htmlFor="akunAkumulasiPenyusutanId">Akun Akumulasi Penyusutan (kontra-aset) *</label>
          <select id="akunAkumulasiPenyusutanId" name="akunAkumulasiPenyusutanId" required className="isian">
            <option value="">-</option>
            {daftarAkun.filter((a) => a.jenis === "ASET").map((a) => (
              <option key={a.id} value={a.id}>{a.kode} - {a.nama}{akhiran(a.perusahaan)}</option>
            ))}
          </select>
        </div>

        <div className="bidang">
          <label className="label" htmlFor="akunPembayaranId">Dibayar dari (Kas/Bank atau Hutang)</label>
          <select id="akunPembayaranId" name="akunPembayaranId" className="isian" defaultValue="">
            <option value="">Tidak dijurnal (aset sudah tercatat)</option>
            {daftarAkun.filter((a) => a.kasBank || a.jenis === "KEWAJIBAN").map((a) => (
              <option key={a.id} value={a.id}>{a.kode} - {a.nama}{akhiran(a.perusahaan)}</option>
            ))}
          </select>
          <span className="petunjuk">Bila dipilih, sistem menjurnal Dr Akun Aset / Cr akun ini sebesar harga perolehan</span>
        </div>

        <div className="md:col-span-2">
          <button type="submit" className="tombol tombol-utama">
            Simpan Aset
          </button>
        </div>
      </FormulirAksi>
    </div>
  );
}
