import TombolHapusDokumen from "@/komponen/TombolHapusDokumen";
import { punyaHak, type Hak } from "@/lib/hakAkses";
import KontrolDaftar from "@/komponen/ui/KontrolDaftar";
import { bacaParamDaftar, cocokTeks } from "@/lib/daftar";
import { wajibHak } from "@/lib/otentikasi";
import Link from "next/link";
import { LencanaStatus } from "@/komponen/ui/Lencana";
import { SelPersetujuan } from "@/komponen/KontrolPersetujuan";
import { db } from "@/lib/db";
import { lingkupPerusahaan, saringPerusahaan } from "@/lib/perusahaan";
import { bacaFilterProyek, filterProyekSah, whereFilterProyekLewat } from "@/lib/filterProyek";
import LencanaPerusahaan from "@/komponen/ui/LencanaPerusahaan";
import FilterProyek from "@/komponen/proyek/FilterProyek";
import NomorDokumenCetak from "@/komponen/penjualan/NomorDokumenCetak";

export default async function HalamanFakturPenjualan({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const pengguna = await wajibHak("faktur.lihat");
  const boleh = (hak: Hak) => punyaHak(pengguna, hak);
  const bolehHapus = boleh("faktur.hapus");
  const param = await bacaParamDaftar(searchParams);
  // Lingkup perusahaan (D1 §7.4); saringan proyek lewat pesanan (faktur tanpa pesanan = tanpa proyek, D5 §7.3);
  // pencarian juga mencocokkan nomor cetak (D2 §7.1)
  const [{ perusahaanId }, f] = await Promise.all([lingkupPerusahaan(), searchParams.then((sp) => filterProyekSah(db, bacaFilterProyek(sp)))]);
  const cari = param.q ? { OR: [{ nomor: cocokTeks(param.q) }, { nomorCetak: cocokTeks(param.q) }, { pelanggan: { nama: cocokTeks(param.q) } }] } : {};
  const where = { AND: [cari, saringPerusahaan(perusahaanId), whereFilterProyekLewat("pesanan", "pesananId", f)] };
  const [total, daftarFaktur, daftarProyek] = await Promise.all([
    db.fakturPenjualan.count({ where }),
    db.fakturPenjualan.findMany({
      where,
      select: {
        id: true,
        nomor: true,
        nomorCetak: true,
        tanggal: true,
        total: true,
        uangMuka: true,
        status: true,
        statusPersetujuan: true,
        diajukanOlehId: true,
        catatanPenolakan: true,
        pelanggan: { select: { nama: true } },
        perusahaan: { select: { kode: true, nama: true, warna: true } },
        penerimaan: { select: { jumlah: true, potonganPajak: true } },
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
      <h1 className="judul-halaman">Faktur Penjualan</h1>
      <p className="redup">
        Faktur dibuat dari halaman Pesanan Penjualan (tombol &quot;Fakturkan&quot;). Selama alur persetujuan
        menyala, faktur baru berstatus Draf dan belum masuk buku besar sampai diajukan lalu disetujui pengguna lain.
      </p>

      <div className="kartu kartu-tabel">
        <div className="px-5 md:px-6 pt-3">
          <FilterProyek nilai={f} daftar={daftarProyek} tambahan={{ q: param.q || undefined }} />
        </div>
        <KontrolDaftar param={param} total={total} placeholder="Cari nomor / nomor cetak / pelanggan…" tambahan={{ proyek: f || undefined }} />
        <div className="bungkus-tabel">
        <table className="tabel min-w-[36rem]">
        <thead>
          <tr>
            <th>No</th>
            {gabungan && <th>Perusahaan</th>}
            <th>Tanggal</th>
            <th>Pelanggan</th>
            <th className="text-right">Total</th>
            <th className="text-right">Terbayar (termasuk DP)</th>
            <th>Status</th>
            <th>Persetujuan</th>
            <th className="th-lekat" />
          </tr>
        </thead>
        <tbody>
          {daftarFaktur.map((inv) => {
            const paid = inv.penerimaan.reduce((s, r) => s + Number(r.jumlah) + Number(r.potonganPajak), 0) + Number(inv.uangMuka);
            return (
              <tr key={inv.id}>
                <td>
                  <Link href={`/penjualan/faktur/${inv.id}`} className="hover:underline">
                    <NomorDokumenCetak nomor={inv.nomor} nomorCetak={inv.nomorCetak} />
                  </Link>
                </td>
                {gabungan && <td><LencanaPerusahaan kode={inv.perusahaan.kode} warna={inv.perusahaan.warna} nama={inv.perusahaan.nama} /></td>}
                <td className="text-slate-500 whitespace-nowrap">{inv.tanggal.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}</td>
                <td>{inv.pelanggan.nama}</td>
                <td className="text-right angka">{Number(inv.total).toLocaleString("id-ID")}</td>
                <td className="text-right angka">{paid.toLocaleString("id-ID")}</td>
                <td><LencanaStatus status={inv.status} /></td>
                <td>
                  <SelPersetujuan
                    jenis="faktur"
                    kode="faktur"
                    id={inv.id}
                    nomor={inv.nomor}
                    status={inv.statusPersetujuan}
                    diajukanOlehId={inv.diajukanOlehId}
                    pengguna={pengguna}
                    catatanPenolakan={inv.catatanPenolakan}
                  />
                </td>
                <td className="space-x-3 whitespace-nowrap td-lekat">
                  {inv.statusPersetujuan === "DISETUJUI" && inv.status !== "LUNAS" && boleh("penerimaan.buat") && (
                    <Link
                      href={`/penjualan/penerimaan/baru?fakturId=${inv.id}`}
                      className="tombol-tautan"
                    >
                      Terima Bayar
                    </Link>
                  )}
                  {inv.statusPersetujuan === "DISETUJUI" && boleh("retur-penjualan.buat") && (
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
              <td colSpan={gabungan ? 9 : 8} className="kosong">
                {param.q ? "Tidak ada yang cocok dengan pencarian." : f ? "Tidak ada yang cocok dengan saringan proyek." : "Belum ada faktur."}
              </td>
            </tr>
          )}
        </tbody>
        </table>
      </div></div>
    </div>
  );
}
