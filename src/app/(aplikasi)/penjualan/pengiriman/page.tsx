import { punyaHak } from "@/lib/hakAkses";
import TombolHapusDokumen from "@/komponen/TombolHapusDokumen";
import KontrolDaftar from "@/komponen/ui/KontrolDaftar";
import { bacaParamDaftar, cocokTeks } from "@/lib/daftar";
import { wajibHak } from "@/lib/otentikasi";
import { db } from "@/lib/db";
import { lingkupPerusahaan, saringPerusahaan } from "@/lib/perusahaan";
import LencanaPerusahaan from "@/komponen/ui/LencanaPerusahaan";
import { NomorDokumen, LencanaStatus } from "@/komponen/ui/Lencana";
import AntreanPesanan from "@/komponen/persediaan/AntreanPesanan";
import { pesananMenungguDikirim } from "@/lib/pesananTerbuka";

export default async function HalamanPengiriman({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const pengguna = await wajibHak("pengiriman.lihat");
  const bolehHapus = punyaHak(pengguna, "pengiriman.hapus");
  const bolehBuat = punyaHak(pengguna, "pengiriman.buat");
  const param = await bacaParamDaftar(searchParams);
  // Lingkup perusahaan (D1 §7.4): satu perusahaan = dokumen miliknya; gabungan = semua + kolom Perusahaan
  const { perusahaanId } = await lingkupPerusahaan();
  const cari = param.q ? { OR: [{ nomor: cocokTeks(param.q) }, { pesanan: { nomor: cocokTeks(param.q) } }, { pesanan: { pelanggan: { nama: cocokTeks(param.q) } } }] } : {};
  const where = { AND: [cari, saringPerusahaan(perusahaanId)] };
  const [total, daftarPengiriman, antrean] = await Promise.all([
    db.pengirimanPesanan.count({ where }),
    db.pengirimanPesanan.findMany({ where, include: { pesanan: { include: { pelanggan: true } }, gudang: true, perusahaan: { select: { kode: true, nama: true, warna: true } } }, orderBy: { tanggal: "desc" }, skip: param.lewati, take: param.ambil }),
    // Antrean kerja: jalan masuk Gudang ke formulir Kirim, karena halaman Pesanan Penjualan bukan haknya
    bolehBuat ? pesananMenungguDikirim(perusahaanId) : null,
  ]);

  return (
    <div className="space-y-6">
      <h1 className="judul-halaman">Pengiriman Pesanan</h1>
      <p className="redup">
        {bolehBuat
          ? "Pengiriman dibuat dari pesanan penjualan. Klik \"Kirim\" pada pesanan di daftar \"Menunggu dikirim\"."
          : "Pengiriman dibuat dari pesanan penjualan yang barangnya siap dikirim."}
      </p>

      {antrean && (
        <AntreanPesanan
          antrean={antrean}
          judul="Menunggu dikirim"
          labelMitra="Pelanggan"
          labelSisa="Belum dikirim"
          labelAksi="Kirim"
          hrefFormulir="/penjualan/pengiriman/baru"
          pesanKosong="Tidak ada pesanan penjualan yang barangnya menunggu dikirim."
          gabungan={!perusahaanId}
        />
      )}

      <div className="kartu kartu-tabel">
        <KontrolDaftar param={param} total={total} placeholder="Cari nomor SJ / pesanan / pelanggan…" />
        <div className="bungkus-tabel">
        <table className="tabel min-w-[36rem]">
        <thead>
          <tr>
            <th>No</th>
            {!perusahaanId && <th>Perusahaan</th>}
            <th>Tanggal</th>
            <th>Pesanan</th>
            <th>Pelanggan</th>
            <th>Gudang</th>
            <th>Status</th>
            <th className="th-lekat" />
          </tr>
        </thead>
        <tbody>
          {daftarPengiriman.map((d) => (
            <tr key={d.id}>
              <td><NomorDokumen nomor={d.nomor} /></td>
              {!perusahaanId && <td><LencanaPerusahaan kode={d.perusahaan.kode} warna={d.perusahaan.warna} nama={d.perusahaan.nama} /></td>}
              <td className="text-slate-500 whitespace-nowrap">{d.tanggal.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}</td>
              <td>{d.pesanan.nomor}</td>
              <td>{d.pesanan.pelanggan.nama}</td>
              <td>{d.gudang.nama}</td>
              <td><LencanaStatus status={d.status} /></td>
              <td className="text-right td-lekat"><TombolHapusDokumen jenis="pengiriman" id={d.id} nomor={d.nomor} boleh={bolehHapus} /></td>
            </tr>
          ))}
          {daftarPengiriman.length === 0 && (
            <tr>
              <td colSpan={perusahaanId ? 7 : 8} className="kosong">
                {param.q ? "Tidak ada yang cocok dengan pencarian." : "Belum ada pengiriman."}
              </td>
            </tr>
          )}
        </tbody>
        </table>
      </div></div>
    </div>
  );
}
