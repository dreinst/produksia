import TombolHapusDokumen from "@/komponen/TombolHapusDokumen";
import { punyaHak, type Hak } from "@/lib/hakAkses";
import KontrolDaftar from "@/komponen/ui/KontrolDaftar";
import { bacaParamDaftar, cocokTeks } from "@/lib/daftar";
import { wajibHak } from "@/lib/otentikasi";
import Link from "next/link";
import { NomorDokumen, LencanaStatus } from "@/komponen/ui/Lencana";
import { db } from "@/lib/db";

export default async function HalamanFakturPenjualan({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const pengguna = await wajibHak("faktur.lihat");
  const boleh = (hak: Hak) => punyaHak(pengguna, hak);
  const bolehHapus = boleh("faktur.hapus");
  const param = await bacaParamDaftar(searchParams);
  const where = param.q ? { OR: [{ nomor: cocokTeks(param.q) }, { pelanggan: { nama: cocokTeks(param.q) } }] } : undefined;
  const [total, daftarFaktur] = await Promise.all([
    db.fakturPenjualan.count({ where }),
    db.fakturPenjualan.findMany({ where, include: { pelanggan: true, penerimaan: true }, orderBy: { tanggal: "desc" }, skip: param.lewati, take: param.ambil }),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="judul-halaman">Faktur Penjualan</h1>
      <p className="redup">
        Faktur dibuat dari halaman Pesanan Penjualan (tombol &quot;Fakturkan&quot;).
      </p>

      <div className="kartu kartu-tabel">
        <KontrolDaftar param={param} total={total} placeholder="Cari nomor / pelanggan…" />
        <div className="bungkus-tabel">
        <table className="tabel min-w-[36rem]">
        <thead>
          <tr>
            <th>No</th>
            <th>Tanggal</th>
            <th>Pelanggan</th>
            <th className="text-right">Total</th>
            <th className="text-right">Terbayar (termasuk DP)</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {daftarFaktur.map((inv) => {
            const paid = inv.penerimaan.reduce((s, r) => s + Number(r.jumlah) + Number(r.potonganPajak), 0) + Number(inv.uangMuka);
            return (
              <tr key={inv.id}>
                <td><NomorDokumen nomor={inv.nomor} /></td>
                <td className="text-slate-500 whitespace-nowrap">{inv.tanggal.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}</td>
                <td>{inv.pelanggan.nama}</td>
                <td className="text-right angka">{Number(inv.total).toLocaleString("id-ID")}</td>
                <td className="text-right angka">{paid.toLocaleString("id-ID")}</td>
                <td><LencanaStatus status={inv.status} /></td>
                <td className="space-x-3 whitespace-nowrap">
                  {inv.status !== "LUNAS" && boleh("penerimaan.buat") && (
                    <Link
                      href={`/penjualan/penerimaan/baru?fakturId=${inv.id}`}
                      className="tombol-tautan"
                    >
                      Terima Bayar
                    </Link>
                  )}
                  {boleh("retur-penjualan.buat") && (
                    <Link
                    href={`/penjualan/retur/baru?fakturId=${inv.id}`}
                    className="tombol-tautan"
                  >
                    Retur
                  </Link>
                  )}
                  <TombolHapusDokumen jenis="faktur" id={inv.id} nomor={inv.nomor} boleh={bolehHapus} />
                </td>
              </tr>
            );
          })}
          {daftarFaktur.length === 0 && (
            <tr>
              <td colSpan={7} className="kosong">
                {param.q ? "Tidak ada yang cocok dengan pencarian." : "Belum ada faktur."}
              </td>
            </tr>
          )}
        </tbody>
        </table>
      </div></div>
    </div>
  );
}
