import Link from "next/link";
import { db } from "@/lib/db";
import { wajibHak } from "@/lib/otentikasi";
import { punyaHak } from "@/lib/hakAkses";
import { bacaParamDaftar, cocokTeks } from "@/lib/daftar";
import KontrolDaftar from "@/komponen/ui/KontrolDaftar";
import TombolHapusDokumen from "@/komponen/TombolHapusDokumen";
import { NomorDokumen } from "@/komponen/ui/Lencana";
import { SelPersetujuan } from "@/komponen/KontrolPersetujuan";
import KepalaHalaman from "@/komponen/ui/KepalaHalaman";
import LencanaPerusahaan from "@/komponen/ui/LencanaPerusahaan";
import { lingkupPerusahaan } from "@/lib/perusahaan";

const rp = (v: { toString(): string }) => `Rp ${Number(v).toLocaleString("id-ID")}`;

export default async function HalamanPenggajian({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const pengguna = await wajibHak("penggajian.lihat");
  const bolehBuat = punyaHak(pengguna, "penggajian.buat");
  const bolehHapus = punyaHak(pengguna, "penggajian.hapus");
  const param = await bacaParamDaftar(searchParams);
  // Lingkup perusahaan (D1 §7.4, §8.4): satu perusahaan = penggajiannya saja; gabungan = kueri lama + kolom Perusahaan
  const { perusahaanId } = await lingkupPerusahaan();
  const cari = param.q ? { OR: [{ nomor: cocokTeks(param.q) }, { bulan: cocokTeks(param.q) }, { keterangan: cocokTeks(param.q) }] } : undefined;
  const where = perusahaanId ? { AND: [cari ?? {}, { perusahaanId }] } : cari;
  const [total, daftar] = await Promise.all([
    db.penggajian.count({ where }),
    db.penggajian.findMany({
      where,
      include: { akunKas: true, proyek: { select: { kode: true } }, jurnal: { select: { nomor: true } }, baris: { select: { id: true } }, perusahaan: { select: { kode: true, nama: true, warna: true } } },
      // bulan, bukan kunci periode (perusahaan selain utama berakhiran @id); periode hanya pemecah seri
      orderBy: [{ bulan: "desc" }, { periode: "desc" }],
      skip: param.lewati,
      take: param.ambil,
    }),
  ]);

  return (
    <div className="space-y-6">
      <KepalaHalaman
        jejak={[{ label: "SDM" }]}
        judul="Penggajian"
        subjudul="Proses gaji bulanan: satu dokumen per periode. Selama alur persetujuan menyala, beban gaji dan kas keluar baru dijurnal setelah dokumen disetujui pengguna lain."
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
                {!perusahaanId && <th>Perusahaan</th>}
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
                <th>Persetujuan</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {daftar.map((p) => (
                <tr key={p.id}>
                  <td><NomorDokumen nomor={p.nomor} /></td>
                  {!perusahaanId && <td><LencanaPerusahaan kode={p.perusahaan.kode} warna={p.perusahaan.warna} nama={p.perusahaan.nama} /></td>}
                  <td className="mono">{p.bulan}</td>
                  <td className="text-slate-500 whitespace-nowrap">{p.tanggal.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}</td>
                  <td className="text-right angka">{p.baris.length}</td>
                  <td className="text-right angka">{rp(p.totalGajiPokok)}</td>
                  <td className="text-right angka">{rp(p.totalTunjangan)}</td>
                  <td className="text-right angka">{rp(p.totalPotongan)}</td>
                  <td className="text-right angka font-semibold">{rp(p.totalDibayar)}</td>
                  <td className="text-slate-500">{p.akunKas.kode} - {p.akunKas.nama}</td>
                  <td className="text-slate-500">{p.proyek?.kode ?? "-"}</td>
                  <td className="mono text-slate-500">{p.jurnal?.nomor ?? "-"}</td>
                  <td>
                    <SelPersetujuan
                      jenis="penggajian"
                      kode="penggajian"
                      id={p.id}
                      nomor={p.nomor}
                      status={p.statusPersetujuan}
                      diajukanOlehId={p.diajukanOlehId}
                      pengguna={pengguna}
                      catatanPenolakan={p.catatanPenolakan}
                    />
                  </td>
                  <td className="text-right"><TombolHapusDokumen jenis="penggajian" id={p.id} nomor={p.nomor} boleh={bolehHapus} /></td>
                </tr>
              ))}
              {daftar.length === 0 && <tr><td colSpan={perusahaanId ? 13 : 14} className="kosong">{param.q ? "Tidak ada yang cocok." : "Belum ada penggajian."}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
