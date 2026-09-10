import TombolHapusDokumen from "@/komponen/TombolHapusDokumen";
import { punyaHak, type Hak } from "@/lib/hakAkses";
import KontrolDaftar from "@/komponen/ui/KontrolDaftar";
import { bacaParamDaftar, cocokTeks } from "@/lib/daftar";
import { wajibHak } from "@/lib/otentikasi";
import Link from "next/link";
import { NomorDokumen, LencanaStatus } from "@/komponen/ui/Lencana";
import { db } from "@/lib/db";

export default async function HalamanFakturPembelian({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const pengguna = await wajibHak("pembelian.lihat");
  const boleh = (hak: Hak) => punyaHak(pengguna.peran, hak);
  const bolehHapus = boleh("dokumen.hapus");
  const param = await bacaParamDaftar(searchParams);
  const where = param.q ? { OR: [{ nomor: cocokTeks(param.q) }, { pemasok: { nama: cocokTeks(param.q) } }] } : undefined;
  const [total, daftarFaktur] = await Promise.all([
    db.fakturPembelian.count({ where }),
    db.fakturPembelian.findMany({ where, include: { pemasok: true, pembayaran: true }, orderBy: { tanggal: "desc" }, skip: param.lewati, take: param.ambil }),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="judul-halaman">Faktur Pembelian</h1>
      <p className="redup">
        Faktur dibuat dari halaman Pesanan Pembelian (tombol &quot;Fakturkan&quot;).
      </p>

      <div className="kartu kartu-tabel">
        <KontrolDaftar param={param} total={total} placeholder="Cari nomor / pemasok…" />
        <div className="bungkus-tabel">
        <table className="tabel min-w-[36rem]">
        <thead>
          <tr>
            <th>No</th>
            <th>Tanggal</th>
            <th>Pemasok</th>
            <th className="text-right">Total</th>
            <th className="text-right">Terbayar</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {daftarFaktur.map((inv) => {
            const paid = inv.pembayaran.reduce((s, p) => s + Number(p.jumlah), 0);
            return (
              <tr key={inv.id}>
                <td><NomorDokumen nomor={inv.nomor} /></td>
                <td className="text-slate-500 whitespace-nowrap">{inv.tanggal.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}</td>
                <td>{inv.pemasok.nama}</td>
                <td className="text-right angka">{Number(inv.total).toLocaleString("id-ID")}</td>
                <td className="text-right angka">{paid.toLocaleString("id-ID")}</td>
                <td><LencanaStatus status={inv.status} /></td>
                <td className="space-x-3 whitespace-nowrap">
                  {inv.status !== "LUNAS" && boleh("pembelian.tulis") && (
                    <Link
                      href={`/pembelian/pembayaran/baru?fakturId=${inv.id}`}
                      className="tombol-tautan"
                    >
                      Bayar
                    </Link>
                  )}
                  {boleh("pembelian.tulis") && (
                    <Link
                    href={`/pembelian/retur/baru?fakturId=${inv.id}`}
                    className="tombol-tautan"
                  >
                    Retur
                  </Link>
                  )}
                  <TombolHapusDokumen jenis="fakturPembelian" id={inv.id} nomor={inv.nomor} boleh={bolehHapus} />
                </td>
              </tr>
            );
          })}
          {daftarFaktur.length === 0 && (
            <tr>
              <td colSpan={7} className="kosong">
                {param.q ? "Tidak ada yang cocok dengan pencarian." : "Belum ada faktur pembelian."}
              </td>
            </tr>
          )}
        </tbody>
        </table>
      </div></div>
    </div>
  );
}
