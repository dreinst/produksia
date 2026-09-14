import { wajibHak } from "@/lib/otentikasi";
import { daftarAkunKasBank } from "@/lib/baganAkun";
import { daftarKaryawanAktif, akunGajiBawaan } from "@/lib/sdm";
import { daftarProyekAktif } from "@/lib/proyek";
import { buatPenggajianFormulir } from "@/lib/aksi/sdm";
import { PERINGATAN_TANPA_EVENT } from "@/lib/verifikasi";
import FormulirAksi from "@/komponen/FormulirAksi";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import EditorBarisPenggajian from "@/komponen/sdm/EditorBarisPenggajian";

export default async function HalamanPenggajianBaru() {
  await wajibHak("penggajian.buat");
  const [daftarAkunKas, daftarKaryawan, daftarProyek, gaji] = await Promise.all([
    daftarAkunKasBank(),
    daftarKaryawanAktif(),
    daftarProyekAktif(),
    akunGajiBawaan(),
  ]);
  const bulanIni = new Date().toISOString().slice(0, 7);
  const hariIni = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6 max-w-5xl">
      <KepalaHalaman
        jejak={[{ label: "SDM" }, { label: "Penggajian", href: "/sdm/penggajian" }]}
        judul="Proses Gaji Baru"
        subjudul="Satu proses per bulan untuk semua karyawan aktif yang diikutkan. Jurnal: Dr Beban Gaji Pokok + Tunjangan / Cr Hutang Potongan (bila ada) / Cr Kas-Bank."
      />

      {!gaji.bebanGaji && (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Akun Beban Gaji belum ada. Terapkan Bagan Akun Standar di Pengaturan → Bagan Akun Standar (akun 5-2100 Gaji Pokok), atau atur sendiri di Pengaturan → Pemetaan Akun → Pemetaan tambahan (&quot;bebanGaji&quot;).
        </div>
      )}

      <FormulirAksi
        aksi={buatPenggajianFormulir}
        className="kartu grid grid-cols-1 md:grid-cols-2 gap-4"
        verifikasi={{ judul: "Periksa proses gaji", peringatan: [PERINGATAN_TANPA_EVENT] }}
      >
        <div className="bidang">
          <label className="label" htmlFor="periode">Periode *</label>
          <input id="periode" name="periode" type="month" required defaultValue={bulanIni} max={bulanIni} className="isian" />
          <span className="petunjuk">Satu proses per bulan; koreksi = hapus lalu proses ulang.</span>
        </div>
        <div className="bidang">
          <label className="label" htmlFor="tanggal">Tanggal pembayaran *</label>
          <input id="tanggal" name="tanggal" type="date" required defaultValue={hariIni} max={hariIni} className="isian" />
        </div>
        <div className="bidang">
          <label className="label" htmlFor="akunKasId">Dibayar dari *</label>
          <select id="akunKasId" name="akunKasId" required className="isian">
            <option value="">-</option>
            {daftarAkunKas.map((a) => (
              <option key={a.id} value={a.id}>{a.kode} - {a.nama}</option>
            ))}
          </select>
        </div>
        <div className="bidang">
          <label className="label" htmlFor="proyekId">Proyek / Event</label>
          <select id="proyekId" name="proyekId" className="isian" defaultValue="">
            <option value="">Tanpa event</option>
            {daftarProyek.map((p) => (
              <option key={p.id} value={p.id}>{p.kode} - {p.nama}</option>
            ))}
          </select>
          <span className="petunjuk">Isi bila gaji ini seluruhnya beban satu event (mis. kru lepas khusus event itu).</span>
        </div>
        <div className="bidang md:col-span-2">
          <label className="label" htmlFor="keterangan">Keterangan</label>
          <input id="keterangan" name="keterangan" className="isian" placeholder="mis. Gaji bulan berjalan" />
        </div>

        <EditorBarisPenggajian
          daftarKaryawan={daftarKaryawan.map((k) => ({ id: k.id, kode: k.kode, nama: k.nama, jabatan: k.jabatan, gajiPokok: Number(k.gajiPokok), tunjangan: Number(k.tunjangan) }))}
        />

        <div className="md:col-span-2">
          <button type="submit" className="tombol tombol-utama">
            Proses Gaji
          </button>
        </div>
      </FormulirAksi>
    </div>
  );
}
