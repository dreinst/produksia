import Link from "next/link";
import LencanaPerusahaan from "@/komponen/ui/LencanaPerusahaan";
import { BATAS_PESANAN_MENUNGGU, type AntreanPesanan as DataAntrean, type BarisMenunggu } from "@/lib/pesananTerbuka";

const tanggal = (t: Date) => t.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });

/** Sisa kuantitas per barang; dipakai kartu HP dan tabel desktop supaya isinya sama. */
function DaftarSisa({ baris }: { baris: BarisMenunggu[] }) {
  return (
    <ul className="space-y-0.5">
      {baris.map((b) => (
        <li key={b.id}>
          <span className="mono">{b.kode}</span> <span className="text-slate-700">({b.nama})</span>{" "}
          <span className="angka">{b.sisa.toLocaleString("id-ID")}</span> {b.satuan}
        </li>
      ))}
    </ul>
  );
}

/**
 * Kartu antrean kerja gudang di halaman Penerimaan Barang dan Pengiriman: pesanan yang barangnya belum diterima atau
 * dikirim semua, dengan tombol ke formulirnya. Tanpa harga dan total (lihat src/lib/pesananTerbuka.ts).
 */
export default function AntreanPesanan({
  antrean,
  judul,
  labelMitra,
  labelSisa,
  labelAksi,
  hrefFormulir,
  pesanKosong,
  gabungan,
}: {
  antrean: DataAntrean;
  judul: string;
  labelMitra: string;
  labelSisa: string;
  labelAksi: string;
  /** Rute formulir; id pesanan ditempel sebagai ?pesananId= */
  hrefFormulir: string;
  pesanKosong: string;
  /** Lingkup gabungan menampilkan kolom Perusahaan, sama dengan tabel di bawahnya */
  gabungan: boolean;
}) {
  return (
    <div className="kartu kartu-tabel">
      <div className="kepala-kartu">
        <h2 className="judul-kartu">{judul}</h2>
        <span className="text-xs text-slate-500">{antrean.total.toLocaleString("id-ID")} pesanan</span>
      </div>
      {/* HP (< md): kartu per pesanan, karena antrean ini dikerjakan di gudang lewat HP */}
      <div className="md:hidden divide-y divide-slate-100">
        {antrean.daftar.map((p) => (
          <div key={p.id} className="p-4 space-y-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-slate-900">{p.nomor}</span>
              {gabungan && <LencanaPerusahaan kode={p.perusahaan.kode} warna={p.perusahaan.warna} nama={p.perusahaan.nama} />}
            </div>
            <div className="text-slate-600">
              {tanggal(p.tanggal)} · <span className="font-medium text-slate-900">{p.mitra}</span>
            </div>
            <div>
              <div className="text-xs font-semibold text-slate-500">{labelSisa}</div>
              <DaftarSisa baris={p.baris} />
            </div>
            <Link href={`${hrefFormulir}?pesananId=${p.id}`} className="tombol tombol-garis w-full min-h-11">
              {labelAksi}
            </Link>
          </div>
        ))}
        {antrean.daftar.length === 0 && <p className="p-4 text-center redup">{pesanKosong}</p>}
      </div>

      {/* Desktop (md+): tabel */}
      <div className="hidden md:block bungkus-tabel">
        <table className="tabel min-w-[36rem]">
          <thead>
            <tr>
              <th>Pesanan</th>
              {gabungan && <th>Perusahaan</th>}
              <th>Tanggal</th>
              <th>{labelMitra}</th>
              <th>{labelSisa}</th>
              <th className="th-lekat" />
            </tr>
          </thead>
          <tbody>
            {antrean.daftar.map((p) => (
              <tr key={p.id}>
                <td className="whitespace-nowrap">{p.nomor}</td>
                {gabungan && <td><LencanaPerusahaan kode={p.perusahaan.kode} warna={p.perusahaan.warna} nama={p.perusahaan.nama} /></td>}
                <td className="text-slate-500 whitespace-nowrap">{tanggal(p.tanggal)}</td>
                <td>{p.mitra}</td>
                <td><DaftarSisa baris={p.baris} /></td>
                <td className="text-right td-lekat">
                  <Link href={`${hrefFormulir}?pesananId=${p.id}`} className="tombol tombol-garis tombol-kecil">
                    {labelAksi}
                  </Link>
                </td>
              </tr>
            ))}
            {antrean.daftar.length === 0 && (
              <tr>
                <td colSpan={gabungan ? 6 : 5} className="kosong">{pesanKosong}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {antrean.total > antrean.daftar.length && (
        <p className="redup px-5 md:px-6 py-3 border-t border-slate-100">
          Menampilkan {BATAS_PESANAN_MENUNGGU} pesanan terlama dari {antrean.total.toLocaleString("id-ID")}.
        </p>
      )}
    </div>
  );
}
