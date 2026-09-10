import TombolHapusDokumen from "@/komponen/TombolHapusDokumen";
import { punyaHak, type Hak } from "@/lib/hakAkses";
import KontrolDaftar from "@/komponen/ui/KontrolDaftar";
import { bacaParamDaftar, cocokTeks } from "@/lib/daftar";
import { wajibHak } from "@/lib/otentikasi";
import Link from "next/link";
import { LencanaStatus } from "@/komponen/ui/Lencana";
import { db } from "@/lib/db";

export default async function HalamanAsetTetap({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const pengguna = await wajibHak("aset-tetap.lihat");
  const boleh = (hak: Hak) => punyaHak(pengguna.peran, hak);
  const bolehHapus = boleh("dokumen.hapus");
  const param = await bacaParamDaftar(searchParams);
  const where = param.q ? { OR: [{ kode: cocokTeks(param.q) }, { nama: cocokTeks(param.q) }] } : undefined;
  const [total, daftarAset] = await Promise.all([
    db.asetTetap.count({ where }),
    db.asetTetap.findMany({ where, include: { penyusutan: true, akunAset: true }, orderBy: { kode: "asc" }, skip: param.lewati, take: param.ambil }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="judul-halaman">Daftar Aset Tetap</h1>
        {boleh("aset-tetap.tulis") && (
          <div className="space-x-3">
          <Link href="/aset-tetap/penyusutan" className="tombol-tautan">
            Jalankan Penyusutan →
          </Link>
          <Link href="/aset-tetap/baru" className="tombol tombol-utama">
            + Aset Baru
          </Link>
        </div>
        )}
      </div>

      <div className="kartu kartu-tabel">
        <KontrolDaftar param={param} total={total} placeholder="Cari kode / nama aset…" />
        <div className="bungkus-tabel">
        <table className="tabel min-w-[36rem]">
        <thead>
          <tr>
            <th>Kode</th>
            <th>Nama</th>
            <th>Tanggal Perolehan</th>
            <th className="text-right angka">Harga Perolehan</th>
            <th className="text-right angka">Akumulasi Penyusutan</th>
            <th className="text-right angka">Nilai Buku</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {daftarAset.map((a) => {
            const accumulated = a.penyusutan.reduce((s, d) => s + Number(d.jumlah), 0);
            const bookValue = Number(a.hargaPerolehan) - accumulated;
            return (
              <tr key={a.id}>
                <td>{a.kode}</td>
                <td>{a.nama}</td>
                <td>{a.tanggalPerolehan.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}</td>
                <td className="text-right angka">{Number(a.hargaPerolehan).toLocaleString("id-ID")}</td>
                <td className="text-right angka">{accumulated.toLocaleString("id-ID")}</td>
                <td className="text-right angka font-semibold">{bookValue.toLocaleString("id-ID")}</td>
                <td><LencanaStatus status={a.status} /></td>
                <td className="text-right"><TombolHapusDokumen jenis="aset" id={a.id} nomor={a.kode} boleh={bolehHapus} /></td>
              </tr>
            );
          })}
          {daftarAset.length === 0 && (
            <tr>
              <td colSpan={8} className="kosong">
                {param.q ? "Tidak ada yang cocok dengan pencarian." : "Belum ada aset tetap."}
              </td>
            </tr>
          )}
        </tbody>
        </table>
      </div></div>
    </div>
  );
}
