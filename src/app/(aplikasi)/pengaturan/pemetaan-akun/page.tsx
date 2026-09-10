import { wajibHak } from "@/lib/otentikasi";
import { db } from "@/lib/db";
import FormulirAksi from "@/komponen/FormulirAksi";
import { simpanPemetaanAkunFormulir } from "@/lib/aksi/pengaturan";

const FIELDS = [
  { nama: "piutangUsahaId", label: "Piutang Usaha (akun Aset)", filterType: "ASET", wajib: true, petunjuk: "Didebit saat Faktur Penjualan, dikredit saat Penerimaan/Retur" },
  { nama: "persediaanId", label: "Persediaan (akun Aset)", filterType: "ASET", wajib: true, petunjuk: "Bawaan untuk barang tanpa akun persediaan khusus" },
  { nama: "hppId", label: "Harga Pokok Penjualan (akun Beban)", filterType: "BEBAN", wajib: true, petunjuk: "Bawaan HPP saat Faktur Penjualan barang" },
  { nama: "pendapatanPenjualanId", label: "Pendapatan Penjualan (akun Pendapatan)", filterType: "PENDAPATAN", wajib: true, petunjuk: "Bawaan untuk barang/jasa tanpa akun pendapatan khusus" },
  { nama: "utangUsahaId", label: "Hutang Usaha (akun Kewajiban)", filterType: "KEWAJIBAN", wajib: true, petunjuk: "Dikredit saat Faktur Pembelian, didebit saat Pembayaran/Retur" },
  { nama: "barangBelumDitagihId", label: "Barang Diterima Belum Ditagih (akun Kewajiban)", filterType: "KEWAJIBAN", wajib: false, petunjuk: "Dikredit saat Terima Barang, didebit saat Faktur Pembelian — wajib bila memakai alur TB → FB" },
  { nama: "bebanJasaId", label: "Beban pembelian jasa (akun Beban)", filterType: "BEBAN", wajib: false, petunjuk: "Didebit saat Faktur Pembelian baris JASA; kosong = akun HPP" },
  { nama: "selisihPersediaanId", label: "Selisih Persediaan (akun Beban)", filterType: "BEBAN", wajib: false, petunjuk: "Beda harga retur pembelian vs harga pokok, opname stok" },
] as const;

export default async function HalamanPemetaanAkun() {
  await wajibHak("pengaturan.tulis");
  const [daftarAkun, pemetaan] = await Promise.all([
    db.akun.findMany({ where: { kelompok: false }, orderBy: { kode: "asc" } }),
    db.pemetaanAkun.findUnique({ where: { id: "default" } }),
  ]);

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="judul-halaman">Pemetaan Akun</h1>
        <p className="text-sm text-slate-500 mt-1">
          Menentukan akun mana yang dipakai saat sistem otomatis membuat jurnal dari transaksi Penjualan &
          Pembelian (Faktur, Penerimaan, Pembayaran, Retur). Wajib diisi sebelum transaksi tersebut bisa dibuat.
        </p>
      </div>

      <FormulirAksi
        aksi={simpanPemetaanAkunFormulir}
        pesanSukses="Pemetaan akun tersimpan."
        className="kartu flex flex-col gap-4"
      >
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
                  <option key={a.id} value={a.id}>
                    {a.kode} - {a.nama}
                  </option>
                ))}
            </select>
            <span className="petunjuk">{bidang.petunjuk}</span>
          </div>
        ))}

        <button type="submit" className="tombol tombol-utama w-fit">
          Simpan Pemetaan
        </button>
      </FormulirAksi>
    </div>
  );
}
