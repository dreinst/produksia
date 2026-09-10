import { punyaHak } from "@/lib/hakAkses";
import TombolHapusDokumen from "@/komponen/TombolHapusDokumen";
import KontrolDaftar from "@/komponen/ui/KontrolDaftar";
import { bacaParamDaftar, cocokTeks } from "@/lib/daftar";
import { wajibHak } from "@/lib/otentikasi";
import { db } from "@/lib/db";
import { daftarAkunKasBank } from "@/lib/baganAkun";
import { NomorDokumen } from "@/komponen/ui/Lencana";
import FormulirAksi from "@/komponen/FormulirAksi";
import { buatKasMasukFormulir } from "@/lib/aksi/jurnal";

export default async function HalamanKasMasuk({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const pengguna = await wajibHak("kas-bank.lihat");
  const bolehHapus = punyaHak(pengguna.peran, "dokumen.hapus");
  const param = await bacaParamDaftar(searchParams);
  const where = { sumber: "KAS_MASUK" as const, ...(param.q ? { OR: [{ nomor: cocokTeks(param.q) }, { keterangan: cocokTeks(param.q) }] } : {}) };
  const [daftarAkunKas, daftarAkun, total, daftarJurnal] = await Promise.all([
    daftarAkunKasBank(),
    db.akun.findMany({ where: { kelompok: false }, orderBy: { kode: "asc" } }),
    db.jurnal.count({ where }),
    db.jurnal.findMany({ where, include: { baris: { include: { akun: true } } }, orderBy: { tanggal: "desc" }, skip: param.lewati, take: param.ambil }),
  ]);

  return (
    <div className="space-y-8">
      <h1 className="judul-halaman">Kas Masuk</h1>

      <FormulirAksi aksi={buatKasMasukFormulir} className="kartu grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl">
        <div className="bidang">
          <label className="label" htmlFor="akunKasId">Akun Kas/Bank Penerima *</label>
          <select id="akunKasId" name="akunKasId" required className="isian">
            <option value="">-</option>
            {daftarAkunKas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.kode} - {a.nama}
              </option>
            ))}
          </select>
        </div>

        <div className="bidang">
          <label className="label" htmlFor="akunLawanId">Akun Lawan (sumber dana) *</label>
          <select id="akunLawanId" name="akunLawanId" required className="isian">
            <option value="">-</option>
            {daftarAkun.map((a) => (
              <option key={a.id} value={a.id}>
                {a.kode} - {a.nama}
              </option>
            ))}
          </select>
        </div>

        <div className="bidang">
          <label className="label" htmlFor="jumlah">Jumlah *</label>
          <input id="jumlah" type="number" name="jumlah" step="0.01" min={0} required className="isian" />
        </div>

        <div className="bidang">
          <label className="label" htmlFor="keterangan">Keterangan</label>
          <input id="keterangan" type="text" name="keterangan" className="isian" />
        </div>

        <div className="md:col-span-2">
          <button type="submit" className="tombol tombol-utama">
            Catat Kas Masuk
          </button>
        </div>
      </FormulirAksi>

      <div className="kartu kartu-tabel">
        <KontrolDaftar param={param} total={total} placeholder="Cari nomor KM / keterangan…" />
        <div className="bungkus-tabel">
        <table className="tabel min-w-[36rem]">
        <thead>
          <tr>
            <th>No</th>
            <th>Tanggal</th>
            <th>Akun Kas/Bank</th>
            <th>Dari Akun</th>
            <th className="text-right angka">Jumlah</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {daftarJurnal.map((e) => {
            const cashLine = e.baris.find((l) => Number(l.debit) > 0);
            const counterLine = e.baris.find((l) => Number(l.kredit) > 0);
            return (
              <tr key={e.id}>
                <td><NomorDokumen nomor={e.nomor} /></td>
                <td className="text-slate-500 whitespace-nowrap">{e.tanggal.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}</td>
                <td>{cashLine?.akun.nama}</td>
                <td>{counterLine?.akun.nama}</td>
                <td className="text-right angka">
                  {Number(cashLine?.debit ?? 0).toLocaleString("id-ID")}
                </td>
                <td className="text-right"><TombolHapusDokumen jenis="jurnal" id={e.id} nomor={e.nomor} boleh={bolehHapus} /></td>
              </tr>
            );
          })}
          {daftarJurnal.length === 0 && (
            <tr>
              <td colSpan={6} className="kosong">
                {param.q ? "Tidak ada yang cocok dengan pencarian." : "Belum ada kas masuk."}
              </td>
            </tr>
          )}
        </tbody>
        </table>
      </div></div>
    </div>
  );
}
