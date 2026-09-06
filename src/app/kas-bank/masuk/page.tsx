import { db } from "@/lib/db";
import { NomorDokumen } from "@/komponen/ui/Lencana";
import FormulirAksi from "@/komponen/FormulirAksi";
import { buatKasMasukFormulir } from "@/lib/aksi/jurnal";

export default async function CashInPage() {
  const [daftarAkun, daftarJurnal] = await Promise.all([
    db.akun.findMany({ orderBy: { kode: "asc" } }),
    db.jurnal.findMany({
      where: { sumber: "KAS_MASUK" },
      include: { baris: { include: { akun: true } } },
      orderBy: { tanggal: "desc" },
    }),
  ]);

  return (
    <div className="space-y-8">
      <h1 className="judul-halaman">Kas Masuk</h1>

      <FormulirAksi aksi={buatKasMasukFormulir} className="kartu grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl">
        <div className="bidang">
          <label className="label">Akun Kas/Bank Penerima *</label>
          <select name="akunKasId" required className="isian">
            <option value="">-</option>
            {daftarAkun.map((a) => (
              <option key={a.id} value={a.id}>
                {a.kode} - {a.nama}
              </option>
            ))}
          </select>
        </div>

        <div className="bidang">
          <label className="label">Akun Lawan (sumber dana) *</label>
          <select name="akunLawanId" required className="isian">
            <option value="">-</option>
            {daftarAkun.map((a) => (
              <option key={a.id} value={a.id}>
                {a.kode} - {a.nama}
              </option>
            ))}
          </select>
        </div>

        <div className="bidang">
          <label className="label">Jumlah *</label>
          <input type="number" name="jumlah" step="0.01" min={0} required className="isian" />
        </div>

        <div className="bidang">
          <label className="label">Keterangan</label>
          <input type="text" name="keterangan" className="isian" />
        </div>

        <div className="md:col-span-2">
          <button type="submit" className="tombol tombol-utama">
            Catat Kas Masuk
          </button>
        </div>
      </FormulirAksi>

      <div className="kartu kartu-tabel"><div className="bungkus-tabel">
        <table className="tabel min-w-[36rem]">
        <thead>
          <tr>
            <th>No</th>
            <th>Tanggal</th>
            <th>Akun Kas/Bank</th>
            <th>Dari Akun</th>
            <th className="text-right angka">Jumlah</th>
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
              </tr>
            );
          })}
          {daftarJurnal.length === 0 && (
            <tr>
              <td colSpan={5} className="kosong">
                Belum ada kas masuk.
              </td>
            </tr>
          )}
        </tbody>
        </table>
      </div></div>
    </div>
  );
}
