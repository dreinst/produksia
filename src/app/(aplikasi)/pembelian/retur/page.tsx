import { punyaHak } from "@/lib/hakAkses";
import TombolHapusDokumen from "@/komponen/TombolHapusDokumen";
import KontrolDaftar from "@/komponen/ui/KontrolDaftar";
import { bacaParamDaftar, cocokTeks } from "@/lib/daftar";
import { wajibHak } from "@/lib/otentikasi";
import { db } from "@/lib/db";
import { NomorDokumen } from "@/komponen/ui/Lencana";

export default async function HalamanReturPembelian({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const pengguna = await wajibHak("retur-pembelian.lihat");
  const bolehHapus = punyaHak(pengguna, "retur-pembelian.hapus");
  const param = await bacaParamDaftar(searchParams);
  const where = param.q ? { OR: [{ nomor: cocokTeks(param.q) }, { faktur: { nomor: cocokTeks(param.q) } }, { faktur: { pemasok: { nama: cocokTeks(param.q) } } }] } : undefined;
  const [total, daftarRetur] = await Promise.all([
    db.returPembelian.count({ where }),
    db.returPembelian.findMany({ where, include: { faktur: { include: { pemasok: true } }, gudang: true }, orderBy: { tanggal: "desc" }, skip: param.lewati, take: param.ambil }),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="judul-halaman">Retur Pembelian</h1>
      <p className="redup">
        Retur dibuat dari halaman Faktur Pembelian (tombol &quot;Retur&quot;).
      </p>

      <div className="kartu kartu-tabel">
        <KontrolDaftar param={param} total={total} placeholder="Cari nomor / faktur / pemasok…" />
        <div className="bungkus-tabel">
        <table className="tabel min-w-[36rem]">
        <thead>
          <tr>
            <th>No</th>
            <th>Tanggal</th>
            <th>Faktur</th>
            <th>Pemasok</th>
            <th>Gudang</th>
            <th>Alasan</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {daftarRetur.map((r) => (
            <tr key={r.id}>
              <td><NomorDokumen nomor={r.nomor} /></td>
              <td className="text-slate-500 whitespace-nowrap">{r.tanggal.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}</td>
              <td>{r.faktur.nomor}</td>
              <td>{r.faktur.pemasok.nama}</td>
              <td>{r.gudang.nama}</td>
              <td>{r.alasan ?? "-"}</td>
              <td className="text-right"><TombolHapusDokumen jenis="returPembelian" id={r.id} nomor={r.nomor} boleh={bolehHapus} /></td>
            </tr>
          ))}
          {daftarRetur.length === 0 && (
            <tr>
              <td colSpan={7} className="kosong">
                {param.q ? "Tidak ada yang cocok dengan pencarian." : "Belum ada retur pembelian."}
              </td>
            </tr>
          )}
        </tbody>
        </table>
      </div></div>
    </div>
  );
}
