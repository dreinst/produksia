import TombolHapusDokumen from "@/komponen/TombolHapusDokumen";
import Link from "next/link";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { punyaHak } from "@/lib/hakAkses";
import { bacaParamDaftar, cocokTeks } from "@/lib/daftar";
import KontrolDaftar from "@/komponen/ui/KontrolDaftar";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import { NomorDokumen } from "@/komponen/ui/Lencana";

export default async function HalamanPenyesuaianPersediaan({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const pengguna = await wajibHak("penyesuaian.lihat");
  const bolehHapus = punyaHak(pengguna, "penyesuaian.hapus");
  const param = await bacaParamDaftar(searchParams);
  const where = param.q ? { OR: [{ nomor: cocokTeks(param.q) }, { keterangan: cocokTeks(param.q) }, { gudang: { nama: cocokTeks(param.q) } }] } : undefined;
  const [total, daftar] = await Promise.all([
    db.penyesuaianPersediaan.count({ where }),
    db.penyesuaianPersediaan.findMany({
      where,
      include: { gudang: true, akunLawan: true, jurnal: { select: { nomor: true } }, baris: true },
      orderBy: { tanggal: "desc" },
      skip: param.lewati,
      take: param.ambil,
    }),
  ]);

  return (
    <div className="space-y-6">
      <KepalaHalaman
        jejak={[{ label: "Persediaan" }, { label: "Stok per Gudang", href: "/persediaan" }]}
        judul="Penyesuaian Stok"
        subjudul="Saldo awal, hasil opname, dan koreksi stok. Setiap penyesuaian otomatis membuat jurnal JU-PS."
        aksi={
          punyaHak(pengguna, "penyesuaian.buat") ? (
            <Link href="/persediaan/penyesuaian/baru" className="tombol tombol-utama">
              + Penyesuaian Baru
            </Link>
          ) : undefined
        }
      />

      <div className="kartu kartu-tabel">
        <KontrolDaftar param={param} total={total} placeholder="Cari nomor / keterangan / gudang…" />
        <div className="bungkus-tabel">
          <table className="tabel min-w-[40rem]">
            <thead>
              <tr>
                <th>No</th>
                <th>Tanggal</th>
                <th>Gudang</th>
                <th>Keterangan</th>
                <th>Akun lawan</th>
                <th className="text-right">Baris</th>
                <th className="text-right">Nilai</th>
                <th>Jurnal</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {daftar.map((p) => {
                const nilai = p.baris.reduce((s, b) => s + (Number(b.jumlahSesudah) - Number(b.jumlahSebelum)) * Number(b.hargaSatuan), 0);
                return (
                  <tr key={p.id}>
                    <td><NomorDokumen nomor={p.nomor} /></td>
                    <td className="text-slate-500 whitespace-nowrap">{p.tanggal.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}</td>
                    <td>{p.gudang.nama}</td>
                    <td className="text-slate-600">{p.keterangan ?? "-"}</td>
                    <td className="text-slate-500">{p.akunLawan.kode} - {p.akunLawan.nama}</td>
                    <td className="text-right angka">{p.baris.length}</td>
                    <td className={`text-right angka font-semibold ${nilai < 0 ? "text-rose-700" : "text-emerald-700"}`}>{nilai.toLocaleString("id-ID")}</td>
                    <td className="mono text-slate-500">{p.jurnal?.nomor ?? "-"}</td>
                    <td className="text-right"><TombolHapusDokumen jenis="penyesuaian" id={p.id} nomor={p.nomor} boleh={bolehHapus} /></td>
                  </tr>
                );
              })}
              {daftar.length === 0 && (
                <tr>
                  <td colSpan={9} className="kosong">
                    {param.q ? "Tidak ada yang cocok dengan pencarian." : "Belum ada penyesuaian."}
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
