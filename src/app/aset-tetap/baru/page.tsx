import { db } from "@/lib/db";
import FormulirAksi from "@/komponen/FormulirAksi";
import { buatAsetTetapFormulir } from "@/lib/aksi/asetTetap";

export default async function NewFixedAssetPage() {
  const daftarAkun = await db.akun.findMany({ orderBy: { kode: "asc" } });
  const hariIni = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="judul-halaman">Aset Tetap Baru</h1>

      <FormulirAksi aksi={buatAsetTetapFormulir} className="kartu grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bidang">
          <label className="label">Kode *</label>
          <input type="text" name="kode" required className="isian" />
        </div>

        <div className="bidang">
          <label className="label">Nama Aset *</label>
          <input type="text" name="nama" required className="isian" />
        </div>

        <div className="bidang">
          <label className="label">Tanggal Perolehan</label>
          <input type="date" name="tanggalPerolehan" defaultValue={hariIni} className="isian" />
        </div>

        <div className="bidang">
          <label className="label">Harga Perolehan *</label>
          <input type="number" name="hargaPerolehan" step="0.01" min={0} required className="isian" />
        </div>

        <div className="bidang">
          <label className="label">Nilai Sisa (Salvage)</label>
          <input type="number" name="nilaiSisa" step="0.01" min={0} defaultValue={0} className="isian" />
        </div>

        <div className="bidang">
          <label className="label">Umur Ekonomis (bulan) *</label>
          <input type="number" name="umurBulan" min={1} required className="isian" />
        </div>

        <div className="bidang">
          <label className="label">Akun Aset (Aset Tetap) *</label>
          <select name="akunAsetId" required className="isian">
            <option value="">-</option>
            {daftarAkun.filter((a) => a.jenis === "ASET").map((a) => (
              <option key={a.id} value={a.id}>{a.kode} - {a.nama}</option>
            ))}
          </select>
        </div>

        <div className="bidang">
          <label className="label">Akun Beban Penyusutan *</label>
          <select name="akunBebanPenyusutanId" required className="isian">
            <option value="">-</option>
            {daftarAkun.filter((a) => a.jenis === "BEBAN").map((a) => (
              <option key={a.id} value={a.id}>{a.kode} - {a.nama}</option>
            ))}
          </select>
        </div>

        <div className="bidang md:col-span-2">
          <label className="label">Akun Akumulasi Penyusutan (kontra-aset) *</label>
          <select name="akunAkumulasiPenyusutanId" required className="isian">
            <option value="">-</option>
            {daftarAkun.filter((a) => a.jenis === "ASET").map((a) => (
              <option key={a.id} value={a.id}>{a.kode} - {a.nama}</option>
            ))}
          </select>
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
