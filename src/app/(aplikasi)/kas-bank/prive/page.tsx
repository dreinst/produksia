import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { punyaHak } from "@/lib/hakAkses";
import { daftarAkunKasBank } from "@/lib/baganAkun";
import { bacaParamDaftar, cocokTeks } from "@/lib/daftar";
import { buatPriveFormulir } from "@/lib/aksi/prive";
import { akunPemetaanTambahan } from "@/lib/baganAkun";
import FormulirAksi from "@/komponen/FormulirAksi";
import KontrolDaftar from "@/komponen/ui/KontrolDaftar";
import TombolHapusDokumen from "@/komponen/TombolHapusDokumen";
import { NomorDokumen } from "@/komponen/ui/Lencana";

export default async function HalamanPrive({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const pengguna = await wajibHak("prive.lihat");
  const bolehBuat = punyaHak(pengguna, "prive.buat");
  const bolehHapus = punyaHak(pengguna, "prive.hapus");
  const param = await bacaParamDaftar(searchParams);
  const where = param.q ? { OR: [{ nomor: cocokTeks(param.q) }, { pemilikNama: cocokTeks(param.q) }, { keterangan: cocokTeks(param.q) }] } : undefined;
  const [daftarAkunKas, daftarAkunModal, pemilik, total, daftar, akunPrivePemetaan] = await Promise.all([
    daftarAkunKasBank(),
    db.akun.findMany({ where: { jenis: "MODAL", kelompok: false }, orderBy: { kode: "asc" } }),
    db.pengguna.findMany({ where: { peran: { in: ["PEMILIK", "SUPERADMIN"] }, aktif: true }, orderBy: { nama: "asc" }, select: { nama: true } }),
    db.prive.count({ where }),
    db.prive.findMany({ where, include: { akunKas: true, jurnal: { select: { nomor: true } } }, orderBy: { tanggal: "desc" }, skip: param.lewati, take: param.ambil }),
    akunPemetaanTambahan(db, "prive"),
  ]);
  // akun prive: dari Pemetaan Akun (tambahan "prive") bila ada, kalau tidak cari akun modal bernama Prive
  const akunPriveBawaan = akunPrivePemetaan?.id ?? daftarAkunModal.find((a) => /prive/i.test(a.nama))?.id ?? "";
  const hariIni = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="judul-halaman">Prive</h1>
        <p className="subjudul-halaman">Pengambilan uang pribadi oleh pemilik. Mengurangi modal, bukan beban.</p>
      </div>

      {bolehBuat && (
        <FormulirAksi aksi={buatPriveFormulir} className="kartu grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl">
          <div className="bidang">
            <label className="label" htmlFor="pemilikNama">Pemilik *</label>
            <input id="pemilikNama" name="pemilikNama" list="daftar-pemilik" required className="isian" defaultValue={pemilik[0]?.nama ?? ""} />
            <datalist id="daftar-pemilik">{pemilik.map((p) => <option key={p.nama} value={p.nama} />)}</datalist>
          </div>
          <div className="bidang">
            <label className="label" htmlFor="tanggal">Tanggal *</label>
            <input id="tanggal" name="tanggal" type="date" defaultValue={hariIni} max={hariIni} required className="isian" />
          </div>
          <div className="bidang">
            <label className="label" htmlFor="akunKasId">Diambil dari *</label>
            <select id="akunKasId" name="akunKasId" required className="isian">
              {daftarAkunKas.map((a) => (
                <option key={a.id} value={a.id}>{a.kode} - {a.nama}</option>
              ))}
            </select>
          </div>
          <div className="bidang">
            <label className="label" htmlFor="akunPriveId">Akun prive *</label>
            <select id="akunPriveId" name="akunPriveId" required defaultValue={akunPriveBawaan} className="isian">
              {daftarAkunModal.map((a) => (
                <option key={a.id} value={a.id}>{a.kode} - {a.nama}</option>
              ))}
            </select>
          </div>
          <div className="bidang">
            <label className="label" htmlFor="jumlah">Jumlah *</label>
            <input id="jumlah" name="jumlah" type="number" step="0.01" min={0} required className="isian" />
          </div>
          <div className="bidang">
            <label className="label" htmlFor="keterangan">Keterangan</label>
            <input id="keterangan" name="keterangan" className="isian" placeholder="mis. keperluan pribadi" />
          </div>
          <div className="md:col-span-2">
            <button type="submit" className="tombol tombol-utama">Catat prive</button>
          </div>
        </FormulirAksi>
      )}

      <div className="kartu kartu-tabel">
        <KontrolDaftar param={param} total={total} placeholder="Cari nomor / pemilik / keterangan" />
        <div className="bungkus-tabel">
          <table className="tabel min-w-[40rem]">
            <thead>
              <tr><th>No</th><th>Tanggal</th><th>Pemilik</th><th>Dari</th><th>Keterangan</th><th className="text-right">Jumlah</th><th>Jurnal</th><th /></tr>
            </thead>
            <tbody>
              {daftar.map((p) => (
                <tr key={p.id}>
                  <td><NomorDokumen nomor={p.nomor} /></td>
                  <td className="text-slate-500 whitespace-nowrap">{p.tanggal.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}</td>
                  <td>{p.pemilikNama}</td>
                  <td className="text-slate-500">{p.akunKas.kode} - {p.akunKas.nama}</td>
                  <td className="text-slate-600">{p.keterangan ?? "-"}</td>
                  <td className="text-right angka">{Number(p.jumlah).toLocaleString("id-ID")}</td>
                  <td className="mono text-slate-500">{p.jurnal?.nomor ?? "-"}</td>
                  <td className="text-right"><TombolHapusDokumen jenis="prive" id={p.id} nomor={p.nomor} boleh={bolehHapus} /></td>
                </tr>
              ))}
              {daftar.length === 0 && <tr><td colSpan={8} className="kosong">{param.q ? "Tidak ada yang cocok." : "Belum ada prive."}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
