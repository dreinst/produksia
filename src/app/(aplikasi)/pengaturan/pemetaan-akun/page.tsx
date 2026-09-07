import { wajibHak } from "@/lib/otentikasi";
import { db } from "@/lib/db";
import FormulirAksi from "@/komponen/FormulirAksi";
import { simpanPemetaanAkunFormulir } from "@/lib/aksi/pengaturan";

const FIELDS = [
  { nama: "piutangUsahaId", label: "Piutang Usaha (akun Aset)", filterType: "ASET" },
  { nama: "persediaanId", label: "Persediaan Barang Dagang (akun Aset)", filterType: "ASET" },
  { nama: "hppId", label: "Harga Pokok Penjualan / HPP (akun Beban)", filterType: "BEBAN" },
  { nama: "pendapatanPenjualanId", label: "Pendapatan Penjualan (akun Pendapatan)", filterType: "PENDAPATAN" },
  { nama: "utangUsahaId", label: "Utang Usaha (akun Kewajiban)", filterType: "KEWAJIBAN" },
] as const;

export default async function HalamanPemetaanAkun() {
  await wajibHak("pengaturan.tulis");
  const [daftarAkun, pemetaan] = await Promise.all([
    db.akun.findMany({ orderBy: { kode: "asc" } }),
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
            <label className="label" htmlFor={bidang.nama}>{bidang.label} *</label>
            <select
              id={bidang.nama}
              name={bidang.nama}
              required
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
          </div>
        ))}

        <button type="submit" className="tombol tombol-utama w-fit">
          Simpan Pemetaan
        </button>
      </FormulirAksi>
    </div>
  );
}
