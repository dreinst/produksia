import { punyaHak } from "@/lib/hakAkses";
import TombolHapusDokumen from "@/komponen/TombolHapusDokumen";
import KontrolDaftar from "@/komponen/ui/KontrolDaftar";
import { bacaParamDaftar, cocokTeks } from "@/lib/daftar";
import { wajibHak } from "@/lib/otentikasi";
import { db } from "@/lib/db";
import { NomorDokumen, LencanaStatus } from "@/komponen/ui/Lencana";

export default async function HalamanPenerimaanBarang({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const pengguna = await wajibHak("pembelian.lihat");
  const bolehHapus = punyaHak(pengguna.peran, "dokumen.hapus");
  const param = await bacaParamDaftar(searchParams);
  const where = param.q ? { OR: [{ nomor: cocokTeks(param.q) }, { pesanan: { nomor: cocokTeks(param.q) } }, { pesanan: { pemasok: { nama: cocokTeks(param.q) } } }] } : undefined;
  const [total, daftarPenerimaan] = await Promise.all([
    db.penerimaanBarang.count({ where }),
    db.penerimaanBarang.findMany({ where, include: { pesanan: { include: { pemasok: true } }, gudang: true }, orderBy: { tanggal: "desc" }, skip: param.lewati, take: param.ambil }),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="judul-halaman">Penerimaan Barang</h1>
      <p className="redup">
        Penerimaan dibuat dari halaman Pesanan Pembelian (tombol &quot;Terima Barang&quot;).
      </p>

      <div className="kartu kartu-tabel">
        <KontrolDaftar param={param} total={total} placeholder="Cari nomor TB / pesanan / pemasok…" />
        <div className="bungkus-tabel">
        <table className="tabel min-w-[36rem]">
        <thead>
          <tr>
            <th>No</th>
            <th>Tanggal</th>
            <th>Pesanan</th>
            <th>Pemasok</th>
            <th>Gudang</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {daftarPenerimaan.map((r) => (
            <tr key={r.id}>
              <td><NomorDokumen nomor={r.nomor} /></td>
              <td className="text-slate-500 whitespace-nowrap">{r.tanggal.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}</td>
              <td>{r.pesanan.nomor}</td>
              <td>{r.pesanan.pemasok.nama}</td>
              <td>{r.gudang.nama}</td>
              <td><LencanaStatus status={r.status} /></td>
              <td className="text-right"><TombolHapusDokumen jenis="penerimaanBarang" id={r.id} nomor={r.nomor} boleh={bolehHapus} /></td>
            </tr>
          ))}
          {daftarPenerimaan.length === 0 && (
            <tr>
              <td colSpan={7} className="kosong">
                {param.q ? "Tidak ada yang cocok dengan pencarian." : "Belum ada penerimaan barang."}
              </td>
            </tr>
          )}
        </tbody>
        </table>
      </div></div>
    </div>
  );
}
