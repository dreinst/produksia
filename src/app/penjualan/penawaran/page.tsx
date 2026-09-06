import Link from "next/link";
import { NomorDokumen, LencanaStatus } from "@/komponen/ui/Lencana";
import { db } from "@/lib/db";
import FormulirAksi from "@/komponen/FormulirAksi";
import { konversiPenawaranKePesananFormulir } from "@/lib/aksi/penjualan";

export default async function QuotationsPage() {
  const daftarPenawaran = await db.penawaranPenjualan.findMany({
    include: { pelanggan: true },
    orderBy: { tanggal: "desc" },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="judul-halaman">Penawaran Penjualan</h1>
        <Link href="/penjualan/penawaran/baru" className="tombol tombol-utama">
          + Penawaran Baru
        </Link>
      </div>

      <div className="kartu kartu-tabel"><div className="bungkus-tabel">
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
              <td>
                {q.status === "DRAF" && (
                  <FormulirAksi
                    aksi={konversiPenawaranKePesananFormulir.bind(null, q.id)}
                    pesanKonfirmasi={`Konversi penawaran ${q.nomor} menjadi Pesanan Penjualan?`}
                  >
                    <button type="submit" className="tombol-tautan">
                      Konversi ke Pesanan
                    </button>
                  </FormulirAksi>
                )}
              </td>
            </tr>
          ))}
          {daftarPenawaran.length === 0 && (
            <tr>
              <td colSpan={6} className="kosong">
                Belum ada penawaran.
              </td>
            </tr>
          )}
        </tbody>
        </table>
      </div></div>
    </div>
  );
}
