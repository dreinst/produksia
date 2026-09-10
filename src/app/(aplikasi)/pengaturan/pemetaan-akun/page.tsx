import { wajibHak } from "@/lib/otentikasi";
import { db } from "@/lib/db";
import FormulirAksi from "@/komponen/FormulirAksi";
import Ikon from "@/komponen/ui/Ikon";
import {
  simpanPemetaanAkunFormulir,
  tambahPemetaanTambahanFormulir,
  ubahPemetaanTambahanFormulir,
  hapusPemetaanTambahanFormulir,
} from "@/lib/aksi/pengaturan";

const FIELDS = [
  { nama: "piutangUsahaId", label: "Piutang Usaha (akun Aset)", filterType: "ASET", wajib: true, petunjuk: "Dipakai Faktur Penjualan, Penerimaan, dan Retur" },
  { nama: "persediaanId", label: "Persediaan (akun Aset)", filterType: "ASET", wajib: true, petunjuk: "Untuk barang tanpa akun persediaan khusus" },
  { nama: "hppId", label: "Harga Pokok Penjualan (akun Beban)", filterType: "BEBAN", wajib: true, petunjuk: "HPP saat Faktur Penjualan barang" },
  { nama: "pendapatanPenjualanId", label: "Pendapatan Penjualan (akun Pendapatan)", filterType: "PENDAPATAN", wajib: true, petunjuk: "Untuk barang/jasa tanpa akun pendapatan khusus" },
  { nama: "utangUsahaId", label: "Hutang Usaha (akun Kewajiban)", filterType: "KEWAJIBAN", wajib: true, petunjuk: "Dipakai Faktur Pembelian, Pembayaran, dan Retur" },
  { nama: "barangBelumDitagihId", label: "Barang Diterima Belum Ditagih (akun Kewajiban)", filterType: "KEWAJIBAN", wajib: false, petunjuk: "Dipakai Terima Barang dan Faktur Pembelian" },
  { nama: "bebanJasaId", label: "Beban pembelian jasa (akun Beban)", filterType: "BEBAN", wajib: false, petunjuk: "Faktur Pembelian baris jasa. Kosong = akun HPP" },
  { nama: "selisihPersediaanId", label: "Selisih Persediaan (akun Beban)", filterType: "BEBAN", wajib: false, petunjuk: "Selisih retur pembelian dan opname stok" },
  { nama: "barangTerkirimId", label: "Barang Terkirim Belum Ditagih (akun Aset)", filterType: "ASET", wajib: false, petunjuk: "Dipakai Surat Jalan dan Faktur Penjualan" },
  { nama: "uangMukaPelangganId", label: "Uang Muka Pelanggan (akun Kewajiban)", filterType: "KEWAJIBAN", wajib: false, petunjuk: "DP pesanan, dipakai saat Faktur Penjualan" },
  { nama: "labaDitahanId", label: "Laba Ditahan (akun Modal)", filterType: "MODAL", wajib: false, petunjuk: "Tujuan jurnal penutup tahun" },
] as const;

export default async function HalamanPemetaanAkun() {
  await wajibHak("pemetaan.tulis");
  const [daftarAkun, pemetaan, tambahan] = await Promise.all([
    db.akun.findMany({ where: { kelompok: false }, orderBy: { kode: "asc" } }),
    db.pemetaanAkun.findUnique({ where: { id: "default" } }),
    db.pemetaanAkunTambahan.findMany({ include: { akun: true }, orderBy: { label: "asc" } }),
  ]);
  const labelAkun = (a: { kode: string; nama: string }) => `${a.kode} - ${a.nama}`;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="judul-halaman">Pemetaan Akun</h1>
        <p className="text-sm text-slate-500 mt-1">
          Akun yang dipakai sistem saat membuat jurnal otomatis dari Penjualan, Pembelian, dan Persediaan.
        </p>
      </div>

      <FormulirAksi
        aksi={simpanPemetaanAkunFormulir}
        pesanSukses="Pemetaan akun tersimpan."
        className="kartu flex flex-col gap-4"
      >
        <h2 className="judul-kartu">Pemetaan standar</h2>
        {FIELDS.map((bidang) => (
          <div key={bidang.nama} className="bidang">
            <label className="label" htmlFor={bidang.nama}>{bidang.label}{bidang.wajib ? " *" : ""}</label>
            <select
              id={bidang.nama}
              name={bidang.nama}
              required={bidang.wajib}
              defaultValue={(pemetaan as unknown as Record<string, string>)?.[bidang.nama] ?? ""}
              className="isian"
            >
              <option value="">-</option>
              {daftarAkun
                .filter((a) => a.jenis === bidang.filterType)
                .map((a) => (
                  <option key={a.id} value={a.id}>{labelAkun(a)}</option>
                ))}
            </select>
            <span className="petunjuk">{bidang.petunjuk}</span>
          </div>
        ))}

        <button type="submit" className="tombol tombol-utama w-fit">
          Simpan Pemetaan
        </button>
      </FormulirAksi>

      <div className="kartu space-y-4">
        <div>
          <h2 className="judul-kartu">Pemetaan tambahan</h2>
          <p className="text-sm text-slate-500 mt-1">
            Nama peran baru yang belum ada di pemetaan standar, misalnya Prive. Modul terkait memakai akun ini sebagai bawaan.
          </p>
        </div>

        {tambahan.length > 0 && (
          <div className="bungkus-tabel">
            <table className="tabel-polos min-w-[32rem]">
              <thead>
                <tr>
                  <th>Nama peran</th>
                  <th>Akun</th>
                  <th className="w-40" />
                </tr>
              </thead>
              <tbody>
                {tambahan.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <div className="font-medium text-slate-900">{t.label}</div>
                      <div className="text-xs text-slate-400 mono">{t.kunci}</div>
                      {t.keterangan && <div className="text-xs text-slate-500">{t.keterangan}</div>}
                    </td>
                    <td>
                      <FormulirAksi aksi={ubahPemetaanTambahanFormulir.bind(null, t.id)} pesanSukses="Akun diganti." className="flex items-center gap-2">
                        <select name="akunId" defaultValue={t.akunId} className="isian isian-kecil" aria-label={`Akun untuk ${t.label}`}>
                          {daftarAkun.map((a) => (
                            <option key={a.id} value={a.id}>{labelAkun(a)}</option>
                          ))}
                        </select>
                        <button type="submit" className="tombol tombol-garis tombol-kecil">Ganti</button>
                      </FormulirAksi>
                    </td>
                    <td className="text-right">
                      <FormulirAksi aksi={hapusPemetaanTambahanFormulir.bind(null, t.id)} pesanKonfirmasi={`Hapus pemetaan "${t.label}"?`}>
                        <button type="submit" className="tombol-tautan-bahaya">Hapus</button>
                      </FormulirAksi>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <FormulirAksi aksi={tambahPemetaanTambahanFormulir} pesanSukses="Pemetaan tambahan disimpan." className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-slate-100 pt-4">
          <div className="bidang">
            <label className="label" htmlFor="label">Nama peran *</label>
            <input id="label" name="label" required className="isian" placeholder="Contoh: Prive" />
          </div>
          <div className="bidang">
            <label className="label" htmlFor="akunIdTambahan">Akun *</label>
            <select id="akunIdTambahan" name="akunId" required className="isian" defaultValue="">
              <option value="">-</option>
              {daftarAkun.map((a) => (
                <option key={a.id} value={a.id}>{labelAkun(a)}</option>
              ))}
            </select>
          </div>
          <div className="bidang md:col-span-2">
            <label className="label" htmlFor="keteranganTambahan">Keterangan</label>
            <input id="keteranganTambahan" name="keterangan" className="isian" placeholder="Untuk apa akun ini dipakai" />
          </div>
          <div className="md:col-span-2">
            <button type="submit" className="tombol tombol-utama">
              <Ikon nama="add" className="!text-[18px]" />
              Tambah nama akun
            </button>
          </div>
        </FormulirAksi>
      </div>
    </div>
  );
}
