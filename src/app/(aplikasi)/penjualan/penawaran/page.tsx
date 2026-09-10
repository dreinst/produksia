import TombolHapusDokumen from "@/komponen/TombolHapusDokumen";
import { punyaHak, type Hak } from "@/lib/hakAkses";
import KontrolDaftar from "@/komponen/ui/KontrolDaftar";
import { bacaParamDaftar, cocokTeks } from "@/lib/daftar";
import { wajibHak } from "@/lib/otentikasi";
import Link from "next/link";
import { NomorDokumen, LencanaStatus } from "@/komponen/ui/Lencana";
import { db } from "@/lib/db";
import FormulirAksi from "@/komponen/FormulirAksi";
import { konversiPenawaranKePesananFormulir } from "@/lib/aksi/penjualan";

export default async function HalamanPenawaran({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const pengguna = await wajibHak("penjualan.lihat");
  const boleh = (hak: Hak) => punyaHak(pengguna.peran, hak);
  const bolehHapus = boleh("dokumen.hapus");
  const param = await bacaParamDaftar(searchParams);
  const where = param.q ? { OR: [{ nomor: cocokTeks(param.q) }, { pelanggan: { nama: cocokTeks(param.q) } }] } : undefined;
  const [total, daftarPenawaran] = await Promise.all([
    db.penawaranPenjualan.count({ where }),
    db.penawaranPenjualan.findMany({ where, include: { pelanggan: true }, orderBy: { tanggal: "desc" }, skip: param.lewati, take: param.ambil }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="judul-halaman">Penawaran Penjualan</h1>
        {boleh("penjualan.tulis") && (
          <Link href="/penjualan/penawaran/baru" className="tombol tombol-utama">
          + Penawaran Baru
        </Link>
        )}
      </div>

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
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {daftarPenawaran.map((q) => (
            <tr key={q.id}>
              <td><NomorDokumen nomor={q.nomor} /></td>
              <td className="text-slate-500 whitespace-nowrap">{q.tanggal.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}</td>
              <td>{q.pelanggan.nama}</td>
              <td className="text-right angka">{Number(q.total).toLocaleString("id-ID")}</td>
              <td><LencanaStatus status={q.status} /></td>
              <td className="space-x-3 whitespace-nowrap">
                {q.status === "DRAF" && boleh("penjualan.tulis") && (
                  <FormulirAksi
                    aksi={konversiPenawaranKePesananFormulir.bind(null, q.id)}
                    pesanKonfirmasi={`Konversi penawaran ${q.nomor} menjadi Pesanan Penjualan?`}
                  >
                    <button type="submit" className="tombol-tautan">
                      Konversi ke Pesanan
                    </button>
                  </FormulirAksi>
                )}
                <TombolHapusDokumen jenis="penawaran" id={q.id} nomor={q.nomor} boleh={bolehHapus} />
              </td>
            </tr>
          ))}
          {daftarPenawaran.length === 0 && (
            <tr>
              <td colSpan={6} className="kosong">
                {param.q ? "Tidak ada yang cocok dengan pencarian." : "Belum ada penawaran."}
              </td>
            </tr>
          )}
        </tbody>
        </table>
      </div></div>
    </div>
  );
}
