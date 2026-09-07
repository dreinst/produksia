import { punyaHak, type Hak } from "@/lib/hakAkses";
import { wajibHak } from "@/lib/otentikasi";
import { db } from "@/lib/db";
import FormulirAksi from "@/komponen/FormulirAksi";
import { jalankanPenyusutanBulananFormulir } from "@/lib/aksi/asetTetap";

export default async function HalamanPenyusutan() {
  const pengguna = await wajibHak("aset-tetap.lihat");
  const boleh = (hak: Hak) => punyaHak(pengguna.peran, hak);
  const daftarPenyusutan = await db.penyusutanAset.findMany({
    include: { aset: true },
    orderBy: { periode: "desc" },
  });

  const currentMonth = new Date().toISOString().slice(0, 7);

  return (
    <div className="space-y-8">
      <h1 className="judul-halaman">Penyusutan Aset Tetap</h1>

      {boleh("aset-tetap.tulis") && (
        <>
      <FormulirAksi aksi={jalankanPenyusutanBulananFormulir} className="kartu flex items-end gap-3 max-w-md">
        <div className="bidang flex-1">
          <label className="label" htmlFor="periode">Periode (bulan)</label>
          <input id="periode" type="month" name="periode" defaultValue={currentMonth} required className="isian" />
        </div>
        <button type="submit" className="tombol tombol-utama">
          Jalankan Penyusutan
        </button>
      </FormulirAksi>
      <p className="text-xs text-slate-500 -mt-4">
        Menghitung penyusutan garis lurus untuk semua aset AKTIF yang belum disusutkan pada periode ini, lalu membuat satu jurnal otomatis.
      </p>
        </>
      )}

      <div className="kartu kartu-tabel"><div className="bungkus-tabel">
        <table className="tabel min-w-[36rem]">
        <thead>
          <tr>
            <th>Periode</th>
            <th>Aset</th>
            <th className="text-right angka">Jumlah Penyusutan</th>
          </tr>
        </thead>
        <tbody>
          {daftarPenyusutan.map((d) => (
            <tr key={d.id}>
              <td>{d.periode.toLocaleDateString("id-ID", { year: "numeric", month: "long" })}</td>
              <td>{d.aset.nama}</td>
              <td className="text-right angka">{Number(d.jumlah).toLocaleString("id-ID")}</td>
            </tr>
          ))}
          {daftarPenyusutan.length === 0 && (
            <tr>
              <td colSpan={3} className="kosong">
                Belum ada penyusutan yang dijalankan.
              </td>
            </tr>
          )}
        </tbody>
        </table>
      </div></div>
    </div>
  );
}
