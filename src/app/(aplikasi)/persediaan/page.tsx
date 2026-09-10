import Link from "next/link";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { punyaHak } from "@/lib/hakAkses";
import { bacaParamDaftar, cocokTeks } from "@/lib/daftar";
import { periksaSinkron } from "@/lib/sinkron";
import KontrolDaftar from "@/komponen/ui/KontrolDaftar";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import Ikon from "@/komponen/ui/Ikon";

export default async function HalamanPersediaan({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const pengguna = await wajibHak("persediaan.lihat");
  const param = await bacaParamDaftar(searchParams);
  const where = param.q
    ? { barang: { OR: [{ kode: cocokTeks(param.q) }, { nama: cocokTeks(param.q) }] } }
    : undefined;
  const [total, daftarStok, semuaStok, sinkron] = await Promise.all([
    db.stokBarang.count({ where }),
    db.stokBarang.findMany({ where, include: { barang: true, gudang: true }, orderBy: [{ barang: { kode: "asc" } }, { gudang: { kode: "asc" } }], skip: param.lewati, take: param.ambil }),
    db.stokBarang.findMany({ include: { barang: { select: { hargaBeli: true, jenis: true } } } }),
    periksaSinkron(db),
  ]);
  const nilaiSeluruh = semuaStok.filter((s) => s.barang.jenis === "BARANG").reduce((t, s) => t + Number(s.jumlah) * Number(s.barang.hargaBeli), 0);

  return (
    <div className="space-y-6">
      <KepalaHalaman
        jejak={[{ label: "Persediaan" }]}
        judul="Stok per Gudang"
        subjudul="Jumlah fisik dan nilainya (harga pokok rata-rata bergerak). Nilai ini harus sama dengan saldo akun Persediaan di buku besar."
        aksi={
          punyaHak(pengguna.peran, "persediaan.tulis") ? (
            <Link href="/persediaan/penyesuaian/baru" className="tombol tombol-utama">
              <Ikon nama="tune" className="!text-[18px]" />
              Penyesuaian Stok
            </Link>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="kartu p-5">
          <div className="teks-label">Nilai persediaan (stok × harga pokok)</div>
          <div className="font-heading text-2xl font-bold angka mt-1">Rp {nilaiSeluruh.toLocaleString("id-ID")}</div>
        </div>
        <div className="kartu p-5">
          <div className="teks-label">Saldo akun Persediaan (buku besar)</div>
          <div className="font-heading text-2xl font-bold angka mt-1">Rp {Number(sinkron.persediaan.bukuBesar).toLocaleString("id-ID")}</div>
        </div>
        <div className={`kartu p-5 ${sinkron.persediaan.sinkron ? "border-emerald-200" : "border-rose-300"}`}>
          <div className="teks-label">Sinkronisasi</div>
          <div className={`font-heading text-2xl font-bold mt-1 ${sinkron.persediaan.sinkron ? "text-emerald-700" : "text-rose-700"}`}>
            {sinkron.persediaan.sinkron ? "Sinkron" : `Selisih Rp ${Number(sinkron.persediaan.selisih).toLocaleString("id-ID")}`}
          </div>
        </div>
      </div>

      <div className="kartu kartu-tabel">
        <KontrolDaftar param={param} total={total} placeholder="Cari kode / nama barang…" />
        <div className="bungkus-tabel">
          <table className="tabel min-w-[40rem]">
            <thead>
              <tr>
                <th>Kode</th>
                <th>Barang</th>
                <th>Gudang</th>
                <th className="text-right">Jumlah</th>
                <th>Satuan</th>
                <th className="text-right">Harga pokok</th>
                <th className="text-right">Nilai</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {daftarStok.map((s) => {
                const jumlah = Number(s.jumlah);
                const minimum = Number(s.barang.stokMinimum);
                const nilai = jumlah * Number(s.barang.hargaBeli);
                return (
                  <tr key={`${s.barangId}-${s.gudangId}`}>
                    <td className="mono">{s.barang.kode}</td>
                    <td className="font-medium text-slate-900">{s.barang.nama}</td>
                    <td className="text-slate-500">{s.gudang.nama}</td>
                    <td className="text-right angka font-semibold">{jumlah.toLocaleString("id-ID")}</td>
                    <td className="text-slate-500">{s.barang.satuan}</td>
                    <td className="text-right angka">{Number(s.barang.hargaBeli).toLocaleString("id-ID")}</td>
                    <td className="text-right angka">{nilai.toLocaleString("id-ID")}</td>
                    <td>
                      {minimum > 0 && jumlah < minimum ? (
                        <span className="lencana lencana-rose">Di bawah minimum {minimum.toLocaleString("id-ID")}</span>
                      ) : jumlah === 0 ? (
                        <span className="lencana lencana-slate">Kosong</span>
                      ) : (
                        <span className="lencana lencana-emerald">Aman</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {daftarStok.length === 0 && (
                <tr>
                  <td colSpan={8} className="kosong">
                    {param.q ? "Tidak ada yang cocok dengan pencarian." : "Belum ada stok. Isi saldo awal lewat Penyesuaian Stok."}
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
