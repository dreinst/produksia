import TombolHapusDokumen from "@/komponen/TombolHapusDokumen";
import { punyaHak, type Hak } from "@/lib/hakAkses";
import KontrolDaftar from "@/komponen/ui/KontrolDaftar";
import { bacaParamDaftar, cocokTeks } from "@/lib/daftar";
import { wajibHak } from "@/lib/otentikasi";
import Link from "next/link";
import { LencanaStatus } from "@/komponen/ui/Lencana";
import { db } from "@/lib/db";
import FormulirAksi from "@/komponen/FormulirAksi";
import { konversiPenawaranKePesananFormulir } from "@/lib/aksi/penjualan";
import { lingkupPerusahaan, saringPerusahaan } from "@/lib/perusahaan";
import { bacaFilterProyek, filterProyekSah, whereFilterProyek } from "@/lib/filterProyek";
import { tanggalIso } from "@/lib/waktu";
import LencanaPerusahaan from "@/komponen/ui/LencanaPerusahaan";
import FilterProyek from "@/komponen/proyek/FilterProyek";
import NomorDokumenCetak from "@/komponen/penjualan/NomorDokumenCetak";
import LencanaStatusKomersial from "@/komponen/penjualan/LencanaStatusKomersial";

export default async function HalamanPenawaran({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const pengguna = await wajibHak("penawaran.lihat");
  const boleh = (hak: Hak) => punyaHak(pengguna, hak);
  const bolehHapus = boleh("penawaran.hapus");
  const param = await bacaParamDaftar(searchParams);
  // Lingkup perusahaan (D1 §7.4): satu perusahaan = dokumen miliknya; gabungan = semua + kolom Perusahaan.
  // Saringan proyek ?proyek= (D5 §7.3); pencarian juga mencocokkan nomor cetak (D2 §7.1).
  const [{ perusahaanId }, f] = await Promise.all([lingkupPerusahaan(), searchParams.then((sp) => filterProyekSah(db, bacaFilterProyek(sp)))]);
  const cari = param.q ? { OR: [{ nomor: cocokTeks(param.q) }, { nomorCetak: cocokTeks(param.q) }, { pelanggan: { nama: cocokTeks(param.q) } }] } : {};
  const where = { AND: [cari, saringPerusahaan(perusahaanId), whereFilterProyek(f)] };
  const [total, daftarPenawaran, daftarProyek] = await Promise.all([
    db.penawaranPenjualan.count({ where }),
    db.penawaranPenjualan.findMany({
      where,
      select: {
        id: true,
        nomor: true,
        nomorCetak: true,
        tanggal: true,
        total: true,
        status: true,
        statusKomersial: true,
        berlakuSampai: true,
        pelanggan: { select: { nama: true } },
        perusahaan: { select: { kode: true, nama: true, warna: true } },
      },
      orderBy: { tanggal: "desc" },
      skip: param.lewati,
      take: param.ambil,
    }),
    db.proyek.findMany({ where: saringPerusahaan(perusahaanId), orderBy: { kode: "asc" }, select: { id: true, kode: true, nama: true, status: true } }),
  ]);
  const gabungan = !perusahaanId;
  const hariIni = tanggalIso(new Date());

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="judul-halaman">Penawaran Penjualan</h1>
        {boleh("penawaran.buat") && (
          <Link href="/penjualan/penawaran/baru" className="tombol tombol-utama">
          + Penawaran Baru
        </Link>
        )}
      </div>

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
            <th>Status</th>
            <th>Status klien</th>
            <th className="th-lekat" />
          </tr>
        </thead>
        <tbody>
          {daftarPenawaran.map((q) => (
            <tr key={q.id}>
              <td>
                <Link href={`/penjualan/penawaran/${q.id}`} className="hover:underline">
                  <NomorDokumenCetak nomor={q.nomor} nomorCetak={q.nomorCetak} />
                </Link>
              </td>
              {gabungan && <td><LencanaPerusahaan kode={q.perusahaan.kode} warna={q.perusahaan.warna} nama={q.perusahaan.nama} /></td>}
              <td className="text-slate-500 whitespace-nowrap">{q.tanggal.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}</td>
              <td>{q.pelanggan.nama}</td>
              <td className="text-right angka">{Number(q.total).toLocaleString("id-ID")}</td>
              <td><LencanaStatus status={q.status} /></td>
              <td>
                <span className="flex flex-wrap items-center gap-1">
                  <LencanaStatusKomersial status={q.statusKomersial} />
                  {q.status === "DRAF" && q.berlakuSampai && tanggalIso(q.berlakuSampai) < hariIni && <span className="lencana lencana-amber">Lewat masa berlaku</span>}
                </span>
              </td>
              <td className="space-x-3 whitespace-nowrap td-lekat">
                {q.status === "DRAF" && boleh("pesanan.buat") && (
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
              <td colSpan={gabungan ? 8 : 7} className="kosong">
                {param.q ? "Tidak ada yang cocok dengan pencarian." : f ? "Tidak ada yang cocok dengan saringan proyek." : "Belum ada penawaran."}
              </td>
            </tr>
          )}
        </tbody>
        </table>
      </div></div>
    </div>
  );
}
