import TombolHapusDokumen from "@/komponen/TombolHapusDokumen";
import Link from "next/link";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { punyaHak } from "@/lib/hakAkses";
import { bacaParamDaftar, cocokTeks } from "@/lib/daftar";
import KontrolDaftar from "@/komponen/ui/KontrolDaftar";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import { NomorDokumen } from "@/komponen/ui/Lencana";

export default async function HalamanPindahBarang({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const pengguna = await wajibHak("pindah-barang.lihat");
  const bolehHapus = punyaHak(pengguna, "pindah-barang.hapus");
  const param = await bacaParamDaftar(searchParams);
  const where = param.q
    ? { OR: [{ nomor: cocokTeks(param.q) }, { keterangan: cocokTeks(param.q) }, { gudangAsal: { nama: cocokTeks(param.q) } }, { gudangTujuan: { nama: cocokTeks(param.q) } }] }
    : undefined;
  const [total, daftar] = await Promise.all([
    db.pindahBarang.count({ where }),
    db.pindahBarang.findMany({
      where,
      include: { gudangAsal: true, gudangTujuan: true, baris: { include: { barang: { select: { kode: true, satuan: true } } } } },
      orderBy: { tanggal: "desc" },
      skip: param.lewati,
      take: param.ambil,
    }),
  ]);

  return (
    <div className="space-y-6">
      <KepalaHalaman
        jejak={[{ label: "Persediaan" }, { label: "Stok per Gudang", href: "/persediaan" }]}
        judul="Pindah Barang"
        subjudul="Perpindahan stok fisik antar gudang. Nilai persediaan tidak berubah, jadi tidak ada jurnal."
        aksi={
          punyaHak(pengguna, "pindah-barang.buat") ? (
            <Link href="/persediaan/pindah/baru" className="tombol tombol-utama">
              + Pindah Barang Baru
            </Link>
          ) : undefined
        }
      />

      <div className="kartu kartu-tabel">
        <KontrolDaftar param={param} total={total} placeholder="Cari nomor / keterangan / gudang…" />
        <div className="bungkus-tabel">
          <table className="tabel min-w-[44rem]">
            <thead>
              <tr>
                <th>No</th>
                <th>Tanggal</th>
                <th>Dari</th>
                <th>Ke</th>
                <th>Keterangan</th>
                <th>Barang</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {daftar.map((p) => (
                <tr key={p.id}>
                  <td><NomorDokumen nomor={p.nomor} /></td>
                  <td className="text-slate-500 whitespace-nowrap">{p.tanggal.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}</td>
                  <td>{p.gudangAsal.nama}</td>
                  <td>{p.gudangTujuan.nama}</td>
                  <td className="text-slate-600">{p.keterangan ?? "-"}</td>
                  <td className="text-slate-600 text-xs">
                    {p.baris.map((b) => (
                      <span key={b.id} className="inline-block mr-2 whitespace-nowrap">
                        <span className="mono">{b.barang.kode}</span> × <span className="angka">{Number(b.jumlah).toLocaleString("id-ID")}</span> {b.barang.satuan}
                      </span>
                    ))}
                  </td>
                  <td className="text-right"><TombolHapusDokumen jenis="pindahBarang" id={p.id} nomor={p.nomor} boleh={bolehHapus} /></td>
                </tr>
              ))}
              {daftar.length === 0 && (
                <tr>
                  <td colSpan={7} className="kosong">
                    {param.q ? "Tidak ada yang cocok dengan pencarian." : "Belum ada pindah barang."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
