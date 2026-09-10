import { punyaHak } from "@/lib/hakAkses";
import TombolHapusDokumen from "@/komponen/TombolHapusDokumen";
import KontrolDaftar from "@/komponen/ui/KontrolDaftar";
import { bacaParamDaftar, cocokTeks } from "@/lib/daftar";
import { wajibHak } from "@/lib/otentikasi";
import { db } from "@/lib/db";
import { NomorDokumen, labelMetodeBayar } from "@/komponen/ui/Lencana";

export default async function HalamanUangMuka({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const pengguna = await wajibHak("uang-muka.lihat");
  const bolehHapus = punyaHak(pengguna, "uang-muka.hapus");
  const param = await bacaParamDaftar(searchParams);
  const where = param.q ? { OR: [{ nomor: cocokTeks(param.q) }, { pesanan: { nomor: cocokTeks(param.q) } }, { pelanggan: { nama: cocokTeks(param.q) } }] } : undefined;
  const [total, daftar] = await Promise.all([
    db.uangMukaPelanggan.count({ where }),
    db.uangMukaPelanggan.findMany({ where, include: { pelanggan: true, pesanan: true, akun: true }, orderBy: { tanggal: "desc" }, skip: param.lewati, take: param.ambil }),
  ]);
  const rp = (n: { toString(): string } | number) => Number(n).toLocaleString("id-ID");

  return (
    <div className="space-y-6">
      <h1 className="judul-halaman">Uang Muka Pelanggan</h1>
      <p className="redup">
        DP yang diterima di muka atas sebuah Pesanan Penjualan (tombol &quot;Uang Muka&quot; di daftar pesanan). Dicatat sebagai kewajiban Uang Muka Pelanggan sampai dipakai mengurangi piutang saat faktur dibuat.
      </p>

      <div className="kartu kartu-tabel">
        <KontrolDaftar param={param} total={total} placeholder="Cari nomor / pesanan / pelanggan…" />
        <div className="bungkus-tabel">
        <table className="tabel min-w-[48rem]">
        <thead>
          <tr>
            <th>No</th>
            <th>Tanggal</th>
            <th>Pesanan</th>
            <th>Pelanggan</th>
            <th>Akun</th>
            <th className="text-right">Jumlah</th>
            <th className="text-right">Dipakai</th>
            <th className="text-right">Sisa</th>
            <th>Metode</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {daftar.map((u) => (
            <tr key={u.id}>
              <td><NomorDokumen nomor={u.nomor} /></td>
              <td className="text-slate-500 whitespace-nowrap">{u.tanggal.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}</td>
              <td>{u.pesanan.nomor}</td>
              <td>{u.pelanggan.nama}</td>
              <td className="text-slate-500">{u.akun.kode} · {u.akun.nama}</td>
              <td className="text-right angka">{rp(u.jumlah)}</td>
              <td className="text-right angka">{rp(u.jumlahDipakai)}</td>
              <td className="text-right angka font-semibold">{rp(Number(u.jumlah) - Number(u.jumlahDipakai))}</td>
              <td>{labelMetodeBayar(u.metodeBayar)}</td>
              <td className="text-right"><TombolHapusDokumen jenis="uangMuka" id={u.id} nomor={u.nomor} boleh={bolehHapus} /></td>
            </tr>
          ))}
          {daftar.length === 0 && (
            <tr>
              <td colSpan={10} className="kosong">
                {param.q ? "Tidak ada yang cocok dengan pencarian." : "Belum ada uang muka."}
              </td>
            </tr>
          )}
        </tbody>
        </table>
      </div></div>
    </div>
  );
}
