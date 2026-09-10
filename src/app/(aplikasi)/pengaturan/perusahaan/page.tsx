import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { ambilPengaturanPerusahaan } from "@/lib/pengaturanPerusahaan";
import { simpanPengaturanPerusahaanFormulir } from "@/lib/aksi/pengaturan";
import FormulirAksi from "@/komponen/FormulirAksi";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";

type OpsiAkun = { id: string; kode: string; nama: string; jenis: string };

function PilihAkunPajak({ nama, label, nilai, daftar, petunjuk }: { nama: string; label: string; nilai: string; daftar: OpsiAkun[]; petunjuk: string }) {
  return (
    <div className="bidang">
      <label className="label" htmlFor={nama}>{label}</label>
      <select id={nama} name={nama} defaultValue={nilai} className="isian">
        <option value="">— tidak dipakai</option>
        {daftar.map((a) => (
          <option key={a.id} value={a.id}>
            {a.kode} - {a.nama}
          </option>
        ))}
      </select>
      <span className="petunjuk">{petunjuk}</span>
    </div>
  );
}

export default async function HalamanPengaturanPerusahaan() {
  await wajibHak("pengaturan.tulis");
  const [pengaturan, daftarAkun, tersimpan] = await Promise.all([
    ambilPengaturanPerusahaan(db),
    db.akun.findMany({ where: { kelompok: false, jenis: { in: ["ASET", "KEWAJIBAN"] } }, orderBy: { kode: "asc" } }),
    db.pengaturanPerusahaan.findUnique({ where: { id: "default" } }),
  ]);
  const byKode = (kode: string) => daftarAkun.find((a) => a.kode === kode)?.id ?? "";
  // bawaan dari bagan akun standar bila belum pernah disimpan
  const nilai = {
    akunPpnKeluaranId: pengaturan.akunPpnKeluaranId ?? byKode("2-1330"),
    akunPpnMasukanId: pengaturan.akunPpnMasukanId ?? byKode("1-1800"),
    akunPph23DimukaId: pengaturan.akunPph23DimukaId ?? byKode("1-1900"),
    akunPph23DipotongId: pengaturan.akunPph23DipotongId ?? byKode("2-1320"),
  };
  const aset = daftarAkun.filter((a) => a.jenis === "ASET");
  const kewajiban = daftarAkun.filter((a) => a.jenis === "KEWAJIBAN");

  return (
    <div className="space-y-6 max-w-3xl">
      <KepalaHalaman
        jejak={[{ label: "Administrasi" }, { label: "Pengaturan" }]}
        judul="Perusahaan & Pajak"
        subjudul="Identitas perusahaan, tahun buku, status PKP, tarif PPN, termin faktur, dan akun pajak yang dipakai jurnal otomatis."
        lencana={<span className={`lencana ${tersimpan ? "lencana-emerald" : "lencana-amber"}`}>{tersimpan ? "Tersimpan" : "Masih bawaan"}</span>}
      />

      <FormulirAksi aksi={simpanPengaturanPerusahaanFormulir} className="kartu grid grid-cols-1 md:grid-cols-2 gap-4" pesanSukses="Pengaturan perusahaan tersimpan.">
        <div className="bidang md:col-span-2">
          <label className="label" htmlFor="nama">Nama perusahaan *</label>
          <input id="nama" name="nama" required defaultValue={pengaturan.nama} className="isian" />
          <span className="petunjuk">Tampil di sidebar dan dokumen</span>
        </div>

        <div className="bidang">
          <label className="label" htmlFor="terminHari">Termin jatuh tempo faktur (hari)</label>
          <input id="terminHari" name="terminHari" type="number" min={0} max={365} defaultValue={pengaturan.terminHari} className="isian" />
          <span className="petunjuk">TOP bawaan: tanggal faktur + termin</span>
        </div>

        <div className="bidang">
          <label className="label" htmlFor="tahunBuku">Tahun buku yang dibuka</label>
          <input id="tahunBuku" name="tahunBuku" type="number" min={2000} max={2100} defaultValue={tersimpan?.tahunBuku ?? ""} placeholder={String(new Date().getFullYear())} className="isian" />
          <span className="petunjuk">Bawaan periode laporan & pintasan; kosongkan untuk mengikuti tahun kalender. Bisa diganti cepat dari kartu perusahaan di sidebar</span>
        </div>

        <div className="bidang">
          <label className="label" htmlFor="mataUang">Mata uang</label>
          <input id="mataUang" value="Rupiah (IDR)" readOnly className="isian bg-slate-50" />
          <span className="petunjuk">Sistem berjalan satu mata uang</span>
        </div>

        <div className="bidang">
          <label className="label" htmlFor="tarifPpnPersen">Tarif PPN (%)</label>
          <input id="tarifPpnPersen" name="tarifPpnPersen" type="number" min={0} max={100} step="0.01" defaultValue={Number(pengaturan.tarifPpnPersen)} className="isian" />
          <span className="petunjuk">Dipakai sebagai bawaan faktur bila PKP; per faktur bisa dipilih 0%</span>
        </div>

        <label className="md:col-span-2 flex items-start gap-3 ubin cursor-pointer">
          <input type="checkbox" name="pkp" defaultChecked={pengaturan.pkp} className="mt-0.5 h-4 w-4 rounded border-slate-300" />
          <span className="text-sm">
            <span className="font-semibold text-slate-900">Pengusaha Kena Pajak (PKP)</span>
            <span className="block text-xs text-slate-500 mt-0.5">Bila aktif, Faktur Penjualan memungut PPN (Cr PPN Keluaran) dan Faktur Pembelian mencatat PPN Masukan. Non-PKP: faktur selalu tanpa PPN.</span>
          </span>
        </label>

        <PilihAkunPajak nama="akunPpnKeluaranId" label="Akun PPN Keluaran (kewajiban)" nilai={nilai.akunPpnKeluaranId} daftar={kewajiban} petunjuk="Dikredit saat Faktur Penjualan, didebit saat Retur Penjualan" />
        <PilihAkunPajak nama="akunPpnMasukanId" label="Akun PPN Masukan (aset)" nilai={nilai.akunPpnMasukanId} daftar={aset} petunjuk="Didebit saat Faktur Pembelian, dikredit saat Retur Pembelian" />
        <PilihAkunPajak nama="akunPph23DimukaId" label="Akun PPh 23 dibayar dimuka (aset)" nilai={nilai.akunPph23DimukaId} daftar={aset} petunjuk="PPh 23 yang dipotong klien saat membayar kita (isian di Penerimaan)" />
        <PilihAkunPajak nama="akunPph23DipotongId" label="Akun Hutang PPh 23 (kewajiban)" nilai={nilai.akunPph23DipotongId} daftar={kewajiban} petunjuk="PPh 23 yang kita potong saat membayar vendor (isian di Pembayaran)" />

        <div className="md:col-span-2">
          <button type="submit" className="tombol tombol-utama">
            Simpan Pengaturan
          </button>
        </div>
      </FormulirAksi>
    </div>
  );
}
