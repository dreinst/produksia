import TombolHapusDokumen from "@/komponen/TombolHapusDokumen";
import { punyaHak, type Hak } from "@/lib/hakAkses";
import { wajibHak } from "@/lib/otentikasi";
import { db } from "@/lib/db";
import FormulirAksi from "@/komponen/FormulirAksi";
import { jalankanPenyusutanBulananFormulir } from "@/lib/aksi/asetTetap";
import LencanaPerusahaan from "@/komponen/ui/LencanaPerusahaan";
import { PERUSAHAAN_UTAMA, lingkupPerusahaan, saringPerusahaan } from "@/lib/perusahaan";

export default async function HalamanPenyusutan() {
  const pengguna = await wajibHak("penyusutan.lihat");
  const boleh = (hak: Hak) => punyaHak(pengguna, hak);
  const bolehHapus = boleh("penyusutan.hapus");
  // Lingkup perusahaan (D1 §4.4, §8.4): daftar dan aksi penyusutan hanya untuk aset perusahaan lingkup; gabungan =
  // semua aset, satu jurnal per perusahaan, dengan kolom Perusahaan
  const lingkup = await lingkupPerusahaan();
  const p = lingkup.perusahaanId;
  const daftarPenyusutan = await db.penyusutanAset.findMany({
    ...(p ? { where: { aset: saringPerusahaan(p) } } : {}),
    include: { aset: { include: { perusahaan: { select: { kode: true, nama: true, warna: true } } } } },
    orderBy: { periode: "desc" },
  });
  const lingkupTeks =
    p === PERUSAHAAN_UTAMA
      ? "Menghitung penyusutan garis lurus untuk semua aset AKTIF yang belum disusutkan pada periode ini, lalu membuat satu jurnal otomatis."
      : p
        ? `Menghitung penyusutan garis lurus untuk semua aset AKTIF milik ${lingkup.perusahaan?.nama ?? p} yang belum disusutkan pada periode ini, lalu membuat satu jurnal otomatis.`
        : "Menghitung penyusutan garis lurus untuk semua aset AKTIF semua perusahaan yang belum disusutkan pada periode ini, lalu membuat satu jurnal otomatis per perusahaan.";

  const currentMonth = new Date().toISOString().slice(0, 7);

  return (
    <div className="space-y-8">
      <h1 className="judul-halaman">Penyusutan Aset Tetap</h1>

      {boleh("penyusutan.buat") && (
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
        {lingkupTeks}
      </p>
        </>
      )}

      <div className="kartu kartu-tabel"><div className="bungkus-tabel">
        <table className="tabel min-w-[36rem]">
        <thead>
          <tr>
            <th>Periode</th>
            {!p && <th>Perusahaan</th>}
            <th>Aset</th>
            <th className="text-right angka">Jumlah Penyusutan</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {daftarPenyusutan.map((d) => (
            <tr key={d.id}>
              <td>{d.periode.toLocaleDateString("id-ID", { year: "numeric", month: "long" })}</td>
              {!p && <td><LencanaPerusahaan kode={d.aset.perusahaan.kode} warna={d.aset.perusahaan.warna} nama={d.aset.perusahaan.nama} /></td>}
              <td>{d.aset.nama}</td>
              <td className="text-right angka">{Number(d.jumlah).toLocaleString("id-ID")}</td>
              <td className="text-right">{d.jurnalId && <TombolHapusDokumen jenis="penyusutan" id={d.jurnalId} nomor={`penyusutan ${d.periode.toLocaleDateString("id-ID", { year: "numeric", month: "long" })}`} boleh={bolehHapus} />}</td>
            </tr>
          ))}
          {daftarPenyusutan.length === 0 && (
            <tr>
              <td colSpan={p ? 4 : 5} className="kosong">
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
