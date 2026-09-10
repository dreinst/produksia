import TombolHapusDokumen from "@/komponen/TombolHapusDokumen";
import { punyaHak, type Hak } from "@/lib/hakAkses";
import KontrolDaftar from "@/komponen/ui/KontrolDaftar";
import { bacaParamDaftar, cocokTeks } from "@/lib/daftar";
import { wajibHak } from "@/lib/otentikasi";
import Link from "next/link";
import { NomorDokumen, LencanaStatus } from "@/komponen/ui/Lencana";
import { db } from "@/lib/db";

export default async function HalamanPesananPembelian({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const pengguna = await wajibHak("pesanan-pembelian.lihat");
  const boleh = (hak: Hak) => punyaHak(pengguna, hak);
  const bolehHapus = boleh("pesanan-pembelian.hapus");
  const param = await bacaParamDaftar(searchParams);
  const where = param.q ? { OR: [{ nomor: cocokTeks(param.q) }, { pemasok: { nama: cocokTeks(param.q) } }] } : undefined;
  const [total, daftarPesanan] = await Promise.all([
    db.pesananPembelian.count({ where }),
    db.pesananPembelian.findMany({ where, include: { pemasok: true, baris: true }, orderBy: { tanggal: "desc" }, skip: param.lewati, take: param.ambil }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="judul-halaman">Pesanan Pembelian</h1>
        {boleh("pesanan-pembelian.buat") && (
          <Link href="/pembelian/pesanan/baru" className="tombol tombol-utama">
          + Pesanan Baru
        </Link>
        )}
      </div>

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
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {daftarPesanan.map((o) => {
            const diterimaSemua = o.baris.every((l) => Number(l.jumlahDiterima) >= Number(l.jumlah));
            const difakturSemua = o.baris.every((l) => Number(l.jumlahDifaktur) >= Number(l.jumlah));
            return (
              <tr key={o.id}>
                <td><NomorDokumen nomor={o.nomor} /></td>
                <td className="text-slate-500 whitespace-nowrap">{o.tanggal.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}</td>
                <td>{o.pemasok.nama}</td>
                <td className="text-right angka">{Number(o.total).toLocaleString("id-ID")}</td>
                <td><LencanaStatus status={o.status} /></td>
                <td className="space-x-3 whitespace-nowrap">
                  {!diterimaSemua && boleh("penerimaan-barang.buat") && (
                    <Link
                      href={`/pembelian/penerimaan-barang/baru?pesananId=${o.id}`}
                      className="tombol-tautan"
                    >
                      Terima Barang
                    </Link>
                  )}
                  {!difakturSemua && boleh("faktur-pembelian.buat") && (
                    <Link
                      href={`/pembelian/faktur/baru?pesananId=${o.id}`}
                      className="tombol-tautan"
                    >
                      Fakturkan
                    </Link>
                  )}
                  <TombolHapusDokumen jenis="pesananPembelian" id={o.id} nomor={o.nomor} boleh={bolehHapus} />
                </td>
              </tr>
            );
          })}
          {daftarPesanan.length === 0 && (
            <tr>
              <td colSpan={6} className="kosong">
                {param.q ? "Tidak ada yang cocok dengan pencarian." : "Belum ada pesanan pembelian."}
              </td>
            </tr>
          )}
        </tbody>
        </table>
      </div></div>
    </div>
  );
}
