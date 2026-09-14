import Link from "next/link";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { punyaHak } from "@/lib/hakAkses";
import { bacaParamDaftar, cocokTeks } from "@/lib/daftar";
import KontrolDaftar from "@/komponen/ui/KontrolDaftar";
import TombolHapusDokumen from "@/komponen/TombolHapusDokumen";
import { NomorDokumen } from "@/komponen/ui/Lencana";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";

const rp = (v: { toString(): string }) => `Rp ${Number(v).toLocaleString("id-ID")}`;

export default async function HalamanPenggajian({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const pengguna = await wajibHak("penggajian.lihat");
  const bolehBuat = punyaHak(pengguna, "penggajian.buat");
  const bolehHapus = punyaHak(pengguna, "penggajian.hapus");
  const param = await bacaParamDaftar(searchParams);
  const where = param.q ? { OR: [{ nomor: cocokTeks(param.q) }, { periode: cocokTeks(param.q) }, { keterangan: cocokTeks(param.q) }] } : undefined;
  const [total, daftar] = await Promise.all([
    db.penggajian.count({ where }),
    db.penggajian.findMany({
      where,
      include: { akunKas: true, proyek: { select: { kode: true } }, jurnal: { select: { nomor: true } }, baris: { select: { id: true } } },
      orderBy: { periode: "desc" },
      skip: param.lewati,
      take: param.ambil,
    }),
  ]);

  return (
    <div className="space-y-6">
      <KepalaHalaman
        jejak={[{ label: "SDM" }]}
        judul="Penggajian"
        subjudul="Proses gaji bulanan: satu dokumen per periode, langsung menjurnal beban gaji dan mengurangi kas/bank."
        aksi={bolehBuat && (
          <Link href="/sdm/penggajian/baru" className="tombol tombol-utama">
            + Proses Gaji
          </Link>
        )}
      />

      <div className="kartu kartu-tabel">
        <KontrolDaftar param={param} total={total} placeholder="Cari nomor / periode / keterangan…" />
        <div className="bungkus-tabel">
          <table className="tabel min-w-[48rem]">
            <thead>
              <tr>
                <th>No</th>
                <th>Periode</th>
                <th>Tanggal</th>
                <th className="text-right">Karyawan</th>
                <th className="text-right">Gaji pokok</th>
                <th className="text-right">Tunjangan</th>
                <th className="text-right">Potongan</th>
                <th className="text-right">Dibayar</th>
                <th>Dari</th>
                <th>Event</th>
                <th>Jurnal</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {daftar.map((p) => (
                <tr key={p.id}>
                  <td><NomorDokumen nomor={p.nomor} /></td>
                  <td className="mono">{p.periode}</td>
                  <td className="text-slate-500 whitespace-nowrap">{p.tanggal.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}</td>
                  <td className="text-right angka">{p.baris.length}</td>
                  <td className="text-right angka">{rp(p.totalGajiPokok)}</td>
                  <td className="text-right angka">{rp(p.totalTunjangan)}</td>
                  <td className="text-right angka">{rp(p.totalPotongan)}</td>
                  <td className="text-right angka font-semibold">{rp(p.totalDibayar)}</td>
                  <td className="text-slate-500">{p.akunKas.kode} - {p.akunKas.nama}</td>
                  <td className="text-slate-500">{p.proyek?.kode ?? "-"}</td>
                  <td className="mono text-slate-500">{p.jurnal?.nomor ?? "-"}</td>
                  <td className="text-right"><TombolHapusDokumen jenis="penggajian" id={p.id} nomor={p.nomor} boleh={bolehHapus} /></td>
                </tr>
              ))}
              {daftar.length === 0 && <tr><td colSpan={12} className="kosong">{param.q ? "Tidak ada yang cocok." : "Belum ada penggajian."}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
