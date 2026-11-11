import TombolHapusDokumen from "@/komponen/TombolHapusDokumen";
import { punyaHak, type Hak } from "@/lib/hakAkses";
import KontrolDaftar from "@/komponen/ui/KontrolDaftar";
import { bacaParamDaftar, cocokTeks } from "@/lib/daftar";
import { wajibHak } from "@/lib/otentikasi";
import Link from "next/link";
import { LencanaStatus } from "@/komponen/ui/Lencana";
import { db } from "@/lib/db";
import { jumlahkan, type Desimal } from "@/lib/uang";
import { lingkupPerusahaan, saringPerusahaan } from "@/lib/perusahaan";
import { bacaFilterProyek, filterProyekSah, whereFilterProyek } from "@/lib/filterProyek";
import { brutoRencana } from "@/lib/rencanaTermin";
import LencanaPerusahaan from "@/komponen/ui/LencanaPerusahaan";
import FilterProyek from "@/komponen/proyek/FilterProyek";
import NomorDokumenCetak from "@/komponen/penjualan/NomorDokumenCetak";

/** Butir termin lunas: Σ uang muka butir >= nilai butir termasuk PPN (brutoRencana, sama dengan progres termin). */
function terminLunas(rencana: readonly { no: number; jumlah: Desimal; uangMuka: { jumlah: Desimal }[] }[], ppnPersen: Desimal) {
  return brutoRencana(rencana, ppnPersen).filter(({ butir, bruto }) => jumlahkan(butir.uangMuka.map((u) => u.jumlah)).gte(bruto)).length;
}

export default async function HalamanPesananPenjualan({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const pengguna = await wajibHak("pesanan.lihat");
  const boleh = (hak: Hak) => punyaHak(pengguna, hak);
  const bolehHapus = boleh("pesanan.hapus");
  const param = await bacaParamDaftar(searchParams);
  // Lingkup perusahaan (D1 §7.4) dan saringan proyek ?proyek= (D5 §7.3); pencarian tidak berubah (D2 §7.1)
  const [{ perusahaanId }, f] = await Promise.all([lingkupPerusahaan(), searchParams.then((sp) => filterProyekSah(db, bacaFilterProyek(sp)))]);
  const cari = param.q ? { OR: [{ nomor: cocokTeks(param.q) }, { pelanggan: { nama: cocokTeks(param.q) } }] } : {};
  const where = { AND: [cari, saringPerusahaan(perusahaanId), whereFilterProyek(f)] };
  const [total, daftarPesanan, daftarProyek] = await Promise.all([
    db.pesananPenjualan.count({ where }),
    db.pesananPenjualan.findMany({
      where,
      select: {
        id: true,
        nomor: true,
        tanggal: true,
        total: true,
        status: true,
        ppnPersen: true,
        pelanggan: { select: { nama: true } },
        perusahaan: { select: { kode: true, nama: true, warna: true } },
        baris: { select: { jumlah: true, jumlahTerkirim: true, jumlahDifaktur: true } },
        rencanaTermin: { select: { no: true, jumlah: true, uangMuka: { select: { jumlah: true } } } },
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
      <div className="flex items-center justify-between">
        <h1 className="judul-halaman">Pesanan Penjualan</h1>
        {boleh("pesanan.buat") && (
          <Link href="/penjualan/pesanan/baru" className="tombol tombol-utama">
          + Pesanan Baru
        </Link>
        )}
      </div>

      <div className="kartu kartu-tabel">
        <div className="px-5 md:px-6 pt-3">
          <FilterProyek nilai={f} daftar={daftarProyek} tambahan={{ q: param.q || undefined }} />
        </div>
        <KontrolDaftar param={param} total={total} placeholder="Cari nomor / pelanggan…" tambahan={{ proyek: f || undefined }} />
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
            <th className="th-lekat" />
          </tr>
        </thead>
        <tbody>
          {daftarPesanan.map((o) => {
            const terkirimSemua = o.baris.every((l) => Number(l.jumlahTerkirim) >= Number(l.jumlah));
            const difakturSemua = o.baris.every((l) => Number(l.jumlahDifaktur) >= Number(l.jumlah));
            return (
              <tr key={o.id}>
                <td>
                  <Link href={`/penjualan/pesanan/${o.id}`} className="hover:underline">
                    <NomorDokumenCetak nomor={o.nomor} />
                  </Link>
                </td>
                {gabungan && <td><LencanaPerusahaan kode={o.perusahaan.kode} warna={o.perusahaan.warna} nama={o.perusahaan.nama} /></td>}
                <td className="text-slate-500 whitespace-nowrap">{o.tanggal.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}</td>
                <td>{o.pelanggan.nama}</td>
                <td className="text-right angka">{Number(o.total).toLocaleString("id-ID")}</td>
                <td>
                  <LencanaStatus status={o.status} />
                  {o.rencanaTermin.length > 0 && (
                    <span className="block text-[11px] text-slate-500 mt-0.5">
                      Termin {terminLunas(o.rencanaTermin, o.ppnPersen)}/{o.rencanaTermin.length}
                    </span>
                  )}
                </td>
                <td className="space-x-3 whitespace-nowrap td-lekat">
                  {!terkirimSemua && boleh("pengiriman.buat") && (
                    <Link
                      href={`/penjualan/pengiriman/baru?pesananId=${o.id}`}
                      className="tombol-tautan"
                    >
                      Kirim
                    </Link>
                  )}
                  {!difakturSemua && boleh("uang-muka.buat") && (
                    <Link href={`/penjualan/uang-muka/baru?pesananId=${o.id}`} className="tombol-tautan">
                      Uang Muka
                    </Link>
                  )}
                  {!difakturSemua && boleh("faktur.buat") && (
                    <Link
                      href={`/penjualan/faktur/baru?pesananId=${o.id}`}
                      className="tombol-tautan"
                    >
                      Fakturkan
                    </Link>
                  )}
                  <TombolHapusDokumen jenis="pesanan" id={o.id} nomor={o.nomor} boleh={bolehHapus} />
                </td>
              </tr>
            );
          })}
          {daftarPesanan.length === 0 && (
            <tr>
              <td colSpan={gabungan ? 7 : 6} className="kosong">
                {param.q ? "Tidak ada yang cocok dengan pencarian." : f ? "Tidak ada yang cocok dengan saringan proyek." : "Belum ada pesanan."}
              </td>
            </tr>
          )}
        </tbody>
        </table>
      </div></div>
    </div>
  );
}
