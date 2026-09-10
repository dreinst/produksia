import { wajibHak } from "@/lib/otentikasi";
import { db } from "@/lib/db";
import FormulirAksi from "@/komponen/FormulirAksi";
import { buatAsetTetapFormulir } from "@/lib/aksi/asetTetap";

export default async function HalamanAsetTetapBaru() {
  await wajibHak("aset.buat");
  const daftarAkun = await db.akun.findMany({ where: { kelompok: false }, orderBy: { kode: "asc" } });
  const hariIni = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="judul-halaman">Aset Tetap Baru</h1>

      <FormulirAksi aksi={buatAsetTetapFormulir} className="kartu grid grid-cols-1 md:grid-cols-2 gap-4">
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
              <option key={a.id} value={a.id}>{a.kode} - {a.nama}</option>
            ))}
          </select>
        </div>

        <div className="bidang">
          <label className="label" htmlFor="akunBebanPenyusutanId">Akun Beban Penyusutan *</label>
          <select id="akunBebanPenyusutanId" name="akunBebanPenyusutanId" required className="isian">
            <option value="">-</option>
            {daftarAkun.filter((a) => a.jenis === "BEBAN").map((a) => (
              <option key={a.id} value={a.id}>{a.kode} - {a.nama}</option>
            ))}
          </select>
        </div>

        <div className="bidang">
          <label className="label" htmlFor="akunAkumulasiPenyusutanId">Akun Akumulasi Penyusutan (kontra-aset) *</label>
          <select id="akunAkumulasiPenyusutanId" name="akunAkumulasiPenyusutanId" required className="isian">
            <option value="">-</option>
            {daftarAkun.filter((a) => a.jenis === "ASET").map((a) => (
              <option key={a.id} value={a.id}>{a.kode} - {a.nama}</option>
            ))}
          </select>
        </div>

        <div className="bidang">
          <label className="label" htmlFor="akunPembayaranId">Dibayar dari (Kas/Bank atau Hutang)</label>
          <select id="akunPembayaranId" name="akunPembayaranId" className="isian" defaultValue="">
            <option value="">— tidak dijurnal (aset sudah tercatat)</option>
            {daftarAkun.filter((a) => a.kasBank || a.jenis === "KEWAJIBAN").map((a) => (
              <option key={a.id} value={a.id}>{a.kode} - {a.nama}</option>
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
