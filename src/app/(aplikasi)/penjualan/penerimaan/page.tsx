import { punyaHak } from "@/lib/hakAkses";
import Link from "next/link";
import TombolHapusDokumen from "@/komponen/TombolHapusDokumen";
import KontrolDaftar from "@/komponen/ui/KontrolDaftar";
import { bacaParamDaftar, cocokTeks } from "@/lib/daftar";
import { wajibHak } from "@/lib/otentikasi";
import { db } from "@/lib/db";
import { labelMetodeBayar } from "@/komponen/ui/Lencana";
import { lingkupPerusahaan, saringPerusahaan } from "@/lib/perusahaan";
import { bacaFilterProyek, filterProyekSah, whereFilterProyekLewat } from "@/lib/filterProyek";
import LencanaPerusahaan from "@/komponen/ui/LencanaPerusahaan";
import FilterProyek from "@/komponen/proyek/FilterProyek";
import NomorDokumenCetak from "@/komponen/penjualan/NomorDokumenCetak";

export default async function HalamanPenerimaanPenjualan({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const pengguna = await wajibHak("penerimaan.lihat");
  const bolehHapus = punyaHak(pengguna, "penerimaan.hapus");
  const param = await bacaParamDaftar(searchParams);
  // Lingkup perusahaan (D1 §7.4); saringan proyek lewat faktur lalu pesanan (D5 §7.3), tidak dipasang bila "semua";
  // pencarian juga mencocokkan nomor kuitansi (nomor cetak)
  const [{ perusahaanId }, f] = await Promise.all([lingkupPerusahaan(), searchParams.then((sp) => filterProyekSah(db, bacaFilterProyek(sp)))]);
  const cari = param.q
    ? { OR: [{ nomor: cocokTeks(param.q) }, { nomorCetak: cocokTeks(param.q) }, { faktur: { nomor: cocokTeks(param.q) } }, { pelanggan: { nama: cocokTeks(param.q) } }] }
    : {};
  const where = { AND: [cari, saringPerusahaan(perusahaanId), f ? { faktur: whereFilterProyekLewat("pesanan", "pesananId", f) } : {}] };
  const [total, daftarPenerimaan, daftarProyek] = await Promise.all([
    db.penerimaanPenjualan.count({ where }),
    db.penerimaanPenjualan.findMany({
      where,
      select: {
        id: true,
        nomor: true,
        nomorCetak: true,
        tanggal: true,
        jumlah: true,
        metodeBayar: true,
        pelanggan: { select: { nama: true } },
        faktur: { select: { nomor: true } },
        perusahaan: { select: { kode: true, nama: true, warna: true } },
      },
      orderBy: { tanggal: "desc" },
      skip: param.lewati,
      take: param.ambil,
    }),
    db.proyek.findMany({ where: saringPerusahaan(perusahaanId), orderBy: { kode: "asc" }, select: { id: true, kode: true, nama: true, status: true } }),
  ]);
  const gabungan = !perusahaanId;

  return (
    <div className="space-y-6">
      <h1 className="judul-halaman">Penerimaan Penjualan</h1>
      <p className="redup">
        Penerimaan dibuat dari halaman Faktur Penjualan (tombol &quot;Terima Bayar&quot;).
      </p>

      <div className="kartu kartu-tabel">
        <div className="px-5 md:px-6 pt-3">
          <FilterProyek nilai={f} daftar={daftarProyek} tambahan={{ q: param.q || undefined }} />
        </div>
        <KontrolDaftar param={param} total={total} placeholder="Cari nomor / faktur / pelanggan…" tambahan={{ proyek: f || undefined }} />
        <div className="bungkus-tabel">
        <table className="tabel min-w-[36rem]">
        <thead>
          <tr>
            <th>No</th>
            {gabungan && <th>Perusahaan</th>}
            <th>Tanggal</th>
            <th>Faktur</th>
            <th>Pelanggan</th>
            <th className="text-right">Jumlah</th>
            <th>Metode</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {daftarPenerimaan.map((r) => (
            <tr key={r.id}>
              <td>
                <Link href={`/penjualan/penerimaan/${r.id}`} className="hover:underline">
                  <NomorDokumenCetak nomor={r.nomor} nomorCetak={r.nomorCetak} />
                </Link>
              </td>
              {gabungan && <td><LencanaPerusahaan kode={r.perusahaan.kode} warna={r.perusahaan.warna} nama={r.perusahaan.nama} /></td>}
              <td className="text-slate-500 whitespace-nowrap">{r.tanggal.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}</td>
              <td>{r.faktur.nomor}</td>
              <td>{r.pelanggan.nama}</td>
              <td className="text-right angka">{Number(r.jumlah).toLocaleString("id-ID")}</td>
              <td>{labelMetodeBayar(r.metodeBayar)}</td>
              <td className="text-right"><TombolHapusDokumen jenis="penerimaan" id={r.id} nomor={r.nomor} boleh={bolehHapus} /></td>
            </tr>
          ))}
          {daftarPenerimaan.length === 0 && (
            <tr>
              <td colSpan={gabungan ? 8 : 7} className="kosong">
                {param.q ? "Tidak ada yang cocok dengan pencarian." : f ? "Tidak ada yang cocok dengan saringan proyek." : "Belum ada penerimaan."}
              </td>
            </tr>
          )}
        </tbody>
        </table>
      </div></div>
    </div>
  );
}
