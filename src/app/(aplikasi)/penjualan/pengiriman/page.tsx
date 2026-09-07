import KontrolDaftar from "@/komponen/ui/KontrolDaftar";
import { bacaParamDaftar, cocokTeks } from "@/lib/daftar";
import { wajibHak } from "@/lib/otentikasi";
import { db } from "@/lib/db";
import { NomorDokumen, LencanaStatus } from "@/komponen/ui/Lencana";

export default async function HalamanPengiriman({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await wajibHak("penjualan.lihat");
  const param = await bacaParamDaftar(searchParams);
  const where = param.q ? { OR: [{ nomor: cocokTeks(param.q) }, { pesanan: { nomor: cocokTeks(param.q) } }, { pesanan: { pelanggan: { nama: cocokTeks(param.q) } } }] } : undefined;
  const [total, daftarPengiriman] = await Promise.all([
    db.pengirimanPesanan.count({ where }),
    db.pengirimanPesanan.findMany({ where, include: { pesanan: { include: { pelanggan: true } }, gudang: true }, orderBy: { tanggal: "desc" }, skip: param.lewati, take: param.ambil }),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="judul-halaman">Pengiriman Pesanan</h1>
      <p className="redup">
        Pengiriman dibuat dari halaman Pesanan Penjualan (tombol &quot;Kirim&quot;).
      </p>

      <div className="kartu kartu-tabel">
        <KontrolDaftar param={param} total={total} placeholder="Cari nomor SJ / pesanan / pelanggan…" />
        <div className="bungkus-tabel">
        <table className="tabel min-w-[36rem]">
        <thead>
          <tr>
            <th>No</th>
            <th>Tanggal</th>
            <th>Pesanan</th>
            <th>Pelanggan</th>
            <th>Gudang</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {daftarPengiriman.map((d) => (
            <tr key={d.id}>
              <td><NomorDokumen nomor={d.nomor} /></td>
              <td className="text-slate-500 whitespace-nowrap">{d.tanggal.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}</td>
              <td>{d.pesanan.nomor}</td>
              <td>{d.pesanan.pelanggan.nama}</td>
              <td>{d.gudang.nama}</td>
              <td><LencanaStatus status={d.status} /></td>
            </tr>
          ))}
          {daftarPengiriman.length === 0 && (
            <tr>
              <td colSpan={6} className="kosong">
                {param.q ? "Tidak ada yang cocok dengan pencarian." : "Belum ada pengiriman."}
              </td>
            </tr>
          )}
        </tbody>
        </table>
      </div></div>
    </div>
  );
}
